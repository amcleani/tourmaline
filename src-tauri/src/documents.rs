//! Reading PDFs from disk and fingerprinting them.

use std::path::Path;

use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

/// A PDF read from disk: its bytes and the SHA-256 of exactly those bytes.
pub struct ReadFile {
    pub sha256: String,
    pub path: String,
    pub name: String,
    pub bytes: Vec<u8>,
}

pub fn read(path: &Path) -> Result<ReadFile> {
    ensure_pdf(path)?;
    let bytes = std::fs::read(path)?;
    Ok(ReadFile {
        sha256: sha256_hex(&bytes),
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        bytes,
    })
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Writes a file whole or not at all: into a temporary file beside it,
/// flushed to disk, then renamed over it.
pub fn write_synced(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let dir = path.parent().ok_or_else(|| Error::Message(format!("{} has no folder", path.display())))?;
    std::fs::create_dir_all(dir)?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let temp = dir.join(format!(".{name}.{}.tourmaline-saving", uuid::Uuid::new_v4().simple()));
    let result = (|| -> Result<()> {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// Packs a JSON header and the file bytes into one binary IPC response:
/// a little-endian u32 header length, the UTF-8 JSON, then the bytes.
pub fn pack(header: &str, bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + header.len() + bytes.len());
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(header.as_bytes());
    out.extend_from_slice(bytes);
    out
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn refuses_non_pdf_files() {
        let dir = tempfile::tempdir().unwrap();
        let txt = dir.path().join("notes.txt");
        File::create(&txt).unwrap();
        assert!(read(&txt).is_err());
    }

    #[test]
    fn reads_and_hashes() {
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("Paper 2023.PDF");
        File::create(&pdf).unwrap().write_all(b"abc").unwrap();
        let file = read(&pdf).unwrap();
        assert_eq!(file.name, "Paper 2023.PDF");
        assert_eq!(file.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(file.bytes, b"abc");
    }

    #[test]
    fn packs_header_and_bytes() {
        let packed = pack("{}", b"PDF");
        assert_eq!(packed, [2, 0, 0, 0, b'{', b'}', b'P', b'D', b'F']);
    }
}
