import { buildPageText, type TextItemLike } from "../src/pdf/search";
import { cleanQuote, mergeLineRects, textAnchor, textOffset } from "../src/annotations/selection";

const item = (str: string, hasEOL = false): TextItemLike => ({
  str,
  transform: [10, 0, 0, 10, 0, 0],
  width: str.length * 5,
  height: 10,
  hasEOL,
});

describe("cleanQuote", () => {
  it("collapses whitespace and joins words hyphenated across lines", () => {
    expect(cleanQuote("  the gener-\nalization of\n  a  theorem ")).toBe("the generalization of a theorem");
  });
});

describe("mergeLineRects", () => {
  it("merges the pieces of one line and keeps lines apart", () => {
    const lines = mergeLineRects([
      { left: 10, top: 100, width: 50, height: 12 },
      { left: 62, top: 101, width: 40, height: 11 },
      { left: 10, top: 115, width: 80, height: 12 },
    ]);
    expect(lines).toEqual([
      { left: 10, top: 100, width: 92, height: 12 },
      { left: 10, top: 115, width: 80, height: 12 },
    ]);
  });

  it("keeps two columns apart on the same line", () => {
    const lines = mergeLineRects([
      { left: 10, top: 100, width: 200, height: 12 },
      { left: 300, top: 100, width: 200, height: 12 },
    ]);
    expect(lines).toHaveLength(2);
  });

  it("drops empty rectangles", () => {
    expect(mergeLineRects([{ left: 1, top: 1, width: 0, height: 10 }])).toEqual([]);
  });
});

describe("text offsets", () => {
  // "Gödel's ﬁrst" + EOL + "theo-" + EOL + "rem holds."
  const items = [item("Gödel's ﬁrst", true), item("theo-", true), item("rem holds.")];
  const page = buildPageText(items);

  it("maps text points to normalised offsets", () => {
    expect(page.text).toBe("godel's first theorem holds.");
    // "ﬁrst" starts at char 8 of item 0; the ligature expands to "fi".
    expect(textOffset(page, { item: 0, char: 8 }, "start")).toBe(8);
    expect(textOffset(page, { item: 0, char: 12 }, "end")).toBe(13);
    // The end of "theorem" is in item 2, after the dropped hyphen.
    expect(textOffset(page, { item: 2, char: 3 }, "end")).toBe(21);
  });

  it("gives the quote's range and context", () => {
    const anchor = textAnchor(page, { item: 1, char: 0 }, { item: 2, char: 3 });
    expect(page.text.slice(anchor.textStart, anchor.textEnd)).toBe("theorem");
    expect(anchor.prefix).toBe("godel's first ");
    expect(anchor.suffix).toBe(" holds.");
  });
});
