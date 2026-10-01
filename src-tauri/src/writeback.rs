//! Writing annotations into a PDF (opt-in: File › Save annotations into PDF).
//!
//! The file is never rewritten: the changes are appended as an incremental
//! update (ISO 32000-1, 7.5.6), so every byte of the original stays as it
//! was and older readers still see the previous revision. Annotations that
//! came from the file (imported from Okular, say) are updated in place;
//! new ones are named (`/NM`) with their Tourmaline id; deleted ones are
//! taken off their page.

use std::collections::HashMap;

use lopdf::{dictionary, text_string, Dictionary, IncrementalDocument, Object, ObjectId, Stream};
use serde::Deserialize;

use crate::error::{Error, Result};
use crate::pdf_annotations::ref_id;

/// One annotation to write, as the frontend sends it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteAnnotation {
    /// Tourmaline's id.
    pub id: String,
    /// The `/NM` it has or gets: an imported annotation keeps its own.
    pub name: String,
    /// The object it already is in this file, if any ("412R").
    pub pdf_ref: Option<String>,
    /// highlight | area | note
    pub kind: String,
    /// 0-based page.
    pub page: u32,
    /// [x0, y0, x1, y1] in PDF user space, on `page`.
    pub rects: Vec<[f64; 4]>,
    /// #rrggbb
    pub colour: String,
    pub note: String,
    /// Unix ms.
    pub created: i64,
    pub updated: i64,
}

pub struct Written {
    pub bytes: Vec<u8>,
    /// Tourmaline id → the object it now is ("412R").
    pub refs: HashMap<String, String>,
}

fn rgb(colour: &str) -> Result<[f32; 3]> {
    let ok = colour.len() == 7 && colour.starts_with('#') && colour[1..].bytes().all(|b| b.is_ascii_hexdigit());
    if !ok {
        return Err(Error::Message(format!("invalid colour {colour:?}")));
    }
    let channel = |i: usize| u8::from_str_radix(&colour[i..i + 2], 16).map(|v| f32::from(v) / 255.0).unwrap_or(0.0);
    Ok([channel(1), channel(3), channel(5)])
}

/// A PDF date (D:YYYYMMDDHHmmSSZ) from Unix milliseconds.
pub fn pdf_date(millis: i64) -> String {
    let secs = millis.div_euclid(1000);
    let (y, m, d) = crate::db::civil_from_days(secs.div_euclid(86_400));
    let t = secs.rem_euclid(86_400);
    format!("D:{y:04}{m:02}{d:02}{:02}{:02}{:02}Z", t / 3600, t % 3600 / 60, t % 60)
}

fn bbox(rects: &[[f64; 4]]) -> [f64; 4] {
    rects.iter().fold([f64::MAX, f64::MAX, f64::MIN, f64::MIN], |b, r| {
        [b[0].min(r[0]), b[1].min(r[1]), b[2].max(r[2]), b[3].max(r[3])]
    })
}

fn numbers(values: &[f64]) -> Object {
    Object::Array(values.iter().map(|&v| Object::Real(v as f32)).collect())
}

/// The appearance stream a viewer draws: highlights as multiplied colour
/// over the text, areas as an outline. Notes use the viewer's own icon.
fn appearance(kind: &str, rects: &[[f64; 4]], bounds: [f64; 4], [r, g, b]: [f32; 3]) -> Option<Stream> {
    let mut ops = String::new();
    let mut resources = Dictionary::new();
    match kind {
        "highlight" => {
            ops.push_str(&format!("/GS0 gs {r} {g} {b} rg\n"));
            for q in rects {
                ops.push_str(&format!("{} {} {} {} re f\n", q[0], q[1], q[2] - q[0], q[3] - q[1]));
            }
            resources.set(
                "ExtGState",
                dictionary! { "GS0" => dictionary! { "Type" => "ExtGState", "BM" => "Multiply", "CA" => 1, "ca" => 1 } },
            );
        }
        "area" => {
            let [x0, y0, x1, y1] = bounds;
            ops.push_str(&format!("2 w {r} {g} {b} RG {} {} {} {} re S\n", x0 + 1.0, y0 + 1.0, x1 - x0 - 2.0, y1 - y0 - 2.0));
        }
        _ => return None,
    }
    let dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Form",
        "BBox" => numbers(&bounds),
        "Resources" => resources,
    };
    Some(Stream::new(dict, ops.into_bytes()))
}

/// Where each annotation object sits: by object reference and by `/NM`.
struct Existing {
    by_ref: HashMap<String, (ObjectId, ObjectId)>,
    by_name: HashMap<String, (ObjectId, ObjectId)>,
}

fn existing_annotations(doc: &lopdf::Document) -> Existing {
    let mut found = Existing { by_ref: HashMap::new(), by_name: HashMap::new() };
    for page_id in doc.get_pages().into_values() {
        let Ok(page) = doc.get_dictionary(page_id) else { continue };
        let entries = match page.get(b"Annots") {
            Ok(Object::Reference(id)) => doc.get_object(*id).and_then(Object::as_array).cloned().unwrap_or_default(),
            Ok(Object::Array(entries)) => entries.clone(),
            _ => continue,
        };
        for entry in entries {
            let Object::Reference(id) = entry else { continue };
            found.by_ref.insert(ref_id(id), (page_id, id));
            if let Ok(name) = doc.get_dictionary(id).and_then(|d| d.get(b"NM")).and_then(lopdf::decode_text_string) {
                found.by_name.insert(name, (page_id, id));
            }
        }
    }
    found
}

/// A page's `/Annots` in the update, cloned from the previous revision on
/// first change (the array itself when it is an object of its own).
fn edit_annots(inc: &mut IncrementalDocument, page_id: ObjectId, edit: impl FnOnce(&mut Vec<Object>)) -> Result<()> {
    let to_err = |e: lopdf::Error| Error::Message(format!("could not update the page: {e}"));
    inc.opt_clone_object_to_new_document(page_id).map_err(to_err)?;
    let array_id = {
        let page = inc.new_document.get_dictionary(page_id).map_err(to_err)?;
        page.get(b"Annots").and_then(Object::as_reference).ok()
    };
    if let Some(array_id) = array_id {
        inc.opt_clone_object_to_new_document(array_id).map_err(to_err)?;
        if let Ok(Object::Array(entries)) = inc.new_document.get_object_mut(array_id) {
            edit(entries);
            return Ok(());
        }
    }
    let page = inc.new_document.get_dictionary_mut(page_id).map_err(to_err)?;
    if !matches!(page.get(b"Annots"), Ok(Object::Array(_))) {
        page.set("Annots", Object::Array(vec![]));
    }
    if let Ok(Object::Array(entries)) = page.get_mut(b"Annots") {
        edit(entries);
    }
    Ok(())
}

/// Appends the annotations to `original` and takes the objects in `remove`
/// (references, "412R") off their pages.
pub fn write_annotations(original: &[u8], list: &[WriteAnnotation], remove: &[String]) -> Result<Written> {
    let to_err = |e: lopdf::Error| Error::Message(format!("could not write into the PDF: {e}"));
    let mut inc: IncrementalDocument = original.try_into().map_err(to_err)?;
    let pages = inc.get_prev_documents().get_pages();
    let existing = existing_annotations(inc.get_prev_documents());
    let now = pdf_date(crate::db::now_millis());
    let mut refs = HashMap::new();

    for a in list {
        if a.rects.is_empty() {
            continue;
        }
        let page_id = *pages
            .get(&(a.page + 1))
            .ok_or_else(|| Error::Message(format!("the PDF has no page {}", a.page + 1)))?;
        let colour = rgb(&a.colour)?;
        let bounds = bbox(&a.rects);
        let target = a
            .pdf_ref
            .as_ref()
            .and_then(|r| existing.by_ref.get(r))
            .or_else(|| existing.by_name.get(&a.name))
            .copied();

        // Start from the annotation as it is in the file, keeping what other
        // programs put there (author, popup, reply threads).
        let mut dict = match target {
            Some((_, id)) => inc.get_prev_documents().get_dictionary(id).map_err(to_err)?.clone(),
            None => dictionary! {
                "Type" => "Annot",
                "Subtype" => match a.kind.as_str() {
                    "highlight" => "Highlight",
                    "area" => "Square",
                    _ => "Text",
                },
                "F" => 4,
                "CreationDate" => text_string(&pdf_date(a.created)),
            },
        };
        let subtype = dict.get(b"Subtype").and_then(Object::as_name).unwrap_or(b"").to_vec();
        dict.set("P", page_id);
        dict.set("NM", text_string(&a.name));
        dict.set("Rect", numbers(&bounds));
        dict.set("C", numbers(&colour.map(f64::from)));
        dict.set("Contents", text_string(&a.note));
        dict.set("M", text_string(&if a.updated > 0 { pdf_date(a.updated) } else { now.clone() }));
        if a.kind == "highlight" {
            let quads: Vec<f64> = a.rects.iter().flat_map(|r| [r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]]).collect();
            dict.set("QuadPoints", numbers(&quads));
        }
        // An appearance we can draw for this kind of annotation, else none,
        // so the viewer draws it with the new colour itself.
        let ours = matches!((a.kind.as_str(), subtype.as_slice()), ("highlight", b"Highlight") | ("area", b"Square"));
        dict.remove(b"AP");
        if ours {
            if let Some(stream) = appearance(&a.kind, &a.rects, bounds, colour) {
                let ap = inc.new_document.add_object(stream);
                dict.set("AP", dictionary! { "N" => ap });
            }
        }

        let id = match target {
            Some((old_page, id)) => {
                if old_page != page_id {
                    edit_annots(&mut inc, old_page, |entries| entries.retain(|e| e.as_reference().ok() != Some(id)))?;
                    edit_annots(&mut inc, page_id, |entries| entries.push(Object::Reference(id)))?;
                }
                inc.new_document.set_object(id, dict);
                id
            }
            None => {
                let id = inc.new_document.add_object(dict);
                edit_annots(&mut inc, page_id, |entries| entries.push(Object::Reference(id)))?;
                id
            }
        };
        refs.insert(a.id.clone(), ref_id(id));
    }

    for r in remove {
        if let Some(&(page_id, id)) = existing.by_ref.get(r) {
            edit_annots(&mut inc, page_id, |entries| entries.retain(|e| e.as_reference().ok() != Some(id)))?;
        }
    }

    let mut bytes = Vec::with_capacity(original.len() + 4096);
    inc.save_to(&mut bytes)
        .map_err(|e| Error::Message(format!("could not write into the PDF: {e}")))?;
    Ok(Written { bytes, refs })
}

/// How long backups of versions Tourmaline itself wrote are kept.
pub const BACKUP_DAYS: u64 = 30;

/// Prunes `<data>/backups/pdf` (files named `<sha256>.pdf`). A backup of a
/// file Tourmaline never wrote into — the original as the user had it — is
/// kept for good; one of a version write-back produced (an earlier save) goes
/// after `max_age`, as the original plus the current file hold everything it
/// did. Anything the library doesn't know is kept. Returns what was deleted.
pub fn prune_backups(
    dir: &std::path::Path,
    origin: impl Fn(&str) -> Result<Option<String>>,
    max_age: std::time::Duration,
) -> Result<Vec<std::path::PathBuf>> {
    let mut deleted = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return Ok(deleted) };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(sha) = path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_suffix(".pdf"))
            .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        else {
            continue;
        };
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age > max_age);
        if old && origin(sha)?.as_deref() == Some("writeback") {
            std::fs::remove_file(&path)?;
            deleted.push(path);
        }
    }
    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf_annotations::{annotation_names, tests::annotated_pdf};

    fn ours(id: &str, name: &str, pdf_ref: Option<&str>, note: &str) -> WriteAnnotation {
        WriteAnnotation {
            id: id.into(),
            name: name.into(),
            pdf_ref: pdf_ref.map(Into::into),
            kind: "highlight".into(),
            page: 0,
            rects: vec![[70.0, 695.0, 110.0, 715.0], [70.0, 680.0, 90.0, 692.0]],
            colour: "#f7d14c".into(),
            note: note.into(),
            created: 1_700_000_000_000,
            updated: 1_700_000_000_000,
        }
    }

    #[test]
    fn appends_without_touching_the_original() {
        let original = annotated_pdf(Some("okular-1"));
        let written = write_annotations(&original, &[ours("t-1", "t-1", None, "My note ∀x")], &[]).unwrap();
        assert!(written.bytes.starts_with(&original), "an incremental update keeps every byte");
        let names = annotation_names(&written.bytes).unwrap();
        let mine = names.iter().find(|n| n.name == "t-1").expect("written with its id as /NM");
        assert_eq!(written.refs["t-1"], mine.id);
        assert!(names.iter().any(|n| n.name == "okular-1"), "the other annotations stay");

        let doc = lopdf::Document::load_mem(&written.bytes).unwrap();
        let (num, gen) = (mine.id.trim_end_matches('R').parse::<u32>().unwrap(), 0);
        let dict = doc.get_dictionary((num, gen)).unwrap();
        assert_eq!(dict.get(b"Subtype").unwrap().as_name().unwrap(), b"Highlight");
        assert_eq!(lopdf::decode_text_string(dict.get(b"Contents").unwrap()).unwrap(), "My note ∀x");
        assert_eq!(dict.get(b"QuadPoints").unwrap().as_array().unwrap().len(), 16);
        assert!(dict.get(b"AP").is_ok());
    }

    #[test]
    fn updates_an_imported_annotation_in_place_and_removes_deleted_ones() {
        let original = annotated_pdf(Some("okular-1"));
        let names = annotation_names(&original).unwrap();
        let okular = names.iter().find(|n| n.name == "okular-1").unwrap().id.clone();
        let link = names.iter().find(|n| n.name == "link-1").unwrap().id.clone();
        // Edited in Tourmaline: same object, new note; and the link "deleted".
        let written = write_annotations(&original, &[ours("t-9", "okular-1", Some(&okular), "edited")], &[link]).unwrap();
        assert_eq!(written.refs["t-9"], okular, "the same object");
        let after = annotation_names(&written.bytes).unwrap();
        assert_eq!(after.iter().map(|n| n.name.as_str()).collect::<Vec<_>>(), ["okular-1"]);
        let doc = lopdf::Document::load_mem(&written.bytes).unwrap();
        let num = okular.trim_end_matches('R').parse::<u32>().unwrap();
        let dict = doc.get_dictionary((num, 0)).unwrap();
        assert_eq!(lopdf::decode_text_string(dict.get(b"Contents").unwrap()).unwrap(), "edited");
        // Writing again finds it by name even without the reference.
        let again = write_annotations(&written.bytes, &[ours("t-9", "okular-1", None, "again")], &[]).unwrap();
        assert_eq!(again.refs["t-9"], okular);
        assert!(again.bytes.starts_with(&written.bytes));
    }

    /// The user's paper with Okular highlights, when the vault is on this
    /// machine (read only: the result goes to a temporary folder). Set
    /// TOURMALINE_WRITEBACK_OUT to keep the written file for a look.
    #[test]
    fn round_trips_the_users_okular_paper() {
        let Ok(original) = std::fs::read("C:/Users/amcle/Documents/Academia/Library/BaconDorrC.pdf") else { return };
        let names = annotation_names(&original).unwrap();
        let first = names.iter().find(|n| n.name.starts_with("okular-")).unwrap();
        let second = names.iter().filter(|n| n.name.starts_with("okular-")).nth(1).unwrap();
        let edited = WriteAnnotation {
            page: first.page,
            rects: vec![[168.0, 312.25, 504.0, 324.25]],
            ..ours("t-1", &first.name, Some(&first.id), "Edited in Tourmaline")
        };
        let new = WriteAnnotation { page: 0, rects: vec![[100.0, 600.0, 300.0, 612.0]], ..ours("t-2", "t-2", None, "New") };
        let written = write_annotations(&original, &[edited, new], std::slice::from_ref(&second.id)).unwrap();
        assert!(written.bytes.starts_with(&original));
        let after = annotation_names(&written.bytes).unwrap();
        assert_eq!(after.len(), names.len(), "one removed, one added");
        assert!(after.iter().any(|n| n.name == first.name && n.id == first.id));
        assert!(!after.iter().any(|n| n.name == second.name));
        assert!(after.iter().any(|n| n.name == "t-2" && n.page == 0));
        if let Some(out) = std::env::var_os("TOURMALINE_WRITEBACK_OUT") {
            std::fs::write(out, &written.bytes).unwrap();
        }
    }

    #[test]
    fn keeps_originals_and_prunes_old_backups_of_written_versions() {
        use std::time::{Duration, SystemTime};
        let dir = tempfile::tempdir().unwrap();
        let name = |c: char| c.to_string().repeat(64);
        let backup = |c: char, age_days: u64| {
            let path = dir.path().join(format!("{}.pdf", name(c)));
            let file = std::fs::File::create(&path).unwrap();
            file.set_modified(SystemTime::now() - Duration::from_secs(age_days * 86_400)).unwrap();
            path
        };
        let original = backup('a', 400);
        let old_save = backup('b', 31);
        let recent_save = backup('c', 2);
        let unknown = backup('d', 400);
        let other = dir.path().join("notes.txt");
        std::fs::write(&other, "x").unwrap();
        let origin = |sha: &str| -> Result<Option<String>> {
            Ok(match sha.chars().next() {
                Some('a') => Some("opened".into()),
                Some('b') | Some('c') => Some("writeback".into()),
                _ => None,
            })
        };
        let deleted = prune_backups(dir.path(), origin, Duration::from_secs(BACKUP_DAYS * 86_400)).unwrap();
        assert_eq!(deleted, std::slice::from_ref(&old_save));
        assert!(original.exists() && recent_save.exists() && unknown.exists() && other.exists());
        assert!(!old_save.exists());
        // A missing folder is fine.
        assert!(prune_backups(&dir.path().join("none"), origin, Duration::ZERO).unwrap().is_empty());
    }

    #[test]
    fn writes_pdf_dates() {
        assert_eq!(pdf_date(0), "D:19700101000000Z");
        assert_eq!(pdf_date(1_740_706_206_000), "D:20250228013006Z");
    }
}
