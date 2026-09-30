// Bridge between the UI and the Rust side. When the UI runs in a plain browser
// (vite dev server, tests) it falls back to web APIs and an in-memory library
// so it stays usable.

import type {
  Annotation,
  AnnotationEdit,
  Category,
  NewAnnotation,
  PageHash,
  PlacementUpdate,
} from "../annotations/types";
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

