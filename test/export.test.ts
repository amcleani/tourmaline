import { existsSync, readdirSync, readFileSync } from "node:fs";
import Handlebars from "handlebars";
import type { Annotation } from "../src/annotations/types";
import {
  attachmentFolder,
  blockIds,
  DEFAULT_EXPORT_SETTINGS,
  exportable,
  exportNotePath,
  findRegion,
  linksToBlock,
  mergeIntoNote,
  NoteFormatError,
  normaliseSection,
  parseExportSettings,
  renderSection,
} from "../src/vault/export";
import { DEFAULT_HIGHLIGHT_TEMPLATE, highlightVariables, type VaultSettings } from "../src/vault/notes";

const categories = [{ id: "c1", name: "Highlight", colour: "#f7d14c", callout: "quote", hotkey: 1, deleted: false }];

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

const settings = DEFAULT_EXPORT_SETTINGS;
const input = (annotations: Annotation[]) => ({
  annotations,
  categories,
  pageLabel: (p: number) => String(p + 1),
  entry: { citekey: "Goodman2023GG", title: "Grounding Generalizations" },
});

describe("renderSection", () => {
  it("renders every highlight in reading order, orphans last, without ink", () => {
    const orphan = at("4", 0, 0, { placement: { ...at("4", 0, 0).placement!, status: "orphan" } });
    const list = [at("1", 2, 300), orphan, at("2", 0, 100), at("3", 0, 700), at("5", 0, 1, { kind: "ink" })];
    expect(exportable(list).map((a) => a.id)).toEqual(["3", "2", "1", "4"]);
    const text = renderSection(settings, input(list));
    expect([...blockIds(text)]).toEqual(["hl-000003", "hl-000002", "hl-000001", "hl-000004"]);
    expect(text).toContain("[p. ?](tourmaline://open?doc=");
    // Highlights are separated by a blank line, and nothing trails.
    expect(text).toContain("^hl-000003\n\n> [!quote] [p. 1]");
    expect(text.endsWith("^hl-000004")).toBe(true);
  });

  it("embeds area images", () => {
    const area = at("6", 1, 50, { kind: "area", quote: null, imagePath: "attachments/x.png", note: "A figure" });
    expect(renderSection(settings, input([area]))).toMatch(
      /^> \[!quote\] \[p\. 2\]\(tourmaline:[^)]+\)\n> !\[\[tourmaline-hl-000006\.png\]\]\n>\n> A figure\n\n\^hl-000006$/,
    );
  });

  it("matches Handlebars on the default templates", () => {
    // One-line note: with more lines, ours prefixes each with "> " (Handlebars doesn't).
    const a = at("7", 0, 10, { note: "a note" });
    const vars = { ...highlightVariables({ annotation: a, category: categories[0], pageLabel: "1" }), image: "![[i.png]]" };
    const highlight = Handlebars.compile(DEFAULT_HIGHLIGHT_TEMPLATE, { noEscape: true })(vars);
    expect(Handlebars.compile(settings.sectionTemplate, { noEscape: true })({ highlights: [{ markdown: highlight }] }).trimEnd()).toBe(
      renderSection(settings, input([{ ...a, kind: "area", imagePath: "p" }])).replace("tourmaline-hl-000007.png", "i.png"),
    );
    expect(renderSection(settings, input([{ ...a, note: "line one\n$$x$$" }]))).toContain("> line one\n> $$x$$");
  });
});

describe("findRegion", () => {
  it("finds the section between the markers, outside code and frontmatter", () => {
    const note = "---\nt: 1\n---\n```\n%% tourmaline:begin %%\n```\n%% tourmaline:begin %%\r\nA\r\n%% tourmaline:end %%\r\nafter";
    const r = findRegion(note)!;
    expect(r.body).toBe("A");
    expect(note.slice(r.end)).toBe("after");
    expect(findRegion("nothing here")).toBeNull();
    expect(() => findRegion("%% tourmaline:end %%\n%% tourmaline:begin %%")).toThrow(NoteFormatError);
    expect(() => findRegion("%% tourmaline:begin %%\n%% tourmaline:begin %%\n%% tourmaline:end %%")).toThrow(NoteFormatError);
  });
});

describe("mergeIntoNote", () => {
  const s = { destination: "heading" as const, heading: "# Annotations" };

  it("starts a new note from the note template, then the heading and section", () => {
    expect(mergeIntoNote(null, "X", s, "---\nTitle: T\n---\n\n").text).toBe(
      "---\nTitle: T\n---\n\n# Annotations\n\n%% tourmaline:begin %%\nX\n%% tourmaline:end %%\n",
    );
    expect(mergeIntoNote(null, "X", { ...s, destination: "note" }).text).toBe("%% tourmaline:begin %%\nX\n%% tourmaline:end %%\n");
  });

  it("replaces only the section, keeping everything around it", () => {
    const note = "# Summary\nmine\n# Annotations\n\n%% tourmaline:begin %%\nold\n%% tourmaline:end %%\n\nmy comment\n";
    const m = mergeIntoNote(note, "new", s);
    expect(m.previous).toBe("old");
    expect(m.text).toBe(note.replace("old", "new"));
  });

  it("goes directly under an existing heading, before what was there", () => {
    const note = "---\nTitle: x\n---\n\n# Summary\n\n# Annotations\nSource: [[x.pdf]]\n\n## Page 3\n";
    expect(mergeIntoNote(note, "new", s).text).toBe(
      "---\nTitle: x\n---\n\n# Summary\n\n# Annotations\n\n%% tourmaline:begin %%\nnew\n%% tourmaline:end %%\n\nSource: [[x.pdf]]\n\n## Page 3\n",
    );
    // A heading inside a code block or a deeper one isn't it.
    const fenced = "```\n# Annotations\n```\n## Annotations\n";
    expect(mergeIntoNote(fenced, "n", s).text).toBe(`${fenced.trimEnd()}\n\n# Annotations\n\n%% tourmaline:begin %%\nn\n%% tourmaline:end %%\n`);
  });

  it("adds the heading at the end, keeping Windows line endings", () => {
    expect(mergeIntoNote("a\r\nb\r\n\r\n", "x\ny", s).text).toBe(
      "a\r\nb\r\n\r\n# Annotations\r\n\r\n%% tourmaline:begin %%\r\nx\r\ny\r\n%% tourmaline:end %%\r\n",
    );
    expect(mergeIntoNote("# Annotations", "x", s).text).toBe("# Annotations\n\n%% tourmaline:begin %%\nx\n%% tourmaline:end %%\n");
  });

  it("leaves the frontmatter alone even if it mentions the heading", () => {
    const note = "---\nnote: |\n  # Annotations\n---\nbody\n";
    expect(mergeIntoNote(note, "x", s).text.startsWith(`${note}\n# Annotations\n`)).toBe(true);
  });
});

describe("edits and links", () => {
  it("compare section text as Obsidian shows it", () => {
    expect(normaliseSection("a  \r\nb\n\n")).toBe(normaliseSection("a\nb"));
    expect(normaliseSection("a\nb!")).not.toBe(normaliseSection("a\nb"));
  });

  it("find links to blocks, not the blocks themselves", () => {
    const note = "see [[#^hl-aaaaaa]]\n%% tourmaline:begin %%\n> q\n\n^hl-cccccc\n%% tourmaline:end %%\n";
    expect(linksToBlock(note, "hl-aaaaaa")).toBe(true);
    expect(linksToBlock(note, "hl-cccccc")).toBe(false);
    expect([...blockIds(note)]).toEqual(["hl-cccccc"]);
  });
});

describe("settings", () => {
  const citations: VaultSettings["citations"] = {
    enabled: true,
    format: "biblatex",
    bibliography: null,
    noteTitleTemplate: "@{{citekey}}",
    noteFolder: "Obsidian/Library",
    noteTemplate: "",
  };

  it("default to the Citations plugin's note, and survive bad JSON", () => {
    expect(parseExportSettings("{bad")).toEqual(DEFAULT_EXPORT_SETTINGS);
    expect(parseExportSettings('{"destination":"note","heading":"  ","highlightTemplate":"{{quote}}"}')).toMatchObject({
      destination: "note",
      heading: "# Annotations",
      highlightTemplate: "{{quote}}",
    });
    const entry = { citekey: "Goodman2023GG" };
    expect(exportNotePath(citations, DEFAULT_EXPORT_SETTINGS, entry)).toBe("Obsidian/Library/@Goodman2023GG.md");
    expect(exportNotePath(citations, { ...DEFAULT_EXPORT_SETTINGS, destination: "note" }, entry)).toBe(
      "Obsidian/Library/@Goodman2023GG highlights.md",
    );
    expect(exportNotePath(citations, { ...DEFAULT_EXPORT_SETTINGS, noteFolder: "\\Lit\\", noteTitle: "{{citekey}}" }, entry)).toBe(
      "Lit/Goodman2023GG.md",
    );
  });

  it("put images where Obsidian puts attachments", () => {
    expect(attachmentFolder(null, "A/n.md")).toBe("");
    expect(attachmentFolder("/", "A/n.md")).toBe("");
    expect(attachmentFolder("Obsidian/Attatchments", "A/n.md")).toBe("Obsidian/Attatchments");
    expect(attachmentFolder("./", "A/B/n.md")).toBe("A/B");
    expect(attachmentFolder(".", "n.md")).toBe("");
    expect(attachmentFolder("./img", "A/n.md")).toBe("A/img");
  });
});

const LIBRARY = "C:/Users/amcle/Documents/Academia/Obsidian/Library";
describe.skipIf(!existsSync(LIBRARY))("the user's literature notes (read only)", () => {
  it("keep every character of their own text when the section is added", () => {
    const s = { destination: "heading" as const, heading: "# Annotations" };
    let underHeading = 0;
    for (const name of readdirSync(LIBRARY).filter((n) => n.endsWith(".md"))) {
      const note = readFileSync(`${LIBRARY}/${name}`, "utf8");
      const merged = mergeIntoNote(note, "> [!quote] x\n\n^hl-aaaaaa", s).text;
      const region = findRegion(merged)!;
      // Without the section (and the blank lines put around it) it's the note
      // as it was, less any section an earlier export wrote.
      const squash = (t: string) => t.replace(/\s+/g, " ").trim();
      const existing = findRegion(note);
      const own = existing ? note.slice(0, existing.start) + note.slice(existing.end) : note;
      expect(squash(merged.slice(0, region.start) + merged.slice(region.end)), name).toBe(
        squash(/^# Annotations\s*$/m.test(note) ? own : own + "\n# Annotations"),
      );
      if (/^# Annotations\s*$/m.test(note)) underHeading++;
    }
    expect(underHeading).toBeGreaterThan(5);
  });
});
