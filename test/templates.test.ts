import type { Annotation } from "../src/annotations/types";
import { parseReaderLink, readerLink } from "../src/vault/links";
import { DEFAULT_HIGHLIGHT_TEMPLATE, literatureNotePath, obsidianUrl, renderHighlight, type VaultSettings } from "../src/vault/notes";
import { renderTemplate, templateProblem } from "../src/vault/templates";

describe("renderTemplate", () => {
  const r = renderTemplate;

  it("fills in fields without escaping", () => {
    expect(r("{{title}} & {{{title}}}", { title: "A <b> & \"c\"" })).toBe('A <b> & "c" & A <b> & "c"');
    expect(r("{{missing}}|{{n}}|{{zero}}|{{f}}", { n: 3, zero: 0, f: false })).toBe("|3|0|false");
    expect(r("{{entry.author.0.family}}", { entry: { author: [{ family: "Bacon" }] } })).toBe("Bacon");
  });

  it("runs the Citations plugin's default note template", () => {
    const template =
      "---\ntitle: {{title}}\nauthors: {{authorString}}\n{{#if containerTitle}}publication: {{containerTitle}}\n{{/if}}year: {{year}}\n---\n\n";
    expect(r(template, { title: "T", authorString: "A B", year: "2020" })).toBe("---\ntitle: T\nauthors: A B\nyear: 2020\n---\n\n");
    expect(r(template, { title: "T", containerTitle: "J", year: "2020" })).toContain("publication: J\nyear");
  });

  it("supports if/unless/else chains", () => {
    const t = "{{#if a}}A{{else if b}}B{{else}}C{{/if}}";
    expect(r(t, { a: 1 })).toBe("A");
    expect(r(t, { b: [1] })).toBe("B");
    expect(r(t, { b: [] })).toBe("C");
    expect(r("{{#if n}}yes{{else}}no{{/if}}", { n: 0 })).toBe("no");
    expect(r("{{#if n includeZero=true}}yes{{/if}}", { n: 0 })).toBe("yes");
    expect(r("{{#unless a}}none{{/unless}}", {})).toBe("none");
  });

  it("supports each, with, paths, data and block params", () => {
    const ctx = { title: "T", tags: ["x", "y"], meta: { a: 1, b: 2 }, who: { name: "N" } };
    expect(r("{{#each tags}}{{@index}}:{{this}}{{#if @last}}.{{else}}, {{/if}}{{/each}}", ctx)).toBe("0:x, 1:y.");
    expect(r("{{#each meta}}{{@key}}={{.}};{{/each}}", ctx)).toBe("a=1;b=2;");
    expect(r("{{#each tags as |tag i|}}{{i}}{{tag}}{{../title}}{{/each}}", ctx)).toBe("0xT1yT");
    expect(r("{{#with who}}{{name}} of {{@root.title}}{{/with}}", ctx)).toBe("N of T");
    expect(r("{{#each nothing}}x{{else}}empty{{/each}}", ctx)).toBe("empty");
    expect(r("{{#tags}}[{{.}}]{{/tags}}", ctx)).toBe("[x][y]");
    expect(r("{{lookup meta 'b'}}", ctx)).toBe("2");
  });

  it("drops standalone block lines and honours ~", () => {
    expect(r("a\n{{#if x}}\nb\n{{/if}}\nc", { x: true })).toBe("a\nb\nc");
    expect(r("a  {{~x~}}  b", { x: "-" })).toBe("a-b");
  });

  it("keeps multi-line values inside callouts", () => {
    expect(r("> [!note]\n> {{note}}\n\nafter", { note: "one\n\n$$\nx^2\n$$\n" })).toBe(
      "> [!note]\n> one\n>\n> $$\n> x^2\n> $$\n\nafter",
    );
    expect(r("> > {{q}}", { q: "a\nb" })).toBe("> > a\n> > b");
    expect(r("{{q}}", { q: "a\nb" })).toBe("a\nb");
  });

  it("never reaches the prototype", () => {
    expect(r("{{constructor}}{{title.constructor}}{{__proto__}}", { title: "x" })).toBe("");
  });

  it("reports syntax errors and unsupported features", () => {
    expect(templateProblem("{{#if a}}unclosed", {})).toMatch(/Parse error|Expecting/);
    expect(templateProblem("{{> partial}}", {})).toMatch(/partials aren't supported/);
    expect(templateProblem("{{shout title}}", {})).toMatch(/unknown helper "shout"/);
    expect(templateProblem("{{title}}", {})).toBeNull();
  });
});

describe("tourmaline:// links", () => {
  const work = "0f8e6f1c-5d2a-4f3b-9c1e-2a3b4c5d6e7f";

  it("round-trips", () => {
    const url = readerLink(work, { blockId: "hl-k3x9q2" });
    expect(url).toBe(`tourmaline://open?doc=${work}&hl=hl-k3x9q2`);
    expect(parseReaderLink(url)).toEqual({ workId: work, blockId: "hl-k3x9q2", page: null });
    expect(parseReaderLink(readerLink(work, { page: 12 }))).toEqual({ workId: work, blockId: null, page: 12 });
  });

  it("accepts a trailing slash and a ^ on the block id", () => {
    expect(parseReaderLink(`tourmaline://open/?doc=${work.toUpperCase()}&hl=^hl-k3x9q2`)).toEqual({
      workId: work,
      blockId: "hl-k3x9q2",
      page: null,
    });
  });

  it("rejects anything else", () => {
    expect(parseReaderLink("https://example.com/?doc=" + work)).toBeNull();
    expect(parseReaderLink("tourmaline://delete?doc=" + work)).toBeNull();
    expect(parseReaderLink("tourmaline://open?doc=../../etc")).toBeNull();
    expect(parseReaderLink(`tourmaline://open?doc=${work}&page=-1`)).toEqual({ workId: work, blockId: null, page: null });
    expect(parseReaderLink("not a url")).toBeNull();
  });
});

describe("highlights and notes", () => {
  const annotation: Annotation = {
    id: "a1",
    workId: "0f8e6f1c-5d2a-4f3b-9c1e-2a3b4c5d6e7f",
    kind: "highlight",
    categoryId: "default-2",
    colour: null,
    note: "Compare $\\forall x$ with\n$$\n\\exists y\n$$",
    quote: "Grounding generalizations are hard.",
    prefix: null,
    suffix: null,
    imagePath: null,
    blockId: "hl-k3x9q2",
    source: "tourmaline",
    created: Date.UTC(2026, 8, 30),
    updated: 0,
    placement: { page: 4, geometry: { rects: [] }, textStart: 0, textEnd: 10, status: "exact" },
    fallback: null,
  };
  const category = { id: "default-2", name: "Important", colour: "#f28b82", callout: "important", hotkey: 2, deleted: false };

  it("renders the default highlight as a callout with its block id", () => {
    expect(renderHighlight(DEFAULT_HIGHLIGHT_TEMPLATE, { annotation, category, pageLabel: "823" })).toBe(
      `> [!important] [p. 823](tourmaline://open?doc=${annotation.workId}&hl=hl-k3x9q2)
> Grounding generalizations are hard.
>
> Compare $\\forall x$ with
> $$
> \\exists y
> $$

^hl-k3x9q2
`,
    );
  });

  it("leaves out an empty note or quote", () => {
    const plain = renderHighlight(DEFAULT_HIGHLIGHT_TEMPLATE, { annotation: { ...annotation, note: "" }, category, pageLabel: "5" });
    expect(plain).toBe(`> [!important] [p. 5](${"tourmaline://open?doc=" + annotation.workId}&hl=hl-k3x9q2)
> Grounding generalizations are hard.

^hl-k3x9q2
`);
    const area = renderHighlight(DEFAULT_HIGHLIGHT_TEMPLATE, {
      annotation: { ...annotation, kind: "area", quote: null, note: "A figure" },
      category: undefined,
      pageLabel: "5",
    });
    expect(area).toMatch(/^> \[!quote\] .*\n> A figure\n\n\^hl-k3x9q2\n$/);
  });

  it("gives the paper's fields to the highlight template", () => {
    expect(
      renderHighlight("{{citekey}}: {{title}}, p. {{page}} ({{pageNumber}})", {
        annotation,
        category,
        pageLabel: "iv",
        entry: { citekey: "Goodman2023GG", title: "Grounding Generalizations" },
      }),
    ).toBe("Goodman2023GG: Grounding Generalizations, p. iv (5)");
  });

  const settings: VaultSettings["citations"] = {
    enabled: true,
    format: "biblatex",
    bibliography: null,
    noteTitleTemplate: "@{{citekey}}",
    noteFolder: "Obsidian/Library",
    noteTemplate: "",
  };

  it("names the literature note like the Citations plugin", () => {
    expect(literatureNotePath(settings, { citekey: "Goodman2023GG" })).toBe("Obsidian/Library/@Goodman2023GG.md");
    expect(literatureNotePath({ ...settings, noteTitleTemplate: "{{title}}", noteFolder: "" }, { title: 'A: "B"?' })).toBe(
      "A_ _B__.md",
    );
    expect(obsidianUrl("Academia", "Obsidian/Library/@Goodman2023GG.md")).toBe(
      "obsidian://open?vault=Academia&file=Obsidian%2FLibrary%2F%40Goodman2023GG",
    );
  });
});
