import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { renderNote } from "../src/notes/markdown";
import { mathSyntax } from "../src/notes/mathSyntax";
import {
  headingLinkText,
  linkText,
  noteOptions,
  parseWikilink,
  resolveNote,
  wikilinkCompletionSource,
  wikilinkLength,
  wikilinkSyntax,
  wikilinkUrl,
  type VaultIndex,
  type WikilinkContext,
} from "../src/notes/wikilinks";

const INDEX: VaultIndex = {
  notes: [
    { path: "Obsidian/concept.md", aliases: ["idea"], headings: [{ level: 1, text: "Definition: first" }, { level: 2, text: "Uses" }], blocks: ["hl-abc123"] },
    { path: "Obsidian/conceptual analysis.md", aliases: [], headings: [], blocks: [] },
    { path: "Obsidian/Library/@Goodman2023GG.md", aliases: [], headings: [], blocks: ["hl-k3x9q2"] },
    { path: "Other/concept.md", aliases: [], headings: [], blocks: [] },
    { path: "top.md", aliases: [], headings: [], blocks: [] },
  ],
  unresolved: [{ name: "consequence", count: 3 }],
};

const ctx = (over: Partial<WikilinkContext> = {}): WikilinkContext => ({
  index: INDEX,
  vaultName: "Academia",
  format: "shortest",
  from: "Obsidian/Library/@Goodman2023GG.md",
  ...over,
});

const extensions = [markdown({ extensions: [mathSyntax, wikilinkSyntax] })];

/** Completions with the cursor at `|` in the text. */
function complete(text: string, c = ctx()) {
  const pos = text.indexOf("‸");
  const state = EditorState.create({ doc: text.replace("‸", ""), extensions });
  ensureSyntaxTree(state, state.doc.length);
  return wikilinkCompletionSource(new CompletionContext(state, pos, false), c);
}

/** The text after picking an option. */
function pick(text: string, label: string, c = ctx()) {
  const result = complete(text, c)!;
  const option = result.options.find((o) => o.label === label)!;
  const pos = text.indexOf("‸");
  const view = new EditorView({ state: EditorState.create({ doc: text.replace("‸", ""), extensions }) });
  (option.apply as (v: EditorView, o: Completion, from: number, to: number) => void)(view, option, result.from, pos);
  const out = view.state.doc.toString();
  const cursor = view.state.selection.main.head;
  view.destroy();
  return out.slice(0, cursor) + "‸" + out.slice(cursor);
}

describe("wikilink syntax", () => {
  it("reads the parts of a link", () => {
    expect(parseWikilink("note#Heading|shown")).toEqual({ note: "note", subpath: "Heading", alias: "shown", embed: false });
    expect(parseWikilink("Folder/note#^block")).toEqual({ note: "Folder/note", subpath: "^block", alias: null, embed: false });
    expect(parseWikilink("#local", true)).toEqual({ note: "", subpath: "local", alias: null, embed: true });
  });

  it("finds a link only on one line, not empty, not nested", () => {
    expect(wikilinkLength("[[a]] b", 0)).toBe(5);
    expect(wikilinkLength("![[a.png]]", 0)).toBe(10);
    expect(wikilinkLength("[[]]", 0)).toBe(0);
    expect(wikilinkLength("[[a\nb]]", 0)).toBe(0);
    expect(wikilinkLength("[[a [[b]]", 0)).toBe(0);
    expect(wikilinkLength("[[a]b]]", 0)).toBe(0);
    expect(wikilinkLength("[a]]", 0)).toBe(0);
  });

  // The sidebar (markdown-it) and the editor (CodeMirror) must agree on what is a link.
  const sidebar = (text: string) => [...renderNote(text).html.matchAll(/data-wikilink="([^"]*)"/g)].map((m) => m[1]);
  const editor = (text: string) => {
    const state = EditorState.create({ doc: text, extensions });
    const found: string[] = [];
    ensureSyntaxTree(state, state.doc.length)!.iterate({
      enter: (n) => {
        if (n.name !== "Wikilink") return;
        const raw = state.sliceDoc(n.from, n.to).replace(/^!/, "");
        const link = parseWikilink(raw.slice(2, -2));
        found.push(link.note + (link.subpath ? `#${link.subpath}` : ""));
      },
    });
    return found;
  };
  const CASES: [string, string, string[]][] = [
    ["plain", "see [[concept]] and [[Folder/x#Sec|y]]", ["concept", "Folder/x#Sec"]],
    ["embed", "![[pic.png]] and ![[note#^b]]", ["pic.png", "note#^b"]],
    ["code span", "`[[no]]` but [[yes]]", ["yes"]],
    ["fenced code", "```\n[[no]]\n```\n[[yes]]", ["yes"]],
    ["math", "$[[no]]$ and [[yes]]", ["yes"]],
    ["math inside a link", "[[a $x$ b]]", ["a $x$ b"]],
    ["in a callout", "> [!quote] [[concept#Uses]]", ["concept#Uses"]],
    ["brackets inside", "[[a [b] c]] and [[ok]]", ["ok"]],
  ];
  it.each(CASES)("agrees in both parsers: %s", (_, text, expected) => {
    expect(sidebar(text)).toEqual(expected);
    expect(editor(text)).toEqual(expected);
  });

  it("renders the alias, or the note and heading", () => {
    const html = renderNote("[[concept#Uses]] [[concept|an idea]] [[x#^b]]").html;
    expect(html).toContain(">concept &gt; Uses</a>");
    expect(html).toContain(">an idea</a>");
    expect(html).toContain(">x &gt; b</a>");
  });
});

describe("link text and targets", () => {
  const counts = new Map([["concept", 2], ["top", 1], ["conceptual analysis", 1], ["@goodman2023gg", 1]]);
  const [concept, analysis, , , top] = INDEX.notes;

  it("follows Obsidian's new link format", () => {
    expect(linkText(analysis, "shortest", null, counts)).toBe("conceptual analysis");
    // The name alone is ambiguous: the path.
    expect(linkText(concept, "shortest", null, counts)).toBe("Obsidian/concept");
    expect(linkText(analysis, "absolute", null, counts)).toBe("Obsidian/conceptual analysis");
    expect(linkText(analysis, "relative", "Obsidian/Library/@Goodman2023GG.md", counts)).toBe("../conceptual analysis");
    expect(linkText(top, "relative", "Obsidian/Library/@Goodman2023GG.md", counts)).toBe("../../top");
    expect(linkText(analysis, "relative", "Obsidian/x.md", counts)).toBe("conceptual analysis");
  });

  it("resolves names, paths and relative paths, ignoring case", () => {
    expect(resolveNote(INDEX, "Conceptual Analysis")?.path).toBe("Obsidian/conceptual analysis.md");
    expect(resolveNote(INDEX, "Other/concept")?.path).toBe("Other/concept.md");
    expect(resolveNote(INDEX, "concept.md")?.path).toBe("Obsidian/concept.md");
    expect(resolveNote(INDEX, "../concept", "Obsidian/Library/@Goodman2023GG.md")?.path).toBe("Obsidian/concept.md");
    expect(resolveNote(INDEX, "missing")).toBeNull();
    expect(resolveNote(INDEX, "../../../x", "a.md")).toBeNull();
  });

  it("cleans heading text for links", () => {
    expect(headingLinkText("Definition: first")).toBe("Definition first");
    expect(headingLinkText("A [b] | c ^d")).toBe("A b c d");
  });

  it("opens the note in Obsidian", () => {
    expect(wikilinkUrl(parseWikilink("conceptual analysis#Sec"), ctx())).toBe(
      "obsidian://open?vault=Academia&file=Obsidian%2Fconceptual%20analysis",
    );
    expect(wikilinkUrl(parseWikilink("not yet"), ctx())).toBe("obsidian://open?vault=Academia&file=not%20yet");
    expect(wikilinkUrl(parseWikilink("x"), ctx({ vaultName: null }))).toBeNull();
  });
});

describe("[[ autocomplete", () => {
  it("suggests the vault's notes after [[ (the done-when: [[conc offers the concept notes)", () => {
    const result = complete("see [[conc‸")!;
    expect(result.from).toBe(6);
    const labels = result.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["concept", "conceptual analysis", "idea", "consequence"]));
    // Names used twice show their folder; aliases and new names say what they are.
    expect(result.options.filter((o) => o.label === "concept").map((o) => o.detail)).toEqual(["Obsidian", "Other"]);
    expect(result.options.find((o) => o.label === "idea")?.detail).toBe("alias of concept");
    expect(result.options.find((o) => o.label === "consequence")).toMatchObject({ detail: "not created yet", boost: -20 });
    expect(result.validFor instanceof RegExp && result.validFor.test("concept anal")).toBe(true);
  });

  it("inserts the link with its closing brackets", () => {
    expect(pick("see [[conc‸", "conceptual analysis")).toBe("see [[conceptual analysis]]‸");
    expect(pick("see [[conc‸]] after", "conceptual analysis")).toBe("see [[conceptual analysis]]‸ after");
    expect(pick("[[conc‸", "idea")).toBe("[[Obsidian/concept|idea]]‸");
    expect(pick("[[cons‸", "consequence")).toBe("[[consequence]]‸");
    expect(pick("[[conc‸", "conceptual analysis", ctx({ format: "relative" }))).toBe("[[../conceptual analysis]]‸");
  });

  it("suggests headings after # and blocks after #^", () => {
    const headings = complete("[[Obsidian/concept#‸")!;
    expect(headings.options.map((o) => o.label)).toEqual(["Definition first", "Uses"]);
    expect(pick("[[Obsidian/concept#U‸", "Uses")).toBe("[[Obsidian/concept#Uses]]‸");
    const blocks = complete("[[@Goodman2023GG#^‸")!;
    expect(blocks.options.map((o) => o.label)).toEqual(["hl-k3x9q2"]);
    expect(pick("[[@Goodman2023GG#^hl‸", "hl-k3x9q2")).toBe("[[@Goodman2023GG#^hl-k3x9q2]]‸");
    expect(complete("[[nothing here#‸")).toBeNull();
  });

  it("stays out of code and formulas, and needs an index", () => {
    expect(complete("`[[conc‸`")).toBeNull();
    expect(complete("```\n[[conc‸\n```")).toBeNull();
    expect(complete("$x [[conc‸$")).toBeNull();
    expect(complete("[conc‸")).toBeNull();
    expect(complete("[[a|b‸")).toBeNull();
    expect(complete("[[conc‸", ctx({ index: null }))).toBeNull();
  });

  it("builds the list once per index", () => {
    expect(noteOptions(ctx())).toBe(noteOptions(ctx()));
    expect(noteOptions(ctx({ format: "absolute" }))).not.toBe(noteOptions(ctx()));
  });
});
