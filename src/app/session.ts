import type { Anchor, ZoomMode } from "../pdf/layout";
import type { ZoomSpec } from "../pdf/PdfViewer";

// Serialisation of per-document reading positions and of the open-tab session.
// Stored as JSON (documents.last_position and app_state "session"); parsing is
// defensive because the data outlives app versions.

export interface SavedPosition {
  anchor: Anchor;
  zoom: ZoomSpec;
}

const ZOOM_MODES: ZoomMode[] = ["custom", "fit-width", "fit-page"];
export const DEFAULT_ZOOM: ZoomSpec = { mode: "fit-width", zoom: 1 };

export function encodePosition(p: SavedPosition): string {
  return JSON.stringify({ v: 1, page: p.anchor.page, fraction: round(p.anchor.fraction), mode: p.zoom.mode, zoom: round(p.zoom.zoom) });
}

export function decodePosition(json: string | null | undefined): SavedPosition | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    if (o?.v !== 1 || !Number.isInteger(o.page) || o.page < 0 || typeof o.fraction !== "number") return null;
    const mode: ZoomMode = ZOOM_MODES.includes(o.mode) ? o.mode : DEFAULT_ZOOM.mode;
    const zoom = typeof o.zoom === "number" && o.zoom > 0 ? o.zoom : 1;
    return { anchor: { page: o.page, fraction: clamp01(o.fraction) }, zoom: { mode, zoom } };
  } catch {
    return null;
  }
}

export interface SessionTab {
  path: string;
  name: string;
}

export interface Session {
  tabs: SessionTab[];
  active: number;
  outlineOpen: boolean;
}

export function encodeSession(s: Session): string {
  return JSON.stringify({ v: 1, ...s });
}

export function decodeSession(json: string | null | undefined): Session | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    if (o?.v !== 1 || !Array.isArray(o.tabs)) return null;
    const tabs: SessionTab[] = o.tabs
      .filter((t: unknown): t is SessionTab => typeof (t as SessionTab)?.path === "string" && typeof (t as SessionTab)?.name === "string")
      .map((t: SessionTab) => ({ path: t.path, name: t.name }));
    const active = Number.isInteger(o.active) ? Math.min(Math.max(o.active, 0), Math.max(tabs.length - 1, 0)) : 0;
    return { tabs, active, outlineOpen: o.outlineOpen === true };
  } catch {
    return null;
  }
}

const round = (n: number) => Math.round(n * 10000) / 10000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
