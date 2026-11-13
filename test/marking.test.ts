import { detectLines } from "../src/focus/lines";
import { focusStart, stepAnnotation, stepMarkable } from "../src/focus/marking";
import { buildSteps, type FocusPage } from "../src/focus/steps";
import { textAnchor } from "../src/annotations/selection";
import type { Annotation } from "../src/annotations/types";
import { buildPageText, type TextItemLike } from "../src/pdf/search";

// One item per word, as in steps.test.ts.
function words(text: string, x: number, y: number, size = 10): TextItemLike[] {
  const items: TextItemLike[] = [];
  let cursor = x;
  for (const w of text.split(" ")) {
    const width = w.length * 0.5 * size;
    items.push({ str: w, transform: [size, 0, 0, size, cursor, y], width, height: size, hasEOL: false });
    cursor += width + 0.3 * size;
  }
  return items;
}

function page(rows: Array<string | { text: string; y: number }>): FocusPage {
  let y = 700;
  const items = rows.flatMap((row) => {
    const r = typeof row === "string" ? { text: row, y: (y -= 14) } : row;
    y = r.y;
    return words(r.text, 72, r.y);
  });
  return { page: 0, lines: detectLines(items).lines, items, rotation: 0, top: 792 };
}

const annotation = (a: Partial<Annotation>): Annotation =>
  ({ id: "a", workId: "w", kind: "highlight", categoryId: null, placement: null, ...a }) as Annotation;

describe("marking a focus step", () => {
  const p = page(["One sentence here. Another one follows.", { text: "Figure 1: What it shows.", y: 500 }]);
  const text = buildPageText(p.items as TextItemLike[]);
  const [first, second] = buildSteps([p], "sentence");

  it("text steps with a place and figures can be marked", () => {
    expect(stepMarkable(first)).toBe(true);
    expect(stepMarkable({ ...first, range: undefined })).toBe(false);
    expect(stepMarkable({ ...first, kind: "figure", range: undefined })).toBe(true);
    expect(stepMarkable(null)).toBe(false);
  });

  it("finds the highlight of exactly the step's text, not another's", () => {
    const { textStart, textEnd } = textAnchor(text, first.range!.start, first.range!.end);
    // (The page text is normalised: lower case, no spaces between items.)
    expect(text.text.slice(textStart, textEnd)).toBe("onesentencehere.");
    const mark = annotation({ placement: { page: 0, geometry: { rects: first.rects }, textStart, textEnd, status: "exact" } as Annotation["placement"] });
    expect(stepAnnotation(first, [mark], text)).toBe(mark);
    expect(stepAnnotation(second, [mark], text)).toBeNull();
    // Without the page's text nothing can be matched.
    expect(stepAnnotation(first, [mark], null)).toBeNull();
  });

  it("finds the area of exactly a figure", () => {
    const figure = { rects: [[0, 72, 520, 400, 680]] as [number, number, number, number, number][], text: "", kind: "figure" as const };
    const area = annotation({ kind: "area", placement: { page: 0, geometry: { rects: [[0, 72.4, 520, 400, 679.6]] } } as Annotation["placement"] });
    const elsewhere = annotation({ kind: "area", placement: { page: 0, geometry: { rects: [[0, 72, 300, 400, 480]] } } as Annotation["placement"] });
    expect(stepAnnotation(figure, [elsewhere, area], null)).toBe(area);
    expect(stepAnnotation(figure, [elsewhere], null)).toBeNull();
  });
});

describe("where F starts", () => {
  it("stays on the toolbar's page", () => {
    expect(focusStart(4, { page: 4, y: 300 })).toEqual({ page: 4, y: 300 });
    // Eye line still on the page before: this page's top.
    expect(focusStart(4, { page: 3, y: 100 })).toEqual({ page: 4, y: Infinity });
    // Already on the next page: this page's end.
    expect(focusStart(4, { page: 5, y: 700 })).toEqual({ page: 4, y: -Infinity });
    expect(focusStart(4, null)).toEqual({ page: 4, y: Infinity });
  });
});
