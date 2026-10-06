//! What `[[` autocomplete in notes offers: the vault's notes with their
//! aliases, headings and block IDs, and the names notes link to that have no
//! note yet. Read only. Each note is parsed again only when its size or
//! modification time changes, so re-reading the vault on focus is cheap.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

use crate::error::Result;

/// Notes bigger than this are skipped (as by find_block_links).
const MAX_NOTE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Serialize, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Heading {
    pub level: u8,
    pub text: String,
}

#[derive(Debug, Serialize, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IndexedNote {
    /// Relative to the vault, forward slashes, with `.md`.
    pub path: String,
    pub aliases: Vec<String>,
    pub headings: Vec<Heading>,
    /// Block IDs (`^id` at the end of a block), without the `^`.
    pub blocks: Vec<String>,
}

/// A name notes link to that isn't a note (yet).
#[derive(Debug, Serialize, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Unresolved {
    pub name: String,
    /// How many links to it there are.
    pub count: u32,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultIndex {
    pub notes: Vec<IndexedNote>,
    pub unresolved: Vec<Unresolved>,
}

/// What one note's text holds.
#[derive(Debug, PartialEq, Clone, Default)]
pub struct Parsed {
    pub aliases: Vec<String>,
    pub headings: Vec<Heading>,
    pub blocks: Vec<String>,
    /// Link targets (`[[target#…|…]]` → `target`), as written.
    pub links: Vec<String>,
}

/// Parsed notes by relative path: (modified, size, parsed).
type ParsedNotes = HashMap<String, (i64, u64, Parsed)>;

/// The parsed notes of the last vault indexed.
#[derive(Default)]
pub struct IndexCache(Mutex<Option<(PathBuf, ParsedNotes)>>);

fn unquote(s: &str) -> String {
    let s = s.trim();
    let quoted = s.len() >= 2 && ((s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')));
    if quoted { s[1..s.len() - 1].to_owned() } else { s.to_owned() }
}

/// `a, "b, c", 'd'` → the items, splitting only on commas outside quotes.
fn split_list(inner: &str) -> Vec<&str> {
    let mut items = Vec::new();
    let mut quote: Option<char> = None;
    let mut start = 0;
    for (i, c) in inner.char_indices() {
        match (quote, c) {
            (None, '"' | '\'') => quote = Some(c),
            (Some(q), _) if c == q => quote = None,
            (None, ',') => {
                items.push(&inner[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    items.push(&inner[start..]);
    items
}

/// `a/b/../c` → `a/c`; None if it climbs out of the vault.
fn normalise(path: &str) -> Option<String> {
    let mut out: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                out.pop()?;
            }
            _ => out.push(part),
        }
    }
    Some(out.join("/"))
}

/// The `aliases` (or `alias`) of a note's frontmatter: `[a, "b"]`, a single
/// name, or a list of `- a` lines.
fn frontmatter_aliases(lines: &[&str]) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let Some((key, value)) = line.split_once(':') else {
            i += 1;
            continue;
        };
        if !matches!(key, "aliases" | "alias") {
            i += 1;
            continue;
        }
        let value = value.trim();
        if let Some(inner) = value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
            out.extend(split_list(inner).into_iter().map(unquote));
        } else if !value.is_empty() {
            out.push(unquote(value));
        } else {
            i += 1;
            while i < lines.len() {
                let item = lines[i].trim_start();
                let Some(name) = item.strip_prefix("- ").or_else(|| (item == "-").then_some("")) else { break };
                out.push(unquote(name));
                i += 1;
            }
            continue;
        }
        i += 1;
    }
    out.retain(|a| !a.is_empty());
    out
}

/// A fence line (``` or ~~~, indented at most three spaces): its marker.
fn fence(line: &str) -> Option<&str> {
    let t = line.trim_start_matches(' ');
    if line.len() - t.len() > 3 {
        return None;
    }
    ["```", "~~~"].into_iter().find(|m| t.starts_with(m))
}

/// `# Heading` → (1, "Heading"), without a closing run of `#`.
fn heading(line: &str) -> Option<Heading> {
    let t = line.trim_start_matches(' ');
    if line.len() - t.len() > 3 {
        return None;
    }
    let level = t.bytes().take_while(|&b| b == b'#').count();
    if level == 0 || level > 6 {
        return None;
    }
    let rest = &t[level..];
    if !rest.is_empty() && !rest.starts_with([' ', '\t']) {
        return None; // #tag
    }
    let mut text = rest.trim();
    let closing = text.trim_end_matches('#');
    if closing.is_empty() || closing.ends_with([' ', '\t']) {
        text = closing.trim_end();
    }
    (!text.is_empty()).then(|| Heading { level: level as u8, text: text.to_owned() })
}

/// The block ID ending a line: `text ^id` or a line that is only `^id`.
fn block_id(line: &str) -> Option<&str> {
    let t = line.trim_end();
    let at = t.rfind('^')?;
    let id = &t[at + 1..];
    let before = &t[..at];
    let ok = !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    (ok && (before.is_empty() || before.ends_with([' ', '\t']))).then_some(id)
}

/// The text of a line outside `inline code`.
fn without_code_spans(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(start) = rest.find('`') {
        out.push_str(&rest[..start]);
        let ticks = rest[start..].bytes().take_while(|&b| b == b'`').count();
        let after = &rest[start + ticks..];
        let closer = "`".repeat(ticks);
        match after.find(&closer) {
            Some(end) => rest = &after[end + ticks..],
            None => {
                out.push_str(&rest[start..]);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Link targets in a line: `[[target]]`, `[[target#heading|shown]]`, embeds too.
fn link_targets(line: &str, out: &mut Vec<String>) {
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { return };
        let inner = &after[..end];
        if !inner.contains("[[") {
            let target = inner.split(['|', '#']).next().unwrap_or("").trim();
            if !target.is_empty() {
                out.push(target.to_owned());
            }
            rest = &after[end + 2..];
        } else {
            rest = &rest[start + 2..];
        }
    }
}

/// Reads what autocomplete needs from a note's text.
pub fn parse_note(text: &str) -> Parsed {
    let mut parsed = Parsed::default();
    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0;
    if lines.first().is_some_and(|l| l.trim_end() == "---") {
        if let Some(end) = lines.iter().skip(1).position(|l| matches!(l.trim_end(), "---" | "...")) {
            parsed.aliases = frontmatter_aliases(&lines[1..end + 1]);
            i = end + 2;
        }
    }
    let mut in_fence: Option<&str> = None;
    let mut in_comment = false;
    for line in &lines[i.min(lines.len())..] {
        if let Some(marker) = in_fence {
            if fence(line).is_some_and(|m| m == marker) {
                in_fence = None;
            }
            continue;
        }
        if let Some(marker) = fence(line) {
            in_fence = Some(marker);
            continue;
        }
        // %% Obsidian comments %% spanning lines hide what they hold.
        if line.matches("%%").count() % 2 == 1 {
            in_comment = !in_comment;
            continue;
        }
        if in_comment {
            continue;
        }
        if let Some(h) = heading(line) {
            parsed.headings.push(h);
        }
        if let Some(id) = block_id(line) {
            parsed.blocks.push(id.to_owned());
        }
        link_targets(&without_code_spans(line), &mut parsed.links);
    }
    parsed
}

fn modified_millis(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as i64)
}

/// Whether a link target names a note (no extension, or `.md`) rather than an attachment.
fn names_a_note(target: &str) -> bool {
    match Path::new(target).extension() {
        None => true,
        Some(e) => e.eq_ignore_ascii_case("md") || !e.to_string_lossy().chars().all(|c| c.is_ascii_alphanumeric()),
    }
}

/// Every note in the vault (hidden files and folders skipped) and the link
/// targets that match none, most linked first.
pub fn index_vault(vault: &Path, cache: &IndexCache) -> Result<VaultIndex> {
    crate::vault::check_vault(vault)?;
    let mut guard = cache.0.lock().unwrap_or_else(|e| e.into_inner());
    let previous = match guard.take() {
        Some((dir, notes)) if dir == vault => notes,
        _ => HashMap::new(),
    };
    let mut parsed: ParsedNotes = HashMap::with_capacity(previous.len());
    let mut previous = previous;
    let mut stack = vec![(vault.to_path_buf(), String::new())];
    while let Some((dir, rel)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let child = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                stack.push((entry.path(), child));
                continue;
            }
            if !kind.is_file() || !name.to_lowercase().ends_with(".md") {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if meta.len() > MAX_NOTE_BYTES {
                continue;
            }
            let (modified, size) = (modified_millis(&meta), meta.len());
            let note = match previous.remove(&child) {
                Some(cached) if cached.0 == modified && cached.1 == size => cached,
                _ => {
                    let Ok(bytes) = std::fs::read(entry.path()) else { continue };
                    (modified, size, parse_note(&String::from_utf8_lossy(&bytes)))
                }
            };
            parsed.insert(child, note);
        }
    }

    // A link resolves to a note by its path or its name, ignoring case, as in Obsidian.
    let mut known: std::collections::HashSet<String> = std::collections::HashSet::new();
    for path in parsed.keys() {
        let stem = path[..path.len() - 3].to_lowercase();
        known.insert(stem.rsplit('/').next().unwrap_or(&stem).to_owned());
        known.insert(stem);
    }
    let mut counts: HashMap<String, (String, u32)> = HashMap::new();
    for (path, (_, _, p)) in &parsed {
        for target in &p.links {
            if !names_a_note(target) {
                continue;
            }
            let target = target.strip_suffix(".md").unwrap_or(target);
            // `./x` and `../x` (Obsidian's relative link format) are from the linking note's folder.
            let target = if target.starts_with("./") || target.starts_with("../") {
                let folder = path.rsplit_once('/').map_or("", |(f, _)| f);
                let Some(t) = normalise(&format!("{folder}/{target}")) else { continue };
                t
            } else {
                target.trim_start_matches('/').to_owned()
            };
            let key = target.to_lowercase();
            if key.is_empty() || known.contains(&key) {
                continue;
            }
            counts.entry(key).or_insert_with(|| (target, 0)).1 += 1;
        }
    }
    let mut unresolved: Vec<Unresolved> = counts.into_values().map(|(name, count)| Unresolved { name, count }).collect();
    unresolved.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));

    let mut notes: Vec<IndexedNote> = parsed
        .iter()
        .map(|(path, (_, _, p))| IndexedNote {
            path: path.clone(),
            aliases: p.aliases.clone(),
            headings: p.headings.clone(),
            blocks: p.blocks.clone(),
        })
        .collect();
    notes.sort_by(|a, b| a.path.cmp(&b.path));
    *guard = Some((vault.to_path_buf(), parsed));
    Ok(VaultIndex { notes, unresolved })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn reads_aliases_in_each_frontmatter_form() {
        let p = parse_note("---\naliases: [one, \"two words\"]\ntags: x\n---\nbody");
        assert_eq!(p.aliases, vec!["one", "two words"]);
        let p = parse_note("---\naliases:\n  - quantifier generalism\n  - 'qg'\ncreated: 2024\n---\n");
        assert_eq!(p.aliases, vec!["quantifier generalism", "qg"]);
        assert_eq!(parse_note("---\nalias: solo\n---\n").aliases, vec!["solo"]);
        assert!(parse_note("---\naliases: []\n---\n").aliases.is_empty());
        // Commas inside quotes belong to the alias.
        let p = parse_note("---\naliases: [\"Lewis, David\", 'K, L', plain]\n---\n");
        assert_eq!(p.aliases, vec!["Lewis, David", "K, L", "plain"]);
        assert!(parse_note("---\naliases: \ncreated: 1\n---\n").aliases.is_empty());
        // Not frontmatter unless it opens the note.
        assert!(parse_note("text\n---\naliases: [x]\n---\n").aliases.is_empty());
    }

    #[test]
    fn reads_headings_blocks_and_links_outside_code() {
        let text = "\
# Title #
#concept in #proof_theory
## Second: part
Some text ^abc-12
> [!quote] [[Other note#Section|shown]] and ![[image.png]]
```
# not a heading
[[not a link]] ^nope
```
A `[[code]]` span and [[Folder/Deep note]].
^lone
%%
[[hidden]]
%%
####### seven
";
        let p = parse_note(text);
        assert_eq!(
            p.headings,
            vec![Heading { level: 1, text: "Title".into() }, Heading { level: 2, text: "Second: part".into() }]
        );
        assert_eq!(p.blocks, vec!["abc-12", "lone"]);
        assert_eq!(p.links, vec!["Other note", "image.png", "Folder/Deep note"]);
    }

    #[test]
    fn indexes_the_vault_and_finds_unresolved_names() {
        let dir = tempfile::tempdir().unwrap();
        let v = dir.path();
        fs::create_dir_all(v.join(".obsidian")).unwrap();
        fs::create_dir_all(v.join("Concepts")).unwrap();
        fs::create_dir_all(v.join(".trash")).unwrap();
        fs::write(v.join("Concepts/concept.md"), "---\naliases: [idea]\n---\n# Def\n").unwrap();
        fs::write(v.join("index.md"), "[[concept]] [[Concepts/Concept]] [[missing]] [[Missing#x]] [[pic.png]] [[later.md]]").unwrap();
        fs::write(v.join(".trash/old.md"), "[[ghost]]").unwrap();
        // Relative links (Obsidian's "Relative path to file"), from the linking note's folder.
        fs::write(v.join("Concepts/rel.md"), "[[./concept]] [[../index]] [[../Concepts/gone]] [[../../out]]").unwrap();
        let cache = IndexCache::default();
        let index = index_vault(v, &cache).unwrap();
        let paths: Vec<&str> = index.notes.iter().map(|n| n.path.as_str()).collect();
        assert_eq!(paths, vec!["Concepts/concept.md", "Concepts/rel.md", "index.md"]);
        assert_eq!(index.notes[0].aliases, vec!["idea"]);
        assert_eq!(
            index.unresolved,
            vec![
                Unresolved { name: "missing".into(), count: 2 },
                Unresolved { name: "Concepts/gone".into(), count: 1 },
                Unresolved { name: "later".into(), count: 1 },
            ]
        );

        // Creating the missing note resolves its links; unchanged notes come from the cache.
        fs::write(v.join("missing.md"), "").unwrap();
        let again = index_vault(v, &cache).unwrap();
        assert_eq!(
            again.unresolved,
            vec![Unresolved { name: "Concepts/gone".into(), count: 1 }, Unresolved { name: "later".into(), count: 1 }]
        );
        assert!(index_vault(&v.join("Concepts"), &cache).is_err());
    }

    /// The user's vault, read only: `[[conc` has notes to offer.
    #[test]
    fn indexes_the_users_vault() {
        let vault = Path::new(r"C:\Users\amcle\Documents\Academia");
        if !vault.join(".obsidian").exists() {
            return;
        }
        let index = index_vault(vault, &IndexCache::default()).unwrap();
        assert!(index.notes.len() > 1000);
        assert!(index.notes.iter().any(|n| n.path.ends_with("/conceptual analysis.md")));
        assert!(index.notes.iter().any(|n| !n.aliases.is_empty()));
        assert!(index.notes.iter().all(|n| !n.path.starts_with('.') && !n.path.contains("/.")));
    }
}
