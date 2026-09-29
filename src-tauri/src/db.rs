//! SQLite storage. The schema is versioned with `PRAGMA user_version`; each
//! entry in `MIGRATIONS` moves the database up one version.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};

use crate::documents::DocumentInfo;
use crate::error::Result;

const MIGRATIONS: &[&str] = &[
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
];

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrate(&mut conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Records that a document was opened (inserting it the first time).
    pub fn record_open(&self, doc: &DocumentInfo) -> Result<()> {
        let conn = self.conn.lock().expect("database lock poisoned");
        conn.execute(
            "INSERT INTO documents (id, path, name, size, first_opened, last_opened)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET
                path = excluded.path,
                name = excluded.name,
                size = excluded.size,
                last_opened = excluded.last_opened",
            params![doc.id, doc.path, doc.name, doc.size as i64, doc.last_opened],
        )?;
        Ok(())
    }

    /// Most recently opened documents, one per path, newest first.
    pub fn recent(&self, limit: u32) -> Result<Vec<DocumentInfo>> {
        let conn = self.conn.lock().expect("database lock poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, path, name, size, last_opened, last_position FROM documents d
             WHERE last_opened = (SELECT MAX(last_opened) FROM documents WHERE path = d.path)
             ORDER BY last_opened DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit], |row| {
            Ok(DocumentInfo {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                size: row.get::<_, i64>(3)? as u64,
                last_opened: row.get(4)?,
                last_position: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Reading position saved for a document (opaque JSON owned by the frontend).
    pub fn last_position(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().expect("database lock poisoned");
        Ok(conn
            .query_row("SELECT last_position FROM documents WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .flatten())
    }

    pub fn save_position(&self, id: &str, position: &str) -> Result<()> {
        let conn = self.conn.lock().expect("database lock poisoned");
        conn.execute("UPDATE documents SET last_position = ?2 WHERE id = ?1", params![id, position])?;
        Ok(())
    }

    pub fn get_state(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().expect("database lock poisoned");
        Ok(conn
            .query_row("SELECT value FROM app_state WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn set_state(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().expect("database lock poisoned");
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
    pub fn document_count(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row("SELECT COUNT(*) FROM documents", [], |r| r.get(0))?)
    }
}

fn migrate(conn: &mut Connection) -> Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
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

    fn doc(id: &str, path: &str, t: i64) -> DocumentInfo {
        DocumentInfo {
            id: id.into(),
            path: path.into(),
            name: "x.pdf".into(),
            size: 10,
            last_opened: t,
            last_position: None,
        }
    }

    #[test]
    fn migrates_to_latest_version() {
        let db = Db::in_memory().unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as i64);
    }

    #[test]
    fn reopening_updates_instead_of_duplicating() {
        let db = Db::in_memory().unwrap();
        db.record_open(&doc("a", "/p/a.pdf", 1)).unwrap();
        db.record_open(&doc("a", "/p/renamed.pdf", 2)).unwrap();
        assert_eq!(db.document_count().unwrap(), 1);
        let recent = db.recent(10).unwrap();
        assert_eq!(recent[0].path, "/p/renamed.pdf");
    }

    #[test]
    fn recent_is_newest_first_and_one_per_path() {
        let db = Db::in_memory().unwrap();
        db.record_open(&doc("a", "/p/a.pdf", 1)).unwrap();
        db.record_open(&doc("b", "/p/b.pdf", 2)).unwrap();
        // Same path, file contents changed: only the newer entry is listed.
        db.record_open(&doc("a2", "/p/a.pdf", 3)).unwrap();
        let ids: Vec<_> = db.recent(10).unwrap().into_iter().map(|d| d.id).collect();
        assert_eq!(ids, ["a2", "b"]);
    }

    #[test]
    fn reading_position_survives_reopening() {
        let db = Db::in_memory().unwrap();
        db.record_open(&doc("a", "/p/a.pdf", 1)).unwrap();
        assert_eq!(db.last_position("a").unwrap(), None);
        db.save_position("a", r#"{"page":3}"#).unwrap();
        db.record_open(&doc("a", "/p/a.pdf", 2)).unwrap();
        assert_eq!(db.last_position("a").unwrap().as_deref(), Some(r#"{"page":3}"#));
        assert_eq!(db.recent(1).unwrap()[0].last_position.as_deref(), Some(r#"{"page":3}"#));
    }

    #[test]
    fn app_state_round_trips() {
        let db = Db::in_memory().unwrap();
        assert_eq!(db.get_state("tabs").unwrap(), None);
        db.set_state("tabs", "[1]").unwrap();
        db.set_state("tabs", "[2]").unwrap();
        assert_eq!(db.get_state("tabs").unwrap().as_deref(), Some("[2]"));
    }
}
