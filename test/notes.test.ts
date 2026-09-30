import { renderNote } from "../src/notes/markdown";

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
