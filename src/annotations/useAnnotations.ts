import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
  restoreAnnotation,
  saveAttachment,
  savePlacements,
  updateAnnotation,
} from "../platform";
import type { PdfRect } from "../pdf/search";
import { getPageHash, getPageText } from "../pdf/textCache";
import { reanchor } from "./anchor";
import { renderRegion } from "./capture";
import { textAnchor, type CapturedSelection } from "./selection";
import { byPosition, type Annotation, type AnnotationEdit, type PageHash, type PlacementUpdate } from "./types";

export interface OpenDoc {
  workId: string;
  fileId: string;
  pdf: PDFDocumentProxy;
}

/** A change that can be undone and redone. */
type Op =
  | { kind: "create"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "edit"; id: string; before: AnnotationEdit; after: AnnotationEdit };

const UNDO_LIMIT = 100;

const editOf = (a: Annotation): AnnotationEdit => ({ categoryId: a.categoryId, colour: a.colour, note: a.note });

async function hashesFor(pdf: PDFDocumentProxy, pages: Iterable<number>): Promise<PageHash[]> {
  return Promise.all([...new Set(pages)].map(async (page) => ({ page, hash: await getPageHash(pdf, page) })));
}

/**
 * The annotations of the open document's work, placed on the open file.
 * Annotations made on another version of the file are re-anchored when first
 * shown on this one.
 */
export function useAnnotations(doc: OpenDoc | null, onError: (what: string, err: unknown) => void) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [reanchoring, setReanchoring] = useState(false);
  const docRef = useRef(doc);
  docRef.current = doc;
  const report = useRef(onError);
  report.current = onError;

  // Undo history per work, so switching tabs keeps each paper's history.
  const history = useRef(new Map<string, { undo: Op[]; redo: Op[] }>());
  const [historyVersion, setHistoryVersion] = useState(0);
  /** Ids deleted in this session, so late saves (a closing popover) don't revive them. */
  const deleted = useRef(new Set<string>());
  const stacks = (workId: string) => {
    let h = history.current.get(workId);
    if (!h) history.current.set(workId, (h = { undo: [], redo: [] }));
    return h;
  };
  const push = (workId: string, op: Op) => {
    const h = stacks(workId);
    h.undo.push(op);
    if (h.undo.length > UNDO_LIMIT) h.undo.shift();
    h.redo = [];
    setHistoryVersion((v) => v + 1);
  };

  const workId = doc?.workId;
  const fileId = doc?.fileId;
  const pdf = doc?.pdf;

  useEffect(() => {
    setAnnotations([]);
    if (!workId || !fileId || !pdf) return;
    let cancelled = false;
    (async () => {
      const list = await listAnnotations(workId, fileId);
      if (cancelled) return;
      setAnnotations([...list].sort(byPosition));
      const unplaced = list.filter((a) => !a.placement);
      if (unplaced.length === 0) return;

      // Made on another version of this paper: find them in this one.
      setReanchoring(true);
      const load = async (page: number) => {
        const [{ text, content }, hash] = await Promise.all([getPageText(pdf, page), getPageHash(pdf, page)]);
        return { text, items: content.items, hash };
      };
      const updates: PlacementUpdate[] = [];
      for (const a of unplaced) {
        updates.push({ annotationId: a.id, placement: await reanchor(a, pdf.numPages, load) });
        if (cancelled) return;
      }
      const placed = updates.filter((u) => u.placement.status !== "orphan").map((u) => u.placement.page);
      await savePlacements(fileId, updates, await hashesFor(pdf, placed));
      if (cancelled) return;
      const byId = new Map(updates.map((u) => [u.annotationId, u.placement]));
      setAnnotations((prev) =>
        prev.map((a) => (byId.has(a.id) ? { ...a, placement: byId.get(a.id)!, fallback: null } : a)).sort(byPosition),
      );
    })()
      .catch((err) => !cancelled && report.current("Could not load the annotations", err))
      .finally(() => !cancelled && setReanchoring(false));
    return () => {
      cancelled = true;
    };
  }, [workId, fileId, pdf]);

  /** Applies a change to the list if it still shows the same work. */
  const apply = useCallback((forWork: string, change: (list: Annotation[]) => Annotation[]) => {
    if (docRef.current?.workId === forWork) setAnnotations((prev) => [...change(prev)].sort(byPosition));
  }, []);
  const upsert = (list: Annotation[], a: Annotation) =>
    list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a];

  const highlight = useCallback(
    async (capture: CapturedSelection, categoryId: string | null): Promise<Annotation | null> => {
      const d = docRef.current;
      if (!d) return null;
      try {
        const { text } = await getPageText(d.pdf, capture.startPage);
        const anchor = textAnchor(text, capture.start, capture.end);
        const created = await createAnnotation({
          workId: d.workId,
          fileId: d.fileId,
          kind: "highlight",
          categoryId,
          colour: null,
          note: "",
          quote: capture.quote,
          prefix: anchor.prefix,
          suffix: anchor.suffix,
          placement: {
            page: capture.startPage,
            geometry: { rects: capture.rects },
            textStart: anchor.textStart,
            textEnd: anchor.textEnd,
            status: "exact",
          },
          pageHashes: await hashesFor(d.pdf, capture.rects.map((r) => r[0])),
        });
        apply(d.workId, (list) => upsert(list, created));
        push(d.workId, { kind: "create", id: created.id });
        return created;
      } catch (err) {
        report.current("Could not save the highlight", err);
        return null;
      }
    },
    [apply],
  );

  const captureArea = useCallback(
    async (page: number, rect: PdfRect, categoryId: string | null): Promise<Annotation | null> => {
      const d = docRef.current;
      if (!d) return null;
      try {
        const created = await createAnnotation({
          workId: d.workId,
          fileId: d.fileId,
          kind: "area",
          categoryId,
          colour: null,
          note: "",
          quote: null,
          prefix: null,
          suffix: null,
          placement: { page, geometry: { rects: [[page, ...rect]] }, textStart: null, textEnd: null, status: "exact" },
          pageHashes: await hashesFor(d.pdf, [page]),
        });
        apply(d.workId, (list) => upsert(list, created));
        push(d.workId, { kind: "create", id: created.id });
        // The picture is what goes into the note; the annotation exists even if it fails.
        renderRegion(d.pdf, page, rect)
          .then((png) => saveAttachment(created.id, png))
          .then((imagePath) =>
            apply(d.workId, (list) => list.map((a) => (a.id === created.id ? { ...a, imagePath } : a))),
          )
          .catch((err) => report.current("Could not save the picture of the area", err));
        return created;
      } catch (err) {
        report.current("Could not capture the area", err);
        return null;
      }
    },
    [apply],
  );

  /**
   * Changes an annotation. Takes the annotation rather than its id so a note
   * saved as its popover closes still lands after the user has switched tabs.
   */
  const edit = useCallback(
    async (target: Annotation, change: Partial<AnnotationEdit>) => {
      const d = docRef.current;
      if (!d) return;
      const current = annotationsRef.current.find((a) => a.id === target.id) ?? target;
      // Deleted meanwhile (the popover of a deleted annotation saving its note).
      if (deleted.current.has(target.id)) return;
      const before = editOf(current);
      const after = { ...before, ...change };
      if (before.categoryId === after.categoryId && before.colour === after.colour && before.note === after.note) return;
      try {
        const updated = await updateAnnotation(target.id, d.fileId, after);
        apply(target.workId, (list) => upsert(list, updated));
        push(target.workId, { kind: "edit", id: target.id, before, after });
      } catch (err) {
        report.current("Could not save the change", err);
      }
    },
    [apply],
  );

  const remove = useCallback(
    async (id: string) => {
      const d = docRef.current;
      if (!d) return;
      deleted.current.add(id);
      try {
        await deleteAnnotation(id);
        apply(d.workId, (list) => list.filter((a) => a.id !== id));
        push(d.workId, { kind: "delete", id });
      } catch (err) {
        deleted.current.delete(id);
        report.current("Could not delete the annotation", err);
      }
    },
    [apply],
  );

  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  /** Runs one step of history; returns the id of the annotation it touched. */
  const step = useCallback(
    async (direction: "undo" | "redo"): Promise<string | null> => {
      const d = docRef.current;
      if (!d) return null;
      const h = stacks(d.workId);
      const op = (direction === "undo" ? h.undo : h.redo).pop();
      if (!op) return null;
      setHistoryVersion((v) => v + 1);
      const hide = (op.kind === "create") === (direction === "undo");
      try {
        if (op.kind === "edit") {
          const updated = await updateAnnotation(op.id, d.fileId, direction === "undo" ? op.before : op.after);
          apply(d.workId, (list) => upsert(list, updated));
        } else if (hide) {
          deleted.current.add(op.id);
          await deleteAnnotation(op.id);
          apply(d.workId, (list) => list.filter((a) => a.id !== op.id));
        } else {
          const restored = await restoreAnnotation(op.id, d.fileId);
          deleted.current.delete(op.id);
          apply(d.workId, (list) => upsert(list, restored));
        }
        (direction === "undo" ? h.redo : h.undo).push(op);
        setHistoryVersion((v) => v + 1);
        return op.kind !== "edit" && hide ? null : op.id;
      } catch (err) {
        report.current(`Could not ${direction}`, err);
        return null;
      }
    },
    [apply],
  );

  const h = workId ? history.current.get(workId) : undefined;
  return {
    annotations,
    reanchoring,
    highlight,
    captureArea,
    edit,
    remove,
    undo: useCallback(() => step("undo"), [step]),
    redo: useCallback(() => step("redo"), [step]),
    canUndo: (h?.undo.length ?? 0) > 0,
    canRedo: (h?.redo.length ?? 0) > 0,
    historyVersion,
  };
}
