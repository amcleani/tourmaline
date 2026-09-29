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
npm run tauri dev                      # desktop app with hot reload (needs cargo on PATH)
npm run dev                            # UI only in a browser at :1420 (browser file picker, no library/DB)
npm test                               # all Vitest tests
npx vitest run test/registry.test.ts   # one file;  add  -t "name"  for one test
npm run typecheck
npm run build                          # also required before any cargo command: the crate embeds dist/
cd src-tauri && ~/.cargo/bin/cargo test [name]
cd src-tauri && CARGO_TARGET_DIR=target/clippy ~/.cargo/bin/cargo clippy --all-targets -- -D warnings
```

Use a separate `CARGO_TARGET_DIR` for clippy/tests while `tauri dev` is running,
or they block on the same build lock. CI (`.github/workflows/ci.yml`, Windows)
runs typecheck, Vitest, build, cargo test and clippy with `-D warnings`.

`predev`/`prebuild` copy pdf.js runtime data (cmaps, standard fonts, ICC
profiles, wasm decoders) into `public/pdfjs/` (gitignored); `src/pdf/loader.ts`
points pdf.js at it. If PDFs render with missing glyphs or images, check that
this copy ran.

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
- On Windows the native menu accelerator and the webview keydown can both fire
  for one key press; `execute()` drops a repeat of the same command from a
  different source within 150 ms. Keep that in mind when testing shortcuts.
- The palette hides commands whose `when` is false.

**Frontend ↔ Rust.** `src/platform/index.ts` is the only module that calls
`invoke`; it falls back to web APIs outside Tauri so the UI runs in a browser
and in jsdom tests. Rust commands live in `src-tauri/src/lib.rs`; file I/O and
hashing run in `spawn_blocking`. PDF bytes return as a binary
`tauri::ipc::Response`, not JSON. Rust file commands only accept `.pdf` paths.

**Identity and storage.** A document's id is the SHA-256 of its contents, so
annotations survive renames/moves (`src-tauri/src/documents.rs`). SQLite lives
in the app data dir (`library.sqlite3`), accessed through `Db` in `db.rs`.
Schema changes are appended to `MIGRATIONS` (applied by `PRAGMA user_version`);
never edit an existing migration.

**Viewer.** `src/pdf/PdfViewer.tsx` renders pages lazily with an
IntersectionObserver; sizes use CSS px = PDF pt × 96/72 × zoom, canvases are
scaled by devicePixelRatio. pdf.js 6: `render({ canvas, viewport })`, and
documents are freed with `pdf.loadingTask.destroy()`.

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
