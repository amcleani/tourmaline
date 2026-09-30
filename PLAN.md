# Tourmaline — plan

A desktop PDF reader for academic research, built around an Obsidian vault.
Sioyek-level reading power with a UI where every feature is reachable both by
mouse (menus, toolbar, right-click) and by keyboard (shortcuts, command palette).

## Stack

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (Rust): file access, SQLite, `tourmaline://` deep links, optional equation-OCR model |
| UI | React + TypeScript + Vite |
| PDF reading | `pdfjs-dist` (pages, text layer, links, outline) |
| PDF writing | `pdf-lib` (standard annotations, appended to the end of the file) |
| Notes editor | CodeMirror 6 with live MathJax 3 preview |
| Ink | `perfect-freehand`, pressure from pointer events |
| Templates | Handlebars (same syntax as the Obsidian Citations plugin) |
| Storage | SQLite (`rusqlite`); works (papers) with one file row per SHA-256 version |

## Principles

- **One command list.** Every action is a `Command` (id, title, shortcut, menu
  placement, `when` condition). The native menu bar, toolbar, command palette
  (Ctrl+K), context menus, shortcut editor and Help › Keyboard shortcuts are all
  generated from it.
- **Never overwrite the user's writing.** Tourmaline only rewrites the section of
  a note between `%% tourmaline:begin %%` and `%% tourmaline:end %%`, and never
  rewrites frontmatter of an existing note.
- **PDFs are untouched by default.** Writing annotations into PDFs is an opt-in
  setting (appended to the end of the file, backup first).

## The user's setup (Academia vault)

- Vault: `C:\Users\amcle\Documents\Academia`. PDFs in `Library/`.
- Literature notes: `Obsidian/Library/@{{citekey}}.md` (Citations plugin
  settings; template has `Title`, `Author: "[[{{authorString}}]]"`, `Year`, `Tags`).
- Bibliography: `Library/database.bib`, managed by JabRef. Citekeys like
  `Goodman2023GG`; the PDF is recorded in each entry's `file` field.
- Math: `preamble.sty` at the vault root defines custom macros (loaded by the
  obsidian-latex plugin); latest-mathjax plugin with the `newcm` font; LaTeX
  Suite snippets.
- PDF++ is being retired — no compatibility needed. Existing
  `[[x.pdf#page=N&annotation=ID]]` links work in Obsidian's core viewer.

## Obsidian integration

- **Note title and folder** default to the Citations plugin settings (read from
  the vault), with a switch to override.
- **Three editable Handlebars templates**: new note (defaults to the Citations
  template), one highlight, and the highlights section. Fields match the
  Citations plugin (`{{citekey}}`, `{{title}}`, `{{authorString}}`, `{{year}}`,
  `{{DOI}}`, …) plus Tourmaline's (`{{quote}}`, `{{note}}`, `{{page}}`,
  `{{category.callout}}`, `{{blockId}}`, `{{readerLink}}`, `{{pdfLink}}`, `{{image}}`).
- **Where highlights go** (choice): under a heading in the literature note, in a
  separate `@{{citekey}} highlights` note, or copy one at a time.
- **Links**: `{{readerLink}}` (`tourmaline://open?doc=…&hl=…`, default) reopens
  Tourmaline at the highlight. `{{pdfLink}}` (`[[x.pdf#page=5&annotation=412R]]`)
  opens Obsidian's own viewer; needs PDF write-back turned on.
- **Block IDs** per highlight (`^hl-k3x9q2`) that never change.
- Multi-line notes and `$$` blocks in callouts get a `>` on every line.
- Optional CSS snippet in `.obsidian/snippets/` to colour category callouts (off by default).

## Citekeys (JabRef)

Match PDF → entry by the `.bib` `file` field, then by filename prefix, then a
searchable picker (remembered). Never write `database.bib` directly; for new
papers, fetch metadata from DOI/arXiv and send to JabRef (`--importToOpen`) or
copy BibTeX. Watch the `.bib` for changes.

## Features

**Reading**: tabs, reading-position memory, split view, outline sidebar (from
the PDF or inferred from headings), citation popups and figure/equation previews
(PDF links first, text-pattern fallback), back/forward.

**Focus mode**: 1–3 lines or one sentence; lines grouped from pdf.js text items;
two-column ordering from the gap between columns, with full-width elements in
place; per-paper switch to disable column detection; overlay with fixed eye
height; formulas/figures count as one step.

**Annotations**: user-defined colour categories (name, colour, key 1–9, callout
type); area capture to PNG in the vault's attachment folder (`Obsidian/Attatchments`);
pen with pressure and eraser; filterable annotation sidebar; import existing PDF
annotations (e.g. Okular); optional write-back via pdf-lib.

**Notes editor**: CodeMirror + live MathJax preview using the vault's
`preamble.sty`; `\` command autocomplete; optional LaTeX Suite snippets
(not yet: the vault's snippets are JavaScript, which would need a parser for
their subset, since the CSP rightly forbids eval).

Math matches the vault's Obsidian: its built-in MathJax 3 unless the
latest-mathjax plugin is enabled (then its font and packages), plus the
obsidian-latex preamble. Tourmaline uses MathJax 4 either way, with the
classic TeX font standing in for MathJax 3's; `\href` and `\require` are
left out.

**Copy equation as LaTeX**: arXiv source matching first; otherwise an optional
downloadable OCR model (pix2tex / UniMERNet via ONNX in Rust).

## Data model

A **work** is a paper; a **file** is one exact version of it (SHA-256 of its
bytes). Annotations, the reading position and (later) the citekey belong to the
work, so they survive renames, moves and new versions of the PDF.

```
works        (id uuid, title, citekey, last_position, created)
files        (sha256, work_id, path, name, size, origin: opened|writeback|external,
              derived_from, first_opened, last_opened)
file_pages   (file_sha256, page, text_hash)          -- to tell whether a page changed
categories   (id, name, colour, callout, hotkey 1-9, sort_order, deleted_at)
annotations  (id uuidv7 = /NM on write-back, work_id, kind: highlight|area|note|ink,
              category_id, colour, note_md, quote, prefix, suffix, image_path,
              block_id UNIQUE, source: tourmaline|imported, source_nm,
              created, updated, deleted_at)
annotation_placements (annotation_id, file_sha256, page, geometry JSON in PDF
              user space, text_start, text_end, status: exact|moved|fuzzy|orphan,
              pdf_obj_ref)
```

No ON DELETE CASCADE anywhere; deletes are soft (`deleted_at`) so export can
remove the matching block from the note and undo can bring it back. The file
hash is computed in Rust from the bytes it hands to the viewer.

**Re-anchoring** when a new version is opened: page text hash unchanged → same
geometry (exact); otherwise find quote + prefix/suffix in the new text, nearest
the old page first (moved/fuzzy); otherwise orphan (shown in the sidebar, never
silently dropped).

### Decisions (agreed before phase 2)

1. **New version of a paper** (same path now; same JabRef citekey from phase 4):
   inherits the annotations automatically; highlights that can't be re-found
   are flagged as orphans. If the new file's text doesn't look like the same
   paper (a generic download name reused), Tourmaline asks first.
2. **Write-back target**: the vault PDF itself, backed up first.
3. **Deleting a highlight**: its block is removed from the note on the next
   export; if other notes link to that block, ask first.
4. **Imported annotations** (Okular etc.): owned by Tourmaline and editable.
5. **Note text**: Tourmaline's database is the master; export warns before
   overwriting edits made inside the managed region.
6. **Block IDs**: `^hl-` + 6 base36 characters (`^hl-k3x9q2`), never changed.
7. **Backups**: local only, next to the database.

## Phases

| # | Phase | Done when |
|---|---|---|
| 0 | **Setup**: Tauri + React + pdf.js, command registry, native menu, palette, SQLite, CI | A PDF opens from File › Open and from the palette ✅ |
| 1 | **Viewer**: virtualised pages, text layer, zoom keeping position, fit width, page tracking, tabs, outline, search, reading position; prototype line/column detection | A 50-page paper reads comfortably ✅ (line detection passes all fixture pages in `test/fixtures/`) |
| 2 | **Annotations**: highlights, categories, notes, area capture, sidebar | Highlights survive restart and file rename ✅ |
| 3 | **Notes editor**: CodeMirror + MathJax + preamble + autocomplete | Formulas render as in Obsidian (built; awaiting side-by-side check) |
| 4a | **Vault**: read vault settings, match PDFs to JabRef entries, Handlebars templates, `tourmaline://` links | — |
| 4b | **PDF annotations**: import existing annotations; optional write-back and `{{pdfLink}}` | — |
| 4c | **Export**: merge into notes preserving edits; template editor with live preview | Highlight in `Goodman2023GG` → appears in `@Goodman2023GG.md` without touching the user's text → link reopens Tourmaline there |
| 5 | **Focus mode** | A two-column arXiv paper reads in order |
| 6 | **Smart navigation**: citation/figure/equation popups, back/forward, split view | Hovering "[12]" shows the reference |
| 7 | **Ink** | Strokes survive zoom and export |
| 8 | **Equation → LaTeX** | Copied LaTeX compiles |
| 9 | **Polish**: accessibility audit, themes, UI scale, shortcut editor, installer, auto-update | Everything works mouse-only and keyboard-only |

## Development notes

- Test corpus: `test/fixtures/` (9 LaTeX-built PDFs with ground truth; see its
  README). `test/readingOrder.test.ts` checks line detection against it.
- Development runs keep their library in `.dev-data/` (`TOURMALINE_DATA_DIR`):
  apps launched from the Claude desktop app have AppData writes redirected.
- Known issue: search highlights estimate character positions proportionally
  within a text item, so they drift sideways on long lines ("action model"
  highlighted as "ction models"). Fix by measuring positions from the text
  layer spans. (Phase 2 highlights use the real selection, so they're unaffected.)
- Still missing: `test/fixtures/REAL_PAPERS.md` (a list of the user's papers for
  manual checks; the fixture subagent didn't finish it).

## Risks

- Text extraction (ligatures, hyphenation, garbled math): cleanup pass + test corpus.
- Column detection on unusual layouts: per-paper off switch.
- Citation matching without internal links: best effort, falls back to no popup.
- PDF write-back renders differently across viewers: test in Acrobat, Obsidian, Zotero.
- `annotation=` object refs change if another tool fully rewrites a PDF: re-find by `/NM` and fix links in the managed section.
- EPUB/DjVu files in `Library/` aren't supported (EPUB via foliate-js is a possible later addition).
