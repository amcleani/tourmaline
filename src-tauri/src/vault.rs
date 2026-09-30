//! Reading settings from the user's Obsidian vault. Nothing here writes to it.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::error::{Error, Result};

/// Preamble files bigger than this are not macro files; refuse them.
const MAX_PREAMBLE_BYTES: u64 = 1024 * 1024;
/// Bibliographies bigger than this are refused (the user's is under 1 MB).
const MAX_BIBLIOGRAPHY_BYTES: u64 = 64 * 1024 * 1024;

/// Where the vault keeps literature notes and the bibliography, and how
/// Obsidian shows notes.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultSettings {
    /// The vault's name in Obsidian (its folder name), for obsidian:// links.
    pub name: String,
    pub citations: CitationSettings,
    /// Obsidian's folder for new attachments, relative to the vault.
    pub attachment_folder: Option<String>,
    /// Obsidian's "Strict line breaks": a single newline doesn't break the line.
    pub strict_line_breaks: bool,
}

/// The Citations plugin's settings, with its defaults for anything unset.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CitationSettings {
    pub enabled: bool,
    /// "biblatex" or "csl-json".
    pub format: String,
    /// Absolute path of the bibliography, if set.
    pub bibliography: Option<String>,
    pub note_title_template: String,
    /// Relative to the vault, with forward slashes.
    pub note_folder: String,
    pub note_template: String,
}

/// A bibliography file's text and when it last changed (Unix milliseconds).
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bibliography {
    pub text: String,
    pub modified: i64,
}

// The Citations plugin's defaults (obsidian-citation-plugin, settings.ts).
const DEFAULT_NOTE_TITLE: &str = "@{{citekey}}";
const DEFAULT_NOTE_FOLDER: &str = "Reading notes";
const DEFAULT_NOTE_TEMPLATE: &str = "---\ntitle: {{title}}\nauthors: {{authorString}}\n{{#if containerTitle}}publication: {{containerTitle}}\n{{/if}}year: {{year}}\n---\n\n";

/// How Obsidian renders math in this vault.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MathSettings {
    /// Set when the latest-mathjax plugin is enabled: it replaces Obsidian's
    /// built-in MathJax 3 with MathJax 4 and these settings.
    pub latest_mathjax: Option<LatestMathjax>,
    /// TeX run before any formula (macro definitions), in load order.
    pub preamble: String,
    /// Where the preamble came from, with any file that couldn't be read.
    pub sources: Vec<PreambleSource>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LatestMathjax {
    pub font_family: Option<String>,
    pub packages: Option<Vec<String>>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreambleSource {
    pub plugin: String,
    pub path: String,
    pub error: Option<String>,
}

fn config_dir(vault: &Path) -> Result<PathBuf> {
    let dir = vault.join(".obsidian");
    if dir.is_dir() {
        Ok(dir)
    } else {
        Err(Error::Message(format!(
            "{} isn't an Obsidian vault (it has no .obsidian folder)",
            vault.display()
        )))
    }
}

/// Checks that `path` is an Obsidian vault.
pub fn check_vault(vault: &Path) -> Result<()> {
    config_dir(vault).map(|_| ())
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn plugin_settings(config: &Path, id: &str) -> Option<Value> {
    read_json(&config.join("plugins").join(id).join("data.json"))
}

/// Resolves an existing file or folder in the vault, refusing anything outside it.
fn resolve_in_vault(vault: &Path, relative: &str) -> Result<PathBuf> {
    let root = vault.canonicalize()?;
    let path = root.join(relative).canonicalize()?;
    if !path.starts_with(&root) {
        return Err(Error::Message("the file is outside the vault".into()));
    }
    Ok(path)
}

/// Whether a file exists at a path relative to the vault.
pub fn vault_file_exists(vault: &Path, relative: &str) -> Result<bool> {
    config_dir(vault)?;
    match resolve_in_vault(vault, relative) {
        Ok(path) => Ok(path.is_file()),
        Err(Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

/// Reads a file the vault's settings point to, refusing anything outside the vault.
fn read_vault_file(vault: &Path, relative: &str) -> Result<String> {
    let path = resolve_in_vault(vault, relative)?;
    if std::fs::metadata(&path)?.len() > MAX_PREAMBLE_BYTES {
        return Err(Error::Message("the file is too large to be a preamble".into()));
    }
    Ok(std::fs::read_to_string(path)?)
}

pub fn math_settings(vault: &Path) -> Result<MathSettings> {
    let config = config_dir(vault)?;
    let enabled = enabled_plugins(&config);
    let is_enabled = |id: &str| enabled.iter().any(|p| p == id);

    let mut preamble = String::new();
    let mut sources = Vec::new();
    let mut add_file = |plugin: &str, relative: &str, preamble: &mut String| {
        let error = match read_vault_file(vault, relative) {
            Ok(text) => {
                preamble.push_str(&text);
                preamble.push('\n');
                None
            }
            Err(e) => Some(e.to_string()),
        };
        sources.push(PreambleSource { plugin: plugin.into(), path: relative.into(), error });
    };

    let mut latest_mathjax = None;
    if is_enabled("latest-mathjax") {
        let data = plugin_settings(&config, "latest-mathjax").unwrap_or(Value::Null);
        let text = |key: &str| data.get(key).and_then(Value::as_str).filter(|s| !s.trim().is_empty());
        if let Some(inline) = text("preamble") {
            preamble.push_str(inline);
            preamble.push('\n');
        }
        if let Some(file) = text("preambleFile") {
            add_file("latest-mathjax", file, &mut preamble);
        }
        latest_mathjax = Some(LatestMathjax {
            font_family: text("fontFamily").map(str::to_owned),
            packages: data.get("packages").and_then(|v| serde_json::from_value(v.clone()).ok()),
        });
    }
    if is_enabled("obsidian-latex") {
        let data = plugin_settings(&config, "obsidian-latex");
        let path = data
            .as_ref()
            .and_then(|d| d.get("preamblePath"))
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("preamble.sty")
            .to_owned();
        add_file("obsidian-latex", &path, &mut preamble);
    }
    Ok(MathSettings { latest_mathjax, preamble, sources })
}

fn enabled_plugins(config: &Path) -> Vec<String> {
    read_json(&config.join("community-plugins.json"))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

pub fn vault_settings(vault: &Path) -> Result<VaultSettings> {
    let config = config_dir(vault)?;
    let app = read_json(&config.join("app.json")).unwrap_or(Value::Null);
    let data = plugin_settings(&config, "obsidian-citation-plugin").unwrap_or(Value::Null);
    let text = |key: &str| data.get(key).and_then(Value::as_str);
    let bibliography = text("citationExportPath")
        .map(str::trim)
        .filter(|s| !s.is_empty())
        // The plugin resolves a relative path against the vault.
        .map(|p| vault.join(p).to_string_lossy().into_owned());
    let note_folder = text("literatureNoteFolder")
        .unwrap_or(DEFAULT_NOTE_FOLDER)
        .replace('\\', "/")
        .trim_matches('/')
        .to_owned();
    Ok(VaultSettings {
        name: vault
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        citations: CitationSettings {
            enabled: enabled_plugins(&config).iter().any(|p| p == "obsidian-citation-plugin"),
            format: text("citationExportFormat").unwrap_or("csl-json").to_owned(),
            bibliography,
            note_title_template: text("literatureNoteTitleTemplate").unwrap_or(DEFAULT_NOTE_TITLE).to_owned(),
            note_folder,
            note_template: text("literatureNoteContentTemplate").unwrap_or(DEFAULT_NOTE_TEMPLATE).to_owned(),
        },
        attachment_folder: app
            .get("attachmentFolderPath")
            .and_then(Value::as_str)
            .map(|s| s.trim_matches('/').to_owned())
            .filter(|s| !s.is_empty()),
        strict_line_breaks: app.get("strictLineBreaks").and_then(Value::as_bool).unwrap_or(false),
    })
}

fn ensure_bib(path: &Path) -> Result<()> {
    let is_bib = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("bib"));
    if is_bib {
        Ok(())
    } else {
        Err(Error::Message(format!("{} is not a .bib file", path.display())))
    }
}

fn modified_millis(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Reads a BibTeX file. Only ever reads: JabRef owns it.
pub fn read_bibliography(path: &Path) -> Result<Bibliography> {
    ensure_bib(path)?;
    let meta = std::fs::metadata(path)?;
    if meta.len() > MAX_BIBLIOGRAPHY_BYTES {
        return Err(Error::Message(format!("{} is too large to be a bibliography", path.display())));
    }
    let bytes = std::fs::read(path)?;
    Ok(Bibliography { text: String::from_utf8_lossy(&bytes).into_owned(), modified: modified_millis(&meta) })
}

/// When a BibTeX file last changed, to tell whether to read it again.
pub fn bibliography_modified(path: &Path) -> Result<i64> {
    ensure_bib(path)?;
    Ok(modified_millis(&std::fs::metadata(path)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn reads_citation_settings() {
        let dir = vault(&["obsidian-citation-plugin"]);
        plugin(
            dir.path(),
            "obsidian-citation-plugin",
            &serde_json::json!({
                "citationExportFormat": "biblatex",
                "literatureNoteTitleTemplate": "@{{citekey}}",
                "literatureNoteFolder": "Obsidian\\Library",
                "literatureNoteContentTemplate": "---\nTitle: {{title}}\n---\n",
                "citationExportPath": "Library/database.bib"
            })
            .to_string(),
        );
        fs::write(
            dir.path().join(".obsidian/app.json"),
            r#"{"attachmentFolderPath":"Obsidian/Attatchments","strictLineBreaks":true}"#,
        )
        .unwrap();
        let s = vault_settings(dir.path()).unwrap();
        let c = &s.citations;
        assert!(c.enabled);
        assert_eq!(c.format, "biblatex");
        assert_eq!(c.note_folder, "Obsidian/Library");
        assert_eq!(c.note_template, "---\nTitle: {{title}}\n---\n");
        assert_eq!(c.bibliography.as_deref().map(PathBuf::from), Some(dir.path().join("Library/database.bib")));
        assert_eq!(s.attachment_folder.as_deref(), Some("Obsidian/Attatchments"));
        assert!(s.strict_line_breaks);
    }

    #[test]
    fn citation_settings_default_like_the_plugin() {
        let dir = vault(&[]);
        let s = vault_settings(dir.path()).unwrap();
        assert!(!s.citations.enabled);
        assert_eq!(s.citations.bibliography, None);
        assert_eq!(s.citations.note_title_template, "@{{citekey}}");
        assert_eq!(s.citations.note_folder, "Reading notes");
        assert_eq!(s.attachment_folder, None);
        assert!(!s.strict_line_breaks);
    }

    #[test]
    fn reads_only_bib_files() {
        let dir = tempfile::tempdir().unwrap();
        let bib = dir.path().join("refs.bib");
        fs::write(&bib, "@Book{a, title={A}}").unwrap();
        let b = read_bibliography(&bib).unwrap();
        assert_eq!(b.text, "@Book{a, title={A}}");
        assert!(b.modified > 0);
        assert_eq!(bibliography_modified(&bib).unwrap(), b.modified);
        fs::write(dir.path().join("secret.txt"), "x").unwrap();
        assert!(read_bibliography(&dir.path().join("secret.txt")).is_err());
    }

    #[test]
    fn finds_notes_only_inside_the_vault() {
        let outer = tempfile::tempdir().unwrap();
        fs::write(outer.path().join("outside.md"), "").unwrap();
        let dir = vault(&[]);
        fs::create_dir_all(dir.path().join("Notes")).unwrap();
        fs::write(dir.path().join("Notes/@a.md"), "").unwrap();
        assert!(vault_file_exists(dir.path(), "Notes/@a.md").unwrap());
        assert!(!vault_file_exists(dir.path(), "Notes/@b.md").unwrap());
        assert!(!vault_file_exists(dir.path(), "Notes").unwrap(), "a folder is not a note");
        let relative = format!("../{}/outside.md", outer.path().file_name().unwrap().to_string_lossy());
        assert!(vault_file_exists(dir.path(), &relative).is_err());
    }

    fn vault(plugins: &[&str]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join(".obsidian");
        fs::create_dir_all(config.join("plugins")).unwrap();
        fs::write(config.join("community-plugins.json"), serde_json::to_string(plugins).unwrap()).unwrap();
        dir
    }

    fn plugin(dir: &Path, id: &str, data: &str) {
        let p = dir.join(".obsidian/plugins").join(id);
        fs::create_dir_all(&p).unwrap();
        fs::write(p.join("data.json"), data).unwrap();
    }

    #[test]
    fn rejects_a_folder_that_is_not_a_vault() {
        let dir = tempfile::tempdir().unwrap();
        assert!(math_settings(dir.path()).is_err());
    }

    #[test]
    fn reads_the_obsidian_latex_preamble() {
        let dir = vault(&["obsidian-latex"]);
        plugin(dir.path(), "obsidian-latex", r#"{"preamblePath":"tex/macros.sty"}"#);
        fs::create_dir_all(dir.path().join("tex")).unwrap();
        fs::write(dir.path().join("tex/macros.sty"), r"\newcommand{\at}{\mathsf{At}}").unwrap();
        let s = math_settings(dir.path()).unwrap();
        assert_eq!(s.latest_mathjax, None);
        assert!(s.preamble.contains(r"\newcommand{\at}"));
        assert_eq!(s.sources[0].error, None);
    }

    #[test]
    fn defaults_to_preamble_sty_and_reports_a_missing_file() {
        let dir = vault(&["obsidian-latex"]);
        let s = math_settings(dir.path()).unwrap();
        assert_eq!(s.sources[0].path, "preamble.sty");
        assert!(s.sources[0].error.is_some());
        assert_eq!(s.preamble, "");
    }

    #[test]
    fn ignores_disabled_plugins() {
        let dir = vault(&[]);
        plugin(dir.path(), "latest-mathjax", r#"{"fontFamily":"newcm","preamble":"\\def\\x{1}"}"#);
        fs::write(dir.path().join("preamble.sty"), r"\newcommand{\at}{A}").unwrap();
        let s = math_settings(dir.path()).unwrap();
        assert_eq!(s, MathSettings { latest_mathjax: None, preamble: String::new(), sources: vec![] });
    }

    #[test]
    fn reads_latest_mathjax_settings() {
        let dir = vault(&["latest-mathjax"]);
        plugin(
            dir.path(),
            "latest-mathjax",
            r#"{"fontFamily":"newcm","packages":["base","ams"],"preamble":"\\def\\x{1}","preambleFile":"missing.tex"}"#,
        );
        let s = math_settings(dir.path()).unwrap();
        let lm = s.latest_mathjax.unwrap();
        assert_eq!(lm.font_family.as_deref(), Some("newcm"));
        assert_eq!(lm.packages, Some(vec!["base".to_string(), "ams".to_string()]));
        assert!(s.preamble.contains(r"\def\x{1}"));
        assert!(s.sources[0].error.is_some());
    }

    #[test]
    fn refuses_a_preamble_outside_the_vault() {
        let outer = tempfile::tempdir().unwrap();
        fs::write(outer.path().join("secret.sty"), "secret").unwrap();
        let dir = vault(&["obsidian-latex"]);
        let relative = format!("../{}/secret.sty", outer.path().file_name().unwrap().to_string_lossy());
        // Both temp dirs share a parent, so this path exists but is outside the vault.
        plugin(dir.path(), "obsidian-latex", &serde_json::json!({ "preamblePath": relative }).to_string());
        let s = math_settings(dir.path()).unwrap();
        assert_eq!(s.preamble, "");
        assert!(s.sources[0].error.as_deref().unwrap().contains("outside"));
    }
}
