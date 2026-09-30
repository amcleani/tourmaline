import { parser } from "@lezer/markdown";
import { renderNote } from "../src/notes/markdown";
import { mathSyntax } from "../src/notes/mathSyntax";

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

  it("leaves math in code alone and puts TeX back in link titles", () => {
    const { html, math } = renderNote('`$x$` [l](http://a.b "$y$")');
    expect(math.map((m) => m.tex)).toEqual(["y"]);
    expect(html).toContain("<code>$x$</code>");
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
    expect(found).toContain("Emphasis:*here*");
    expect(found.filter((n) => n.startsWith("Emphasis:"))).toHaveLength(1);
  });

  it("agrees with findMath on dollars that aren't math", () => {
    expect(nodes("costs $5 and $10").some((n) => n.startsWith("Math"))).toBe(false);
    expect(nodes("$$x and $y$").filter((n) => n.startsWith("Math"))).toEqual(["Math:$y$"]);
  });
});
