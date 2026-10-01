# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Tourmaline is a Tauri 2 desktop PDF reader for academic research that exports
annotations to the user's Obsidian vault. [PLAN.md](PLAN.md) is the source of
truth for scope, phases and each phase's "done when" criterion; update it when
a decision changes.

## Commands

Rust is installed via rustup but `~/.cargo/bin` may not be on PATH in the Bash
tool — call `~/.cargo/bin/cargo` directly, or prefix `PATH="$HOME/.cargo/bin:$PATH"`.

```bash
TOURMALINE_DATA_DIR="$PWD/.dev-data" npm run tauri dev   # desktop app with hot reload (needs cargo on PATH)
npm run dev                            # UI only in a browser at :1420 (browser file picker, no library/DB)
npm test                               # all Vitest tests
npx vitest run test/registry.test.ts   # one file;  add  -t "name"  for one test
npm run typecheck
npm run build                          # also required before any cargo command: the crate embeds dist/
cd src-tauri && ~/.cargo/bin/cargo test [name]
cd src-tauri && CARGO_TARGET_DIR=target/clippy ~/.cargo/bin/cargo clippy --all-targets -- -D warnings
```

Always set `TOURMALINE_DATA_DIR` when launching the app from Claude Code:
processes started from the Claude desktop app inherit its MSIX package, so
their %APPDATA% writes are redirected to a private copy under
`%LOCALAPPDATA%\Packages\Claude_*\LocalCache`, splitting the library in two
(see the run-tourmaline skill).

Use a separate `CARGO_TARGET_DIR` for clippy/tests while `tauri dev` is running,
or they block on the same build lock. CI (`.github/workflows/ci.yml`, Windows)
runs typecheck, Vitest, build, cargo test and clippy with `-D warnings`.

`predev`/`prebuild` (`scripts/copy-runtime-assets.mjs`) copy pdf.js runtime
data (cmaps, standard fonts, ICC profiles, wasm decoders) into `public/pdfjs/`
and the MathJax fonts into `public/mathjax/` (both gitignored). If PDFs render
with missing glyphs or images, or formulas as boxes, check that this copy ran.
`npm run dev` also takes `?preamble=/test/fixtures/math/preamble.sty` to stand
in for a vault's math preamble. and `?bib=/test/fixtures/vault/database.bib`
for its bibliography.

## Architecture

**Command registry is the only way to add a user-facing action.**
`src/commands/registry.ts` holds `Command`s (id, title, shortcut, menu
placement, toolbar icon, `when(ctx)`, `run`). The native menu bar
(`src/platform/menu.ts`), toolbar, command palette, Help › Keyboard shortcuts
and the global keydown handler in `App.tsx` are all generated from it — never
wire a button or key handler directly. Mouse and keyboard parity is a core
product requirement. New context the `when` conditions need goes in
`CommandContext`; call `registry.notifyContextChanged()` when it changes.

- Shortcuts are written `"Mod+Shift+K"` and normalised in `shortcuts.ts`
  (`Mod` = Ctrl on Windows). Registering a duplicate id or shortcut throws.
- Only Ctrl/Alt/Meta shortcuts are registered as native menu accelerators
  (`src/platform/menu.ts`): a native accelerator takes the key before the page
  sees it, even when disabled, so plain keys (Escape, F3) are handled only by
  the page's keydown handler. Don't put tab-separated shortcut text in menu
  labels - it blanks the window on Windows. For modifier shortcuts both the
  menu and the page can fire; `execute()` drops a repeat of the same command
  from a different source within 150 ms.
- Global shortcuts are ignored while an `aria-modal` dialog is open, and in
  text fields for editing keys (Home/End/arrows...) and text-editing
  shortcuts (`isTextEditingShortcut`: Ctrl+Z/Y/A/C/X/V), which are also never
  native accelerators. So Undo is Ctrl+Z everywhere except inside a note field.
  When such a command can't run, the key keeps its usual meaning: Ctrl+C
  copies the selected annotation as Markdown, else the selected text.
- Plain-letter shortcuts (H, N, A, 1-9, Delete) are fine: they don't fire in
  text fields. Escape is one command (`edit.cancel`) that closes/cancels
  whatever is open; a shortcut can belong to only one command.
- The palette hides commands whose `when` is false.
- Exception: controls that act on one specific item (the close button on a
  given tab, an entry in a list) may call a handler directly, provided a
  command offers the same action by keyboard, menu and palette (Close tab,
  Open recent...).

**Frontend ↔ Rust.** `src/platform/index.ts` is the only module that calls
`invoke`; it falls back to web APIs outside Tauri so the UI runs in a browser
and in jsdom tests. Rust commands live in `src-tauri/src/lib.rs`; file I/O and
hashing run in `spawn_blocking`. PDF bytes return as a binary
`tauri::ipc::Response`, not JSON. Rust file commands only accept `.pdf` paths.

**Identity and storage.** A *work* (the paper, UUID) owns annotations and the
reading position; each exact version of its PDF is a *file* keyed by SHA-256,
hashed in Rust from the bytes `open_document` returns (one binary response:
u32 header length, JSON `DocumentInfo`, file bytes; `unpackDocument` in
`platform/index.ts`). Same bytes anywhere → same work (renames/moves); new
bytes at any path a known file was seen at (`file_paths`) → new version of
that work (`library.rs`), unless the start of its text differs from the
file it replaced (`src/annotations/version.ts`), in which case the user is
asked and `detach_file` gives it its own work. Annotations
(`annotations.rs`) have one placement per file; on a new version the frontend
re-anchors them (`src/annotations/anchor.ts`: page text hash → quote +
prefix/suffix → orphan) and saves the placements. Deletes are soft. Area
captures are PNGs in `<data>/attachments/<annotation id>.png`, sent as a raw
IPC body. SQLite lives in the app data dir (`library.sqlite3`), accessed
through `Db` in `db.rs` (queries in `library.rs` / `annotations.rs`).
Schema changes are appended to `MIGRATIONS` (applied by `PRAGMA user_version`);
never edit an existing migration. On startup, before migrating, a daily
snapshot goes to `backups/library-<date>.sqlite3` next to the database (14
kept). The app is single-instance (tauri-plugin-single-instance) so only one
process writes the library; it logs the database path at startup.

**Viewer.** Geometry lives in `src/pdf/layout.ts` (pure, unit-tested):
page tops/sizes, which pages are near the viewport (only those mount), the
current page, fit zoom, and `Anchor` = page + fraction, which keeps the
reader's place across zoom and relayout. `src/pdf/PdfViewer.tsx` renders
canvas + pdf.js text layer per mounted page (CSS px = PDF pt × 96/72 × zoom;
canvas × devicePixelRatio, capped) and exposes a `ViewerHandle` for
navigation. Text content is extracted once per page (`src/pdf/textCache.ts`)
and shared by the text layer and search (`search.ts`, `useSearch.ts`).
Annotations: `useAnnotations` (state, undo/redo per work; every change runs
through one queue so quick changes apply in order) feeds `Mark`s to
the viewer, drawn under the text layer; clicks hit-test marks in PDF space.
Text selections become highlights via `captureSelection` in
`src/annotations/selection.ts` (text layer span k = k-th text item, so DOM
points map exactly to offsets in `buildPageText`'s normalised text).
Popovers and the selection toolbar render through the viewer's per-page
`overlay`, so they scroll with the page.
pdf.js 6: `render({ canvas, viewport })`, documents are freed with
`pdf.loadingTask.destroy()`. Focus-mode line detection is
`src/focus/lines.ts`, checked against the fixtures in `test/fixtures/` by
`test/readingOrder.test.ts`.

**Notes and math.** Notes are markdown edited in CodeMirror 6
(`src/notes/NoteEditor.tsx`) with formulas previewed in place
(`mathPreview.ts`, a state field because display math replaces line breaks)
and shown rendered elsewhere by `NoteView` (markdown-it, `notes/markdown.ts`).
Math is a node of each markdown parser (`notes/mathSyntax.ts` for
CodeMirror's, an inline rule in `notes/markdown.ts` for markdown-it), so each
parser decides what is code, a link or a quote; both ask `mathAt` in
`src/math/delimiters.ts` for Obsidian's `$`/`$$` rules, and
`test/notes.test.ts` checks they agree case by case. Never find math with a
separate scan of the raw text. PDF text selections are only those inside a
`.textLayer` (a note editor on a popover is inside the viewer too). MathJax 4 is used directly (`src/math/engine.ts`, lazily
loaded; `@mathjax/src/js/...` imports, CHTML output), set up like the user's
Obsidian (`settings.ts`): the built-in MathJax 3 look (TeX font, its default
and autoloaded packages, never `html`/`require`) unless latest-mathjax is
enabled, plus the preamble. `src-tauri/src/vault.rs` reads those settings
from the vault chosen with File › Choose Obsidian vault (read-only, files
must be inside the vault); `useVaultMath` re-reads them when the window
regains focus. Macros can't be undefined, so a settings change rebuilds the
MathJax document. TeX packages and font ranges are loaded with
`import.meta.glob` from `/node_modules`, which is why MathJax is excluded
from Vite's dependency pre-bundling (a second copy would register the
packages where the TeX input can't see them). `\` autocomplete
(`math/completions.ts`) lists the preamble's macros (`preamble.ts`) with tab
stops, then MathJax's own names.

**Vault and bibliography.** `src/vault/`: `useVault` reads the Citations
plugin settings (`vault_settings` in `vault.rs`) and the JabRef `.bib`
(`read_bibliography`, re-read on focus when its mtime changes). `bibtex.ts`
is our own BibTeX reader (LaTeX → Unicode, names, JabRef's escaped `file`
field); `bibliography.ts` matches a PDF to an entry (file field, then citekey
prefix of the file name) and builds the Citations plugin's template
variables; `test/bibliography.test.ts` checks both against the user's real
bib and notes when the vault exists. A work's citekey is set with
`link_citekey` (`library.rs`), which may move a new, unannotated file into
the work that already has that citekey (then the text check runs, as for a
new version). `templates.ts` interprets Handlebars' parsed AST (no
`Handlebars.compile`: the CSP has no `unsafe-eval`); a multi-line value
written after `> ` gets the prefix on every line. `tourmaline://open?doc=<work
id>&hl=<block id>&page=<n>` links (`links.ts`) arrive through
tauri-plugin-deep-link (forwarded by single-instance when running; a debug
build registers the scheme for the current user at startup) and are resolved
by `locate_work`. The only external URLs the app opens are `obsidian://`
(opener scope in capabilities).

**Annotations in the PDF file.** `src/annotations/importPdf.ts` turns the
PDF's own annotations (pdf.js `getAnnotations`) into Tourmaline annotations;
`/NM` comes from Rust (`pdf_annotations.rs`, lopdf) because pdf.js doesn't
expose it. `usePdfImport` runs it once per file per session after the
annotations load (`import_annotations` skips keys the work already has,
deleted too; `imported_keys` also returns `nm:<id>` for every annotation so
write-back's own output isn't imported back) and returns the pdf.js ids to
hide: `hidePdfAnnotations` sets `noView`/`noPrint` in the document's
annotation storage and pages render with `AnnotationMode.ENABLE_STORAGE`
(captures too). Write-back is `writeback.rs` (lopdf `IncrementalDocument`;
the output must start with the original bytes) behind
`save_annotations_to_pdf`, which checks the file is still the open version,
backs it up, writes beside it and renames; `record_writeback` adds the new
version with copied placements and their `pdf_obj_ref`. Never test it on
the vault: use copies in `.dev-data/`.

**Security.** CSP is set in `src-tauri/tauri.conf.json` (includes
`'wasm-unsafe-eval'` for pdf.js decoders); window permissions are in
`src-tauri/capabilities/default.json` — add a permission there when using a new
Tauri API from the frontend.

## Rules for the Obsidian integration (phase 4+)

- Only rewrite the managed region between `%% tourmaline:begin %%` and
  `%% tourmaline:end %%` in a note; never rewrite frontmatter of an existing note.
- PDFs are not modified unless the user enables write-back; then append an
  incremental update and back up first.
- Never write the JabRef-managed `database.bib`.
- Templates use Handlebars with the Obsidian Citations plugin's field names.

## The user's vault (for testing against real data)

`C:\Users\amcle\Documents\Academia`: PDFs in `Library/` (named by JabRef
citekey, e.g. `Goodman2023GG - Grounding Generalizations.pdf`; some `.djvu`,
`.epub`, `.pdf.part` junk), literature notes `Obsidian/Library/@{{citekey}}.md`,
bibliography `Library/database.bib`, MathJax macros in `preamble.sty`, plugin
settings under `.obsidian/plugins/` (obsidian-citation-plugin, latest-mathjax,
obsidian-latex-suite). `BaconDorrC.pdf` contains existing Okular highlights.
Treat the vault as read-only unless the user asks otherwise.
