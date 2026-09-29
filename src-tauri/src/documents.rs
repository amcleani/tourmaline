//! Reading documents and describing them for the library.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    /// SHA-256 of the file contents, so a paper keeps its identity (and later
    /// its annotations) when it is renamed or moved. Computed by the frontend
    /// from the same bytes it displays.
    pub id: String,
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Unix milliseconds.
    pub last_opened: i64,
    /// Reading position as JSON written by the frontend.
    pub last_position: Option<String>,
}

pub fn read(path: &Path) -> Result<Vec<u8>> {
    ensure_pdf(path)?;
    Ok(std::fs::read(path)?)
}

/// Builds the library entry for a document the frontend has just opened.
pub fn describe(path: &Path, id: String, size: u64) -> Result<DocumentInfo> {
    ensure_pdf(path)?;
    let is_sha256 = id.len() == 64 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if !is_sha256 {
        return Err(Error::Message(format!("invalid document id {id:?}")));
    }
    Ok(DocumentInfo {
        id,
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        size,
        last_opened: now_millis(),
        last_position: None,
    })
}

/// The reader only ever needs PDFs; refusing anything else keeps the file
/// commands from being usable as a general file reader.
fn ensure_pdf(path: &Path) -> Result<()> {
    let is_pdf = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
    if is_pdf {
        Ok(())
    } else {
        Err(Error::Message(format!("{} is not a PDF file", path.display())))
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    const HASH: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    #[test]
    fn refuses_non_pdf_files() {
        let dir = tempfile::tempdir().unwrap();
        let txt = dir.path().join("notes.txt");
        File::create(&txt).unwrap();
        assert!(read(&txt).is_err());
        assert!(describe(&txt, HASH.into(), 0).is_err());
    }

    #[test]
    fn describes_with_file_name() {
        let info = describe(Path::new("/lib/Paper 2023.PDF"), HASH.into(), 42).unwrap();
        assert_eq!(info.name, "Paper 2023.PDF");
        assert_eq!(info.size, 42);
    }

    #[test]
    fn rejects_ids_that_are_not_sha256_hex() {
        let p = Path::new("/lib/a.pdf");
        assert!(describe(p, "abc".into(), 0).is_err());
        assert!(describe(p, HASH.to_uppercase(), 0).is_err());
        assert!(describe(p, format!("{}/", &HASH[..63]), 0).is_err());
    }
}
