# Tourmaline

A PDF reader for academic research that exports annotations to Obsidian.
See [PLAN.md](PLAN.md) for the design and roadmap.

## Development

Requirements: Node 24+, Rust (stable, MSVC toolchain on Windows), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
npm install
npm run tauri dev      # run the desktop app with hot reload
npm run dev            # UI only, in a browser (uses browser file picker, no library)
npm test               # frontend tests
npm run typecheck
cd src-tauri && cargo test
```

`npm run tauri build` produces an installer in `src-tauri/target/release/bundle/`.

## Layout

```
src/
  commands/   command registry, shortcuts, palette matching, app commands
  pdf/        pdf.js loading and the page viewer
  platform/   bridge to Rust (files, library) and the native menu
  ui/         toolbar, command palette, dialogs, welcome screen
src-tauri/
  src/db.rs         SQLite library (versioned migrations)
  src/documents.rs  fingerprinting and reading PDFs
test/         Vitest tests
```

Every user-facing action is registered once in the command registry
(`src/commands/`); the menu bar, toolbar, palette and keyboard shortcuts are
generated from it. New features should add commands rather than wiring
buttons or key handlers directly.
