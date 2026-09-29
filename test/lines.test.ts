import { detectLines } from "../src/focus/lines";
import type { TextItemLike } from "../src/pdf/search";

// Builds pdf.js-like items for a line of text: one item per word, 0.5em per char.
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

const texts = (items: ReadonlyArray<unknown>, opts?: Parameters<typeof detectLines>[1]) =>
  detectLines(items, opts).lines.map((l) => l.text);

/** Interleaves arrays the way a content stream might (a1, b1, a2, b2, ...). */
function interleave<T>(...arrays: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(...arrays.map((a) => a.length)); i++) for (const a of arrays) if (a[i]) out.push(a[i]);
  return out;
}

describe("single column", () => {
  it("orders lines top to bottom regardless of stream order", () => {
    const lines = ["first line of text here", "second line of text here", "third line of text here", "fourth line"];
    const items = lines.map((t, i) => words(t, 72, 700 - i * 14)).reverse().flat();
    const result = detectLines(items);
    expect(result.columns).toBe(1);
    expect(result.lines.map((l) => l.text)).toEqual(lines);
  });

  it("keeps a ragged column with short lines as one column", () => {
    const lines = [
      "a long line of body text that runs across",
      "short",
      "another long line of body text runs across",
      "end.",
      "a new paragraph begins with a long line here",
      "and it ends",
      "then more text follows in a long line again",
    ];
    const result = detectLines(lines.flatMap((t, i) => words(t, 72, 700 - i * 14)));
    expect(result.columns).toBe(1);
    expect(result.lines.map((l) => l.text)).toEqual(lines);
  });
});

describe("two columns", () => {
  const left = Array.from({ length: 6 }, (_, i) => `left column line ${i + 1} text`);
  const right = Array.from({ length: 6 }, (_, i) => `right column line ${i + 1} text`);
  const y = (i: number) => 640 - i * 14;

  it("reads the full-width title, then the left column, then the right", () => {
    const title = words("A Title That Spans Both Columns Of The Page Entirely", 100, 720, 16);
    const l = left.map((t, i) => words(t, 72, y(i)));
    const r = right.map((t, i) => words(t, 320, y(i)));
    const result = detectLines([...title, ...interleave(l, r).flat()]);
    expect(result.columns).toBe(2);
    expect(result.gutter).toBeGreaterThan(72 + 150);
    expect(result.gutter).toBeLessThan(320);
    expect(result.lines.map((l) => l.text)).toEqual(["A Title That Spans Both Columns Of The Page Entirely", ...left, ...right]);
    expect(result.lines.map((l) => l.column)).toEqual([-1, ...left.map(() => 0), ...right.map(() => 1)]);
  });

  it("keeps a wide figure caption in place between column bands", () => {
    const above = 3;
    const l = left.map((t, i) => words(t, 72, i < above ? y(i) : y(i) - 80));
    const r = right.map((t, i) => words(t, 320, i < above ? y(i) : y(i) - 80));
    const caption = words("Figure 1: a caption that runs across the whole page width here", 90, y(above) - 30);
    const result = detectLines([...interleave(l, r).flat(), ...caption]);
    expect(result.lines.map((l) => l.text)).toEqual([
      ...left.slice(0, above),
      ...right.slice(0, above),
      "Figure 1: a caption that runs across the whole page width here",
      ...left.slice(above),
      ...right.slice(above),
    ]);
  });

  it("can be told to ignore columns", () => {
    const l = left.map((t, i) => words(t, 72, y(i)));
    const r = right.map((t, i) => words(t, 320, y(i)));
    const result = detectLines(interleave(l, r).flat(), { detectColumns: false });
    expect(result.columns).toBe(1);
    // Without columns, each row is read straight across as one step.
    expect(result.lines.slice(0, 2).map((l) => l.text)).toEqual([`${left[0]} ${right[0]}`, `${left[1]} ${right[1]}`]);
  });
});

describe("math and small text", () => {
  it("keeps superscripts in their line and in order", () => {
    const base = words("where x", 72, 700);
    // "where" spans 72-97, "x" 100-105; the superscript sits right after x.
    const sup: TextItemLike = { str: "2", transform: [7, 0, 0, 7, 105, 704], width: 3.5, height: 7, hasEOL: false };
    const rest = words("is positive", 111, 700);
    expect(texts([sup, ...base, ...rest])).toEqual(["where x2 is positive"]);
  });

  it("treats a stacked fraction as a single line", () => {
    const numerator = words("a + b", 200, 708, 9);
    const bar = words("f =", 170, 700);
    const denominator = words("c", 210, 692, 9);
    const after = words("next line of text after the display", 72, 670);
    const lines = detectLines([...numerator, ...bar, ...denominator, ...after]).lines;
    expect(lines).toHaveLength(2);
    // One step covering numerator, operator line and denominator.
    expect(lines[0].items).toHaveLength(numerator.length + bar.length + denominator.length);
    expect(lines[1].text).toBe("next line of text after the display");
  });

  it("ignores rotated text and empty items", () => {
    const rotated: TextItemLike = { str: "arXiv:1234", transform: [0, 10, -10, 0, 20, 400], width: 50, height: 10, hasEOL: false };
    const blank: TextItemLike = { str: " ", transform: [10, 0, 0, 10, 72, 700], width: 3, height: 10, hasEOL: false };
    expect(texts([rotated, blank, ...words("body text", 72, 700)])).toEqual(["body text"]);
  });
});
