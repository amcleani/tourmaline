// Bridge between the UI and the Rust side. When the UI runs in a plain browser
// (vite dev server, tests) it falls back to web APIs so it stays usable.

export interface DocumentInfo {
  /** SHA-256 of the file contents; stable across renames and moves. */
  id: string;
  path: string | null;
  name: string;
  size: number;
  /** Unix milliseconds. */
  lastOpened: number;
}

export interface OpenedDocument {
  info: DocumentInfo;
  bytes: Uint8Array;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function openPdfAtPath(path: string): Promise<OpenedDocument> {
  const bytes = new Uint8Array(await invoke<ArrayBuffer>("read_document", { path }));
  // Fingerprint the bytes actually shown, so the id always matches them.
  const id = await sha256Hex(bytes);
  const info = await invoke<DocumentInfo>("record_open", { path, id, size: bytes.byteLength });
  return { info, bytes };
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

export async function quitApp(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } else {
    window.close();
  }
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
        resolve({
          info: {
            id: await sha256Hex(bytes),
            path: null,
            name: file.name,
            size: file.size,
            lastOpened: Date.now(),
          },
          bytes,
        });
      } catch (err) {
        reject(err);
      }
    });
    input.click();
  });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
