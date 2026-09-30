import {
  PADDING,
  PAGE_GAP,
  anchorAt,
  computeLayout,
  currentPage,
  fitZoom,
  nextZoom,
  offsetOf,
  pageAt,
  typicalSize,
  visibleRange,
} from "../src/pdf/layout";
import { PDF_TO_CSS } from "../src/pdf/units";

// Letter-size pages: 612 x 792 pt = 816 x 1056 CSS px at zoom 1.
const letter = { width: 612, height: 792 };
const landscape = { width: 792, height: 612 };

describe("layout", () => {
  it("stacks pages with padding and gaps", () => {
    const l = computeLayout([letter, letter, letter], 1);
    expect(l.heights).toEqual([1056, 1056, 1056]);
    expect(l.tops).toEqual([PADDING, PADDING + 1056 + PAGE_GAP, PADDING + 2 * (1056 + PAGE_GAP)]);
    expect(l.totalHeight).toBe(PADDING * 2 + 3 * 1056 + 2 * PAGE_GAP);
    expect(l.maxWidth).toBe(816);
  });

  it("handles mixed page sizes", () => {
    const l = computeLayout([letter, landscape], 1);
    expect(l.widths).toEqual([816, 1056]);
    expect(l.maxWidth).toBe(1056);
  });

  it("finds the page at an offset, assigning gaps to the page above", () => {
    const l = computeLayout([letter, letter, letter], 1);
    expect(pageAt(l, 0)).toBe(0);
    expect(pageAt(l, l.tops[1] - 1)).toBe(0);
    expect(pageAt(l, l.tops[1])).toBe(1);
    expect(pageAt(l, 1e9)).toBe(2);
  });

  it("computes visible pages with overscan", () => {
    const l = computeLayout(Array(10).fill(letter), 1);
    expect(visibleRange(l, l.tops[4] + 10, 500, 0)).toEqual([4, 4]);
    expect(visibleRange(l, l.tops[4] + 10, 500, 1)).toEqual([3, 5]);
    expect(visibleRange(l, 0, 500, 2)).toEqual([0, 2]);
  });

  it("reports the page that fills most of the viewport as current", () => {
    const l = computeLayout(Array(3).fill(letter), 1);
    // Viewport shows the last 100px of page 0 and 800px of page 1.
    expect(currentPage(l, l.tops[1] - 100, 900)).toBe(1);
    expect(currentPage(l, l.tops[1] - 800, 900)).toBe(0);
  });

  it("keeps the same place across zoom levels", () => {
    const sizes = Array(20).fill(letter);
    const before = computeLayout(sizes, 1);
    const y = before.tops[7] + 0.3 * before.heights[7];
    const anchor = anchorAt(before, y);
    expect(anchor.page).toBe(7);
    expect(anchor.fraction).toBeCloseTo(0.3, 5);

    const after = computeLayout(sizes, 2);
    const y2 = offsetOf(after, anchor);
    expect(pageAt(after, y2)).toBe(7);
    expect((y2 - after.tops[7]) / after.heights[7]).toBeCloseTo(0.3, 5);
  });

  it("clamps anchors in gaps and out of range", () => {
    const l = computeLayout([letter, letter], 1);
    expect(anchorAt(l, l.tops[1] - 2)).toEqual({ page: 0, fraction: 1 });
    expect(offsetOf(l, { page: 99, fraction: 0 })).toBe(l.tops[1]);
    expect(offsetOf(computeLayout([], 1), { page: 0, fraction: 0 })).toBe(0);
  });

  it("fits width and whole page", () => {
    const w = 816 + 2 * PADDING;
    expect(fitZoom("fit-width", letter, w, 400)).toBeCloseTo(1, 5);
    // Tall enough for width to fit but not height: fit-page is limited by height.
    const h = 1056 / 2 + 2 * PADDING;
    expect(fitZoom("fit-page", letter, w, h)).toBeCloseTo(0.5, 5);
    expect(fitZoom("fit-width", { width: 72 / PDF_TO_CSS, height: 100 }, 132, 400)).toBeCloseTo(100 / 72, 5);
  });
});

describe("typical page size", () => {
  it("ignores an odd cover page", () => {
    expect(typicalSize([landscape, letter, letter, letter])).toEqual(letter);
    expect(typicalSize([])).toEqual({ width: 612, height: 792 });
  });
});

describe("zoom steps", () => {
  it("steps through the preset levels and clamps at the ends", () => {
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(1, -1)).toBe(0.9);
    expect(nextZoom(1.05, 1)).toBe(1.1);
    expect(nextZoom(1.37, -1)).toBe(1.25);
    expect(nextZoom(4, 1)).toBe(4);
    expect(nextZoom(0.25, -1)).toBe(0.25);
  });
});
