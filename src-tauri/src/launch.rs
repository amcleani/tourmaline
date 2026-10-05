//! PDFs passed on the command line: Explorer's "Open with Tourmaline" starts
//! the app with the file's path, or, when it already runs, hands the path to
//! the running app through the single-instance plugin.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The PDF paths among a launch's arguments (the first is the program),
/// made absolute against the directory it was started from.
pub fn pdf_args(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-') && !a.contains("://"))
        .filter(|a| Path::new(a).extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")))
        .map(|a| {
            let p = PathBuf::from(a);
            let p = if p.is_absolute() { p } else { cwd.join(p) };
            p.to_string_lossy().into_owned()
        })
        .collect()
}

/// Files the app was started with or handed by a later launch, until the window takes them.
#[derive(Default)]
pub struct LaunchFiles(pub Mutex<Vec<String>>);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_pdfs_made_absolute() {
        let cwd = if cfg!(windows) { Path::new(r"C:\Papers") } else { Path::new("/papers") };
        let args: Vec<String> = ["tourmaline.exe", "a.pdf", "--flag", "notes.txt", "tourmaline://open?doc=x", "B.PDF"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let out = pdf_args(&args, cwd);
        assert_eq!(out, vec![cwd.join("a.pdf").to_string_lossy().into_owned(), cwd.join("B.PDF").to_string_lossy().into_owned()]);
        let absolute = if cfg!(windows) { r"D:\x\y.pdf" } else { "/x/y.pdf" };
        assert_eq!(pdf_args(&["t".into(), absolute.into()], cwd), vec![absolute.to_string()]);
        assert!(pdf_args(&["only-the-program".into()], cwd).is_empty());
    }
}
