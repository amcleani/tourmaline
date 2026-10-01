//! Annotations stored inside PDF files. pdf.js gives the frontend everything
//! about them except `/NM`, the annotation's name, which stays the same when
//! another tool rewrites the file (object numbers don't); this reads it.

use lopdf::{decode_text_string, Document, Object};
use serde::Serialize;

use crate::error::{Error, Result};

/// One annotation's name. `id` is pdf.js's id for it: the object reference
/// ("1571R", or "1571R2" for a non-zero generation).
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationName {
    /// 0-based page.
    pub page: u32,
    pub id: String,
    pub name: String,
}

pub fn ref_id((num, gen): (u32, u16)) -> String {
    if gen == 0 {
        format!("{num}R")
    } else {
        format!("{num}R{gen}")
    }
}

/// The `/NM` of every annotation that has one.
pub fn annotation_names(bytes: &[u8]) -> Result<Vec<AnnotationName>> {
    let doc = Document::load_mem(bytes).map_err(|e| Error::Message(format!("could not read the PDF's annotations: {e}")))?;
    let mut names = Vec::new();
    for (number, page_id) in doc.get_pages() {
        let Ok(page) = doc.get_dictionary(page_id) else { continue };
        let entries = match page.get(b"Annots") {
            Ok(Object::Reference(id)) => doc.get_object(*id).and_then(Object::as_array).cloned().unwrap_or_default(),
            Ok(Object::Array(entries)) => entries.clone(),
            _ => continue,
        };
        for entry in entries {
            // pdf.js only gives ids to annotations that are objects of their own.
            let Object::Reference(id) = entry else { continue };
            let Ok(dict) = doc.get_dictionary(id) else { continue };
            let Ok(nm) = dict.get(b"NM") else { continue };
            if let Ok(name) = decode_text_string(nm) {
                if !name.is_empty() {
                    names.push(AnnotationName { page: number - 1, id: ref_id(id), name });
                }
            }
        }
    }
    Ok(names)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use lopdf::{dictionary, Stream};

    /// A one-page PDF with a highlight named `name` (or unnamed) and a link.
    pub fn annotated_pdf(name: Option<&str>) -> Vec<u8> {
        let mut doc = Document::with_version("1.7");
        let pages_id = doc.new_object_id();
        let content = doc.add_object(Stream::new(dictionary! {}, b"BT /F1 12 Tf 72 700 Td (Hello) Tj ET".to_vec()));
        let mut highlight = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Highlight",
            "Rect" => vec![70.into(), 695.into(), 110.into(), 715.into()],
            "QuadPoints" => vec![70.into(), 715.into(), 110.into(), 715.into(), 70.into(), 695.into(), 110.into(), 695.into()],
            "C" => vec![1.into(), 1.into(), 0.into()],
            "Contents" => Object::string_literal("A note"),
        };
        if let Some(name) = name {
            highlight.set("NM", Object::string_literal(name));
        }
        let highlight = doc.add_object(highlight);
        let link = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Link",
            "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()],
            "NM" => Object::string_literal("link-1"),
        });
        let page = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Contents" => content,
            "Annots" => vec![highlight.into(), link.into()],
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 }),
        );
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }

    #[test]
    fn reads_annotation_names() {
        let names = annotation_names(&annotated_pdf(Some("okular-{40b3fdae}"))).unwrap();
        assert_eq!(names.len(), 2);
        assert_eq!(names[0].page, 0);
        assert_eq!(names[0].name, "okular-{40b3fdae}");
        assert!(names[0].id.ends_with('R'));
        assert_eq!(names[1].name, "link-1");
        assert_eq!(annotation_names(&annotated_pdf(None)).unwrap().len(), 1);
    }

    /// The user's paper with Okular highlights, when the vault is on this machine.
    #[test]
    fn reads_okular_names_from_the_users_paper() {
        let path = std::path::Path::new("C:/Users/amcle/Documents/Academia/Library/BaconDorrC.pdf");
        let Ok(bytes) = std::fs::read(path) else { return };
        let names = annotation_names(&bytes).unwrap();
        let okular: Vec<_> = names.iter().filter(|n| n.name.starts_with("okular-")).collect();
        assert!(okular.len() >= 100, "{} Okular names", okular.len());
        assert!(okular.iter().any(|n| n.page == 6 && n.id == "1571R"), "{:?}", &okular[..3]);
    }

    #[test]
    fn refuses_what_isnt_a_pdf() {
        assert!(annotation_names(b"not a pdf").is_err());
    }
}
