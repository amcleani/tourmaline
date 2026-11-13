import type { Annotation } from "../annotations/types";
import { textAnchor } from "../annotations/selection";
import type { PageText } from "../pdf/search";
import type { Step } from "./steps";

// Focus mode's link to annotations and the page: which annotation already
// marks a step, and where on the toolbar's page F starts.

/** Whether a step can be marked: text with a known place, or a figure. */
export const stepMarkable = (s: Step | null): s is Step => !!s && (s.kind === "figure" || !!s.range);

/**
 * The annotation already marking a step: a highlight of exactly its text
 * (`pageText` is its first page's), or an area of exactly its figure.
 */
export function stepAnnotation(step: Step, annotations: readonly Annotation[], pageText: PageText | null): Annotation | null {
  const page = step.rects[0][0];
  if (step.kind === "figure") {
    const [, ...want] = step.rects[0];
    return (
      annotations.find((a) => {
        const r = a.placement?.page === page ? a.placement.geometry.rects[0] : undefined;
        return a.kind === "area" && !!r && r.slice(1).every((v, i) => Math.abs(v - want[i]) < 1);
      }) ?? null
    );
  }
  if (!step.range || !pageText) return null;
  const { textStart, textEnd } = textAnchor(pageText, step.range.start, step.range.end);
  return (
    annotations.find(
      (a) => a.kind === "highlight" && a.placement?.page === page && a.placement.textStart === textStart && a.placement.textEnd === textEnd,
    ) ?? null
  );
}

/**
 * Where on `page` (the toolbar's current page) focus mode starts, given the
 * point under the eye line: there when it is on that page; else the page's
 * top when the eye line is on an earlier page (or unknown), its end when on
 * a later one. Never another page.
 */
export function focusStart(page: number, eye: { page: number; y: number } | null | undefined): { page: number; y: number } {
  const y = !eye ? Infinity : eye.page === page ? eye.y : eye.page < page ? Infinity : -Infinity;
  return { page, y };
}
