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
- PDF++ is being retired — no compatibility needed. (Its links name Okular
  annotations by /NM, which Tourmaline keeps when importing.) Existing
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
  separate `@{{citekey}} highlights` note, or copy one at a time. **Default
  (decided before 4c): under a `# Annotations` heading in the literature note**;
  the managed `%% tourmaline:begin %%`…`%% tourmaline:end %%` region sits
  under that heading.
- **Links**: `{{readerLink}}` (`tourmaline://open?doc=…&hl=…`, default) reopens
  Tourmaline at the highlight. `{{pdfLink}}` (`[[x.pdf#page=5&annotation=412R]]`)
  opens Obsidian's own viewer; needs PDF write-back turned on.
- **Block IDs** per highlight (`^hl-k3x9q2`) that never change.
- Templates are parsed by Handlebars and run by Tourmaline's own interpreter
  (the app's CSP forbids the `new Function` Handlebars' compiler uses):
  everything the Citations plugin's templates use works; partials don't.
- Notes follow the vault's "Strict line breaks" setting.
- Phase 4a ships the highlight template and **Copy as Markdown** / **Copy link
  to annotation**; the template editor and writing notes are 4c.
- Multi-line notes and `$$` blocks in callouts get a `>` on every line.
- Optional CSS snippet in `.obsidian/snippets/` to colour category callouts (off by default).

## Citekeys (JabRef)

Match PDF → entry by the `.bib` `file` field, then by filename prefix, then a
searchable picker (remembered; File › Link to bibliography entry, or the
citekey button in the toolbar). A new file matched to an entry another paper
already has joins that paper as a new version (decision 1) if it has no
annotations of its own; if the user then says it's a different paper, it is
not matched to that entry again. Works with their own annotations are never
merged. Never write `database.bib` directly; for new
papers, fetch metadata from DOI/arXiv and send to JabRef (`--importToOpen`) or
copy BibTeX. Watch the `.bib` for changes.

## Features

**Reading**: tabs, reading-position memory, split view, outline sidebar (from
the PDF or inferred from headings), citation popups and figure/equation previews
(PDF links first, text-pattern fallback), back/forward.

**Smart navigation (6)**: links in the PDF are clickable (web and mail
links open in the browser). Hovering or focusing (Tab) a link or citation
shows where it leads, drawn from the page: the bibliography entry, the
figure with its caption, the equation, theorem or section. Without links,
citations are found in the text: numeric ([12], [2, 5–7], [BD24]),
author-year matched against the bibliography read after its heading
(Lewis (1986), Bacon and Dorr 2024, Bacon 2018a, p. 3; 2018b; "—" for the
same authors), Figure/Table/Eq./Section/Theorem/Lemma… N, and a bare (2)
when the paper numbers such an equation. Back/Forward (Alt+Left/Right,
toolbar, mouse buttons) after any jump. Split view (Ctrl+Shift+S): a second
pane on the same paper or another tab; Ctrl+click opens a link there; F6
switches panes.

**Focus mode** (View › Focus mode, F; toolbar): 1–3 lines or one sentence
(S changes it); lines grouped from pdf.js text items; two-column ordering
from the gap between columns, with full-width elements and side-by-side
author blocks in place; per-paper switch to disable column detection;
everything but the step dimmed, the step kept at a fixed eye line (near the
top, upper third or middle); formulas and figures (the band beside a
caption) count as one step; page numbers skipped. Up/Down step, a click
picks a step, scrolling away and pressing Down carries on from the eye line;
a floating bar has every control; the step is read out to screen readers.

**Importing (4b)**: annotations other programs saved in a PDF become
Tourmaline's on first open: text markup → highlights with their quote,
sticky notes/free text → notes, squares/circles → areas; replies join their
parent's note; colour → the category nearest in hue. Once per paper, keyed
by /NM (else position); deleting one keeps it deleted. pdf.js stops drawing
the originals. Ink is left drawn until Ink (phase 7, deferred) exists.

**Write-back (4b)**: File › Save annotations into PDF (Ctrl+S), asked before
the first use, never automatic. Original bytes backed up to
`<data>/backups/pdf/<sha256>.pdf` (originals kept for good; backups of
versions Tourmaline wrote, i.e. earlier saves, deleted after 30 days); changes appended as an incremental update
(lopdf) and moved over the file. Imported annotations update their own
object; Tourmaline's are named by their id; deleted ones leave the page. The
result is a `writeback` version of the work with placements copied, each
remembering its object (`{{pdfLink}}` = `[[x.pdf#page=N&annotation=412R]]`).

**Export (4c)**: Export › Export annotations to Obsidian (Ctrl+Shift+X,
toolbar), never automatic. Renders every highlight, area and note of the
paper (reading order, orphans last) with the highlight template, joins them
with the section template, and puts the result between the markers: an
existing section is replaced in place; otherwise it goes directly under
`# Annotations` (added at the end of the note if missing). A missing
literature note is created from the Citations plugin's template. Asks before
replacing edits made inside the section (compared with what Tourmaline last
wrote there) and before removing highlights that any note links to
(`#^hl-…`); refuses a note changed meanwhile or with muddled markers. Area
images are copied to Obsidian's attachment folder as
`tourmaline-hl-xxxxxx.png` and embedded with `{{image}}`. Export › Export
settings edits where highlights go (heading, or a separate note), the
literature note overrides and both templates, with a live preview on the
open paper; Copy as Markdown uses the same highlight template.

**Annotations**: user-defined colour categories (name, colour, key 1–9, callout
type); area capture to PNG in the vault's attachment folder (`Obsidian/Attatchments`);
pen with pressure and eraser; filterable annotation sidebar; import existing PDF
annotations (e.g. Okular); optional write-back via pdf-lib.

**Notes editor**: CodeMirror + live MathJax preview using the vault's
`preamble.sty`; `\` command autocomplete. No LaTeX Suite snippets (the
user doesn't want them).

**Wikilink autocomplete (10)**: typing `[[` in a note suggests the vault's
notes (fuzzy match on names and frontmatter `aliases`, the folder shown for
names used twice); choosing one inserts the link as the vault's "new link
format" setting (`.obsidian/app.json`: shortest path, relative or absolute)
would write it, with the closing `]]`. Read-only: a Rust command lists the
vault's `.md` files (skipping `.obsidian` and hidden folders) with their
aliases and headings, cached and re-read when the window regains focus.
Wikilinks are a syntax node of both note parsers (like math), so nothing is
suggested inside code or formulas; rendered notes show them as links that
open the note in Obsidian. Also suggested: names other notes link to that
don't exist yet (after the existing notes, marked as not created yet), and
after `[[note#` that note's headings, after `[[note#^` its block IDs.

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
7. **Backups**: local only, next to the database. PDF backups: the file as
   it was before Tourmaline first wrote into it is kept for good; backups of
   later saves go after 30 days (decided in phase 4b).

## Phases

| # | Phase | Done when |
|---|---|---|
| 0 | **Setup**: Tauri + React + pdf.js, command registry, native menu, palette, SQLite, CI | A PDF opens from File › Open and from the palette ✅ |
| 1 | **Viewer**: virtualised pages, text layer, zoom keeping position, fit width, page tracking, tabs, outline, search, reading position; prototype line/column detection | A 50-page paper reads comfortably ✅ (line detection passes all fixture pages in `test/fixtures/`) |
| 2 | **Annotations**: highlights, categories, notes, area capture, sidebar | Highlights survive restart and file rename ✅ |
| 3 | **Notes editor**: CodeMirror + MathJax + preamble + autocomplete | Formulas render as in Obsidian ✅ |
| 4a | **Vault**: read vault settings, match PDFs to JabRef entries, Handlebars templates, `tourmaline://` links | `BaconDorrC.pdf` is matched to its entry; Copy as Markdown gives a callout whose `tourmaline://` link reopens the highlight ✅ |
| 4b | **PDF annotations**: import existing annotations; optional write-back and `{{pdfLink}}` | The Okular highlights in `BaconDorrC.pdf` appear in the sidebar and can be edited; Save annotations into PDF puts Tourmaline's into a copy, and Obsidian shows them ✅ |
| 4c | **Export**: merge into notes preserving edits; template editor with live preview | Highlight in `Goodman2023GG` → appears in `@Goodman2023GG.md` without touching the user's text → link reopens Tourmaline there ✅ |
| 5 | **Focus mode** | A two-column arXiv paper reads in order ✅ |
| 6 | **Smart navigation**: citation/figure/equation popups, back/forward, split view | Hovering "[12]" shows the reference ✅ |
| 7 | **Ink** *(deferred: a later feature, after phase 9)* | Strokes survive zoom and export |
| 8 | **Equation → LaTeX** *(deferred: a later feature, after phase 9)* | Copied LaTeX compiles |
| 9 | **Polish**: accessibility audit, themes, UI scale, shortcut editor, installer, auto-update | Everything works mouse-only and keyboard-only ✅ |
| 10 | **Wikilink autocomplete** in notes, from the vault | Typing `[[conc` in a note suggests `concept` from the vault ✅ |

Phases 7 and 8 are put off (decided after phase 6): phase 9 comes next, and
they follow as later features. Phase 10 (wikilink autocomplete, added after
phase 9) comes after phase 9's review, before 7 and 8.

**Polish (9)**:
- Zoom by trackpad pinch (smooth while pinching, the pages redrawn sharp
  when it stops) and Ctrl+mouse wheel (one step a notch), around the
  pointer, in whichever pane is under it; the webview's own zoom of the
  whole interface stays off.
- Shortcut editor (Help › Keyboard shortcuts): change, remove or reset any
  command's shortcut; taking another command's asks first; keys that move
  focus, open menus, close the window or edit text are refused. Category
  keys stay in Edit categories.
- Appearance (View › Appearance, and View menu commands): theme as Windows,
  light, dark or high contrast; pages as printed, dark or sepia; interface
  size 80–200% (the webview's zoom). Windows' contrast themes keep pages and
  highlights in their own colours.
- Right-click menus (also Shift+F10 / the menu key) on selected text, a
  highlight or the page, made of registry commands.
- Keyboard text selection: Navigate › Select the found text (Alt+Enter, or
  Select in the find bar), then Shift+arrows (Ctrl+Shift by word) to adjust;
  H, 1–9 and N work on it as on a mouse selection. (Selecting a focus-mode
  step is a possible later addition.)
- Accessibility audit with axe-core over every dialog and panel in each
  theme: no violations. Tab stays inside modal dialogs.
- Installer (decided in phase 9): NSIS, per user; Tourmaline is offered in
  Explorer's "Open with" for PDFs without becoming the default; PDFs passed
  on the command line open (also into the running app).
- Updates (decided in phase 9): signed GitHub releases of
  `amcleani/tourmaline` (`plugins.updater` in tauri.conf.json). Pushing a
  `v*` tag runs `.github/workflows/release.yml`, which makes a draft
  release; publishing it delivers the update. The signing key is
  `~/.tauri/tourmaline.key` (not in the repo; GitHub secret
  `TAURI_SIGNING_PRIVATE_KEY`). Help › Check for updates / About; an
  automatic check at start, at most daily, can be turned off.

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
