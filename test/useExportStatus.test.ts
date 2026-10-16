import { renderHook, waitFor } from "@testing-library/react";
import type { Annotation } from "../src/annotations/types";

const state = new Map<string, string>();
vi.mock("../src/platform", () => ({
  getState: vi.fn(async (key: string) => state.get(key) ?? null),
}));

import { DEFAULT_EXPORT_SETTINGS, normaliseSection, renderAnnotation, type SectionInput } from "../src/vault/export";
import { useExportStatus } from "../src/vault/useExportStatus";

const at = (n: number, extra: Partial<Annotation> = {}): Annotation => ({
  id: `id-${n}`,
  workId: "w",
  kind: "highlight",
  categoryId: null,
  colour: null,
  note: "",
  quote: `quote ${n}`,
  prefix: null,
  suffix: null,
  imagePath: null,
  blockId: `hl-00000${n}`,
  source: "tourmaline",
  created: n,
  updated: n,
  placement: { page: 0, geometry: { rects: [[0, 0, 0, 1, 1]] }, textStart: 0, textEnd: 1, status: "exact" },
  fallback: null,
  ...extra,
});

const input = (annotations: Annotation[]): SectionInput => ({
  annotations,
  categories: [],
  pageLabel: (p) => String(p + 1),
  entry: { citekey: "Goodman2023GG" },
  outline: null,
});
const target = { workId: "w", path: "Obsidian/Library/@Goodman2023GG.md" };
const KEY = `export.blocks:w:${target.path}`;
const wrote = (a: Annotation) => normaliseSection(renderAnnotation(DEFAULT_EXPORT_SETTINGS, input([a]), a));

describe("useExportStatus", () => {
  beforeEach(() => state.clear());

  it("shows nothing for a paper never exported, or without a note to export to", async () => {
    const { result } = renderHook(() => useExportStatus(target, input([at(1)]), DEFAULT_EXPORT_SETTINGS, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
    const none = renderHook(() => useExportStatus(null, input([at(1)]), DEFAULT_EXPORT_SETTINGS, 0));
    expect(none.result.current).toBeNull();
  });

  it("compares the annotations with the record, and reads it again after an export", async () => {
    state.set(KEY, JSON.stringify({ exportedAt: 10, blocks: { "hl-000001": wrote(at(1)) } }));
    const list = [at(1, { note: "changed" }), at(2, { created: 20 })];
    const { result, rerender } = renderHook(({ exports }) => useExportStatus(target, input(list), DEFAULT_EXPORT_SETTINGS, exports), {
      initialProps: { exports: 0 },
    });
    await waitFor(() => expect(result.current?.count).toBe(2));
    expect([...result.current!.byId]).toEqual([
      ["id-1", "changed"],
      ["id-2", "new"],
    ]);
    // An export wrote both.
    state.set(KEY, JSON.stringify({ exportedAt: 30, blocks: { "hl-000001": wrote(list[0]), "hl-000002": wrote(list[1]) } }));
    rerender({ exports: 1 });
    await waitFor(() => expect(result.current?.count).toBe(0));
  });
});
