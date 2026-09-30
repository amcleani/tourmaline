//! Reading settings from the user's Obsidian vault. Nothing here writes to it.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::error::{Error, Result};

/// Preamble files bigger than this are not macro files; refuse them.
const MAX_PREAMBLE_BYTES: u64 = 1024 * 1024;

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

/// Reads a file the vault's settings point to, refusing anything outside the vault.
fn read_vault_file(vault: &Path, relative: &str) -> Result<String> {
    let root = vault.canonicalize()?;
    let path = root.join(relative).canonicalize()?;
    if !path.starts_with(&root) {
        return Err(Error::Message("the file is outside the vault".into()));
    }
    if std::fs::metadata(&path)?.len() > MAX_PREAMBLE_BYTES {
        return Err(Error::Message("the file is too large to be a preamble".into()));
    }
    Ok(std::fs::read_to_string(path)?)
}

pub fn math_settings(vault: &Path) -> Result<MathSettings> {
    let config = config_dir(vault)?;
    let enabled: Vec<String> = read_json(&config.join("community-plugins.json"))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
