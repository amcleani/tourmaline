import type { Annotation } from "../src/annotations/types";
import type { DocumentInfo } from "../src/platform";

// A library, vault and app state in memory.
const notes = new Map<string, { text: string; version: number }>();
const state = new Map<string, string>();
let works: DocumentInfo[] = [];
const library = new Map<string, Annotation[]>();
const changedFiles = new Set<string>();
vi.mock("../src/platform", () => ({
  annotatedWorks: vi.fn(async () => works),
  listAnnotations: vi.fn(async (workId: string) => library.get(workId) ?? []),
  readPdf: vi.fn(async (_path: string, fileId: string) => {
    if (changedFiles.has(fileId)) throw new Error("it has changed since Tourmaline last opened it");
    return new Uint8Array([1]);
  }),
  readNote: vi.fn(async (_vault: string, path: string) => {
    const n = notes.get(path);
    return n ? { text: n.text, sha256: String(n.version) } : null;
  }),
  writeNote: vi.fn(async (_vault: string, path: string, text: string) => {
    notes.set(path, { text, version: (notes.get(path)?.version ?? 0) + 1 });
  }),
  exportImage: vi.fn(async () => ""),
  findBlockLinks: vi.fn(async () => []),
  getState: vi.fn(async (key: string) => state.get(key) ?? null),
  setState: vi.fn(async (key: string, value: string) => void state.set(key, value)),
}));
// Page labels "i", "ii"…: the export must use the PDF's own.
vi.mock("../src/pdf/loader", () => ({
  loadPdf: vi.fn(async () => ({
    getPageLabels: async () => ["i", "ii", "iii", "iv", "v"],
    loadingTask: { destroy: async () => {} },
  })),
}));

import { Bibliography } from "../src/vault/bibliography";
import { DEFAULT_EXPORT_SETTINGS, DEFAULT_PRESET } from "../src/vault/export";
import { changesSince, describeChanges, exportPapers, papersToExport } from "../src/vault/exportAll";
import type { VaultSettings } from "../src/vault/notes";
import { runExport } from "../src/vault/runExport";

const citations: VaultSettings["citations"] = {
  enabled: true,
  format: "biblatex",
  bibliography: null,
  noteTitleTemplate: "@{{citekey}}",
  noteFolder: "Notes",
  noteTemplate: "",
};
const vaultSettings: VaultSettings = { name: "V", citations, attachmentFolder: null, strictLineBreaks: false, newLinkFormat: "shortest" };
const bibliography = new Bibliography(`
@article{Alpha2020, title = {Alpha Paper}, author = {A, B}}
@article{Beta2021, title = {Beta Paper}, author = {C, D}}
@article{Gamma2022, title = {Gamma Paper}, author = {E, F}}
@article{Delta2023, title = {Delta Paper}, author = {G, H}}
`, "C:/vault/database.bib");

const doc = (n: string, citekey: string | null): DocumentInfo => ({
  fileId: `f-${n}`,
  workId: `w-${n}`,
  path: `C:/lib/${n}.pdf`,
  name: `${n}.pdf`,
  size: 1,
  lastOpened: 0,
  citekey,
});
const hl = (work: string, n: number, extra: Partial<Annotation> = {}): Annotation => ({
  id: `${work}-${n}`,
  workId: `w-${work}`,
  kind: "highlight",
  categoryId: null,
  colour: null,
  note: "",
  quote: `quote ${n}`,
  prefix: null,
  suffix: null,
  imagePath: null,
  blockId: `hl-${work}0000${n}`.slice(0, 9),
  source: "tourmaline",
  created: n,
  updated: n,
  placement: { page: n, geometry: { rects: [[n, 0, 0, 1, 1]] }, textStart: 0, textEnd: 1, status: "exact" },
  fallback: null,
  ...extra,
});

const asked: unknown[] = [];
const job = () => ({
  vault: "C:/vault",
  vaultSettings,
  settings: DEFAULT_EXPORT_SETTINGS,
  preset: DEFAULT_PRESET,
  categories: [],
  ask: async (q: unknown) => {
    asked.push(q);
    return true;
  },
});

/** A whole export of a paper as the app does it, so it has a record. */
async function exportNow(work: string, citekey: string) {
  await runExport({
    ...job(),
    workId: `w-${work}`,
    input: { annotations: library.get(`w-${work}`) ?? [], categories: [], pageLabel: (p) => String(p + 1), entry: { citekey } },
  });
}

beforeEach(() => {
  notes.clear();
  state.clear();
  library.clear();
  changedFiles.clear();
  asked.length = 0;
  works = [];
});

describe("changes since the last export", () => {
  it("counts annotations made since, those edited since they were written, and blocks gone", () => {
    const record = { exportedAt: 10, blocks: { "hl-a00001": "x", "hl-a00002": "y", "hl-a00009": "z" }, writtenAt: { "hl-a00002": 30 } };
    const list = [
      hl("a", 1, { updated: 20 }), // edited after the export
      hl("a", 2, { updated: 20 }), // edited, but written again later by Export selected
      hl("a", 3, { created: 15, updated: 15 }), // new
      hl("a", 4), // older, left out on purpose
      hl("a", 5, { kind: "ink", created: 50, updated: 50 }),
    ];
    const c = changesSince(record, list);
    expect(c).toEqual({ added: 1, changed: 1, deleted: 1 });
    expect(describeChanges(c)).toBe("1 new, 1 changed, 1 deleted");
  });
});

describe("papers to export", () => {
  it("lists exported papers whose annotations changed, and those exported before records were kept", async () => {
    works = [doc("a", "Alpha2020"), doc("b", "Beta2021"), doc("c", "Gamma2022"), doc("d", "Delta2023"), doc("e", "NotInBib"), doc("f", null)];
    library.set("w-a", [hl("a", 1)]);
    library.set("w-b", [hl("b", 1)]);
    library.set("w-d", [hl("d", 1)]);
    await exportNow("a", "Alpha2020");
    await exportNow("b", "Beta2021");
    // Alpha changes after its export; Beta doesn't; Gamma was never exported;
    // Delta was exported before records were kept.
    library.set("w-a", [hl("a", 1, { note: "new note", updated: Date.now() + 1000 })]);
    state.set("export.section:w-d:Notes/@Delta2023.md", "hash");
    const papers = await papersToExport(citations, DEFAULT_EXPORT_SETTINGS, bibliography);
    expect(papers.map((p) => [p.citekey, p.title, p.notePath, p.changes])).toEqual([
      ["Alpha2020", "Alpha Paper", "Notes/@Alpha2020.md", { added: 0, changed: 1, deleted: 0 }],
      ["Delta2023", "Delta Paper", "Notes/@Delta2023.md", null],
    ]);
  });
});

describe("exporting the papers", () => {
  it("exports each with its PDF's page labels, goes on past one that fails, and asks the usual questions", async () => {
    works = [doc("a", "Alpha2020"), doc("b", "Beta2021")];
    library.set("w-a", [hl("a", 1), hl("a", 2)]);
    library.set("w-b", [hl("b", 1)]);
    const papers = [
      { doc: works[0], citekey: "Alpha2020", title: "", entry: { citekey: "Alpha2020" }, notePath: "", annotations: [], changes: null },
      { doc: works[1], citekey: "Beta2021", title: "", entry: { citekey: "Beta2021" }, notePath: "", annotations: [], changes: null },
    ];
    changedFiles.add("f-b");
    const seen: string[] = [];
    const results = await exportPapers(papers, { ...job(), onPaper: (i, p) => seen.push(`${i}:${p.citekey}`) });
    expect(seen).toEqual(["0:Alpha2020", "1:Beta2021"]);
    expect(results[0].outcome).toMatchObject({ status: "written", count: 2, path: "Notes/@Alpha2020.md" });
    expect(notes.get("Notes/@Alpha2020.md")!.text).toContain("[p. ii]");
    expect(String(results[1].error)).toContain("has changed");
    expect(notes.has("Notes/@Beta2021.md")).toBe(false);

    // A highlight removed: the preview is asked, as for a single export.
    library.set("w-a", [hl("a", 1)]);
    await exportPapers([papers[0]], job());
    expect(asked).toMatchObject([{ kind: "preview", plan: { removed: [{ blockId: "hl-a00002" }] } }]);
  });

  it("stops when told to", async () => {
    works = [doc("a", "Alpha2020")];
    const papers = [{ doc: works[0], citekey: "Alpha2020", title: "", entry: { citekey: "Alpha2020" }, notePath: "", annotations: [], changes: null }];
    expect(await exportPapers(papers, { ...job(), stopped: () => true })).toEqual([]);
  });
});
