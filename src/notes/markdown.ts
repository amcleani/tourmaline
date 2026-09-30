// Markdown for notes, rendered like Obsidian's reading view: soft line breaks
// kept, no raw HTML, and math found by the same rules as the editor
// (math/delimiters.ts). Formulas come out as empty placeholders showing their
// source; NoteView fills them with MathJax.

import MarkdownIt, { type StateCore, type Token } from "markdown-it";
import { findMath, type MathSpan } from "../math/delimiters";

// The math is swapped for private-use markers before markdown sees it, so
// markdown can't mangle the TeX (underscores, asterisks, backslashes).
const MARKER = /\uE000(\d+)\uE001/g;

const md = new MarkdownIt({ html: false, linkify: false, breaks: true });

md.core.ruler.push("tourmaline_math", (state) => {
  const spans = (state.env as { math: MathSpan[] }).math;
  const source = (text: string) => text.replace(MARKER, (_, i) => delimited(spans[Number(i)]));
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const out: Token[] = [];
    for (const tok of block.children) {
      if (tok.attrs) tok.attrs = tok.attrs.map(([k, v]) => [k, typeof v === "string" ? source(v) : v]);
      if (tok.type !== "text" || !tok.content.includes("\uE000")) {
        out.push(tok);
        continue;
      }
      let last = 0;
      for (const m of tok.content.matchAll(MARKER)) {
        if (m.index > last) out.push(textToken(state, tok.content.slice(last, m.index)));
        const math = new state.Token("math", "", 0);
        math.meta = { index: Number(m[1]) };
        out.push(math);
        last = m.index + m[0].length;
      }
      if (last < tok.content.length) out.push(textToken(state, tok.content.slice(last)));
    }
    block.children = out;
  }
});

function textToken(state: StateCore, content: string): Token {
  const t = new state.Token("text", "", 0);
  t.content = content;
  return t;
}

md.renderer.rules.math = (tokens, idx, _options, env) => {
  const i = (tokens[idx].meta as { index: number }).index;
  const span = (env as { math: MathSpan[] }).math[i];
  return `<span class="note-math${span.display ? " display" : ""}" data-math="${i}">${md.utils.escapeHtml(
    delimited(span),
  )}</span>`;
};

function delimited(span: MathSpan): string {
  const delim = span.display ? "$$" : "$";
  return delim + span.tex + delim;
}

export interface RenderedNote {
  html: string;
  /** The formulas, indexed by the placeholders' `data-math`. */
  math: MathSpan[];
}

export function renderNote(text: string): RenderedNote {
  const math = findMath(text);
  let marked = "";
  let last = 0;
  math.forEach((s, i) => {
    marked += text.slice(last, s.from) + `\uE000${i}\uE001`;
    last = s.to;
  });
  marked += text.slice(last);
  return { html: md.render(marked, { math }), math };
}
