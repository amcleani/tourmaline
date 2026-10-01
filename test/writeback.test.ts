import type { Annotation } from "../src/annotations/types";
import { annotationsToWrite } from "../src/annotations/writeback";
import { highlightVariables } from "../src/vault/notes";

const categories = [{ id: "c1", name: "Highlight", colour: "#f7d14c", callout: "quote", hotkey: 1, deleted: false }];

const base: Annotation = {
  id: "0190a-1",
  workId: "w",
  kind: "highlight",
  categoryId: "c1",
  colour: null,
  note: "n",
  quote: "q",
  prefix: null,
  suffix: null,
  imagePath: null,
  blockId: "hl-aaaaaa",
  source: "tourmaline",
  created: 1,
  updated: 2,
  placement: {
    page: 4,
    geometry: {
      rects: [
        [4, 10, 20, 100, 30],
        [5, 10, 700, 50, 710],
      ],
    },
    textStart: 0,
    textEnd: 5,
    status: "exact",
  },
  fallback: null,
};

describe("annotationsToWrite", () => {
  it("writes one PDF annotation per page, named by id", () => {
    const list = annotationsToWrite([base], categories);
    expect(list.map((w) => [w.id, w.name, w.page, w.rects, w.pdfRef])).toEqual([
      ["0190a-1", "0190a-1", 4, [[10, 20, 100, 30]], null],
      ["0190a-1#5", "0190a-1#5", 5, [[10, 700, 50, 710]], null],
    ]);
    expect(list[0]).toMatchObject({ colour: "#f7d14c", note: "n", kind: "highlight" });
  });

  it("keeps an imported annotation's own name and object", () => {
    const imported: Annotation = {
      ...base,
      source: "imported",
      sourceNm: "nm:okular-{40b3}",
      colour: "#7df066",
      placement: { ...base.placement!, geometry: { rects: [[4, 1, 2, 3, 4]] }, pdfRef: "1571R" },
    };
    expect(annotationsToWrite([imported], categories)[0]).toMatchObject({
      name: "okular-{40b3}",
      pdfRef: "1571R",
      colour: "#7df066",
    });
    // Imported without a name: named by its id like Tourmaline's own.
    expect(annotationsToWrite([{ ...imported, sourceNm: "pos:Highlight:4:1,2,3,4" }], categories)[0].name).toBe("0190a-1");
  });

  it("leaves out orphans and ink", () => {
    const orphan = { ...base, placement: { ...base.placement!, status: "orphan" as const } };
    expect(annotationsToWrite([orphan, { ...base, kind: "ink" }, { ...base, placement: null }], categories)).toEqual([]);
  });
});

describe("{{pdfLink}}", () => {
  it("links to the annotation in Obsidian's PDF viewer once it is in the file", () => {
    const placed = { ...base, placement: { ...base.placement!, pdfRef: "412R" } };
    const v = (a: Annotation) => highlightVariables({ annotation: a, category: undefined, pageLabel: "5", fileName: "Goodman2023GG.pdf" });
    expect(v(placed).pdfLink).toBe("[[Goodman2023GG.pdf#page=5&annotation=412R]]");
    expect(v(base).pdfLink).toBe("");
  });
});
