// Annotation data as stored by the Rust side (src-tauri/src/annotations.rs).

/** [page, x0, y0, x1, y1]: a rectangle in PDF user space on a 0-based page. */
export type PageRect = [number, number, number, number, number];

export interface Geometry {
  rects: PageRect[];
}

export type PlacementStatus = "exact" | "moved" | "fuzzy" | "orphan";

export interface Placement {
  /** 0-based page the annotation starts on. */
  page: number;
  geometry: Geometry;
  /** Character range in the start page's normalised text (search.ts). */
  textStart: number | null;
  textEnd: number | null;
  status: PlacementStatus;
  /** The PDF object it is in this file ("412R"): an imported original, or written back. */
  pdfRef?: string | null;
}

export interface Fallback {
  fileId: string;
  placement: Placement;
  pageHash: string | null;
}

export type AnnotationKind = "highlight" | "area" | "note" | "ink";

export interface Annotation {
  id: string;
  workId: string;
  kind: AnnotationKind;
  categoryId: string | null;
  /** Overrides the category colour. */
  colour: string | null;
  /** Markdown, may contain $math$. */
  note: string;
  quote: string | null;
  prefix: string | null;
  suffix: string | null;
  /** Relative to the data folder, for area captures. */
  imagePath: string | null;
  blockId: string;
  source: "tourmaline" | "imported";
  /** Imported: "nm:<the PDF's /NM>", or "pos:…" when it had none. */
  sourceNm?: string | null;
  created: number;
  updated: number;
  placement: Placement | null;
  fallback: Fallback | null;
}

export interface PageHash {
  page: number;
  hash: string;
}

export interface NewAnnotation {
  workId: string;
  fileId: string;
  kind: AnnotationKind;
  categoryId: string | null;
  colour: string | null;
  note: string;
  quote: string | null;
  prefix: string | null;
  suffix: string | null;
  placement: Placement;
  pageHashes: PageHash[];
  /** Imported from the PDF: its /NM (or position) key. */
  sourceNm?: string | null;
  /** Unix ms; defaults to now. */
  created?: number | null;
}

/** What importing a PDF's annotations did (see import_annotations in Rust). */
export interface ImportResult {
  created: Annotation[];
  /** Keys imported before, maybe since deleted. */
  existing: string[];
}

export interface AnnotationEdit {
  categoryId: string | null;
  colour: string | null;
  note: string;
}

export interface PlacementUpdate {
  annotationId: string;
  placement: Placement;
}

export interface Category {
  id: string;
  name: string;
  /** #rrggbb */
  colour: string;
  /** Obsidian callout type used on export. */
  callout: string;
  /** Digit key 1-9, or null. */
  hotkey: number | null;
  deleted: boolean;
}

export const CALLOUT_TYPES = [
  "quote",
  "note",
  "abstract",
  "info",
  "todo",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "important",
] as const;

export const FALLBACK_COLOUR = "#9e9e9e";

/**
 * Reading order: by page; on a page, highlights by their position in the
 * text (which follows columns), otherwise top to bottom. Orphans go last.
 */
export function byPosition(a: Annotation, b: Annotation): number {
  const pa = a.placement?.status === "orphan" ? null : a.placement;
  const pb = b.placement?.status === "orphan" ? null : b.placement;
  if (!pa || !pb) return Number(!pa) - Number(!pb) || a.created - b.created;
  if (pa.page !== pb.page) return pa.page - pb.page;
  if (pa.textStart !== null && pb.textStart !== null) return pa.textStart - pb.textStart;
  const top = (p: Placement) => Math.max(...p.geometry.rects.filter((r) => r[0] === p.page).map((r) => r[4]), -Infinity);
  return top(pb) - top(pa) || a.created - b.created;
}

export function colourOf(a: Pick<Annotation, "colour" | "categoryId">, categories: readonly Category[]): string {
  return a.colour ?? categories.find((c) => c.id === a.categoryId)?.colour ?? FALLBACK_COLOUR;
}
