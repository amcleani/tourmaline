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
| Storage | SQLite (`rusqlite`), documents keyed by SHA-256 of their contents |

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
- **Block IDs** per highlight (`^hl-7f3e`) that never change.
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
`preamble.sty`; `\` command autocomplete; optional LaTeX Suite snippets.

**Copy equation as LaTeX**: arXiv source matching first; otherwise an optional
downloadable OCR model (pix2tex / UniMERNet via ONNX in Rust).

## Data model

```
documents   (id = sha256, path, name, size, first_opened, last_opened, last_position)
categories  (id, name, colour, callout_type, key)
annotations (id, doc_id, kind: highlight|area|ink|note, page, rects|strokes|box,
             quote, prefix, suffix, category_id, note_md, tags, image_path,
             pdf_nm, pdf_obj_ref, block_id, created, updated)
```

Highlights anchor by page + rects, with quote/prefix/suffix to re-find the text
if the PDF changes.

## Phases

| # | Phase | Done when |
|---|---|---|
| 0 | **Setup**: Tauri + React + pdf.js, command registry, native menu, palette, SQLite, CI | A PDF opens from File › Open and from the palette ✅ |
| 1 | **Viewer**: virtualised pages, text layer, zoom keeping position, fit width, page tracking, tabs, outline, search, reading position; prototype line/column detection | A 50-page paper reads comfortably |
| 2 | **Annotations**: highlights, categories, notes, area capture, sidebar | Highlights survive restart and file rename |
| 3 | **Notes editor**: CodeMirror + MathJax + preamble + autocomplete | Formulas render as in Obsidian |
| 4a | **Vault**: read vault settings, match PDFs to JabRef entries, Handlebars templates, `tourmaline://` links | — |
| 4b | **PDF annotations**: import existing annotations; optional write-back and `{{pdfLink}}` | — |
| 4c | **Export**: merge into notes preserving edits; template editor with live preview | Highlight in `Goodman2023GG` → appears in `@Goodman2023GG.md` without touching the user's text → link reopens Tourmaline there |
| 5 | **Focus mode** | A two-column arXiv paper reads in order |
| 6 | **Smart navigation**: citation/figure/equation popups, back/forward, split view | Hovering "[12]" shows the reference |
| 7 | **Ink** | Strokes survive zoom and export |
| 8 | **Equation → LaTeX** | Copied LaTeX compiles |
| 9 | **Polish**: accessibility audit, themes, UI scale, shortcut editor, installer, auto-update | Everything works mouse-only and keyboard-only |

## Risks

- Text extraction (ligatures, hyphenation, garbled math): cleanup pass + test corpus.
- Column detection on unusual layouts: per-paper off switch.
- Citation matching without internal links: best effort, falls back to no popup.
- PDF write-back renders differently across viewers: test in Acrobat, Obsidian, Zotero.
- `annotation=` object refs change if another tool fully rewrites a PDF: re-find by `/NM` and fix links in the managed section.
- EPUB/DjVu files in `Library/` aren't supported (EPUB via foliate-js is a possible later addition).
