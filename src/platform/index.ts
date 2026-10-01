// Bridge between the UI and the Rust side. When the UI runs in a plain browser
// (vite dev server, tests) it falls back to web APIs and an in-memory library
// so it stays usable.

import type {
  Annotation,
  AnnotationEdit,
  Category,
  ImportResult,
  NewAnnotation,
  PageHash,
  PlacementUpdate,
} from "../annotations/types";
import type { VaultMathSettings } from "../math/settings";
import type { VaultSettings } from "../vault/notes";
import type { WriteAnnotation } from "../annotations/writeback";
import { sha256Hex } from "../util/hash";
import { MemoryLibrary } from "./memoryLibrary";

export { sha256Hex };

export interface DocumentInfo {
  /** SHA-256 of this exact version of the file. */
  fileId: string;
  /** The paper: owns annotations and the reading position across renames and new versions. */
  workId: string;
  path: string | null;
  name: string;
  size: number;
  /** Unix milliseconds. */
  lastOpened: number;
  /** Reading position JSON saved by savePosition, if any. */
  lastPosition?: string | null;
  /**
   * Set when this file replaced another at the same path and hasn't been
   * checked yet: compare the text, then setTextSample (same paper) or
   * detachFile (a different paper).
   */
  previousVersion?: { fileId: string; textSample: string | null } | null;
  /** The paper's bibliography entry, if linked. */
  citekey?: string | null;
  /** An entry this paper must not be matched to again (the user said it's a different paper). */
  citekeyDeclined?: string | null;
}

export interface OpenedDocument {
  info: DocumentInfo;
  bytes: Uint8Array;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args, headers ? { headers } : undefined);
}

let memory: MemoryLibrary | null = null;
/** The browser stand-in for the library (exported for tests). */
export function memoryLibrary(): MemoryLibrary {
  return (memory ??= new MemoryLibrary());
}

/** Splits `open_document`'s response: u32 header length, JSON header, file bytes. */
export function unpackDocument(buffer: ArrayBuffer): OpenedDocument {
  const view = new DataView(buffer);
  const headerLength = view.getUint32(0, true);
  const header = new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength));
  return { info: JSON.parse(header) as DocumentInfo, bytes: new Uint8Array(buffer, 4 + headerLength) };
}

export async function openPdfAtPath(path: string): Promise<OpenedDocument> {
  return unpackDocument(await invoke<ArrayBuffer>("open_document", { path }));
}

/** Shows a file picker. Resolves to null if the user cancels. */
export async function pickAndOpenPdf(): Promise<OpenedDocument | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "PDF documents", extensions: ["pdf"] }],
    });
    return path ? openPdfAtPath(path) : null;
  }
  return pickInBrowser();
}

export async function recentDocuments(limit = 10): Promise<DocumentInfo[]> {
  if (!isTauri()) return [];
  return invoke<DocumentInfo[]>("recent_documents", { limit });
}

/** Records the start of a file's text; also marks a new version as checked. */
export async function setTextSample(fileId: string, sample: string): Promise<void> {
  if (isTauri()) await invoke("set_text_sample", { fileId, sample });
}

/** Gives a file that turned out to be a different paper its own work. */
export async function detachFile(fileId: string, sample: string): Promise<DocumentInfo> {
  if (!isTauri()) throw new Error("not available in the browser");
  return invoke<DocumentInfo>("detach_file", { fileId, sample });
}

export async function savePosition(workId: string, position: string): Promise<void> {
  if (isTauri()) await invoke("save_position", { workId, position });
}

// ---- Annotations -------------------------------------------------------------

export async function listAnnotations(workId: string, fileId: string): Promise<Annotation[]> {
  if (!isTauri()) return memoryLibrary().list(workId, fileId);
  return invoke<Annotation[]>("list_annotations", { workId, fileId });
}

export async function createAnnotation(annotation: NewAnnotation): Promise<Annotation> {
  if (!isTauri()) return memoryLibrary().create(annotation);
  return invoke<Annotation>("create_annotation", { annotation: annotation as unknown as Record<string, unknown> });
}

/** Imports annotations found in a PDF; each only once per paper (even after it's deleted). */
export async function importAnnotations(annotations: NewAnnotation[]): Promise<ImportResult> {
  if (!isTauri()) return memoryLibrary().import(annotations);
  return invoke<ImportResult>("import_annotations", { annotations: annotations as unknown as Record<string, unknown>[] });
}

/**
 * Writes annotations into the PDF on disk (backed up first, appended as an
 * incremental update). Resolves to the file's new version, or null if the
 * file already had everything (nothing was written).
 */
export async function saveAnnotationsToPdf(
  path: string,
  fileId: string,
  workId: string,
  annotations: WriteAnnotation[],
): Promise<DocumentInfo | null> {
  if (!isTauri()) throw new Error("saving into the PDF needs the desktop app");
  return invoke<DocumentInfo | null>("save_annotations_to_pdf", {
    path,
    fileId,
    workId,
    annotations: annotations as unknown as Record<string, unknown>[],
  });
}

/**
 * Corrects the notes of imported annotations the user hasn't changed, which
 * then still count as unchanged. Resolves to the ids corrected.
 */
export async function repairImportedNotes(repairs: { id: string; note: string }[]): Promise<string[]> {
  if (repairs.length === 0) return [];
  if (!isTauri()) return memoryLibrary().repairImportedNotes(repairs);
  return invoke<string[]>("repair_imported_notes", { repairs });
}

/** Keys of the annotations already imported into a paper (deleted ones too). */
export async function importedKeys(workId: string): Promise<string[]> {
  if (!isTauri()) return memoryLibrary().importedKeys(workId);
  return invoke<string[]>("imported_keys", { workId });
}

/** pdf.js id → /NM name of the annotations in a PDF (pdf.js doesn't read /NM). Empty in a browser. */
export async function pdfAnnotationNames(path: string | null, fileId: string): Promise<Map<string, string>> {
  if (!isTauri() || !path) return new Map();
  const names = await invoke<{ page: number; id: string; name: string }[]>("pdf_annotation_names", { path, fileId });
  return new Map(names.map((n) => [n.id, n.name]));
}

export async function updateAnnotation(id: string, fileId: string, edit: AnnotationEdit): Promise<Annotation> {
  if (!isTauri()) return memoryLibrary().update(id, fileId, edit);
  return invoke<Annotation>("update_annotation", { id, fileId, edit: edit as unknown as Record<string, unknown> });
}

export async function deleteAnnotation(id: string): Promise<void> {
  if (!isTauri()) return memoryLibrary().delete(id);
  return invoke("delete_annotation", { id });
}

export async function restoreAnnotation(id: string, fileId: string): Promise<Annotation> {
  if (!isTauri()) return memoryLibrary().restore(id, fileId);
  return invoke<Annotation>("restore_annotation", { id, fileId });
}

export async function savePlacements(fileId: string, updates: PlacementUpdate[], pageHashes: PageHash[]): Promise<void> {
  if (!isTauri()) return memoryLibrary().savePlacements(fileId, updates, pageHashes);
  return invoke("save_placements", { fileId, updates, pageHashes });
}

export async function listCategories(): Promise<Category[]> {
  if (!isTauri()) return memoryLibrary().listCategories();
  return invoke<Category[]>("list_categories");
}

export async function saveCategories(categories: Category[]): Promise<Category[]> {
  if (!isTauri()) return memoryLibrary().saveCategories(categories);
  return invoke<Category[]>("save_categories", { categories });
}

/** Stores the PNG of an area annotation; resolves to its path relative to the data folder. */
export async function saveAttachment(annotationId: string, png: Uint8Array): Promise<string> {
  if (!isTauri()) return memoryLibrary().saveAttachment(annotationId, png);
  return invoke<string>("save_attachment", png, { "annotation-id": annotationId });
}

export async function readAttachment(annotationId: string): Promise<Uint8Array> {
  if (!isTauri()) {
    const png = memoryLibrary().attachments.get(annotationId);
    if (!png) throw new Error("no attachment");
    return png;
  }
  return new Uint8Array(await invoke<ArrayBuffer>("read_attachment", { id: annotationId }));
}

// ---- Obsidian vault (read only) ---------------------------------------------

/** The vault chosen with File › Choose Obsidian vault, if any. */
export async function savedVault(): Promise<string | null> {
  // Browser only: `?preamble=/test/fixtures/math/preamble.sty` stands in for a vault.
  if (!isTauri()) return new URLSearchParams(window.location.search).get("preamble");
  return getState("vault");
}

/** Asks for a folder, checks it is an Obsidian vault and remembers it. Null if cancelled. */
export async function chooseVault(): Promise<string | null> {
  if (!isTauri()) throw new Error("choosing a vault needs the desktop app");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ directory: true, multiple: false, title: "Choose your Obsidian vault" });
  if (!path) return null;
  await invoke("check_vault", { path });
  await setState("vault", path);
  return path;
}

/** How the vault renders math (its MathJax plugins' settings and preamble). */
export async function readMathSettings(vault: string): Promise<VaultMathSettings> {
  if (isTauri()) return invoke<VaultMathSettings>("math_settings", { vault });
  const response = await fetch(vault);
  if (!response.ok) throw new Error(`${vault}: ${response.status}`);
  return { latestMathjax: null, preamble: await response.text(), sources: [] };
}

/** Where the vault keeps literature notes and the bibliography (Citations plugin settings). */
export async function readVaultSettings(vault: string): Promise<VaultSettings | null> {
  if (!isTauri()) return null;
  return invoke<VaultSettings>("vault_settings", { vault });
}

/** Whether a file exists at a path relative to the vault. */
export async function vaultFileExists(vault: string, path: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("vault_file_exists", { vault, path });
}

export interface VaultNote {
  text: string;
  /** SHA-256 of the file's bytes, passed back to writeNote. */
  sha256: string;
}

/** A note in the vault (path relative to it); null if there is none. */
export async function readNote(vault: string, path: string): Promise<VaultNote | null> {
  if (!isTauri()) throw new Error("exporting to the vault needs the desktop app");
  return invoke<VaultNote | null>("read_note", { vault, path });
}

/**
 * Writes a note in the vault, refused if it changed since it was read
 * (`expected`: readNote's sha256, or null for a note that didn't exist).
 */
export async function writeNote(vault: string, path: string, text: string, expected: string | null): Promise<void> {
  if (!isTauri()) throw new Error("exporting to the vault needs the desktop app");
  return invoke("write_note", { vault, path, text, expected });
}

/** Copies an area annotation's image into a vault folder ("" = its root); resolves to its path in the vault. */
export async function exportImage(vault: string, annotationId: string, folder: string, name: string): Promise<string> {
  if (!isTauri()) throw new Error("exporting to the vault needs the desktop app");
  return invoke<string>("export_image", { vault, id: annotationId, folder, name });
}

/** Notes in the vault, other than `except`, that link to any of these blocks. */
export async function findBlockLinks(
  vault: string,
  blockIds: string[],
  except: string,
): Promise<{ path: string; blockId: string }[]> {
  if (!isTauri() || blockIds.length === 0) return [];
  return invoke("find_block_links", { vault, blockIds, except });
}

/** The JabRef bibliography's text. Only ever read. */
export async function readBibliography(path: string): Promise<{ text: string; modified: number }> {
  if (!isTauri()) {
    // Browser only: `?bib=/test/…` serves a .bib from the dev server.
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return { text: await response.text(), modified: 0 };
  }
  return invoke("read_bibliography", { path });
}

export async function bibliographyModified(path: string): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>("bibliography_modified", { path });
}

/**
 * Links a file's paper to a bibliography entry. If another paper in the
 * library has that entry and this one has no annotations, the file joins it
 * as a new version (then `previousVersion` is set, as for a new version at a
 * known path).
 */
export async function linkCitekey(fileId: string, citekey: string): Promise<DocumentInfo> {
  if (!isTauri()) throw new Error("linking to the bibliography needs the desktop app");
  return invoke<DocumentInfo>("link_citekey", { fileId, citekey });
}

/** For a tourmaline:// link: the paper's newest file that still exists. */
export async function locateWork(workId: string | null, blockId: string | null): Promise<DocumentInfo | null> {
  if (!isTauri()) return null;
  return invoke<DocumentInfo | null>("locate_work", { workId, blockId });
}

/** Calls `handler` with each tourmaline:// link the app is opened with, now and later. */
export async function onReaderLinks(handler: (url: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
  const unlisten = await onOpenUrl((urls) => urls.forEach(handler));
  // The link the app was started with, if any.
  (await getCurrent().catch(() => null))?.forEach(handler);
  return unlisten;
}

/**
 * PDFs handed to the app by Windows ("Open with Tourmaline"): those it was
 * started with, then any opened while it runs.
 */
export async function onOpenFiles(handler: (paths: string[]) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<string[]>("open-files", (e) => handler(e.payload));
  const atStart = await invoke<string[]>("take_launch_files");
  if (atStart.length > 0) handler(atStart);
  return unlisten;
}

export async function copyText(text: string): Promise<void> {
  if (isTauri()) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    return writeText(text);
  }
  return navigator.clipboard.writeText(text);
}

/** Opens a web or mail link from a PDF in the default browser or mail program. */
export async function openExternal(url: string): Promise<void> {
  if (!/^(https?:|mailto:)/i.test(url)) throw new Error(`Tourmaline doesn't open ${url.split(":")[0]} links`);
  if (!isTauri()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  return openUrl(url);
}

/** Opens an obsidian:// link. */
export async function openInObsidian(url: string): Promise<void> {
  if (!url.startsWith("obsidian://")) throw new Error("not an Obsidian link");
  if (!isTauri()) {
    window.open(url);
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  return openUrl(url);
}

// ---- App state and window ----------------------------------------------------

/** Small persistent app state (open tabs, layout). Falls back to localStorage in a browser. */
export async function getState(key: string): Promise<string | null> {
  if (isTauri()) return invoke<string | null>("get_state", { key });
  try {
    return localStorage.getItem(`tourmaline:${key}`);
  } catch {
    return null;
  }
}

export async function setState(key: string, value: string): Promise<void> {
  if (isTauri()) return invoke("set_state", { key, value });
  try {
    localStorage.setItem(`tourmaline:${key}`, value);
  } catch {
    // Storage unavailable (private mode); state just isn't remembered.
  }
}

/**
 * Runs `handler` (awaited) before the window closes. Returns an unsubscribe
 * function. Outside Tauri this is best effort (pagehide).
 */
export async function onWindowClose(handler: () => Promise<void>): Promise<() => void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().onCloseRequested(async () => {
      await handler();
    });
  }
  const listener = () => void handler();
  window.addEventListener("pagehide", listener);
  return () => window.removeEventListener("pagehide", listener);
}

/**
 * Sets the size of the window's contents (View › Appearance): the webview's
 * zoom, which also raises the pixel density pages are drawn at, so they stay sharp.
 */
export async function setUiScale(scale: number): Promise<void> {
  if (isTauri()) {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(scale);
  } else {
    document.documentElement.style.zoom = scale === 1 ? "" : String(scale);
  }
}

export interface AvailableUpdate {
  version: string;
  /** The release notes, if any. */
  notes: string | null;
  /** Downloads and installs it, then starts the new version. `progress` gets 0-1 while downloading (when the size is known). */
  install(progress?: (fraction: number) => void): Promise<void>;
}

/** A newer signed release, if there is one (the endpoint is plugins.updater in tauri.conf.json). */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body?.trim() || null,
    async install(progress) {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        else if (event.event === "Progress" && total > 0) progress?.(Math.min(1, (done += event.data.chunkLength) / total));
      });
      // On Windows the installer has taken over by now; elsewhere, restart into the new version.
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}

/** Tourmaline's version ("0.1.0"). */
export async function appVersion(): Promise<string> {
  if (!isTauri()) return "development";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

export async function quitApp(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } else {
    window.close();
  }
}

/**
 * Browser only (`npm run dev`): opens a PDF served by the dev server, so the
 * UI can be tried without the file picker: `?pdf=/test/fixtures/two-column.pdf`.
 */
export async function openPdfFromUrl(url: string): Promise<OpenedDocument> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const id = await sha256Hex(bytes);
  const name = decodeURIComponent(url.split("/").pop() || "document.pdf");
  return { info: { fileId: id, workId: id, path: null, name, size: bytes.length, lastOpened: Date.now() }, bytes };
}

function pickInBrowser(): Promise<OpenedDocument | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.addEventListener("cancel", () => resolve(null));
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const id = await sha256Hex(bytes);
        resolve({
          info: { fileId: id, workId: id, path: null, name: file.name, size: file.size, lastOpened: Date.now() },
          bytes,
        });
      } catch (err) {
        reject(err);
      }
    });
    input.click();
  });
}

