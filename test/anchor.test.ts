import { buildPageText, type TextItemLike } from "../src/pdf/search";
import { reanchor, type PageSource } from "../src/annotations/anchor";
import type { Annotation, Placement } from "../src/annotations/types";

const item = (str: string): TextItemLike => ({
  str,
  transform: [10, 0, 0, 10, 72, 700],
  width: str.length * 5,
  height: 10,
  hasEOL: false,
});

function pages(...texts: string[]): (page: number) => Promise<PageSource> {
  return async (page) => {
    const items = [item(texts[page])];
    return { text: buildPageText(items), items, hash: `h:${texts[page]}` };
  };
}

const oldPlacement: Placement = {
  page: 1,
  geometry: { rects: [[1, 1, 2, 3, 4]] },
  textStart: 6,
  textEnd: 13,
  status: "exact",
};

function annotation(over: Partial<Annotation> = {}): Pick<Annotation, "quote" | "prefix" | "suffix" | "fallback"> {
  return {
    quote: "Theorem",
    prefix: "a new ",
    suffix: " about",
    fallback: { fileId: "old", placement: oldPlacement, pageHash: "h:a new theorem about sets" },
    ...over,
  };
}

describe("reanchor", () => {
  it("keeps the geometry when the page text is unchanged", async () => {
    const p = await reanchor(annotation(), 3, pages("x", "a new theorem about sets", "y"));
    expect(p).toEqual({ ...oldPlacement, status: "exact" });
  });

  it("finds a passage that moved to another page", async () => {
    const p = await reanchor(annotation(), 3, pages("intro", "changed page", "and a new theorem about sets"));
    expect(p.status).toBe("moved");
    expect(p.page).toBe(2);
    expect(p.textStart).toBe(10);
    expect(p.geometry.rects[0][0]).toBe(2);
  });

  it("prefers the occurrence whose context matches", async () => {
    const p = await reanchor(annotation(), 2, pages("the theorem is false", "we state a new theorem about sets"));
    expect(p.page).toBe(1);
    expect(p.status).toBe("moved");
  });

  it("marks a quote found without its context as fuzzy", async () => {
    const p = await reanchor(annotation(), 2, pages("unrelated", "this theorem differs"));
    expect(p.status).toBe("fuzzy");
    expect(p.page).toBe(1);
  });

  it("orphans a quote that is gone", async () => {
    const p = await reanchor(annotation(), 2, pages("nothing", "here"));
    expect(p.status).toBe("orphan");
    expect(p.geometry.rects).toEqual([]);
  });

  it("keeps an area on its page, flagged, when the text changed", async () => {
    const area = annotation({ quote: null, prefix: null, suffix: null });
    expect((await reanchor(area, 3, pages("a", "b", "c"))).status).toBe("fuzzy");
    expect((await reanchor(area, 1, pages("a"))).status).toBe("orphan");
  });
});
