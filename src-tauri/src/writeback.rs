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
    /// Imported from a PDF: its replies are part of the note, and without a
    /// name it is found again by kind and place.
    #[serde(default)]
    pub imported: bool,
}

pub struct Written {
    pub bytes: Vec<u8>,
    /// Tourmaline id → the object it now is ("412R").
    pub refs: HashMap<String, String>,
    /// False when everything was already in the file as given.
    pub changed: bool,
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

/// One annotation object already on a page.
#[derive(Clone)]
struct Found {
    page: ObjectId,
    id: ObjectId,
    name: Option<String>,
    subtype: Vec<u8>,
    rect: Option<[f64; 4]>,
    popup: Option<ObjectId>,
}

/// The annotations already in the file: by reference, by `/NM`, and the
/// replies (`/IRT`) to each.
struct Existing {
    by_ref: HashMap<String, Found>,
    by_name: HashMap<String, Found>,
    replies: HashMap<ObjectId, Vec<Found>>,
    all: Vec<Found>,
}

fn number(o: &Object) -> Option<f64> {
    match o {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(r) => Some(f64::from(*r)),
        _ => None,
    }
}

fn number_array(o: Option<&Object>) -> Option<Vec<f64>> {
    o?.as_array().ok()?.iter().map(number).collect()
}

fn existing_annotations(doc: &lopdf::Document) -> Existing {
    let mut found = Existing { by_ref: HashMap::new(), by_name: HashMap::new(), replies: HashMap::new(), all: vec![] };
    for page_id in doc.get_pages().into_values() {
        let Ok(page) = doc.get_dictionary(page_id) else { continue };
        let entries = match page.get(b"Annots") {
            Ok(Object::Reference(id)) => doc.get_object(*id).and_then(Object::as_array).cloned().unwrap_or_default(),
            Ok(Object::Array(entries)) => entries.clone(),
            _ => continue,
        };
        for entry in entries {
            let Object::Reference(id) = entry else { continue };
            let Ok(dict) = doc.get_dictionary(id) else { continue };
            let rect = number_array(dict.get(b"Rect").ok())
                .filter(|r| r.len() == 4)
                .map(|r| [r[0].min(r[2]), r[1].min(r[3]), r[0].max(r[2]), r[1].max(r[3])]);
            let f = Found {
                page: page_id,
                id,
                name: dict.get(b"NM").ok().and_then(|n| lopdf::decode_text_string(n).ok()),
                subtype: dict.get(b"Subtype").and_then(Object::as_name).unwrap_or(b"").to_vec(),
                rect,
                popup: dict.get(b"Popup").and_then(Object::as_reference).ok(),
            };
            if let Ok(parent) = dict.get(b"IRT").and_then(Object::as_reference) {
                found.replies.entry(parent).or_default().push(f.clone());
            }
            found.by_ref.insert(ref_id(id), f.clone());
            if let Some(name) = &f.name {
                found.by_name.insert(name.clone(), f.clone());
            }
            found.all.push(f);
        }
    }
    found
}

/// Changes a page's `/Annots`. The result is written into the page itself,
/// not into an `/Annots` array object, which several pages may share.
fn edit_annots(inc: &mut IncrementalDocument, page_id: ObjectId, edit: impl FnOnce(&mut Vec<Object>)) -> Result<()> {
    let to_err = |e: lopdf::Error| Error::Message(format!("could not update the page: {e}"));
    inc.opt_clone_object_to_new_document(page_id).map_err(to_err)?;
    let mut entries = {
        let page = inc.new_document.get_dictionary(page_id).map_err(to_err)?;
        match page.get(b"Annots") {
            Ok(Object::Array(entries)) => entries.clone(),
            Ok(Object::Reference(array)) => inc
                .new_document
                .get_object(*array)
                .or_else(|_| inc.get_prev_documents().get_object(*array))
                .and_then(Object::as_array)
                .cloned()
                .unwrap_or_default(),
            _ => vec![],
        }
    };
    edit(&mut entries);
    inc.new_document
        .get_dictionary_mut(page_id)
        .map_err(to_err)?
        .set("Annots", Object::Array(entries));
    Ok(())
}

/// Takes an annotation (and its popup) off its page.
fn take_off_page(inc: &mut IncrementalDocument, f: &Found) -> Result<()> {
    let ids: Vec<ObjectId> = std::iter::once(f.id).chain(f.popup).collect();
    edit_annots(inc, f.page, |entries| {
        entries.retain(|e| e.as_reference().map_or(true, |r| !ids.contains(&r)))
    })
}

/// An annotation deleted in Tourmaline: its object in this file, if known,
/// and the `/NM` it was written or imported under.
#[derive(Debug, Clone, PartialEq)]
pub struct Removal {
    pub pdf_ref: Option<String>,
    pub name: String,
}

/// The subtypes an annotation of this kind can be in a file.
fn subtypes(kind: &str) -> &'static [&'static [u8]] {
    match kind {
        "highlight" => &[b"Highlight", b"Underline", b"StrikeOut", b"Squiggly"],
        "area" => &[b"Square", b"Circle"],
        _ => &[b"Text", b"FreeText"],
    }
}

fn close(a: &[f64], b: &[f64], tolerance: f64) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x - y).abs() <= tolerance)
}

/// "Name#3" (an annotation's part on another page) -> "Name".
fn base_name(name: &str) -> &str {
    match name.rsplit_once('#') {
        Some((base, page)) if !page.is_empty() && page.bytes().all(|b| b.is_ascii_digit()) => base,
        _ => name,
    }
}

/// Appends the annotations to `original`, and takes the deleted ones in
/// `remove` off their pages (with their popups, replies, and parts on other
/// pages). Annotations already in the file exactly as given aren't written
/// again; `changed` is false when nothing needed writing.
pub fn write_annotations(original: &[u8], list: &[WriteAnnotation], remove: &[Removal]) -> Result<Written> {
    let to_err = |e: lopdf::Error| Error::Message(format!("could not write into the PDF: {e}"));
    let mut inc: IncrementalDocument = original.try_into().map_err(to_err)?;
    let pages = inc.get_prev_documents().get_pages();
    let existing = existing_annotations(inc.get_prev_documents());
    let now = pdf_date(crate::db::now_millis());
    let mut refs = HashMap::new();
    let mut changed = false;
    // Objects that an annotation in `list` is (so never removed below).
    let mut used: Vec<ObjectId> = Vec::new();

    for a in list {
        if a.rects.is_empty() {
            continue;
        }
        let page_id = *pages
            .get(&(a.page + 1))
            .ok_or_else(|| Error::Message(format!("the PDF has no page {}", a.page + 1)))?;
        let colour = rgb(&a.colour)?;
        let bounds = bbox(&a.rects);
        let quads: Vec<f64> = a.rects.iter().flat_map(|r| [r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]]).collect();
        let target = a
            .pdf_ref
            .as_ref()
            .and_then(|r| existing.by_ref.get(r))
            .or_else(|| existing.by_name.get(&a.name))
            // An imported annotation that had no name: the one of its kind in the same place.
            .or_else(|| {
                existing.all.iter().find(|f| {
                    a.imported
                        && f.name.is_none()
                        && f.page == page_id
                        && !used.contains(&f.id)
                        && subtypes(&a.kind).contains(&f.subtype.as_slice())
                        && f.rect.is_some_and(|r| close(&r, &bounds, 1.0))
                })
            })
            .cloned();
        if let Some(t) = &target {
            used.push(t.id);
        }

        // Start from the annotation as it is in the file, keeping what other
        // programs put there (author, popup, creation date).
        let mut dict = match &target {
            Some(t) => inc.get_prev_documents().get_dictionary(t.id).map_err(to_err)?.clone(),
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
        if let Some(t) = &target {
            let text = dict.get(b"Contents").ok().and_then(|c| lopdf::decode_text_string(c).ok());
            let same = t.page == page_id
                && t.name.as_deref() == Some(a.name.as_str())
                && text.unwrap_or_default() == a.note
                && number_array(dict.get(b"C").ok()).is_some_and(|c| close(&c, &colour.map(f64::from), 1.0 / 255.0))
                && t.rect.is_some_and(|r| close(&r, &bounds, 0.05))
                && (a.kind != "highlight"
                    || number_array(dict.get(b"QuadPoints").ok()).is_some_and(|q| close(&q, &quads, 0.05)));
            if same {
                refs.insert(a.id.clone(), ref_id(t.id));
                continue;
            }
        }
        changed = true;
        let subtype = dict.get(b"Subtype").and_then(Object::as_name).unwrap_or(b"").to_vec();
        dict.set("P", page_id);
        dict.set("NM", text_string(&a.name));
        dict.set("Rect", numbers(&bounds));
        dict.set("C", numbers(&colour.map(f64::from)));
        dict.set("Contents", text_string(&a.note));
        dict.set("M", text_string(&if a.updated > 0 { pdf_date(a.updated) } else { now.clone() }));
        if a.kind == "highlight" {
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

        let id = match &target {
            Some(t) => {
                if t.page != page_id {
                    take_off_page(&mut inc, &Found { popup: None, ..t.clone() })?;
                    edit_annots(&mut inc, page_id, |entries| entries.push(Object::Reference(t.id)))?;
                }
                // Imported replies are part of the note now: keep them from showing twice.
                if a.imported {
                    for reply in existing.replies.get(&t.id).into_iter().flatten() {
                        take_off_page(&mut inc, reply)?;
                    }
                }
                inc.new_document.set_object(t.id, dict);
                t.id
            }
            None => {
                let id = inc.new_document.add_object(dict);
                edit_annots(&mut inc, page_id, |entries| entries.push(Object::Reference(id)))?;
                id
            }
        };
        refs.insert(a.id.clone(), ref_id(id));
    }

    // Deleted annotations, with their replies (and popups, in take_off_page).
    let mut gone: Vec<Found> = Vec::new();
    for r in remove {
        let found = r.pdf_ref.as_ref().and_then(|x| existing.by_ref.get(x)).or_else(|| existing.by_name.get(&r.name));
        if let Some(f) = found {
            gone.extend(existing.replies.get(&f.id).into_iter().flatten().cloned());
            gone.push(f.clone());
        }
    }
    // Parts on other pages ("Name#3") no longer written, of annotations
    // written or deleted now.
    let written: std::collections::HashSet<&str> = list.iter().map(|a| a.name.as_str()).collect();
    let bases: std::collections::HashSet<&str> =
        list.iter().map(|a| base_name(&a.name)).chain(remove.iter().map(|r| r.name.as_str())).collect();
    for f in &existing.all {
        if let Some(name) = &f.name {
            if base_name(name) != name && bases.contains(base_name(name)) && !written.contains(name.as_str()) {
                gone.push(f.clone());
            }
        }
    }
    for f in &gone {
        if !used.contains(&f.id) {
            take_off_page(&mut inc, f)?;
            changed = true;
        }
    }

    if !changed {
        return Ok(Written { bytes: original.to_vec(), refs, changed });
    }
    let mut bytes = Vec::with_capacity(original.len() + 4096);
    inc.save_to(&mut bytes)
        .map_err(|e| Error::Message(format!("could not write into the PDF: {e}")))?;
    Ok(Written { bytes, refs, changed })
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
            imported: false,
        }
    }

    fn removal(pdf_ref: Option<&str>, name: &str) -> Removal {
        Removal { pdf_ref: pdf_ref.map(Into::into), name: name.into() }
    }

    fn reference(id: &str) -> ObjectId {
        (id.trim_end_matches('R').parse().unwrap(), 0)
    }

    /// A PDF with `pages` pages; `annots` are (page, dictionary) pairs. With
    /// `shared`, every page points to one /Annots array object.
    fn build(pages: usize, shared: bool, annots: Vec<(usize, Dictionary)>) -> Vec<u8> {
        let mut doc = lopdf::Document::with_version("1.7");
        let pages_id = doc.new_object_id();
        let mut per_page: Vec<Vec<Object>> = vec![vec![]; pages];
        for (page, mut dict) in annots {
            // Replies point at their parent by the parent's index in `annots` order (IRT_INDEX).
            if let Ok(Object::Integer(i)) = dict.get(b"IRT_INDEX").cloned() {
                dict.remove(b"IRT_INDEX");
                dict.set("IRT", Object::Reference((i as u32 + 2, 0)));
            }
            per_page[page].push(doc.add_object(dict).into());
        }
        let shared_id = shared.then(|| doc.add_object(Object::Array(per_page.concat())));
        let kids: Vec<Object> = per_page
            .into_iter()
            .map(|entries| {
                let annots = match shared_id {
                    Some(id) => Object::Reference(id),
                    None => Object::Array(entries),
                };
                doc.add_object(dictionary! {
                    "Type" => "Page",
                    "Parent" => pages_id,
                    "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
                    "Annots" => annots,
                })
                .into()
            })
            .collect();
        let count = kids.len() as i64;
        doc.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => count }));
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }

    fn markup(subtype: &str, name: Option<&str>, rect: [f64; 4]) -> Dictionary {
        let mut d = dictionary! { "Type" => "Annot", "Subtype" => subtype, "Rect" => numbers(&rect) };
        if let Some(name) = name {
            d.set("NM", text_string(name));
        }
        d
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
        let written =
            write_annotations(&original, &[ours("t-9", "okular-1", Some(&okular), "edited")], &[removal(Some(&link), "link-1")])
                .unwrap();
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

    #[test]
    fn writes_nothing_when_the_file_already_has_it() {
        let original = annotated_pdf(None);
        let first = write_annotations(&original, &[ours("t-1", "t-1", None, "n")], &[]).unwrap();
        assert!(first.changed);
        let again = write_annotations(&first.bytes, &[ours("t-1", "t-1", Some(&first.refs["t-1"]), "n")], &[]).unwrap();
        assert!(!again.changed, "unchanged: no new revision");
        assert_eq!(again.bytes, first.bytes);
        assert_eq!(again.refs["t-1"], first.refs["t-1"]);
        let edited = write_annotations(&first.bytes, &[ours("t-1", "t-1", None, "edited")], &[]).unwrap();
        assert!(edited.changed);
    }

    #[test]
    fn changes_only_its_own_page_when_pages_share_an_annots_array() {
        let original = build(2, true, vec![(0, markup("Highlight", Some("a"), [10.0, 10.0, 20.0, 20.0]))]);
        let written = write_annotations(&original, &[ours("t-1", "t-1", None, "")], &[]).unwrap();
        let after = annotation_names(&written.bytes).unwrap();
        let mine: Vec<u32> = after.iter().filter(|n| n.name == "t-1").map(|n| n.page).collect();
        assert_eq!(mine, [0], "not on page 2 too");
        assert_eq!(after.iter().filter(|n| n.name == "a").count(), 2, "the shared array's own entry stays on both");
    }

    #[test]
    fn removes_parts_on_other_pages_that_are_no_longer_written() {
        let original = build(3, false, vec![]);
        let spanning = [
            ours("t-1", "t-1", None, ""),
            WriteAnnotation { id: "t-1#1".into(), name: "t-1#1".into(), page: 1, ..ours("t-1", "t-1", None, "") },
            WriteAnnotation { id: "t-2#2".into(), name: "t-2#2".into(), page: 2, ..ours("t-2", "t-2", None, "") },
            ours("t-2", "t-2", None, ""),
        ];
        let first = write_annotations(&original, &spanning, &[]).unwrap();
        assert_eq!(annotation_names(&first.bytes).unwrap().len(), 4);
        // t-1 now fits on its first page; t-2 was deleted.
        let second = write_annotations(&first.bytes, &spanning[..1], &[removal(None, "t-2")]).unwrap();
        let names: Vec<String> = annotation_names(&second.bytes).unwrap().into_iter().map(|n| n.name).collect();
        assert_eq!(names, ["t-1"]);
    }

    #[test]
    fn imported_replies_and_popups_follow_their_annotation() {
        let mut parent = markup("Highlight", Some("okular-1"), [70.0, 680.0, 110.0, 715.0]);
        parent.set("Popup", Object::Reference((4, 0)));
        let mut reply = markup("Text", Some("okular-2"), [0.0, 0.0, 10.0, 10.0]);
        reply.set("IRT_INDEX", 0);
        let popup = markup("Popup", Some("popup-1"), [0.0, 0.0, 50.0, 50.0]);
        let original = build(1, false, vec![(0, parent), (0, reply), (0, popup)]);
        let names = annotation_names(&original).unwrap();
        assert_eq!(names.len(), 3);
        let parent_ref = names.iter().find(|n| n.name == "okular-1").unwrap().id.clone();
        assert_eq!(reference(&parent_ref), (2, 0));
        // Edited: the reply's text is in the note now, so the reply goes; the popup stays.
        let edited = WriteAnnotation { imported: true, ..ours("t-1", "okular-1", Some(&parent_ref), "note\n\nAda: reply") };
        let written = write_annotations(&original, &[edited], &[]).unwrap();
        let left: Vec<String> = annotation_names(&written.bytes).unwrap().into_iter().map(|n| n.name).collect();
        assert_eq!(left, ["okular-1", "popup-1"]);
        // Deleted: it goes with its reply and popup.
        let deleted = write_annotations(&original, &[], &[removal(Some(&parent_ref), "okular-1")]).unwrap();
        assert!(annotation_names(&deleted.bytes).unwrap().is_empty());
    }

    #[test]
    fn finds_an_unnamed_imported_annotation_by_kind_and_place() {
        let original = build(1, false, vec![(0, markup("Underline", None, [70.0, 680.0, 110.0, 715.0]))]);
        let written = write_annotations(&original, &[WriteAnnotation { imported: true, ..ours("t-1", "t-1", None, "x") }], &[]).unwrap();
        let doc = lopdf::Document::load_mem(&written.bytes).unwrap();
        let page = doc.get_pages()[&1];
        let annots = doc.get_page_annotations(page).unwrap();
        assert_eq!(annots.len(), 1, "updated, not added beside it");
        assert_eq!(annots[0].get(b"Subtype").unwrap().as_name().unwrap(), b"Underline");
        // Tourmaline's own annotations are never matched by place.
        let own = write_annotations(&original, &[ours("t-1", "t-1", None, "x")], &[]).unwrap();
        let doc = lopdf::Document::load_mem(&own.bytes).unwrap();
        assert_eq!(doc.get_page_annotations(doc.get_pages()[&1]).unwrap().len(), 2);
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
        let written = write_annotations(&original, &[edited, new], &[removal(Some(&second.id), &second.name)]).unwrap();
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
