---
name: run-tourmaline
description: Launch the Tourmaline desktop app (Tauri dev build) on Windows and drive it with computer-use to verify a change - open a PDF, use menus, palette and shortcuts, screenshot the result.
---

# Run and drive Tourmaline

Verified on the user's Windows 11 machine (two monitors).

## Launch

Run in the background (Bash tool, `run_in_background: true`) from the repo root:

```bash
TOURMALINE_DATA_DIR="$PWD/.dev-data" PATH="$HOME/.cargo/bin:$PATH" npx tauri dev > /tmp/tauri-dev.log 2>&1
```

Always set `TOURMALINE_DATA_DIR`. Processes started from Claude Code inherit
the Claude desktop app's MSIX package context, so their writes to %APPDATA% are
silently redirected to
`%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\...`, while
copies of the app started any other way use the real folder: two different
libraries. `.dev-data/` (gitignored) sidesteps that and keeps test data out of
the user's real library. Wait for startup with
`until grep -q "library database" /tmp/tauri-dev.log; do sleep 2; done` - the
log line shows which database is in use.

- First build after a Cargo change takes 1-3 min; afterwards ~1 s. The log line
  `Running target\debug\tourmaline.exe` means the window is up.
- Frontend edits hot-reload; Rust edits trigger a rebuild and restart.
- Only one instance: if the task ends with exit 0 and no error, the window was
  closed (often by the user) - relaunch.
- A Rust compile error mid-edit makes the task exit 101 but the `tauri dev`
  watcher can stay alive and relaunch the app once the code compiles again, so
  a "failed" task may still own a running window. Before relaunching, list
  processes with PowerShell
  `Get-CimInstance Win32_Process -Filter "Name='node.exe' or Name='tourmaline.exe'"`
  and stop the old `tauri.js dev` / `vite.js` / `tourmaline.exe` ones.
- Running `cargo test`/`clippy` meanwhile: use `CARGO_TARGET_DIR=target/clippy`
  or it waits on the dev build lock.
- UI-only checks without Rust: `npm run dev` and the Browser pane at
  http://localhost:1420 (no native menu, no library DB, browser file picker).

## Drive (computer-use)

1. `request_access` with `["tourmaline.exe"]` (the dev exe; resolves to
   `src-tauri\target\debug\tourmaline.exe`). Do NOT request "Tourmaline PDF" -
   that is an unrelated app installed on this machine.
2. `open_application` "Tourmaline" to bring the window forward. CAUTION: if
   it can't match the running window it launches a *second* copy of the exe
   (outside `tauri dev`, so no hot reload). After using it, check with
   `tasklist //FI "IMAGENAME eq tourmaline.exe"`; a copy whose command line is
   the full path (not `target\debug	ourmaline.exe` under cargo) is the stray
   one - `taskkill //PID <pid> //F`. The user's Terminal often takes focus; if a
   click fails with "not in the allowed applications", bring the window
   forward again, then retry.
3. If the window isn't visible, it may be on the other monitor
   (`switch_display`), then `switch_display auto`.
4. Use `screenshot` with `scale: 0.6` - enough to read the UI.

Useful interactions:

- **Open a PDF**: Ctrl+O (or File > Open, or Ctrl+K, type `open`, Return).
  In the Windows Open dialog, click the File name box and `type` a full path,
  then Return. Test papers from the user's vault (read-only):
  - `C:\Users\amcle\Documents\Academia\Library\Goodman2023GG - Grounding Generalizations.pdf` (38 pages, one column)
  - `C:\Users\amcle\Documents\Academia\Library\BaconDorrC.pdf` (84 pages, has Okular highlights)
- **Key names**: `ctrl+=` for zoom in (not `ctrl+equal`), `ctrl+-`, `ctrl+0`,
  `ctrl+k`, `ctrl+w`, `ctrl+/`.
- Status (file name, page count, zoom %) is at the right end of the toolbar;
  `zoom` into that region to read it.
- Menus: File / View / Help in the title-bar menu row; shortcuts are listed
  next to items and disabled items are greyed out.

Always look at the screenshot: a blank grey viewer means pdf.js failed - check
the devtools console (Ctrl+Shift+I in the dev build) and that
`public/pdfjs/` exists.
