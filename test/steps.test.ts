import { detectLines } from "../src/focus/lines";
import { buildSteps, placeOf, stepAt, stepAtPlace, stepUnder, type FocusPage } from "../src/focus/steps";
import type { TextItemLike } from "../src/pdf/search";

// One item per word, 0.5em per character, as in lines.test.ts.
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

/** A page from lines of text (and their sizes), top to bottom, 14 pt apart unless given. */
function page(index: number, rows: Array<string | { text: string; y?: number; x?: number; size?: number }>): FocusPage {
  let y = 700;
  const items = rows.flatMap((row) => {
    const r = typeof row === "string" ? { text: row } : row;
    y = r.y ?? y - 14;
    return words(r.text, r.x ?? 72, y, r.size);
  });
  return { page: index, lines: detectLines(items).lines, items, rotation: 0, top: 792 };
}

const texts = (p: FocusPage[], unit: Parameters<typeof buildSteps>[1]) => buildSteps(p, unit).map((s) => s.text);

describe("line steps", () => {
  it("group lines, starting a new step at a heading", () => {
    const p = page(0, [
      { text: "1 Introduction", size: 14 },
      "first line of the text",
      "second line of the text",
      "third line of the text",
    ]);
    expect(texts([p], 2)).toEqual(["1 Introduction", "first line of the text second line of the text", "third line of the text"]);
    expect(texts([p], 1)).toHaveLength(4);
  });

  it("leave out page numbers", () => {
    const p = page(0, ["a long line of body text that runs across the page", "another long line of body text that runs across", { text: "12", y: 40, x: 300 }]);
    expect(texts([p], 1)).toEqual(["a long line of body text that runs across the page", "another long line of body text that runs across"]);
  });
});

describe("sentence steps", () => {
  it("follow sentences across lines and pages, joining hyphenated words", () => {
    const pages = [
      page(0, ["The first sentence ends here. The second one is hy-", "phenated and carries on to"]),
      page(1, ["the next page. A third."]),
    ];
    const steps = buildSteps(pages, "sentence");
    expect(steps.map((s) => s.text)).toEqual([
      "The first sentence ends here.",
      "The second one is hyphenated and carries on to the next page.",
      "A third.",
    ]);
    // The second sentence lights up the end of line 1, all of line 2 and the start of page 2.
    expect(steps[1].rects.map((r) => r[0])).toEqual([0, 0, 1]);
    expect(steps[1].rects[0][1]).toBeGreaterThan(72 + 50);
    expect(steps[1].rects[2][3]).toBeLessThan(72 + 80);
  });

  it("don't end at abbreviations, initials or within numbers", () => {
    const p = page(0, ["As Fig. 2 shows, e.g. in work by A. Bacon et al. (2020), the value is 3.5 here. Next one."]);
    expect(texts([p], "sentence")).toEqual([
      "As Fig. 2 shows, e.g. in work by A. Bacon et al. (2020), the value is 3.5 here.",
      "Next one.",
    ]);
  });

  it("end at a heading without a full stop", () => {
    const p = page(0, [{ text: "2 Related Work", size: 14 }, "Earlier work did this. It also did that."]);
    expect(texts([p], "sentence")).toEqual(["2 Related Work", "Earlier work did this.", "It also did that."]);
  });
});

describe("figures", () => {
  it("are one step: the empty band above their caption", () => {
    const p = page(0, [
      "text above the figure in a long line",
      { text: "Figure 1: What the drawing shows.", y: 500 },
      "text below the figure in a long line",
    ]);
    const steps = buildSteps([p], 1);
    expect(steps.map((s) => s.kind)).toEqual(["text", "figure", "text", "text"]);
    const [, x0, y0, x1, y1] = steps[1].rects[0];
    expect(y0).toBeGreaterThan(500);
    expect(y1).toBeLessThan(686);
    expect(x1 - x0).toBeGreaterThan(100);
  });

  it("and tables: the band below their caption", () => {
    const p = page(0, ["text above the table in a long line", "Table 2: Results.", { text: "text below the table in a long line", y: 450 }]);
    expect(buildSteps([p], 1).map((s) => s.kind)).toEqual(["text", "text", "figure", "text"]);
  });
});

describe("finding a step", () => {
  const pages = [page(0, ["line one of page one", "line two of page one"]), page(1, ["line one of page two"])];
  const steps = buildSteps(pages, 1);

  it("from where the eye is", () => {
    expect(stepAt(steps, 0, 800)).toBe(0);
    expect(stepAt(steps, 0, 680)).toBe(1);
    expect(stepAt(steps, 0, 100)).toBe(2);
    expect(stepAt(steps, 1, 100)).toBe(2);
  });

  it("again after more pages are read, even the second sentence on a line", () => {
    const one = [page(3, ["First sentence here. Second one on the same line."])];
    const before = buildSteps(one, "sentence");
    const after = buildSteps([page(2, ["An earlier page came in."]), ...one], "sentence");
    expect(after[stepAtPlace(after, placeOf(before[1]))].text).toBe("Second one on the same line.");
  });

  it("from a click", () => {
    expect(stepUnder(steps, 0, 80, 673)).toBe(1);
    expect(stepUnder(steps, 0, 80, 300)).toBe(-1);
  });
});
