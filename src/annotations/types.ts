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

export function colourOf(a: Pick<Annotation, "colour" | "categoryId">, categories: readonly Category[]): string {
  return a.colour ?? categories.find((c) => c.id === a.categoryId)?.colour ?? FALLBACK_COLOUR;
}
