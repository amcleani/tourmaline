// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  collectAnnotations,
  findPdfAnnotations,
  nearestCategory,
  pdfDate,
  textUnderRects,
  toNewAnnotations,
  type PdfAnnotationData,
} from "../src/annotations/importPdf";
import { buildPageText, type TextItemLike } from "../src/pdf/search";

const DEFAULT_CATEGORIES = [
  { id: "default-1", name: "Highlight", colour: "#f7d14c", callout: "quote", hotkey: 1, deleted: false },
  { id: "default-2", name: "Important", colour: "#f28b82", callout: "important", hotkey: 2, deleted: false },
  { id: "default-3", name: "Definition", colour: "#8ab4f8", callout: "info", hotkey: 3, deleted: false },
  { id: "default-4", name: "Question", colour: "#c58af9", callout: "question", hotkey: 4, deleted: false },
  { id: "default-5", name: "Method", colour: "#81c995", callout: "example", hotkey: 5, deleted: false },
];

const highlight = (id: string, extra: Partial<PdfAnnotationData> = {}): PdfAnnotationData => ({
  id,
  subtype: "Highlight",
  rect: [100, 500, 300, 520],
  quadPoints: [100, 520, 300, 520, 100, 500, 300, 500],
  color: [255, 255, 0],
  contentsObj: { str: "" },
  ...extra,
});

describe("collectAnnotations", () => {
  it("keeps what Tourmaline can show, keyed by /NM or position", () => {
    const found = collectAnnotations(
      [
        {
          page: 3,
          annotations: [
            highlight("10R", { contentsObj: { str: " Important point " }, creationDate: "D:20250227173006-08'00'" }),
            highlight("11R", {
              subtype: "Underline",
              quadPoints: [100, 520, 300, 520, 100, 500, 300, 500, 50, 480, 200, 480, 50, 460, 200, 460],
            }),
            { id: "12R", subtype: "Link", rect: [0, 0, 1, 1] },
            { id: "13R", subtype: "Ink", rect: [0, 0, 1, 1] },
            { id: "14R", subtype: "Text", rect: [10, 10, 30, 30], contentsObj: { str: "Sticky" }, color: null },
            { id: "15R", subtype: "Square", rect: [300, 100, 200, 50], color: [0, 0, 255] },
            // A reply to the first.
            { id: "16R", subtype: "Text", rect: [0, 0, 1, 1], inReplyTo: "10R", contentsObj: { str: "I agree" }, titleObj: { str: "Ada" } },
          ],
        },
      ],
      new Map([["10R", "okular-{40b3}"]]),
    );
    expect(found.map((f) => [f.pdfId, f.kind, f.key])).toEqual([
      ["10R", "highlight", "nm:okular-{40b3}"],
      ["11R", "highlight", "pos:Underline:3:100,500,300,520"],
      ["14R", "note", "pos:Text:3:10,10,30,30"],
      ["15R", "area", "pos:Square:3:300,100,200,50"],
    ]);
    expect(found[0]).toMatchObject({ colour: "#ffff00", note: "Important point\n\nAda: I agree", page: 3 });
    expect(found[0].created).toBe(Date.UTC(2025, 1, 28, 1, 30, 6));
    expect(found[1].rects).toEqual([
      [100, 500, 300, 520],
      [50, 460, 200, 480],
    ]);
    expect(found[2]).toMatchObject({ colour: null, note: "Sticky" });
    expect(found[3].rects).toEqual([[200, 50, 300, 100]]);
  });
});

describe("pdfDate", () => {
  it.each([
    ["D:20250227173006-08'00'", Date.UTC(2025, 1, 28, 1, 30, 6)],
    ["D:20240101120000Z", Date.UTC(2024, 0, 1, 12)],
    ["D:2024", Date.UTC(2024, 0, 1)],
    ["20240315103000+01'00", Date.UTC(2024, 2, 15, 9, 30)],
    ["garbage", null],
    [null, null],
  ])("%s", (input, expected) => {
    expect(pdfDate(input)).toBe(expected);
  });
});

describe("nearestCategory", () => {
  it("picks the closest colour", () => {
    expect(nearestCategory("#ffff00", DEFAULT_CATEGORIES)?.name).toBe("Highlight");
    expect(nearestCategory("#7df066", DEFAULT_CATEGORIES)?.name).toBe("Method"); // Okular's green
    expect(nearestCategory("#ff0000", DEFAULT_CATEGORIES)?.name).toBe("Important");
    expect(nearestCategory("#0000ff", DEFAULT_CATEGORIES)?.name).toBe("Definition");
    expect(nearestCategory("#ffa500", DEFAULT_CATEGORIES)?.name).toBe("Highlight"); // orange
    expect(nearestCategory("#800080", DEFAULT_CATEGORIES)?.name).toBe("Question");
    expect(nearestCategory(null, DEFAULT_CATEGORIES)?.name).toBe("Highlight");
    expect(nearestCategory("#ff0000", [{ ...DEFAULT_CATEGORIES[1], deleted: true }])).toBeUndefined();
  });
});

describe("textUnderRects", () => {
  // Two lines of 10 pt text, 6 pt per character.
  const item = (str: string, x: number, y: number, hasEOL = true): TextItemLike => ({
    str,
    transform: [10, 0, 0, 10, x, y],
    width: str.length * 6,
    height: 10,
    hasEOL,
  });
  const items = [item("The ﬁrst line is hyphen-", 100, 700), item("ated across two lines.", 100, 688)];
  const page = buildPageText(items);

  it("finds the text a highlight covers, as printed", () => {
    // "first line is hyphen-" … "ated": from "ﬁrst" on line 1 to "ated" on line 2.
    const t = textUnderRects(page, items, [
      [124, 698, 250, 710],
      [100, 686, 124, 698],
    ])!;
    expect(t.quote).toBe("ﬁrst line is hyphenated");
    expect(page.text.slice(t.textStart, t.textEnd)).toBe("first line is hyphenated");
    expect(t.prefix).toBe("the ");
    expect(t.suffix).toBe(" across two lines.");
  });

  it("is null over no text", () => {
    expect(textUnderRects(page, items, [[0, 0, 50, 50]])).toBeNull();
  });
});

const PAPER = "C:/Users/amcle/Documents/Academia/Library/BaconDorrC.pdf";
describe.skipIf(!existsSync(PAPER))("the Okular highlights in BaconDorrC.pdf", () => {
  it("become highlights with the text under them", async () => {
    const data = new Uint8Array(readFileSync(PAPER));
    const pdf = (await getDocument({ data, verbosity: 0 }).promise) as unknown as PDFDocumentProxy;
    const found = await findPdfAnnotations(pdf, new Map());
    const highlights = found.filter((f) => f.kind === "highlight");
    expect(highlights.length).toBe(105);
    const created = await toNewAnnotations(pdf, { workId: "w", fileId: "f" }, highlights, DEFAULT_CATEGORIES);
    const quotes = created.map((a) => a.quote ?? "");
    // Every highlight is over text (two cover just "2." and "." on purpose).
    expect(quotes.filter((q) => q === "")).toEqual([]);
    expect(quotes.reduce((n, q) => n + q.length, 0) / quotes.length).toBeGreaterThan(40);
    expect(quotes).toContain("Classicism’");
    // Okular's green highlights become Method, the green category.
    const greens = created.filter((_, i) => highlights[i].colour === "#7df066");
    expect(greens.length).toBeGreaterThan(50);
    expect(new Set(greens.map((a) => a.categoryId))).toEqual(new Set(["default-5"]));
    expect(created[0].placement.page).toBe(6);
    await pdf.loadingTask.destroy();
  }, 60_000);
});
