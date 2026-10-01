import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  createAnnotation,
  deleteAnnotation,
  importAnnotations,
  listAnnotations,
  repairImportedNotes,
  restoreAnnotation,
  saveAttachment,
  savePlacements,
  updateAnnotation,
} from "../platform";
import type { PdfRect } from "../pdf/search";
import { getPageHash, getPageText } from "../pdf/textCache";
import { reanchor } from "./anchor";
import { renderRegion } from "./capture";
import { withoutRepeatedQuote } from "./importPdf";
import { textAnchor, type CapturedSelection } from "./selection";
import {
  byPosition,
  type Annotation,
  type AnnotationEdit,
  type ImportResult,
  type NewAnnotation,
  type PageHash,
  type PlacementUpdate,
} from "./types";

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

/** Places annotations that have no placement on this file yet (made on another version). */
async function placeOnFile(pdf: PDFDocumentProxy, fileId: string, unplaced: Annotation[]): Promise<Map<string, Annotation["placement"]>> {
  const load = async (page: number) => {
    const [{ text, content }, hash] = await Promise.all([getPageText(pdf, page), getPageHash(pdf, page)]);
    return { text, items: content.items, hash };
  };
  const updates: PlacementUpdate[] = [];
  for (const a of unplaced) updates.push({ annotationId: a.id, placement: await reanchor(a, pdf.numPages, load) });
  const placed = updates.filter((u) => u.placement.status !== "orphan").map((u) => u.placement.page);
  await savePlacements(fileId, updates, await hashesFor(pdf, placed));
  return new Map(updates.map((u) => [u.annotationId, u.placement]));
}

/**
 * Imports before this fix kept a highlight's /Contents as its note even when
 * it was only the highlighted text again. Clears that from imported
 * annotations the user hasn't changed (best effort: on failure the list is
 * shown as stored).
 */
async function withRepairedNotes(list: Annotation[]): Promise<Annotation[]> {
  const repairs = list.flatMap((a) => {
    if (a.source !== "imported" || a.kind !== "highlight" || a.updated !== a.created) return [];
    const note = withoutRepeatedQuote(a.note, a.quote);
    return note === a.note ? [] : [{ id: a.id, note }];
  });
  if (repairs.length === 0) return list;
  try {
    const fixed = new Set(await repairImportedNotes(repairs));
    const notes = new Map(repairs.map((r) => [r.id, r.note]));
    return list.map((a) => (fixed.has(a.id) ? { ...a, note: notes.get(a.id)! } : a));
  } catch (err) {
    console.warn("Could not correct imported notes", err);
    return list;
  }
}

/**
 * The annotations of the open document's work, placed on the open file.
 * Annotations made on another version of the file are re-anchored when first
 * shown on this one.
 *
 * Every change goes through one queue, so quick successive changes (holding
 * Ctrl+Z, a note saving while the category changes) apply in order and each
 * starts from the result of the previous one.
 */
export function useAnnotations(doc: OpenDoc | null, onError: (what: string, err: unknown) => void) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [reanchoring, setReanchoring] = useState(false);
  /** `workId:fileId` whose list has been loaded. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const report = useRef(onError);
  report.current = onError;
  /** The list as of the last change, ahead of React's render. */
  const listRef = useRef<Annotation[]>([]);
  /** The file each work was last shown with, so changes can land after its tab closed. */
  const fileOf = useRef(new Map<string, string>());
  /** Ids deleted in this session, so late saves (a closing popover) don't revive them. */
  const deleted = useRef(new Set<string>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task, task);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  // Undo history per work, so switching tabs keeps each paper's history.
  const history = useRef(new Map<string, { undo: Op[]; redo: Op[] }>());
  const [historyVersion, setHistoryVersion] = useState(0);
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

  const show = useCallback((list: Annotation[]) => {
    const next = list.filter((a) => !deleted.current.has(a.id)).sort(byPosition);
    listRef.current = next;
    setAnnotations(next);
  }, []);

  const workId = doc?.workId;
  const fileId = doc?.fileId;
  const pdf = doc?.pdf;
  if (workId && fileId) fileOf.current.set(workId, fileId);

  useEffect(() => {
    show([]);
    if (!workId || !fileId || !pdf) return;
    let cancelled = false;
    (async () => {
      const list = await withRepairedNotes(await listAnnotations(workId, fileId));
      if (cancelled) return;
      show(list);
      setLoadedFor(`${workId}:${fileId}`);
      const unplaced = list.filter((a) => !a.placement);
      if (unplaced.length === 0) return;
      setReanchoring(true);
      const placements = await placeOnFile(pdf, fileId, unplaced);
      if (cancelled) return;
      show(listRef.current.map((a) => (placements.has(a.id) ? { ...a, placement: placements.get(a.id)!, fallback: null } : a)));
    })()
      .catch((err) => !cancelled && report.current("Could not load the annotations", err))
      .finally(() => !cancelled && setReanchoring(false));
    return () => {
      cancelled = true;
    };
  }, [workId, fileId, pdf, show]);

  /** Applies a change to the list if it still shows the same work. */
  const apply = useCallback(
    (forWork: string, change: (list: Annotation[]) => Annotation[]) => {
      if (docRef.current?.workId === forWork) show(change(listRef.current));
    },
    [show],
  );
  const upsert = (list: Annotation[], a: Annotation) =>
    list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a];

  /** A restored annotation may come from another version of the file: place it on this one. */
  const withPlacement = async (a: Annotation): Promise<Annotation> => {
    const d = docRef.current;
    if (a.placement || !d || d.workId !== a.workId) return a;
    const placements = await placeOnFile(d.pdf, d.fileId, [a]);
    return { ...a, placement: placements.get(a.id) ?? null, fallback: null };
  };

  const highlight = useCallback(
    (capture: CapturedSelection, categoryId: string | null): Promise<Annotation | null> => {
      const d = docRef.current;
      if (!d) return Promise.resolve(null);
      return enqueue(async () => {
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
      });
    },
    [apply, enqueue],
  );

  /**
   * Adds annotations imported from the PDF (not undoable: deleting one is).
   * Areas get their picture as captured ones do. Null if the paper changed.
   */
  const importFound = useCallback(
    (list: NewAnnotation[]): Promise<ImportResult | null> => {
      const d = docRef.current;
      if (!d || list.some((n) => n.workId !== d.workId)) return Promise.resolve(null);
      return enqueue(async () => {
        const result = await importAnnotations(list);
        apply(d.workId, (current) => result.created.reduce(upsert, current));
        for (const a of result.created) {
          if (a.kind !== "area" || !a.placement) continue;
          const [page, ...rect] = a.placement.geometry.rects[0];
          renderRegion(d.pdf, page, rect as PdfRect)
            .then((png) => saveAttachment(a.id, png))
            .then((imagePath) => apply(d.workId, (l) => l.map((x) => (x.id === a.id ? { ...x, imagePath } : x))))
            .catch((err) => report.current("Could not save the picture of an imported area", err));
        }
        return result;
      });
    },
    [apply, enqueue],
  );

  const captureArea = useCallback(
    (page: number, rect: PdfRect, categoryId: string | null): Promise<Annotation | null> => {
      const d = docRef.current;
      if (!d) return Promise.resolve(null);
      return enqueue(async () => {
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
      });
    },
    [apply, enqueue],
  );

  /**
   * Changes an annotation. Takes the annotation rather than its id, and doesn't
   * need its document to be open, so a note saved as its popover closes still
   * lands after the tab was closed or switched.
   */
  const edit = useCallback(
    (target: Annotation, change: Partial<AnnotationEdit>): Promise<void> =>
      enqueue(async () => {
        const file = fileOf.current.get(target.workId);
        if (!file || deleted.current.has(target.id)) return;
        // The latest version, after any change queued before this one.
        const current = listRef.current.find((a) => a.id === target.id) ?? target;
        const before = editOf(current);
        const after = { ...before, ...change };
        if (before.categoryId === after.categoryId && before.colour === after.colour && before.note === after.note) return;
        try {
          const updated = await updateAnnotation(target.id, file, after);
          apply(target.workId, (list) => upsert(list, updated));
          push(target.workId, { kind: "edit", id: target.id, before, after });
        } catch (err) {
          report.current("Could not save the change", err);
        }
      }),
    [apply, enqueue],
  );

  const remove = useCallback(
    (id: string): Promise<void> => {
      const d = docRef.current;
      if (!d) return Promise.resolve();
      return enqueue(async () => {
        deleted.current.add(id);
        try {
          await deleteAnnotation(id);
          apply(d.workId, (list) => list.filter((a) => a.id !== id));
          push(d.workId, { kind: "delete", id });
        } catch (err) {
          deleted.current.delete(id);
          report.current("Could not delete the annotation", err);
        }
      });
    },
    [apply, enqueue],
  );

  /** Runs one step of history; returns the id of the annotation it touched. */
  const step = useCallback(
    (direction: "undo" | "redo"): Promise<string | null> => {
      const d = docRef.current;
      if (!d) return Promise.resolve(null);
      return enqueue(async () => {
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
            const restored = await withPlacement(await restoreAnnotation(op.id, d.fileId));
            deleted.current.delete(op.id);
            apply(d.workId, (list) => upsert(list, restored));
          }
          (direction === "undo" ? h.redo : h.undo).push(op);
          setHistoryVersion((v) => v + 1);
          return op.kind !== "edit" && hide ? null : op.id;
        } catch (err) {
          // Put the step back so it can be tried again.
          (direction === "undo" ? h.undo : h.redo).push(op);
          setHistoryVersion((v) => v + 1);
          report.current(`Could not ${direction}`, err);
          return null;
        }
      });
    },
    [apply, enqueue],
  );

  /** Resolves once every change asked for so far has been saved. */
  const settled = useCallback(() => enqueue(async () => undefined), [enqueue]);

  const h = workId ? history.current.get(workId) : undefined;
  return {
    annotations,
    reanchoring,
    /** The list as of the last change, even before React re-renders (after `settled`). */
    current: useCallback(() => listRef.current, []),
    /** The open document's annotations have been loaded. */
    loaded: !!workId && loadedFor === `${workId}:${fileId}`,
    highlight,
    captureArea,
    importFound,
    edit,
    remove,
    settled,
    undo: useCallback(() => step("undo"), [step]),
    redo: useCallback(() => step("redo"), [step]),
    canUndo: (h?.undo.length ?? 0) > 0,
    canRedo: (h?.redo.length ?? 0) > 0,
    historyVersion,
  };
}
