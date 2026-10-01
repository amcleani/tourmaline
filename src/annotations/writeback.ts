// What File › Save annotations into PDF writes: one PDF annotation per page
// an annotation covers (a highlight running onto the next page becomes two).
// An imported annotation keeps its own /NM, so the file's original is
// updated; Tourmaline's are named by their id. See src-tauri/src/writeback.rs.

import { colourOf, type Annotation, type Category } from "./types";

export interface WriteAnnotation {
  id: string;
  name: string;
  pdfRef: string | null;
  kind: "highlight" | "area" | "note";
  page: number;
  rects: [number, number, number, number][];
  colour: string;
  note: string;
  created: number;
  updated: number;
}

/** Annotations placed on this file, as write-back takes them. Orphans and ink are left out. */
export function annotationsToWrite(annotations: readonly Annotation[], categories: readonly Category[]): WriteAnnotation[] {
  const list: WriteAnnotation[] = [];
  for (const a of annotations) {
    const p = a.placement;
    if (!p || p.status === "orphan" || a.kind === "ink") continue;
    const name = a.sourceNm?.startsWith("nm:") ? a.sourceNm.slice(3) : a.id;
    const pages = [...new Set(p.geometry.rects.map((r) => r[0]))].sort((x, y) => x - y);
    for (const page of pages) {
      const first = page === p.page;
      list.push({
        // Continuations on later pages are written under their own names.
        id: first ? a.id : `${a.id}#${page}`,
        name: first ? name : `${name}#${page}`,
        pdfRef: first ? (p.pdfRef ?? null) : null,
        kind: a.kind,
        page,
        rects: p.geometry.rects.filter((r) => r[0] === page).map(([, ...r]) => r as [number, number, number, number]),
        colour: colourOf(a, categories),
        note: a.note,
        created: a.created,
        updated: a.updated,
      });
    }
  }
  return list;
}
