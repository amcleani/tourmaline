//! Works (papers) and the files that are versions of them.

use rusqlite::{params, OptionalExtension, Row};
use serde::Serialize;

use crate::db::Db;
use crate::error::Result;

/// A file the user has opened, with the work it belongs to.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    /// SHA-256 of this exact version of the file.
    pub file_id: String,
    /// The paper: owns annotations and the reading position, and survives
    /// renames, moves and new versions of the file.
    pub work_id: String,
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Unix milliseconds.
    pub last_opened: i64,
    /// Reading position as JSON written by the frontend.
    pub last_position: Option<String>,
}

/// Identifies a file on disk: what `documents::read` produced, minus the bytes.
pub struct FileKey<'a> {
    pub sha256: &'a str,
    pub path: &'a str,
    pub name: &'a str,
    pub size: u64,
}

const SELECT_INFO: &str = "SELECT f.sha256, f.work_id, f.path, f.name, f.size, f.last_opened, w.last_position
     FROM files f JOIN works w ON w.id = f.work_id";

fn info_from_row(row: &Row) -> rusqlite::Result<DocumentInfo> {
    Ok(DocumentInfo {
        file_id: row.get(0)?,
        work_id: row.get(1)?,
        path: row.get(2)?,
        name: row.get(3)?,
        size: row.get::<_, i64>(4)? as u64,
        last_opened: row.get(5)?,
        last_position: row.get(6)?,
    })
}

impl Db {
    /// Records that a file was opened and returns it with its work.
    ///
    /// A file seen before (same bytes) keeps its work wherever it now lives.
    /// New bytes at the path of a known file are a new version of that work,
    /// so it inherits the annotations. Anything else starts a new work.
    pub fn record_open(&self, file: &FileKey, now: i64) -> Result<DocumentInfo> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let known: Option<String> = tx
            .query_row("SELECT work_id FROM files WHERE sha256 = ?1", [file.sha256], |r| r.get(0))
            .optional()?;
        if known.is_some() {
            tx.execute(
                "UPDATE files SET path = ?2, name = ?3, last_opened = ?4 WHERE sha256 = ?1",
                params![file.sha256, file.path, file.name, now],
            )?;
        } else {
            let previous: Option<(String, String)> = tx
                .query_row(
                    "SELECT sha256, work_id FROM files WHERE path = ?1 COLLATE NOCASE
                     ORDER BY last_opened DESC LIMIT 1",
                    [file.path],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let (work_id, derived_from) = match previous {
                Some((sha, work)) => (work, Some(sha)),
                None => {
                    let work = uuid::Uuid::new_v4().to_string();
                    tx.execute(
                        "INSERT INTO works (id, title, created) VALUES (?1, ?2, ?3)",
                        params![work, file.name, now],
                    )?;
                    (work, None)
                }
            };
            tx.execute(
                "INSERT INTO files (sha256, work_id, path, name, size, origin, derived_from, first_opened, last_opened)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'opened', ?6, ?7, ?7)",
                params![file.sha256, work_id, file.path, file.name, file.size as i64, derived_from, now],
            )?;
        }
        let info = tx.query_row(&format!("{SELECT_INFO} WHERE f.sha256 = ?1"), [file.sha256], info_from_row)?;
        tx.commit()?;
        Ok(info)
    }

    /// Most recently opened works, newest first, each with its latest file.
    pub fn recent(&self, limit: u32) -> Result<Vec<DocumentInfo>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(&format!(
            "{SELECT_INFO}
             WHERE f.last_opened = (SELECT MAX(last_opened) FROM files WHERE work_id = f.work_id)
             GROUP BY f.work_id
             ORDER BY f.last_opened DESC
             LIMIT ?1"
        ))?;
        let rows = stmt.query_map([limit], info_from_row)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn save_position(&self, work_id: &str, position: &str) -> Result<()> {
        self.conn()
            .execute("UPDATE works SET last_position = ?2 WHERE id = ?1", params![work_id, position])?;
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Opens a fake file whose contents hash to `sha`.
    pub fn open(db: &Db, sha: &str, path: &str, t: i64) -> DocumentInfo {
        let name = path.rsplit('/').next().unwrap();
        db.record_open(&FileKey { sha256: sha, path, name, size: 10 }, t).unwrap()
    }

    #[test]
    fn same_bytes_keep_their_work_across_renames() {
        let db = Db::in_memory().unwrap();
        let a = open(&db, "a", "/p/a.pdf", 1);
        let moved = open(&db, "a", "/q/renamed.pdf", 2);
        assert_eq!(moved.work_id, a.work_id);
        assert_eq!(moved.path, "/q/renamed.pdf");
        assert_eq!(db.count("files").unwrap(), 1);
        assert_eq!(db.count("works").unwrap(), 1);
    }

    #[test]
    fn new_bytes_at_a_known_path_are_a_new_version() {
        let db = Db::in_memory().unwrap();
        let v1 = open(&db, "a", "/p/a.pdf", 1);
        let v2 = open(&db, "a2", "/P/A.pdf", 2);
        assert_eq!(v2.work_id, v1.work_id);
        assert_eq!(v2.file_id, "a2");
        assert_eq!(db.count("files").unwrap(), 2);
        let derived: Option<String> = db
            .conn()
            .query_row("SELECT derived_from FROM files WHERE sha256 = 'a2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(derived.as_deref(), Some("a"));
    }

    #[test]
    fn different_files_are_different_works() {
        let db = Db::in_memory().unwrap();
        let a = open(&db, "a", "/p/a.pdf", 1);
        let b = open(&db, "b", "/p/b.pdf", 2);
        assert_ne!(a.work_id, b.work_id);
    }

    #[test]
    fn recent_is_newest_first_one_per_work() {
        let db = Db::in_memory().unwrap();
        open(&db, "a", "/p/a.pdf", 1);
        open(&db, "b", "/p/b.pdf", 2);
        open(&db, "a2", "/p/a.pdf", 3);
        let ids: Vec<_> = db.recent(10).unwrap().into_iter().map(|d| d.file_id).collect();
        assert_eq!(ids, ["a2", "b"]);
    }

    #[test]
    fn reading_position_belongs_to_the_work() {
        let db = Db::in_memory().unwrap();
        let v1 = open(&db, "a", "/p/a.pdf", 1);
        assert_eq!(v1.last_position, None);
        db.save_position(&v1.work_id, r#"{"page":3}"#).unwrap();
        let v2 = open(&db, "a2", "/p/a.pdf", 2);
        assert_eq!(v2.last_position.as_deref(), Some(r#"{"page":3}"#));
        assert_eq!(db.recent(1).unwrap()[0].last_position.as_deref(), Some(r#"{"page":3}"#));
    }

    #[test]
    fn migration_turns_documents_into_works_and_files() {
        use rusqlite::Connection;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite3");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(crate::db::MIGRATIONS[0]).unwrap();
            conn.execute_batch(crate::db::MIGRATIONS[1]).unwrap();
            conn.pragma_update(None, "user_version", 2).unwrap();
            conn.execute_batch(
                "INSERT INTO documents VALUES ('old', '/p/a.pdf', 'a.pdf', 1, 1, 2, '{\"page\":1}');
                 INSERT INTO documents VALUES ('new', '/p/a.pdf', 'a.pdf', 1, 3, 4, '{\"page\":9}');
                 INSERT INTO documents VALUES ('b', '/p/b.pdf', 'b.pdf', 1, 5, 5, NULL);",
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        assert_eq!(db.count("works").unwrap(), 2);
        assert_eq!(db.count("files").unwrap(), 3);
        let recent = db.recent(10).unwrap();
        assert_eq!(recent[0].file_id, "b");
        assert_eq!(recent[1].file_id, "new");
        assert_eq!(recent[1].last_position.as_deref(), Some(r#"{"page":9}"#));
        // Both versions of a.pdf are one work, and it keeps it on reopening.
        let again = open(&db, "old", "/p/a.pdf", 10);
        assert_eq!(again.work_id, recent[1].work_id);
        assert_eq!(again.work_id.len(), 36);
    }
}
