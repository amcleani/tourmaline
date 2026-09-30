import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { texCompletionSource } from "../src/math/completions";
import { findMath } from "../src/math/delimiters";
import { parseMacros } from "../src/math/preamble";
import { configureMath, DEFAULT_MATH, renderMath, texNames } from "../src/math/engine";

import preamble from "./fixtures/math/preamble.sty?raw";
const tex = (text: string) => findMath(text).map((s) => (s.display ? `$$${s.tex}$$` : s.tex));

describe("findMath", () => {
  it("finds inline and display math", () => {
    expect(tex("Let $x^2$ be\n$$\n\\int f\n$$\nand $y$.")).toEqual(["x^2", "$$\n\\int f\n$$", "y"]);
    const [s] = findMath("a $x$ b");
    expect([s.from, s.to]).toEqual([2, 5]);
  });

  it("follows Obsidian's rules for inline dollars", () => {
    expect(tex("costs $5 and $10")).toEqual([]);
    expect(tex("$ x$ and $x $")).toEqual([]);
    expect(tex("a \\$ sign and $y$")).toEqual(["y"]);
    expect(tex("$a \\$ b$")).toEqual(["a \\$ b"]);
    expect(tex("$a$5 then $b$")).toEqual(["a$5 then $b"]);
  });

  it("does not cross a blank line", () => {
    expect(tex("$a\n\nb$")).toEqual([]);
    expect(tex("$a\nb$")).toEqual(["a\nb"]);
  });

  it("skips code", () => {
    expect(tex("`$x$` and $y$")).toEqual(["y"]);
    expect(tex("``a ` $x$`` $y$")).toEqual(["y"]);
    expect(tex("```\n$x$\n```\n$y$")).toEqual(["y"]);
    expect(tex("~~~tex\n$$x$$\n")).toEqual([]);
  });

  it("leaves unclosed delimiters as text", () => {
    expect(tex("$$x")).toEqual([]);
    expect(tex("$x")).toEqual([]);
  });
});

describe("parseMacros", () => {
  const macros = new Map(parseMacros(preamble).map((m) => [m.name, m]));

  it("reads arguments and optional defaults", () => {
    expect(macros.get("at")).toEqual({ name: "at", args: 0, optional: null, body: "\\mathsf{At}" });
    expect(macros.get("logic")).toMatchObject({ args: 1, optional: null });
    expect(macros.get("clop")).toMatchObject({ args: 2, optional: "" });
    expect(macros.get("int")).toMatchObject({ args: 2, optional: "g", body: "\\|#2\\|^{#1}" });
  });

  it("reads renewcommand, DeclareMathOperator and def", () => {
    expect(macros.get("deg")?.body).toBe("\\mathsf{Deg}");
    expect(macros.get("Clop")).toMatchObject({ args: 0, body: "Clop" });
    expect(macros.get("pair")).toMatchObject({ args: 2 });
  });

  it("ignores comments", () => {
    expect(parseMacros("% \\newcommand{\\no}{x}\n\\newcommand{\\yes}{50\\%}")).toEqual([
      { name: "yes", args: 0, optional: null, body: "50\\%" },
    ]);
  });
});

describe("MathJax engine", () => {
  const isError = (el: HTMLElement) =>
    !!el.querySelector("mjx-merror") || /red/i.test(el.innerHTML);

  it("renders with the preamble's macros", async () => {
    expect(await configureMath({ ...DEFAULT_MATH, preamble })).toBeNull();
    const el = await renderMath("\\clop[a]{X} \\int{\\phi} \\llbracket p \\rrbracket \\deg \\pair{a}{b}", false);
    expect(el.querySelector("mjx-container") ?? el).toBeTruthy();
    expect(el.getAttribute("aria-label")).toContain("\\clop");
    expect(isError(el)).toBe(false);
    expect(isError(await renderMath("\\notdefined", false))).toBe(true);
  });

  it("forgets macros when the preamble changes and lists them for autocomplete", async () => {
    await configureMath({ ...DEFAULT_MATH, preamble });
    expect((await texNames()).macros).toEqual(expect.arrayContaining(["clop", "frac", "mathfrak"]));
    await configureMath(DEFAULT_MATH);
    expect(isError(await renderMath("\\clop{X}", false))).toBe(true);
    expect((await texNames()).macros).not.toContain("clop");
  });

  it("reports a broken preamble", async () => {
    expect(await configureMath({ ...DEFAULT_MATH, preamble: "\\newcommand{\\a}{x" })).toMatch(/brace/i);
  });
});

describe("TeX autocomplete", () => {
  const complete = async (doc: string) => {
    const state = EditorState.create({ doc });
    return texCompletionSource(new CompletionContext(state, doc.length, false));
  };

  it("offers the preamble's macros first, then MathJax's", async () => {
    await configureMath({ ...DEFAULT_MATH, preamble });
    const result = await complete(String.raw`see $\cl`);
    expect(result?.from).toBe(5);
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining([String.raw`\clop`, String.raw`\clubsuit`]));
    const clop = result!.options.find((o) => o.label === String.raw`\clop`)!;
    expect(clop.boost).toBeGreaterThan(0);
    expect(clop.detail).toBe("preamble, 2 arguments");
  });

  it("completes environments after \\begin{ but not after a TeX line break", async () => {
    const env = await complete(String.raw`$$\begin{ali`);
    expect(env?.from).toBe(9);
    expect(env!.options.map((o) => o.label)).toContain("aligned");
    expect(await complete(String.raw`a \\`)).toBeNull();
  });
});
