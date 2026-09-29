//! Opening documents: fingerprinting file contents and reading bytes.

use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    /// SHA-256 of the file contents, so a paper keeps its identity (and later
    /// its annotations) when it is renamed or moved.
    pub id: String,
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Unix milliseconds.
    pub last_opened: i64,
}

/// Hex-encoded SHA-256 of a file, read in chunks so large books stay cheap on memory.
pub fn fingerprint(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

pub fn describe(path: &Path) -> Result<DocumentInfo> {
    ensure_pdf(path)?;
    let size = std::fs::metadata(path)?.len();
    Ok(DocumentInfo {
        id: fingerprint(path)?,
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        size,
        last_opened: now_millis(),
    })
}

pub fn read(path: &Path) -> Result<Vec<u8>> {
    ensure_pdf(path)?;
    Ok(std::fs::read(path)?)
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
    use std::io::Write;

    #[test]
    fn fingerprint_depends_only_on_contents() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.pdf");
        let b = dir.path().join("b.pdf");
        File::create(&a).unwrap().write_all(b"%PDF-1.7 same").unwrap();
        File::create(&b).unwrap().write_all(b"%PDF-1.7 same").unwrap();
        assert_eq!(fingerprint(&a).unwrap(), fingerprint(&b).unwrap());
        // Known SHA-256 of the empty string, as a sanity check of the encoding.
        let empty = dir.path().join("empty.pdf");
        File::create(&empty).unwrap();
        assert_eq!(
            fingerprint(&empty).unwrap(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn refuses_non_pdf_files() {
        let dir = tempfile::tempdir().unwrap();
        let txt = dir.path().join("notes.txt");
        File::create(&txt).unwrap();
        assert!(read(&txt).is_err());
        assert!(describe(&txt).is_err());
    }
}
