<p align="center"><img src="app-icon.svg" width="120" alt=""></p>

# Tourmaline

A desktop PDF reader for academic research, built around an Obsidian vault.
Read papers, highlight and annotate them, and send your annotations into
your literature notes, with links that lead straight back to the highlight.
Every feature works with the mouse and with the keyboard.

Tourmaline runs on Windows. It is built with Tauri, React and pdf.js.

## Installing

Download `Tourmaline_x.y.z_x64-setup.exe` from the
[latest release](https://github.com/amcleani/tourmaline/releases/latest)
and run it. It installs for your user only and doesn't need administrator
rights.

- Tourmaline appears in Explorer's **Open with** menu for PDFs. Your default
  PDF program stays as it is.
- Updates: Tourmaline checks for a new version when it starts (at most once
  a day; this can be turned off), or on request with **Help › Check for
  updates**. Your work is saved before an update installs.

## Features

### Reading

- Tabs, with each paper reopening where you left it.
- Zoom with Ctrl+plus/minus, Ctrl+mouse wheel or a trackpad pinch; fit
  width or fit page.
- Outline sidebar, from the PDF's bookmarks.
- Find in the document (Ctrl+F), matching through ligatures, accents and
  hyphenated line breaks.
- Go to a page by number or by its printed label ("xii").

### Following references

- Links in the PDF can be clicked; web and mail links open in your browser.
- Hovering a link or citation, or moving to it with Tab, shows a preview of
  where it leads: the bibliography entry, the figure with its caption, the
  equation, the theorem or the section.
- Papers without links work too. Citations are found in the text:
  - numbered ones, such as [12], [2, 5–7] or [BD24];
  - author-year ones, such as Lewis (1986) or Bacon and Dorr 2024, matched
    against the bibliography;
  - references to a Figure, Table, Eq., Section, Theorem or Lemma by number.
- Back and Forward (Alt+Left/Right, the toolbar, or the mouse's side
  buttons) after any jump.
- Split view (Ctrl+Shift+S): a second pane on the same paper or another tab.
  Ctrl+click a link to open it there, and F6 switches panes.

### Focus mode

Press F to read one step at a time: one to three lines, or one sentence. The
rest of the page is dimmed, and the current step stays at a fixed eye line.

- Two-column papers are read in the right order: down the left column, then
  the right. Wide figures, titles and author blocks are read where they sit.
- Formulas and figures count as one step, and page numbers are skipped.
- Up and Down step through; a click picks a step.
- A floating bar has every setting, and the current step is read out to
  screen readers.

### Annotations

- Highlights in your own colour categories, each with a name, a key (1–9)
  and an Obsidian callout type.
- Notes on any highlight, written in Markdown with live math (below).
- Area capture (A) for figures and equations, saved as an image.
- An annotations sidebar you can filter by category.
- Undo and redo.
- Highlights survive renaming or moving the file. When a new version of a
  paper replaces the old one, its highlights are found again in the new
  text. Any that can't be placed are kept and flagged, not lost.
- Highlighting by keyboard: find the text (Ctrl+F), press Alt+Enter to
  select it, adjust the selection with Shift+arrow keys, then press H, a
  category key or N.

### Notes and math

- Notes are edited in Markdown, with formulas rendered as you type, using
  MathJax set up like your Obsidian: the same font, packages and macros
  from your vault's `preamble.sty`.
- Typing `\` suggests commands, your own macros first.

### Obsidian

Choose your vault once with **File › Choose Obsidian vault**.

- Papers are matched to their JabRef entries, through the `.bib` file's
  `file` field or the citekey at the start of the file name.
- **Export annotations to Obsidian** (Ctrl+Shift+X) writes every highlight
  into the paper's literature note:
  - The highlights go under an `# Annotations` heading, in a section marked
    by `%% tourmaline:begin %%` and `%% tourmaline:end %%`.
  - Only that section is ever rewritten. Your own writing and the
    frontmatter are left alone.
  - Tourmaline asks before replacing edits you made inside the section, or
    before removing a highlight that another note links to.
  - A missing literature note is created from the Citations plugin's
    template.
- Templates use the same Handlebars fields as the
  [Citations plugin](https://github.com/hans/obsidian-citation-plugin)
  (`{{citekey}}`, `{{title}}`, `{{authorString}}`…), plus Tourmaline's own
  (`{{quote}}`, `{{note}}`, `{{page}}`, `{{readerLink}}`, `{{image}}`…).
  **Export › Export settings** edits them, with a live preview.
- Each highlight gets a block ID (`^hl-k3x9q2`) that never changes, so you
  can link to it from any note.
- `tourmaline://` links reopen Tourmaline at the highlight.
- Copy as Markdown (Ctrl+C on a selected annotation) copies a single
  highlight in the same format.
- Tourmaline never writes JabRef's `database.bib`.

### Annotations inside the PDF

- Highlights, notes and boxes that other programs saved in a PDF (Okular,
  Acrobat…) are imported on first open and can then be edited.
- **File › Save annotations into PDF** (Ctrl+S) writes your annotations into
  the file, so other readers and Obsidian's own PDF viewer show them. It is
  never automatic and asks before its first use.
- Before writing, the original file is backed up, and the change is added to
  the end of the file rather than rewriting it.

### Mouse and keyboard

- Every command is in the menu bar, and the most used ones are on the
  toolbar.
- The command palette (Ctrl+K) finds any command by name.
- Right-click menus (also Shift+F10 or the menu key) on selected text, on a
  highlight and on the page.
- **Help › Keyboard shortcuts** lists every shortcut. You can change, remove
  or reset any of them there.
- Screen reader friendly: labelled controls, keyboard-navigable lists,
  trees and menus, and Tab kept inside dialogs.

### Appearance

**View › Appearance** sets:

- the theme: the same as Windows, light, dark or high contrast;
- the page colours: as printed, dark (light text on dark pages) or sepia;
- the interface size: 80–200%.

## Keyboard shortcuts

These are the defaults. **Help › Keyboard shortcuts** shows the current set
and lets you change them.

| Action | Keys |
|---|---|
| Open, open recent | Ctrl+O, Ctrl+R |
| Command palette | Ctrl+K |
| Find, next, previous | Ctrl+F, F3, Shift+F3 |
| Select the found text | Alt+Enter |
| Go to page | Ctrl+G |
| Back, forward | Alt+Left, Alt+Right |
| Zoom in, out, actual size | Ctrl+plus, Ctrl+minus, Ctrl+0 |
| Fit width, fit page | Ctrl+E, Ctrl+Shift+E |
| Outline, annotations sidebar | Ctrl+Shift+O, Ctrl+Shift+A |
| Split view, switch pane | Ctrl+Shift+S, F6 |
| Focus mode, next and previous step, step size | F, Down, Up, S |
| Highlight, note, capture area | H, N, A |
| Highlight in a category | 1–9 |
| Delete annotation | Delete |
| Undo, redo | Ctrl+Z, Ctrl+Y |
| Save annotations into PDF | Ctrl+S |
| Export to Obsidian | Ctrl+Shift+X |
| Keyboard shortcuts | Ctrl+/ |

## Development

Requirements: Node 24+, Rust (stable, MSVC toolchain on Windows), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # the desktop app with hot reload
npm run dev            # UI only, in a browser (browser file picker, no library)
npm test               # frontend tests (Vitest)
npm run typecheck
cd src-tauri && cargo test
```

`npm run tauri build` makes the installer in
`src-tauri/target/release/bundle/nsis/`. It signs the update, so it needs the
signing key in `TAURI_SIGNING_PRIVATE_KEY`.

**Releases:** raise `version` in `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml` and `package.json`, then push a tag such as `v0.2.0`.
The release workflow builds and signs a draft release; publishing it
delivers the update to installed copies.

Every user-facing action is a command in the command registry
(`src/commands/`). The menu bar, toolbar, palette, right-click menus and
keyboard shortcuts are all generated from it, so new features add commands
rather than buttons or key handlers. [PLAN.md](PLAN.md) holds the design,
the decisions and the roadmap; [CLAUDE.md](CLAUDE.md) describes the
architecture.

```
src/
  commands/   command registry, shortcuts, keymap, context menus, palette matching
  pdf/        pdf.js loading, layout, the page viewer, search
  annotations/  highlights, selection, re-anchoring, import from PDFs
  focus/      focus mode: reading order and steps
  nav/        links, citations, reference previews
  notes/ math/  Markdown note editor and MathJax
  vault/      Obsidian and JabRef: bibliography, templates, export
  platform/   bridge to Rust (files, library, updates) and the native menu
  ui/         toolbar, sidebars, dialogs, menus
src-tauri/src/
  library.rs, annotations.rs, db.rs   SQLite library
  documents.rs                        reading and fingerprinting PDFs
  vault.rs                            reading and writing the vault
  writeback.rs, pdf_annotations.rs    annotations inside PDF files
  launch.rs                           PDFs opened from Explorer
test/         Vitest tests and PDF fixtures
```
