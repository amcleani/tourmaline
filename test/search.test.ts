import { buildPageText, findInPage, matchRects, normaliseQuery, type TextItemLike } from "../src/pdf/search";

const item = (str: string, x = 0, y = 700, hasEOL = false): TextItemLike => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width: str.length * 5,
  height: 10,
  hasEOL,
});

describe("page text normalisation", () => {
  it("folds ligatures, accents and case", () => {
    const page = buildPageText([item("The ﬁrst Gödel Theorem")]);
    expect(page.text).toBe("the first godel theorem");
    expect(normaliseQuery("  GÖDEL   theorem ")).toBe("godel theorem");
  });

  it("joins words hyphenated across a line break", () => {
    const page = buildPageText([item("a defini-", 0, 700, true), item("tion of truth", 0, 688)]);
    expect(page.text).toBe("a definition of truth");
  });

  it("keeps real hyphens and separates lines with a space", () => {
    const page = buildPageText([item("higher-order", 0, 700, true), item("logic", 0, 688)]);
    expect(page.text).toBe("higher-order logic");
  });

  it("collapses whitespace and skips marked-content items", () => {
    const page = buildPageText([item("a  b"), { type: "beginMarkedContent" }, item(" c", 20)]);
    expect(page.text).toBe("a b c");
  });

  it("maps every character back to its item, with inserted spaces unmapped", () => {
    const page = buildPageText([item("ab", 0, 700, true), item("c", 0, 688)]);
    expect(page.text).toBe("ab c");
    expect(page.source).toEqual([[0, 0], [0, 1], null, [1, 0]]);
  });

  it("maps expanded ligatures to the single source character", () => {
    const page = buildPageText([item("ﬁx")]);
    expect(page.text).toBe("fix");
    expect(page.source).toEqual([[0, 0], [0, 0], [0, 1]]);
  });
});

describe("finding matches", () => {
  const items = [item("Classicism and the logic", 100, 700, true), item("of classicism", 100, 688)];
  const page = buildPageText(items);

  it("finds every occurrence, case-insensitively", () => {
    expect(findInPage(page, 3, "CLASSICISM")).toEqual([
      { page: 3, start: 0, end: 10 },
      { page: 3, start: 28, end: 38 },
    ]);
    expect(findInPage(page, 0, "   ")).toEqual([]);
  });

  it("matches across line breaks", () => {
    expect(findInPage(page, 0, "logic of")).toHaveLength(1);
  });

  it("produces one rectangle per item the match covers", () => {
    const [match] = findInPage(page, 0, "logic of");
    const rects = matchRects(page, items, match);
    expect(rects).toHaveLength(2);
    // "logic" is chars 19-23 of item 0 (5 units per char, starting at x=100).
    expect(rects[0][0]).toBeCloseTo(100 + 19 * 5);
    expect(rects[0][2]).toBeCloseTo(100 + 24 * 5);
    expect(rects[1][0]).toBeCloseTo(100);
    expect(rects[1][2]).toBeCloseTo(100 + 2 * 5);
    // Rectangles straddle the baseline.
    expect(rects[1][1]).toBeLessThan(688);
    expect(rects[1][3]).toBeGreaterThan(688);
  });
});

describe("highlight rectangles on rotated text", () => {
  it("follows the text direction", () => {
    // Text running up the page (as on a /Rotate 90 page): origin (300, 100), 5 units per char.
    const rotated: TextItemLike = { str: "abcdef", transform: [0, 10, -10, 0, 300, 100], width: 30, height: 10, hasEOL: false };
    const page = buildPageText([rotated]);
    const [match] = findInPage(page, 0, "cd");
    const [[x0, y0, x1, y1]] = matchRects(page, [rotated], match);
    // "cd" is chars 2-3: 10-20 units up from the origin, glyphs extending left of x=300.
    expect(y0).toBeCloseTo(110);
    expect(y1).toBeCloseTo(120);
    expect(x0).toBeCloseTo(300 - 8.5);
    expect(x1).toBeCloseTo(300 + 2.5);
  });
});
