import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { parser } from "@lezer/markdown";
import { renderNote } from "../src/notes/markdown";
import { formulas } from "../src/notes/mathPreview";
import { mathSyntax } from "../src/notes/mathSyntax";

// The sidebar (markdown-it) and the editor (CodeMirror's markdown parser)
// find math separately; both must agree with Obsidian and each other.
const sidebar = (text: string) => renderNote(text).math.map((m) => (m.display ? `$$${m.tex}$$` : m.tex));
const editor = (text: string) => {
  const state = EditorState.create({ doc: text, extensions: [markdown({ extensions: [mathSyntax] })] });
  return formulas(state).map((m) => (m.display ? `$$${m.tex}$$` : m.tex));
};

const CASES: [string, string, string[]][] = [
  ["inline and display", "Let $x^2$ be\n$$\n\\int f\n$$\nand $y$.", ["x^2", "$$\n\\int f\n$$", "y"]],
  ["prices are not math", "costs $5 and $10", []],
  ["spaces inside the dollars", "$ x$ and $x $", []],
  ["escaped dollar outside", "a \\$ sign and $y$", ["y"]],
  ["escaped dollar inside", "$a \\$ b$", ["a \\$ b"]],
  ["closing dollar before a digit", "$a$5 then $b$", ["a$5 then $b"]],
  ["no blank line inside", "$a\n\nb$", []],
  ["one line break is fine", "$a\nb$", ["a\nb"]],
  ["code spans", "`$x$` and $y$", ["y"]],
  ["longer code spans", "``a ` $x$`` $y$", ["y"]],
  ["fenced code", "```\n$x$\n```\n$y$", ["y"]],
  ["unclosed fence", "~~~tex\n$$x$$\n", []],
  ["indented code", "para\n\n    $x$ code", []],
  ["code span doesn't cross a blank line", "Use ` here\n\n$x$ and `y`", ["x"]],
  ["fence in a quote", "> ```\n> $x$\n> ```", []],
  ["unclosed dollars", "$$x and $y$", ["y"]],
  ["unclosed dollar", "$x", []],
  ["display math in a callout", "> [!note]\n> $$\n> x^2\n> $$", ["$$\nx^2\n$$"]],
];

describe.each([
  ["sidebar", sidebar],
  ["editor", editor],
])("math in the %s", (_, find) => {
  it.each(CASES)("%s", (_name, text, expected) => {
    expect(find(text)).toEqual(expected);
  });
});

describe("renderNote", () => {
  it("keeps TeX away from markdown", () => {
    const { html, math } = renderNote("A *b* and $a_1 * b_2 * c$ then $$\\frac{x}{y}$$");
    expect(math.map((m) => m.tex)).toEqual(["a_1 * b_2 * c", "\\frac{x}{y}"]);
    expect(html).toContain("<em>b</em>");
    expect(html).toContain('<span class="note-math" data-math="0">$a_1 * b_2 * c$</span>');
    expect(html).toContain('<span class="note-math display" data-math="1">$$\\frac{x}{y}$$</span>');
  });

  it("keeps line breaks and escapes HTML", () => {
    const { html } = renderNote("one\ntwo <script>alert(1)</script> $<b>$");
    expect(html).toContain("one<br>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("$&lt;b&gt;$");
  });

  it("leaves link destinations and titles alone", () => {
    const { html, math } = renderNote('[l](http://a.com/$x$ "$y$")');
    expect(math).toEqual([]);
    expect(html).toContain('href="http://a.com/$x$"');
    expect(html).toContain('title="$y$"');
  });
});

describe("editor markdown with math", () => {
  const md = parser.configure([mathSyntax]);
  const nodes = (text: string) => {
    const out: string[] = [];
    md.parse(text).iterate({ enter: (n) => void out.push(`${n.name}:${text.slice(n.from, n.to)}`) });
    return out;
  };

  it("keeps TeX underscores out of emphasis", () => {
    const found = nodes("map $(x)_+$ from *here* by $a_+$");
    expect(found).toContain("Math:$(x)_+$");
    expect(found).toContain("Math:$a_+$");
    expect(found.filter((n) => n.startsWith("Emphasis:"))).toEqual(["Emphasis:*here*"]);
  });
});
