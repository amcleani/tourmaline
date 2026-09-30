//! Works (papers) and the files that are versions of them.

use rusqlite::{params, OptionalExtension, Row};
use serde::Serialize;

use crate::db::{now_millis, Db};
use crate::error::{Error, Result};

/// The file this one replaced at the same path, when the frontend still has
/// to confirm it's the same paper.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviousVersion {
    pub file_id: String,
    pub text_sample: Option<String>,
}

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
    /// Set while this file joined a work as a new version and no text sample
    /// has been recorded for it yet (see `set_text_sample`).
    pub previous_version: Option<PreviousVersion>,
}

/// Identifies a file on disk: what `documents::read` produced, minus the bytes.
pub struct FileKey<'a> {
    pub sha256: &'a str,
    pub path: &'a str,
    pub name: &'a str,
    pub size: u64,
}

const SELECT_INFO: &str = "SELECT f.sha256, f.work_id, f.path, f.name, f.size, f.last_opened, w.last_position,
            CASE WHEN f.text_sample IS NULL THEN f.derived_from END,
            (SELECT text_sample FROM files p WHERE p.sha256 = f.derived_from)
     FROM files f JOIN works w ON w.id = f.work_id";

fn info_from_row(row: &Row) -> rusqlite::Result<DocumentInfo> {
    let previous: Option<String> = row.get(7)?;
    Ok(DocumentInfo {
        file_id: row.get(0)?,
        work_id: row.get(1)?,
        path: row.get(2)?,
        name: row.get(3)?,
        size: row.get::<_, i64>(4)? as u64,
        last_opened: row.get(5)?,
        last_position: row.get(6)?,
        previous_version: match previous {
            Some(file_id) => Some(PreviousVersion { file_id, text_sample: row.get(8)? }),
            None => None,
        },
    })
}

impl Db {
    /// Records that a file was opened and returns it with its work.
    ///
    /// A file seen before (same bytes) keeps its work wherever it now lives.
    /// New bytes at any path a known file was seen at are a new version of
    /// that work, so it inherits the annotations (the frontend then checks
    /// the text really is the same paper). Anything else starts a new work.
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
                    "SELECT f.sha256, f.work_id FROM file_paths p JOIN files f ON f.sha256 = p.sha256
                     WHERE p.path = ?1 ORDER BY p.last_seen DESC LIMIT 1",
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
        tx.execute(
            "INSERT INTO file_paths (sha256, path, last_seen) VALUES (?1, ?2, ?3)
             ON CONFLICT(sha256, path) DO UPDATE SET last_seen = excluded.last_seen",
            params![file.sha256, file.path, now],
        )?;
        let info = tx.query_row(&format!("{SELECT_INFO} WHERE f.sha256 = ?1"), [file.sha256], info_from_row)?;
        tx.commit()?;
        Ok(info)
    }

    /// Records the start of a file's text (once). After that the file no
    /// longer asks to be compared with the version it replaced.
    pub fn set_text_sample(&self, file_id: &str, sample: &str) -> Result<()> {
        self.conn().execute(
            "UPDATE files SET text_sample = ?2 WHERE sha256 = ?1 AND text_sample IS NULL",
            params![file_id, sample],
        )?;
        Ok(())
    }

    /// The file turned out to be a different paper from the one it replaced:
    /// give it a work of its own, without the other paper's annotations.
    pub fn detach_file(&self, file_id: &str, sample: &str) -> Result<DocumentInfo> {
        let now = now_millis();
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let name: String = tx
            .query_row("SELECT name FROM files WHERE sha256 = ?1", [file_id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| Error::Message(format!("no file {file_id}")))?;
        let work = uuid::Uuid::new_v4().to_string();
        tx.execute("INSERT INTO works (id, title, created) VALUES (?1, ?2, ?3)", params![work, name, now])?;
        tx.execute(
            "UPDATE files SET work_id = ?2, derived_from = NULL, text_sample = ?3 WHERE sha256 = ?1",
            params![file_id, work, sample],
        )?;
        // Placements the other paper's annotations may have been given here.
        tx.execute("DELETE FROM annotation_placements WHERE file_sha256 = ?1", [file_id])?;
        let info = tx.query_row(&format!("{SELECT_INFO} WHERE f.sha256 = ?1"), [file_id], info_from_row)?;
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
        assert_eq!(v1.previous_version, None);
        db.set_text_sample("a", "sample one").unwrap();
        let v2 = open(&db, "a2", "/P/A.pdf", 2);
        assert_eq!(v2.work_id, v1.work_id);
        assert_eq!(v2.file_id, "a2");
        assert_eq!(
            v2.previous_version,
            Some(PreviousVersion { file_id: "a".into(), text_sample: Some("sample one".into()) })
        );
        // Asked until the frontend has checked it.
        assert!(open(&db, "a2", "/p/a.pdf", 3).previous_version.is_some());
        db.set_text_sample("a2", "sample two").unwrap();
        assert_eq!(open(&db, "a2", "/p/a.pdf", 4).previous_version, None);
    }

    #[test]
    fn a_copy_opened_elsewhere_doesnt_lose_the_original_path() {
        let db = Db::in_memory().unwrap();
        let v1 = open(&db, "a", "/lib/X.pdf", 1);
        open(&db, "a", "/downloads/X.pdf", 2);
        // The library copy is then replaced by a new version.
        let v2 = open(&db, "a2", "/lib/X.pdf", 3);
        assert_eq!(v2.work_id, v1.work_id);
    }

    #[test]
    fn a_different_paper_can_be_detached() {
        let db = Db::in_memory().unwrap();
        let v1 = open(&db, "a", "/dl/paper.pdf", 1);
        let other = open(&db, "b", "/dl/paper.pdf", 2);
        assert_eq!(other.work_id, v1.work_id);
        let detached = db.detach_file("b", "other text").unwrap();
        assert_ne!(detached.work_id, v1.work_id);
        assert_eq!(detached.previous_version, None);
        assert_eq!(detached.last_position, None);
        assert_eq!(open(&db, "b", "/dl/paper.pdf", 3).work_id, detached.work_id);
        assert_eq!(db.recent(10).unwrap().len(), 2, "both papers are in Recent");
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
                "INSERT INTO documents VALUES ('old', 'C:/p/a.pdf', 'a.pdf', 1, 1, 2, '{\"page\":1}');
                 INSERT INTO documents VALUES ('new', 'c:/P/A.pdf', 'A.pdf', 1, 3, 4, '{\"page\":9}');
                 INSERT INTO documents VALUES ('b', 'C:/p/b.pdf', 'b.pdf', 1, 5, 5, NULL);",
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        // Paths differing only in case are one paper.
        assert_eq!(db.count("works").unwrap(), 2);
        assert_eq!(db.count("files").unwrap(), 3);
        assert_eq!(db.count("file_paths").unwrap(), 3);
        let recent = db.recent(10).unwrap();
        assert_eq!(recent[0].file_id, "b");
        assert_eq!(recent[1].file_id, "new");
        assert_eq!(recent[1].last_position.as_deref(), Some(r#"{"page":9}"#));
        // Both versions of a.pdf are one work, and it keeps it on reopening.
        let again = open(&db, "old", "C:/p/a.pdf", 10);
        assert_eq!(again.work_id, recent[1].work_id);
        assert_eq!(again.work_id.len(), 36);
        // A third version at the older spelling of the path joins it too.
        assert_eq!(open(&db, "v3", "C:/p/a.pdf", 11).work_id, recent[1].work_id);
    }
}
