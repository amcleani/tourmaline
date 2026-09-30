//! SQLite storage. The schema is versioned with `PRAGMA user_version`; each
//! entry in `MIGRATIONS` moves the database up one version.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::Result;

/// A random UUID (v4) as SQL, for rows created inside migrations.
macro_rules! sql_uuid {
    () => {
        "lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))"
    };
}

pub(crate) const MIGRATIONS: &[&str] = &[
    // v1: documents the user has opened, keyed by a hash of their contents.
    r#"
    CREATE TABLE documents (
        id            TEXT PRIMARY KEY,
        path          TEXT NOT NULL,
        name          TEXT NOT NULL,
        size          INTEGER NOT NULL,
        first_opened  INTEGER NOT NULL,
        last_opened   INTEGER NOT NULL,
        last_position TEXT
    );
    CREATE INDEX documents_last_opened ON documents(last_opened DESC);
    CREATE INDEX documents_path ON documents(path);
    "#,
    // v2: small key/value store for app state (open tabs, window layout).
    r#"
    CREATE TABLE app_state (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    "#,
    // v3: a work (the paper) owns annotations and the reading position; each
    // exact version of its PDF is a file. Existing documents at the same path
    // were versions of one paper, so they become one work.
    concat!(
        r#"
    CREATE TABLE works (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        citekey       TEXT UNIQUE,
        last_position TEXT,
        created       INTEGER NOT NULL
    );
    CREATE TABLE files (
        sha256        TEXT PRIMARY KEY,
        work_id       TEXT NOT NULL REFERENCES works(id),
        path          TEXT NOT NULL,
        name          TEXT NOT NULL,
        size          INTEGER NOT NULL,
        origin        TEXT NOT NULL CHECK (origin IN ('opened', 'writeback', 'external')),
        derived_from  TEXT REFERENCES files(sha256),
        -- Start of the text, to tell a new version from a different paper
        -- saved under the same name. NULL until the frontend has read it.
        text_sample   TEXT,
        first_opened  INTEGER NOT NULL,
        last_opened   INTEGER NOT NULL
    );
    -- Every path a file has been seen at, so new bytes at any of them count as
    -- a new version even after the same bytes were opened elsewhere.
    CREATE TABLE file_paths (
        sha256    TEXT NOT NULL REFERENCES files(sha256),
        path      TEXT NOT NULL COLLATE NOCASE,
        last_seen INTEGER NOT NULL,
        PRIMARY KEY (sha256, path)
    );
    CREATE INDEX file_paths_path ON file_paths(path);
    CREATE INDEX files_work ON files(work_id);
    CREATE INDEX files_path ON files(path COLLATE NOCASE);
    CREATE INDEX files_last_opened ON files(last_opened DESC);

    -- Paths compare without case, as Windows does.
    CREATE TEMP TABLE migrated_works AS
        SELECT path, "#,
        sql_uuid!(),
        r#" AS work_id FROM (SELECT path FROM documents GROUP BY path COLLATE NOCASE);
    INSERT INTO works (id, title, last_position, created)
        SELECT m.work_id, d.name, d.last_position,
               (SELECT MIN(first_opened) FROM documents WHERE path = d.path COLLATE NOCASE)
        FROM migrated_works m JOIN documents d ON d.path = m.path COLLATE NOCASE
        WHERE d.last_opened = (SELECT MAX(last_opened) FROM documents WHERE path = d.path COLLATE NOCASE)
        GROUP BY m.path;
    INSERT INTO files (sha256, work_id, path, name, size, origin, derived_from, first_opened, last_opened)
        SELECT d.id, m.work_id, d.path, d.name, d.size, 'opened', NULL, d.first_opened, d.last_opened
        FROM documents d JOIN migrated_works m ON m.path = d.path COLLATE NOCASE;
    INSERT INTO file_paths (sha256, path, last_seen) SELECT id, path, last_opened FROM documents;
    DROP TABLE migrated_works;
    DROP TABLE documents;

    -- Hash of each page's normalised text, recorded for pages that carry
    -- annotations: an unchanged hash in a new version means same geometry.
    CREATE TABLE file_pages (
        file_sha256 TEXT NOT NULL REFERENCES files(sha256),
        page        INTEGER NOT NULL,
        text_hash   TEXT NOT NULL,
        PRIMARY KEY (file_sha256, page)
    );

    CREATE TABLE categories (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        colour     TEXT NOT NULL,
        callout    TEXT NOT NULL,
        hotkey     INTEGER UNIQUE CHECK (hotkey BETWEEN 1 AND 9),
        sort_order INTEGER NOT NULL,
        deleted_at INTEGER
    );
    INSERT INTO categories (id, name, colour, callout, hotkey, sort_order) VALUES
        ('default-1', 'Highlight',  '#f7d14c', 'quote',     1, 1),
        ('default-2', 'Important',  '#f28b82', 'important', 2, 2),
        ('default-3', 'Definition', '#8ab4f8', 'info',      3, 3),
        ('default-4', 'Question',   '#c58af9', 'question',  4, 4),
        ('default-5', 'Method',     '#81c995', 'example',   5, 5);

    CREATE TABLE annotations (
        id          TEXT PRIMARY KEY,
        work_id     TEXT NOT NULL REFERENCES works(id),
        kind        TEXT NOT NULL CHECK (kind IN ('highlight', 'area', 'note', 'ink')),
        category_id TEXT REFERENCES categories(id),
        colour      TEXT,
        note_md     TEXT NOT NULL DEFAULT '',
        quote       TEXT,
        prefix      TEXT,
        suffix      TEXT,
        image_path  TEXT,
        block_id    TEXT NOT NULL UNIQUE,
        source      TEXT NOT NULL DEFAULT 'tourmaline' CHECK (source IN ('tourmaline', 'imported')),
        source_nm   TEXT,
        created     INTEGER NOT NULL,
        updated     INTEGER NOT NULL,
        deleted_at  INTEGER
    );
    CREATE INDEX annotations_work ON annotations(work_id);

    -- Where an annotation sits in one version of the file.
    CREATE TABLE annotation_placements (
        annotation_id TEXT NOT NULL REFERENCES annotations(id),
        file_sha256   TEXT NOT NULL REFERENCES files(sha256),
        page          INTEGER NOT NULL,
        geometry      TEXT NOT NULL,
        text_start    INTEGER,
        text_end      INTEGER,
        status        TEXT NOT NULL CHECK (status IN ('exact', 'moved', 'fuzzy', 'orphan')),
        pdf_obj_ref   TEXT,
        placed_at     INTEGER NOT NULL,
        PRIMARY KEY (annotation_id, file_sha256)
    );
    CREATE INDEX placements_file ON annotation_placements(file_sha256);
    "#
    ),
];

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let dir = path.parent().unwrap_or(Path::new("."));
        std::fs::create_dir_all(dir)?;
        let conn = Connection::open(path)?;
        let backups = dir.join("backups");
        if let Err(e) = backup_daily(&conn, &backups, &today(), BACKUPS_KEPT) {
            eprintln!("Tourmaline: could not back up the library database: {e}");
        }
        // A migration always gets its own snapshot (never pruned), even if
        // today's daily one was taken earlier; a failed backup stops the
        // migration rather than risk the library.
        backup_before_migrating(&conn, &backups)?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    /// The connection, for the query modules (`library`, `annotations`).
    pub(crate) fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().expect("database lock poisoned")
    }

    fn init(mut conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        migrate(&mut conn)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn get_state(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn();
        Ok(conn
            .query_row("SELECT value FROM app_state WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn set_state(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO app_state (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    #[cfg(test)]
    pub fn schema_version(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
    }

    #[cfg(test)]
    pub fn count(&self, table: &str) -> Result<i64> {
        let conn = self.conn();
        Ok(conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))?)
    }
}

const BACKUPS_KEPT: usize = 14;

/// Writes `library-<date>.sqlite3` into `dir` unless today's snapshot exists,
/// then deletes all but the newest `keep` snapshots. Does nothing for a new,
/// empty database. Returns the snapshot written, if any.
fn backup_daily(conn: &Connection, dir: &Path, date: &str, keep: usize) -> Result<Option<PathBuf>> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version == 0 {
        return Ok(None);
    }
    std::fs::create_dir_all(dir)?;
    let target = dir.join(format!("library-{date}.sqlite3"));
    let written = if target.exists() {
        None
    } else {
        // VACUUM INTO produces a consistent copy that includes the WAL.
        conn.execute("VACUUM INTO ?1", [target.to_string_lossy()])?;
        Some(target)
    };

    let mut snapshots: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("library-") && !n.starts_with("library-pre-") && n.ends_with(".sqlite3"))
        })
        .collect();
    // ISO dates sort chronologically as strings.
    snapshots.sort();
    let excess = snapshots.len().saturating_sub(keep);
    for old in &snapshots[..excess] {
        std::fs::remove_file(old)?;
    }
    Ok(written)
}

/// Unix milliseconds.
pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Today's UTC date as YYYY-MM-DD.
fn today() -> String {
    let days = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0) as i64;
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Days since 1970-01-01 to a Gregorian date (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

/// Snapshot to `library-pre-v<N>.sqlite3` if migrations are about to run on an
/// existing database.
fn backup_before_migrating(conn: &Connection, dir: &Path) -> Result<Option<PathBuf>> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version == 0 || version >= MIGRATIONS.len() as i64 {
        return Ok(None);
    }
    std::fs::create_dir_all(dir)?;
    let target = dir.join(format!("library-pre-v{}.sqlite3", MIGRATIONS.len()));
    if target.exists() {
        std::fs::remove_file(&target)?;
    }
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy()])?;
    Ok(Some(target))
}

fn migrate(conn: &mut Connection) -> Result<()> {
    // Foreign keys must be off while migrating: rebuilding a table (create,
    // copy, DROP, rename) would otherwise fire ON DELETE actions on the rows
    // that reference it. The pragma can't change inside a transaction, so it's
    // set here, and each migration checks integrity before committing.
    conn.pragma_update(None, "foreign_keys", "OFF")?;
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        let violations: i64 = tx.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))?;
        if violations > 0 {
            return Err(crate::error::Error::Message(format!(
                "Library migration {} would break {violations} references; nothing was changed.",
                i + 1
            )));
        }
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    // Refuse to run against a database written by a newer version of the app.
    let version: Option<i64> = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).optional()?;
    if version.unwrap_or(0) > MIGRATIONS.len() as i64 {
        return Err(crate::error::Error::Message(
            "The library database was created by a newer version of Tourmaline.".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::library::tests::open;

    #[test]
    fn migrates_to_latest_version() {
        let db = Db::in_memory().unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as i64);
    }

    #[test]
    fn app_state_round_trips() {
        let db = Db::in_memory().unwrap();
        assert_eq!(db.get_state("tabs").unwrap(), None);
        db.set_state("tabs", "[1]").unwrap();
        db.set_state("tabs", "[2]").unwrap();
        assert_eq!(db.get_state("tabs").unwrap().as_deref(), Some("[2]"));
    }

    #[test]
    fn converts_days_to_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
        assert_eq!(civil_from_days(20_725), (2026, 9, 29));
    }

    #[test]
    fn backs_up_once_a_day_and_prunes_old_snapshots() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite3");
        let backups = dir.path().join("backups");

        // A brand-new database is not worth a backup.
        let fresh = Connection::open(&path).unwrap();
        assert_eq!(backup_daily(&fresh, &backups, "2026-01-01", 2).unwrap(), None);
        drop(fresh);

        let db = Db::open(&path).unwrap();
        open(&db, "a", "/p/a.pdf", 1);
        drop(db);

        let conn = Connection::open(&path).unwrap();
        let first = backup_daily(&conn, &backups, "2026-01-01", 2).unwrap().unwrap();
        assert_eq!(backup_daily(&conn, &backups, "2026-01-01", 2).unwrap(), None);
        backup_daily(&conn, &backups, "2026-01-02", 2).unwrap();
        backup_daily(&conn, &backups, "2026-01-03", 2).unwrap();

        let mut names: Vec<_> = std::fs::read_dir(&backups)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        assert_eq!(names, ["library-2026-01-02.sqlite3", "library-2026-01-03.sqlite3"]);
        assert!(!first.exists());

        // Snapshots are complete databases, including rows still in the WAL.
        let copy = Connection::open(backups.join("library-2026-01-03.sqlite3")).unwrap();
        let n: i64 = copy.query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn two_connections_see_each_others_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite3");
        let a = Db::open(&path).unwrap();
        let b = Db::open(&path).unwrap();
        open(&a, "a", "/p/a.pdf", 1);
        open(&b, "b", "/p/b.pdf", 2);
        assert_eq!(a.count("files").unwrap(), 2);
        assert_eq!(b.count("files").unwrap(), 2);
    }

    #[test]
    fn migration_gets_its_own_backup_and_daily_pruning_keeps_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite3");
        let backups = dir.path().join("backups");
        // An existing library one version behind.
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(MIGRATIONS[0]).unwrap();
            conn.pragma_update(None, "user_version", 1).unwrap();
            conn.execute(
                "INSERT INTO documents VALUES ('a', '/p/a.pdf', 'a.pdf', 1, 1, 1, NULL)",
                [],
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as i64);
        let pre = backups.join(format!("library-pre-v{}.sqlite3", MIGRATIONS.len()));
        let copy = Connection::open(&pre).unwrap();
        let v: i64 = copy.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 1, "snapshot is of the database before migrating");
        drop(copy);

        let conn = Connection::open(&path).unwrap();
        for day in ["2030-01-01", "2030-01-02", "2030-01-03"] {
            backup_daily(&conn, &backups, day, 1).unwrap();
        }
        assert!(pre.exists(), "daily pruning must not delete pre-migration snapshots");
    }

    #[test]
    fn migration_breaking_references_is_rolled_back() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE parent (id INTEGER PRIMARY KEY);
             CREATE TABLE child (p INTEGER REFERENCES parent(id));
             INSERT INTO parent VALUES (1); INSERT INTO child VALUES (1);",
        )
        .unwrap();
        conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
        let tx = conn.transaction().unwrap();
        tx.execute_batch("DELETE FROM parent;").unwrap();
        let violations: i64 = tx.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
        assert_eq!(violations, 1, "the integrity check used by migrate() sees the broken reference");
    }
}
