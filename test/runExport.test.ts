import type { Annotation } from "../src/annotations/types";

// A vault of notes in memory; a note's "sha256" is a version counter.
const notes = new Map<string, { text: string; version: number }>();
const state = new Map<string, string>();
const images: string[] = [];
let links: { path: string; blockId: string }[] = [];
vi.mock("../src/platform", () => ({
  readNote: vi.fn(async (_vault: string, path: string) => {
    const n = notes.get(path);
    return n ? { text: n.text, sha256: String(n.version) } : null;
  }),
  writeNote: vi.fn(async (_vault: string, path: string, text: string, expected: string | null) => {
    const n = notes.get(path);
    if ((n ? String(n.version) : null) !== expected) throw new Error("changed");
    notes.set(path, { text, version: (n?.version ?? 0) + 1 });
  }),
  exportImage: vi.fn(async (_vault: string, _id: string, folder: string, name: string) => {
    images.push(`${folder}/${name}`);
    return `${folder}/${name}`;
  }),
  findBlockLinks: vi.fn(async (_vault: string, ids: string[]) => links.filter((l) => ids.includes(l.blockId))),
  getState: vi.fn(async (key: string) => state.get(key) ?? null),
  setState: vi.fn(async (key: string, value: string) => void state.set(key, value)),
}));

import { DEFAULT_EXPORT_SETTINGS, DEFAULT_PRESET } from "../src/vault/export";
import type { VaultSettings } from "../src/vault/notes";
import { runExport, type ExportJob, type ExportQuestion } from "../src/vault/runExport";

const vaultSettings: VaultSettings = {
  name: "Academia",
  citations: {
    enabled: true,
    format: "biblatex",
    bibliography: null,
    noteTitleTemplate: "@{{citekey}}",
    noteFolder: "Obsidian/Library",
    noteTemplate: '---\nTitle: "{{title}}"\n---\n\n',
  },
  attachmentFolder: "Obsidian/Attatchments",
  strictLineBreaks: false,
  newLinkFormat: "shortest",
};

const highlight = (n: number, extra: Partial<Annotation> = {}): Annotation => ({
  id: `id-${n}`,
  workId: "0190a0b0-0000-7000-8000-000000000000",
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
  placement: { page: n, geometry: { rects: [[n, 0, 0, 1, 1]] }, textStart: 0, textEnd: 1, status: "exact" },
  fallback: null,
  ...extra,
});

const PATH = "Obsidian/Library/@Goodman2023GG.md";
let asked: ExportQuestion[] = [];
let answer = true;
const job = (annotations: Annotation[]): ExportJob => ({
  vault: "C:/vault",
  vaultSettings,
  settings: DEFAULT_EXPORT_SETTINGS,
  preset: DEFAULT_PRESET,
  workId: "w",
  input: {
    annotations,
    categories: [],
    pageLabel: (p) => String(p + 1),
    entry: { citekey: "Goodman2023GG", title: "Grounding Generalizations" },
  },
  ask: async (q) => {
    asked.push(q);
    return answer;
  },
});
const run = (annotations: Annotation[]) => runExport(job(annotations));

beforeEach(() => {
  notes.clear();
  state.clear();
  images.length = 0;
  links = [];
  asked = [];
  answer = true;
});

describe("runExport", () => {
  it("creates the literature note from the Citations template, then keeps it up to date", async () => {
    expect(await run([highlight(1)])).toMatchObject({ status: "written", path: PATH, created: true, count: 1 });
    const text = notes.get(PATH)!.text;
    expect(text).toMatch(/^---\nTitle: "Grounding Generalizations"\n---\n\n# Annotations\n\n%% tourmaline:begin %%\n> \[!quote\]/);
    expect(await run([highlight(1)])).toMatchObject({ status: "unchanged" });

    // The user writes around the section; the next export keeps it.
    notes.set(PATH, { text: text.replace("# Annotations", "# Summary\nMine.\n\n# Annotations") + "\nAfter.\n", version: 9 });
    expect(await run([highlight(1), highlight(2)])).toMatchObject({ status: "written", created: false, count: 2 });
    const after = notes.get(PATH)!.text;
    expect(after).toContain("# Summary\nMine.\n\n# Annotations\n\n%% tourmaline:begin %%");
    expect(after).toContain("^hl-000002\n%% tourmaline:end %%\n\nAfter.\n");
    expect(asked).toEqual([]);
  });

  it("asks before replacing edits made inside the section", async () => {
    await run([highlight(1)]);
    const edited = notes.get(PATH)!.text.replace("quote 1", "quote 1 (my edit)");
    notes.set(PATH, { text: edited, version: 5 });
    answer = false;
    expect(await run([highlight(1), highlight(2)])).toMatchObject({ status: "cancelled" });
    expect(notes.get(PATH)!.text).toBe(edited);
    expect(asked).toEqual([{ kind: "edited", path: PATH }]);
    answer = true;
    expect(await run([highlight(1), highlight(2)])).toMatchObject({ status: "written" });
    expect(notes.get(PATH)!.text).not.toContain("my edit");
  });

  it("asks before removing highlights that notes link to", async () => {
    await run([highlight(1), highlight(2), highlight(3)]);
    links = [{ path: "Ideas.md", blockId: "hl-000002" }];
    // A link from the note itself, outside the section, counts too.
    notes.set(PATH, { text: notes.get(PATH)!.text + "\nSee [[#^hl-000003]].\n", version: 7 });
    answer = false;
    expect(await run([highlight(1)])).toMatchObject({ status: "cancelled" });
    expect(asked).toEqual([
      {
        kind: "links",
        path: PATH,
        links: [
          { path: PATH, blockId: "hl-000003" },
          { path: "Ideas.md", blockId: "hl-000002" },
        ],
      },
    ]);
    // Removing one nobody links to doesn't ask.
    asked = [];
    links = [];
    notes.set(PATH, { text: notes.get(PATH)!.text.replace("\nSee [[#^hl-000003]].\n", ""), version: 8 });
    expect(await run([highlight(1), highlight(2)])).toMatchObject({ status: "written" });
    expect(asked).toEqual([]);
  });

  it("counts a link from another highlight's note in the section", async () => {
    await run([highlight(1), highlight(2, { note: "Compare [[#^hl-000001]]" })]);
    answer = false;
    expect(await run([highlight(2, { note: "Compare [[#^hl-000001]]" })])).toMatchObject({ status: "cancelled" });
    expect(asked).toEqual([{ kind: "links", path: PATH, links: [{ path: PATH, blockId: "hl-000001" }] }]);
  });

  it("remembers what it wrote in each note, so switching where highlights go doesn't look like an edit", async () => {
    await run([highlight(1)]);
    const separate = { ...DEFAULT_EXPORT_SETTINGS, destination: "note" as const };
    await runExport({ ...job([highlight(1)]), settings: separate });
    expect(notes.has("Obsidian/Library/@Goodman2023GG highlights.md")).toBe(true);
    expect(await run([highlight(1), highlight(2)])).toMatchObject({ status: "written" });
    expect(asked).toEqual([]);
  });

  it("refuses a section that wouldn't read back, e.g. a note with an unclosed code block", async () => {
    const bare = { ...DEFAULT_EXPORT_SETTINGS, highlightTemplate: "{{note}}\n" };
    await expect(runExport({ ...job([highlight(1, { note: "```js\nx" })]), settings: bare })).rejects.toThrow(/read back/);
    expect(notes.size).toBe(0);
  });

  it("copies area images into the attachment folder and embeds them", async () => {
    await run([highlight(4, { kind: "area", quote: null, imagePath: "attachments/id-4.png" })]);
    expect(images).toEqual(["Obsidian/Attatchments/tourmaline-hl-000004.png"]);
    expect(notes.get(PATH)!.text).toContain("> ![[tourmaline-hl-000004.png]]");
  });

  it("refuses a note whose section markers are muddled, writing nothing", async () => {
    notes.set(PATH, { text: "%% tourmaline:end %%\n%% tourmaline:begin %%\n", version: 1 });
    await expect(run([highlight(1)])).rejects.toThrow(/unclear/);
    expect(notes.get(PATH)!.version).toBe(1);
  });

  it("writes only what the preset's filter lets through, and counts both", async () => {
    const area = highlight(4, { kind: "area", quote: null, imagePath: "attachments/id-4.png" });
    const comments = { ...DEFAULT_PRESET, id: "c", name: "Comments", filter: { ...DEFAULT_PRESET.filter, withNote: true } };
    const result = await runExport({ ...job([highlight(1, { note: "mine" }), highlight(2), area]), preset: comments });
    expect(result).toMatchObject({ status: "written", count: 1, total: 3 });
    const text = notes.get(PATH)!.text;
    expect(text).toContain("^hl-000001");
    expect(text).not.toContain("^hl-000002");
    // The area isn't written, so its image isn't copied.
    expect(images).toEqual([]);
  });
});
