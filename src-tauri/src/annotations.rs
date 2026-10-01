//! Annotations, where they sit in each version of a file, and categories.
//!
//! Geometry is JSON owned by the frontend (PDF user space); the database only
//! stores it. Deletes are soft so export can remove the note's block later and
//! undo can bring an annotation back.

use rusqlite::{params, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};

use crate::db::{now_millis, Db};
use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    /// 0-based page the annotation starts on.
    pub page: u32,
    pub geometry: serde_json::Value,
    /// Character range in the page's normalised text, for text highlights.
    pub text_start: Option<i64>,
    pub text_end: Option<i64>,
    /// exact | moved | fuzzy | orphan
    pub status: String,
    /// The PDF object this annotation is in this file ("412R"): an imported
    /// annotation's original, or what write-back wrote. For `{{pdfLink}}`.
    #[serde(default)]
    pub pdf_ref: Option<String>,
}

/// The most recent placement on another version of the file, for re-anchoring.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fallback {
    pub file_id: String,
    pub placement: Placement,
    /// Hash of that page's text in that file, if recorded.
    pub page_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub work_id: String,
    pub kind: String,
    pub category_id: Option<String>,
    pub colour: Option<String>,
    pub note: String,
    pub quote: Option<String>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub image_path: Option<String>,
    pub block_id: String,
    pub source: String,
    /// Imported from a PDF: "nm:<its /NM>" or "pos:…" (see importPdf.ts).
    pub source_nm: Option<String>,
    pub created: i64,
    pub updated: i64,
    /// Where it sits in the file asked about; None if not placed there yet.
    pub placement: Option<Placement>,
    /// Set when `placement` is None and another version has one.
    pub fallback: Option<Fallback>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageHash {
    pub page: u32,
    pub hash: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAnnotation {
    pub work_id: String,
    pub file_id: String,
    pub kind: String,
    pub category_id: Option<String>,
    pub colour: Option<String>,
    #[serde(default)]
    pub note: String,
    pub quote: Option<String>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub placement: Placement,
    #[serde(default)]
    pub page_hashes: Vec<PageHash>,
    /// Set for annotations imported from the PDF: its `/NM`, or a key made
    /// from its position when it has none. One per work, ever.
    #[serde(default)]
    pub source_nm: Option<String>,
    /// When it was made (imported annotations keep their date), Unix ms.
    #[serde(default)]
    pub created: Option<i64>,
}

/// What `import_annotations` did.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub created: Vec<Annotation>,
    /// Keys that were imported before (even if since deleted): not imported again.
    pub existing: Vec<String>,
}

/// The fields the user edits. All are written, so send the current values.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationEdit {
    pub category_id: Option<String>,
    pub colour: Option<String>,
    pub note: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementUpdate {
    pub annotation_id: String,
    pub placement: Placement,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    /// #rrggbb
    pub colour: String,
    /// Obsidian callout type used on export (quote, important, info, ...).
    pub callout: String,
    /// Digit key 1-9 that highlights with this category.
    pub hotkey: Option<u8>,
    /// Deleted categories are still returned so their annotations keep a colour.
    #[serde(default)]
    pub deleted: bool,
}

const SELECT_ANNOTATION: &str = "SELECT a.id, a.work_id, a.kind, a.category_id, a.colour, a.note_md, a.quote, a.prefix,
            a.suffix, a.image_path, a.block_id, a.source, a.created, a.updated,
            p.page, p.geometry, p.text_start, p.text_end, p.status, a.source_nm, p.pdf_obj_ref
     FROM annotations a
     LEFT JOIN annotation_placements p ON p.annotation_id = a.id AND p.file_sha256 = ?2";

fn placement_from(row: &Row, first: usize) -> rusqlite::Result<Option<Placement>> {
    let Some(page) = row.get::<_, Option<u32>>(first)? else {
        return Ok(None);
    };
    let geometry: String = row.get(first + 1)?;
    Ok(Some(Placement {
        page,
        geometry: serde_json::from_str(&geometry).unwrap_or(serde_json::Value::Null),
        text_start: row.get(first + 2)?,
        text_end: row.get(first + 3)?,
        status: row.get(first + 4)?,
        pdf_ref: None,
    }))
}

fn annotation_from(row: &Row) -> rusqlite::Result<Annotation> {
    Ok(Annotation {
        id: row.get(0)?,
        work_id: row.get(1)?,
        kind: row.get(2)?,
        category_id: row.get(3)?,
        colour: row.get(4)?,
        note: row.get(5)?,
        quote: row.get(6)?,
        prefix: row.get(7)?,
        suffix: row.get(8)?,
        image_path: row.get(9)?,
        block_id: row.get(10)?,
        source: row.get(11)?,
        source_nm: row.get(19)?,
        created: row.get(12)?,
        updated: row.get(13)?,
        placement: match placement_from(row, 14)? {
            Some(p) => Some(Placement { pdf_ref: row.get(20)?, ..p }),
            None => None,
        },
        fallback: None,
    })
}

fn fallback_for(tx: &rusqlite::Connection, annotation_id: &str, file_id: &str) -> rusqlite::Result<Option<Fallback>> {
    tx.query_row(
        "SELECT p.file_sha256, p.page, p.geometry, p.text_start, p.text_end, p.status, fp.text_hash
         FROM annotation_placements p
         LEFT JOIN file_pages fp ON fp.file_sha256 = p.file_sha256 AND fp.page = p.page
         WHERE p.annotation_id = ?1 AND p.file_sha256 != ?2 AND p.status != 'orphan'
         ORDER BY p.placed_at DESC LIMIT 1",
        params![annotation_id, file_id],
        |row| {
            Ok(Fallback {
                file_id: row.get(0)?,
                placement: placement_from(row, 1)?.expect("page is NOT NULL"),
                page_hash: row.get(6)?,
            })
        },
    )
    .optional()
}

/// `^hl-` block ids: six base36 characters.
fn new_block_id() -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut n = uuid::Uuid::new_v4().as_u128();
    let mut id = String::from("hl-");
    for _ in 0..6 {
        id.push(DIGITS[(n % 36) as usize] as char);
        n /= 36;
    }
    id
}

fn validate_placement(p: &Placement) -> Result<()> {
    if !matches!(p.status.as_str(), "exact" | "moved" | "fuzzy" | "orphan") {
        return Err(Error::Message(format!("invalid placement status {:?}", p.status)));
    }
    Ok(())
}

fn validate_colour(colour: &str) -> Result<()> {
    let ok = colour.len() == 7 && colour.starts_with('#') && colour[1..].bytes().all(|b| b.is_ascii_hexdigit());
    if ok {
        Ok(())
    } else {
        Err(Error::Message(format!("invalid colour {colour:?}")))
    }
}

fn upsert_placement(tx: &Transaction, annotation_id: &str, file_id: &str, p: &Placement, now: i64) -> Result<()> {
    validate_placement(p)?;
    tx.execute(
        "INSERT INTO annotation_placements (annotation_id, file_sha256, page, geometry, text_start, text_end, status,
                                            placed_at, pdf_obj_ref)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(annotation_id, file_sha256) DO UPDATE SET
            page = excluded.page, geometry = excluded.geometry, text_start = excluded.text_start,
            text_end = excluded.text_end, status = excluded.status, placed_at = excluded.placed_at,
            pdf_obj_ref = COALESCE(excluded.pdf_obj_ref, pdf_obj_ref)",
        params![annotation_id, file_id, p.page, p.geometry.to_string(), p.text_start, p.text_end, p.status, now, p.pdf_ref],
    )?;
    Ok(())
}

fn record_page_hashes(tx: &Transaction, file_id: &str, hashes: &[PageHash]) -> Result<()> {
    for h in hashes {
        tx.execute(
            "INSERT OR IGNORE INTO file_pages (file_sha256, page, text_hash) VALUES (?1, ?2, ?3)",
            params![file_id, h.page, h.hash],
        )?;
    }
    Ok(())
}

/// Inserts an annotation with its placement; returns its id.
fn insert_annotation(tx: &Transaction, new: &NewAnnotation, now: i64) -> Result<String> {
    if let Some(c) = &new.colour {
        validate_colour(c)?;
    }
    let id = uuid::Uuid::now_v7().to_string();
    let source = if new.source_nm.is_some() { "imported" } else { "tourmaline" };
    let created = new.created.unwrap_or(now);
    // Block ids are short, so retry the rare collision.
    let mut attempts = 0;
    loop {
        let inserted = tx.execute(
            "INSERT INTO annotations (id, work_id, kind, category_id, colour, note_md, quote, prefix, suffix,
                                      block_id, source, source_nm, created, updated)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                id,
                new.work_id,
                new.kind,
                new.category_id,
                new.colour,
                new.note,
                new.quote,
                new.prefix,
                new.suffix,
                new_block_id(),
                source,
                new.source_nm,
                created,
                now
            ],
        );
        match inserted {
            Ok(_) => break,
            Err(rusqlite::Error::SqliteFailure(e, Some(msg)))
                if e.code == rusqlite::ErrorCode::ConstraintViolation && msg.contains("block_id") && attempts < 5 =>
            {
                attempts += 1;
            }
            Err(e) => return Err(e.into()),
        }
    }
    upsert_placement(tx, &id, &new.file_id, &new.placement, now)?;
    record_page_hashes(tx, &new.file_id, &new.page_hashes)?;
    Ok(id)
}

impl Db {
    /// A work's annotations (not deleted), placed on `file_id` where possible,
    /// in page order.
    pub fn list_annotations(&self, work_id: &str, file_id: &str) -> Result<Vec<Annotation>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(&format!(
            "{SELECT_ANNOTATION} WHERE a.work_id = ?1 AND a.deleted_at IS NULL ORDER BY p.page IS NULL, p.page, a.created"
        ))?;
        let mut list: Vec<Annotation> = stmt
            .query_map(params![work_id, file_id], annotation_from)?
            .collect::<std::result::Result<_, _>>()?;
        for a in list.iter_mut().filter(|a| a.placement.is_none()) {
            a.fallback = fallback_for(&conn, &a.id, file_id)?;
        }
        Ok(list)
    }

    fn annotation(&self, id: &str, file_id: &str) -> Result<Annotation> {
        let conn = self.conn();
        let mut a = conn.query_row(&format!("{SELECT_ANNOTATION} WHERE a.id = ?1"), params![id, file_id], annotation_from)?;
        if a.placement.is_none() {
            a.fallback = fallback_for(&conn, id, file_id)?;
        }
        Ok(a)
    }

    pub fn create_annotation(&self, new: &NewAnnotation) -> Result<Annotation> {
        let id = {
            let mut conn = self.conn();
            let tx = conn.transaction()?;
            let id = insert_annotation(&tx, new, now_millis())?;
            tx.commit()?;
            id
        };
        self.annotation(&id, &new.file_id)
    }

    /// The keys of PDF annotations a work already has, deleted or not: what
    /// it imported, and "nm:<id>" for every annotation (write-back names the
    /// annotations it writes by their id).
    pub fn imported_keys(&self, work_id: &str) -> Result<Vec<String>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT source_nm FROM annotations WHERE work_id = ?1 AND source_nm IS NOT NULL
             UNION ALL SELECT 'nm:' || id FROM annotations WHERE work_id = ?1",
        )?;
        let rows = stmt.query_map([work_id], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Imports annotations found in a PDF, each once per work: one whose
    /// `source_nm` the work already has (even deleted, so a deleted import
    /// stays deleted) is skipped.
    pub fn import_annotations(&self, list: &[NewAnnotation]) -> Result<ImportResult> {
        let now = now_millis();
        let mut ids = Vec::new();
        let mut existing = Vec::new();
        let file_id = match list.first() {
            Some(first) => first.file_id.clone(),
            None => return Ok(ImportResult { created: vec![], existing: vec![] }),
        };
        {
            let mut conn = self.conn();
            let tx = conn.transaction()?;
            for new in list {
                let Some(key) = &new.source_nm else {
                    return Err(Error::Message("an imported annotation needs a source key".into()));
                };
                let known: bool = tx.query_row(
                    "SELECT EXISTS (SELECT 1 FROM annotations WHERE work_id = ?1 AND source_nm = ?2)",
                    params![new.work_id, key],
                    |r| r.get(0),
                )?;
                if known {
                    existing.push(key.clone());
                } else {
                    ids.push(insert_annotation(&tx, new, now)?);
                }
            }
            tx.commit()?;
        }
        let created = ids.iter().map(|id| self.annotation(id, &file_id)).collect::<Result<_>>()?;
        Ok(ImportResult { created, existing })
    }

    pub fn update_annotation(&self, id: &str, file_id: &str, edit: &AnnotationEdit) -> Result<Annotation> {
        if let Some(c) = &edit.colour {
            validate_colour(c)?;
        }
        let changed = self.conn().execute(
            "UPDATE annotations SET category_id = ?2, colour = ?3, note_md = ?4, updated = ?5
             WHERE id = ?1 AND deleted_at IS NULL",
            params![id, edit.category_id, edit.colour, edit.note, now_millis()],
        )?;
        if changed == 0 {
            return Err(Error::Message(format!("no annotation {id} (deleted?)")));
        }
        self.annotation(id, file_id)
    }

    /// Soft delete; `restore_annotation` undoes it.
    pub fn delete_annotation(&self, id: &str) -> Result<()> {
        self.conn().execute(
            "UPDATE annotations SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            params![id, now_millis()],
        )?;
        Ok(())
    }

    pub fn restore_annotation(&self, id: &str, file_id: &str) -> Result<Annotation> {
        self.conn()
            .execute("UPDATE annotations SET deleted_at = NULL WHERE id = ?1", [id])?;
        self.annotation(id, file_id)
    }

    /// Stores where annotations sit in `file_id` (after re-anchoring).
    pub fn save_placements(&self, file_id: &str, updates: &[PlacementUpdate], page_hashes: &[PageHash]) -> Result<()> {
        let now = now_millis();
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        for u in updates {
            upsert_placement(&tx, &u.annotation_id, file_id, &u.placement, now)?;
        }
        record_page_hashes(&tx, file_id, page_hashes)?;
        tx.commit()?;
        Ok(())
    }

    pub fn set_annotation_image(&self, id: &str, image_path: &str) -> Result<()> {
        self.conn().execute(
            "UPDATE annotations SET image_path = ?2, updated = ?3 WHERE id = ?1",
            params![id, image_path, now_millis()],
        )?;
        Ok(())
    }

    pub fn annotation_exists(&self, id: &str) -> Result<bool> {
        Ok(self
            .conn()
            .query_row("SELECT 1 FROM annotations WHERE id = ?1", [id], |_| Ok(()))
            .optional()?
            .is_some())
    }

    /// The work an annotation with this block id belongs to, unless deleted.
    pub fn work_for_block(&self, block_id: &str) -> Result<Option<String>> {
        Ok(self
            .conn()
            .query_row(
                "SELECT work_id FROM annotations WHERE block_id = ?1 AND deleted_at IS NULL",
                [block_id],
                |r| r.get(0),
            )
            .optional()?)
    }

    /// All categories in display order, including deleted ones.
    pub fn list_categories(&self) -> Result<Vec<Category>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, name, colour, callout, hotkey, deleted_at IS NOT NULL FROM categories
             ORDER BY deleted_at IS NOT NULL, sort_order, name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Category {
                id: r.get(0)?,
                name: r.get(1)?,
                colour: r.get(2)?,
                callout: r.get(3)?,
                hotkey: r.get(4)?,
                deleted: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Replaces the category list: the order given becomes the display order,
    /// and categories left out are marked deleted (annotations keep them).
    pub fn save_categories(&self, categories: &[Category]) -> Result<Vec<Category>> {
        for c in categories {
            validate_colour(&c.colour)?;
            if c.name.trim().is_empty() {
                return Err(Error::Message("A category needs a name.".into()));
            }
            if c.hotkey.is_some_and(|k| !(1..=9).contains(&k)) {
                return Err(Error::Message(format!("Key for {} must be 1-9.", c.name)));
            }
        }
        let now = now_millis();
        {
            let mut conn = self.conn();
            let tx = conn.transaction()?;
            // Clear keys first so swapping two categories' keys doesn't collide.
            tx.execute("UPDATE categories SET hotkey = NULL", [])?;
            tx.execute("UPDATE categories SET deleted_at = COALESCE(deleted_at, ?1)", [now])?;
            for (i, c) in categories.iter().enumerate() {
                let deleted_at = c.deleted.then_some(now);
                tx.execute(
                    "INSERT INTO categories (id, name, colour, callout, hotkey, sort_order, deleted_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                     ON CONFLICT(id) DO UPDATE SET
                        name = excluded.name, colour = excluded.colour, callout = excluded.callout,
                        hotkey = excluded.hotkey, sort_order = excluded.sort_order,
                        deleted_at = CASE WHEN excluded.deleted_at IS NULL THEN NULL
                                          ELSE COALESCE(categories.deleted_at, excluded.deleted_at) END",
                    params![c.id, c.name.trim(), c.colour, c.callout, c.hotkey, i as i64, deleted_at],
                )
                .map_err(|e| match e {
                    rusqlite::Error::SqliteFailure(f, Some(ref m))
                        if f.code == rusqlite::ErrorCode::ConstraintViolation && m.contains("hotkey") =>
                    {
                        Error::Message("Two categories can't use the same key.".into())
                    }
                    other => other.into(),
                })?;
            }
            tx.commit()?;
        }
        self.list_categories()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::library::tests::open;
    use serde_json::json;

    fn placement(page: u32) -> Placement {
        Placement {
            pdf_ref: None,
            page,
            geometry: json!({ "rects": [[page, 10, 20, 30, 40]] }),
            text_start: Some(5),
            text_end: Some(12),
            status: "exact".into(),
        }
    }

    pub(crate) fn highlight(work_id: &str, file_id: &str, page: u32) -> NewAnnotation {
        NewAnnotation {
            work_id: work_id.into(),
            file_id: file_id.into(),
            kind: "highlight".into(),
            category_id: Some("default-1".into()),
            colour: None,
            note: String::new(),
            quote: Some("the quote".into()),
            prefix: Some("before ".into()),
            suffix: Some(" after".into()),
            placement: placement(page),
            page_hashes: vec![PageHash { page, hash: format!("hash{page}") }],
            source_nm: None,
            created: None,
        }
    }

    #[test]
    fn imports_each_pdf_annotation_once() {
        let db = Db::in_memory().unwrap();
        let doc = open(&db, "a", "/p/a.pdf", 1);
        let imported = |key: &str| NewAnnotation {
            source_nm: Some(key.into()),
            created: Some(42),
            ..highlight(&doc.work_id, "a", 2)
        };
        let first = db.import_annotations(&[imported("okular-1"), imported("okular-2")]).unwrap();
        assert_eq!(first.created.len(), 2);
        assert!(first.existing.is_empty());
        assert_eq!(first.created[0].source, "imported");
        assert_eq!(first.created[0].created, 42);
        // Deleted in Tourmaline: stays deleted when the PDF is opened again.
        db.delete_annotation(&first.created[0].id).unwrap();
        let again = db.import_annotations(&[imported("okular-1"), imported("okular-2"), imported("okular-3")]).unwrap();
        assert_eq!(again.created.len(), 1);
        assert_eq!(again.existing, ["okular-1", "okular-2"]);
        assert_eq!(db.list_annotations(&doc.work_id, "a").unwrap().len(), 2);
        let mut keys = db.imported_keys(&doc.work_id).unwrap();
        keys.retain(|k| !k.starts_with("nm:"));
        keys.sort();
        assert_eq!(keys, ["okular-1", "okular-2", "okular-3"]);
        // Another paper with the same keys gets its own copies.
        let other = open(&db, "b", "/p/b.pdf", 2);
        let theirs = NewAnnotation { source_nm: Some("okular-1".into()), ..highlight(&other.work_id, "b", 0) };
        assert_eq!(db.import_annotations(&[theirs]).unwrap().created.len(), 1);
        assert!(db.import_annotations(&[highlight(&doc.work_id, "a", 0)]).is_err(), "needs a key");
    }

    #[test]
    fn creates_and_lists_in_page_order() {
        let db = Db::in_memory().unwrap();
        let doc = open(&db, "a", "/p/a.pdf", 1);
        let second = db.create_annotation(&highlight(&doc.work_id, "a", 4)).unwrap();
        let first = db.create_annotation(&highlight(&doc.work_id, "a", 1)).unwrap();
        assert!(first.block_id.starts_with("hl-") && first.block_id.len() == 9);
        assert_ne!(first.block_id, second.block_id);
        let list = db.list_annotations(&doc.work_id, "a").unwrap();
        assert_eq!(list.iter().map(|a| &a.id).collect::<Vec<_>>(), [&first.id, &second.id]);
        assert_eq!(list[0].placement, Some(placement(1)));
        assert_eq!(list[0].quote.as_deref(), Some("the quote"));
    }

    #[test]
    fn survive_renaming_the_file() {
        let db = Db::in_memory().unwrap();
        let doc = open(&db, "a", "/p/a.pdf", 1);
        db.create_annotation(&highlight(&doc.work_id, "a", 0)).unwrap();
        let moved = open(&db, "a", "/elsewhere/renamed.pdf", 2);
        let list = db.list_annotations(&moved.work_id, &moved.file_id).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].placement.is_some());
    }

    #[test]
    fn a_new_version_offers_the_old_placement_to_re_anchor() {
        let db = Db::in_memory().unwrap();
        let v1 = open(&db, "a", "/p/a.pdf", 1);
        let a = db.create_annotation(&highlight(&v1.work_id, "a", 3)).unwrap();
        let v2 = open(&db, "a2", "/p/a.pdf", 2);
        let list = db.list_annotations(&v2.work_id, "a2").unwrap();
        assert_eq!(list[0].placement, None);
        let fallback = list[0].fallback.clone().unwrap();
        assert_eq!(fallback.file_id, "a");
        assert_eq!(fallback.page_hash.as_deref(), Some("hash3"));

        db.save_placements(
            "a2",
            &[PlacementUpdate { annotation_id: a.id.clone(), placement: Placement { status: "moved".into(), ..placement(5) } }],
            &[PageHash { page: 5, hash: "new5".into() }],
        )
        .unwrap();
        let list = db.list_annotations(&v2.work_id, "a2").unwrap();
        assert_eq!(list[0].placement.as_ref().unwrap().page, 5);
        assert_eq!(list[0].fallback, None);
        // The original version still has its own placement.
        let old = db.list_annotations(&v1.work_id, "a").unwrap();
        assert_eq!(old[0].placement.as_ref().unwrap().page, 3);
    }

    #[test]
    fn restoring_on_another_version_offers_a_fallback() {
        let db = Db::in_memory().unwrap();
        let v1 = open(&db, "a", "/p/a.pdf", 1);
        let a = db.create_annotation(&highlight(&v1.work_id, "a", 2)).unwrap();
        db.delete_annotation(&a.id).unwrap();
        open(&db, "a2", "/p/a.pdf", 2);
        let restored = db.restore_annotation(&a.id, "a2").unwrap();
        assert_eq!(restored.placement, None);
        assert_eq!(restored.fallback.unwrap().placement.page, 2);
    }

    #[test]
    fn edits_delete_and_restore() {
        let db = Db::in_memory().unwrap();
        let doc = open(&db, "a", "/p/a.pdf", 1);
        let a = db.create_annotation(&highlight(&doc.work_id, "a", 0)).unwrap();
        let edited = db
            .update_annotation(
                &a.id,
                "a",
                &AnnotationEdit { category_id: Some("default-2".into()), colour: None, note: "$x^2$".into() },
            )
            .unwrap();
        assert_eq!(edited.note, "$x^2$");
        assert_eq!(edited.category_id.as_deref(), Some("default-2"));
        assert_eq!(edited.block_id, a.block_id, "block ids never change");

        db.delete_annotation(&a.id).unwrap();
        assert!(db.list_annotations(&doc.work_id, "a").unwrap().is_empty());
        let late = AnnotationEdit { category_id: None, colour: None, note: "late save".into() };
        assert!(db.update_annotation(&a.id, "a", &late).is_err(), "a deleted annotation can't be edited");
        let restored = db.restore_annotation(&a.id, "a").unwrap();
        assert_eq!(restored.note, "$x^2$");
        assert_eq!(db.list_annotations(&doc.work_id, "a").unwrap().len(), 1);
    }

    #[test]
    fn rejects_bad_input() {
        let db = Db::in_memory().unwrap();
        let doc = open(&db, "a", "/p/a.pdf", 1);
        let mut bad = highlight(&doc.work_id, "a", 0);
        bad.placement.status = "lost".into();
        assert!(db.create_annotation(&bad).is_err());
        let mut bad = highlight(&doc.work_id, "a", 0);
        bad.colour = Some("red".into());
        assert!(db.create_annotation(&bad).is_err());
        let mut bad = highlight(&doc.work_id, "a", 0);
        bad.file_id = "unknown".into();
        assert!(db.create_annotation(&bad).is_err(), "placements must reference a known file");
        assert_eq!(db.count("annotations").unwrap(), 0, "a failed create leaves nothing behind");
    }

    #[test]
    fn categories_default_reorder_swap_keys_and_delete() {
        let db = Db::in_memory().unwrap();
        let mut cats = db.list_categories().unwrap();
        assert_eq!(cats.len(), 5);
        assert_eq!(cats[0].hotkey, Some(1));
        // Swap the keys of the first two, drop the last, add one.
        cats[0].hotkey = Some(2);
        cats[1].hotkey = Some(1);
        let dropped = cats.pop().unwrap();
        cats.push(Category {
            id: "mine".into(),
            name: " Counterexample ".into(),
            colour: "#123abc".into(),
            callout: "warning".into(),
            hotkey: Some(9),
            deleted: false,
        });
        let saved = db.save_categories(&cats).unwrap();
        assert_eq!(saved.len(), 6);
        assert_eq!(saved[0].hotkey, Some(2));
        assert_eq!(saved[1].hotkey, Some(1));
        assert_eq!(saved[4].name, "Counterexample");
        let gone = saved.iter().find(|c| c.id == dropped.id).unwrap();
        assert!(gone.deleted);

        cats[0].hotkey = Some(1);
        assert!(db.save_categories(&cats).is_err(), "duplicate keys are refused");
        assert_eq!(db.list_categories().unwrap()[0].hotkey, Some(2), "and nothing changes");
    }
}
