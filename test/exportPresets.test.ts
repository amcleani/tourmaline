import type { Annotation, Category } from "../src/annotations/types";
import type { OutlineNode } from "../src/pdf/outline";
import {
  blockIds,
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_PRESET,
  defaultPreset,
  EVERYTHING,
  exportable,
  groupAnnotations,
  groupHeadingLevel,
  highlightTemplateFor,
  NO_CATEGORY,
  parseExportSettings,
  passes,
  renderSection,
  UNPLACED_GROUP,
  type ExportPreset,
} from "../src/vault/export";

const categories: Category[] = [
  { id: "c1", name: "Claim", colour: "#f7d14c", callout: "quote", hotkey: 1, deleted: false },
  { id: "c2", name: "Question", colour: "#4ca3f7", callout: "question", hotkey: 2, deleted: false },
];

const at = (id: string, page: number, top: number, extra: Partial<Annotation> = {}): Annotation => ({
  id,
  workId: "0190a0b0-0000-7000-8000-000000000000",
  kind: "highlight",
  categoryId: "c1",
  colour: null,
  note: "",
  quote: `quote ${id}`,
  prefix: null,
  suffix: null,
  imagePath: null,
  blockId: `hl-${id.padStart(6, "0")}`,
  source: "tourmaline",
  created: 1,
  updated: 1,
  placement: { page, geometry: { rects: [[page, 10, top - 10, 100, top]] }, textStart: 0, textEnd: 1, status: "exact" },
  fallback: null,
  ...extra,
});
const unplaced = (id: string, extra: Partial<Annotation> = {}) =>
  at(id, 0, 0, { placement: { ...at(id, 0, 0).placement!, status: "orphan" }, ...extra });

const LIST = [
  at("1", 0, 700, { note: "my comment" }),
  at("2", 0, 500, { categoryId: "c2" }),
  at("3", 1, 600, { kind: "area" }),
  at("4", 2, 300, { categoryId: null, note: "  " }),
  unplaced("5", { categoryId: "c2", note: "lost but noted" }),
  at("6", 2, 100, { kind: "ink" }),
];

const input = (annotations: Annotation[], outline: OutlineNode[] | null = null) => ({
  annotations,
  categories,
  pageLabel: (p: number) => String(p + 1),
  entry: { citekey: "Goodman2023GG", title: "Grounding Generalizations" },
  outline,
});

const preset = (patch: Partial<ExportPreset["filter"]> = {}, groupBy: ExportPreset["groupBy"] = "none"): ExportPreset => ({
  id: "p",
  name: "P",
  filter: { ...EVERYTHING, ...patch },
  groupBy,
});

const ids = (list: Annotation[]) => list.map((a) => a.id);

describe("export filters", () => {
  it("let everything but ink through by default", () => {
    expect(ids(exportable(LIST))).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("choose by note, kind, category and placement", () => {
    // Only annotations with a note: blank notes don't count.
    expect(ids(exportable(LIST, preset({ withNote: true }).filter))).toEqual(["1", "5"]);
    expect(ids(exportable(LIST, preset({ kinds: ["area"] }).filter))).toEqual(["3"]);
    expect(ids(exportable(LIST, preset({ categories: ["c2"] }).filter))).toEqual(["2", "5"]);
    expect(ids(exportable(LIST, preset({ categories: [NO_CATEGORY] }).filter))).toEqual(["4"]);
    expect(ids(exportable(LIST, preset({ includeUnplaced: false }).filter))).toEqual(["1", "2", "3", "4"]);
    expect(passes(LIST[5], { ...EVERYTHING, kinds: ["highlight", "area", "note"] })).toBe(false);
  });
});

describe("grouping", () => {
  it("by category, in the categories' order, those without one last", () => {
    const groups = groupAnnotations(exportable(LIST), "category", categories, null);
    expect(groups.map((g) => [g.title, ids(g.annotations)])).toEqual([
      ["Claim", ["1", "3"]],
      ["Question", ["2", "5"]],
      ["No category", ["4"]],
    ]);
  });

  it("by section: the last outline entry before each annotation, the deeper one at the same place", () => {
    const outline: OutlineNode[] = [
      {
        id: "a",
        title: "1 Introduction",
        target: { page: 0, y: 600 },
        children: [{ id: "a1", title: "1.1 Aims", target: { page: 0, y: 600 }, children: [] }],
      },
      { id: "b", title: "2 Grounding", target: { page: 1, y: null }, children: [] },
      { id: "c", title: "No target", target: null, children: [] },
    ];
    const groups = groupAnnotations(exportable(LIST), "section", categories, outline);
    expect(groups.map((g) => [g.title, ids(g.annotations)])).toEqual([
      ["Before “1 Introduction”", ["1"]],
      ["1.1 Aims", ["2"]],
      ["2 Grounding", ["3", "4"]],
      [UNPLACED_GROUP, ["5"]],
    ]);
    // A paper without an outline isn't grouped.
    expect(groupAnnotations(exportable(LIST), "section", categories, []).map((g) => g.title)).toEqual([null]);
  });

  it("puts subheadings one level below the export heading", () => {
    expect(groupHeadingLevel({ destination: "heading", heading: "# Annotations" })).toBe(2);
    expect(groupHeadingLevel({ destination: "heading", heading: "### Deep" })).toBe(4);
    expect(groupHeadingLevel({ destination: "heading", heading: "###### Deepest" })).toBe(6);
    expect(groupHeadingLevel({ destination: "note", heading: "# Annotations" })).toBe(2);
  });
});

describe("rendering with a preset", () => {
  it("writes the done-when: a 'Comments' preset, with notes only, grouped by category", () => {
    const comments = preset({ withNote: true }, "category");
    const text = renderSection(DEFAULT_EXPORT_SETTINGS, input(LIST), comments);
    expect([...blockIds(text)]).toEqual(["hl-000001", "hl-000005"]);
    expect(text.startsWith("## Claim\n\n> [!quote]")).toBe(true);
    expect(text).toContain("^hl-000001\n\n## Question\n\n> [!question]");
    expect(text.endsWith("^hl-000005")).toBe(true);
  });

  it("is unchanged without a preset (the same as before presets existed)", () => {
    expect(renderSection(DEFAULT_EXPORT_SETTINGS, input(LIST))).toBe(renderSection(DEFAULT_EXPORT_SETTINGS, input(LIST), DEFAULT_PRESET));
    expect(renderSection(DEFAULT_EXPORT_SETTINGS, input(LIST))).not.toContain("##");
  });

  it("uses a category's own template for its annotations", () => {
    const s = { ...DEFAULT_EXPORT_SETTINGS, categoryTemplates: { c2: "- [ ] {{quote}} ^{{blockId}}" } };
    const text = renderSection(s, input(LIST), preset({ kinds: ["highlight"], includeUnplaced: false }));
    expect(text).toContain("- [ ] quote 2 ^hl-000002");
    expect(text).toContain("> [!quote] [p. 1]");
    expect(highlightTemplateFor(s, "c2")).toBe("- [ ] {{quote}} ^{{blockId}}");
    expect(highlightTemplateFor(s, "c1")).toBe(s.highlightTemplate);
    expect(highlightTemplateFor(s, null)).toBe(s.highlightTemplate);
  });
});

describe("saved presets", () => {
  it("start with Everything, and old settings get it", () => {
    const s = parseExportSettings(JSON.stringify({ heading: "# Notes" }));
    expect(s.presets).toEqual([DEFAULT_PRESET]);
    expect(defaultPreset(s)).toEqual(DEFAULT_PRESET);
    expect(s.categoryTemplates).toEqual({});
  });

  it("read back what was saved, dropping what can't be used", () => {
    const comments = preset({ withNote: true, categories: ["c1"] }, "category");
    const saved = {
      presets: [
        { ...comments, id: "comments", name: " Comments " },
        { id: "comments", name: "Duplicate id", filter: {} },
        { id: "", name: "No id" },
        { id: "x", name: "Odd", filter: { kinds: ["highlight", "ink", 3], categories: "c1" }, groupBy: "colour" },
      ],
      defaultPreset: "comments",
      categoryTemplates: { c1: "{{quote}}", c2: "   ", c3: 4 },
    };
    const s = parseExportSettings(JSON.stringify(saved));
    expect(s.presets.map((p) => [p.id, p.name])).toEqual([
      ["comments", "Comments"],
      ["x", "Odd"],
    ]);
    expect(s.presets[0].filter).toEqual(comments.filter);
    expect(s.presets[1]).toMatchObject({ filter: { kinds: ["highlight"], categories: null }, groupBy: "none" });
    expect(defaultPreset(s).id).toBe("comments");
    expect(s.categoryTemplates).toEqual({ c1: "{{quote}}" });
    // A default that no longer exists falls back to the first.
    expect(defaultPreset(parseExportSettings(JSON.stringify({ ...saved, defaultPreset: "gone" }))).id).toBe("comments");
  });
});
