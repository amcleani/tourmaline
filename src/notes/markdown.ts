// Markdown for notes, rendered like Obsidian's reading view: soft line breaks
// kept, no raw HTML. Math is an inline rule using the same `$` rules as the
// editor (math/delimiters.ts), so markdown-it itself decides what is code,
// a link or a quote. Formulas come out as placeholders showing their source;
// NoteView fills them with MathJax.

import MarkdownIt from "markdown-it";
import { mathAt } from "../math/delimiters";

export interface NoteMath {
  tex: string;
  display: boolean;
}

const md = new MarkdownIt({ html: false, linkify: false, breaks: true });

// After `escape`, so `\$` stays a dollar sign; `$` ends markdown-it's text runs.
md.inline.ruler.after("escape", "math", (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x24 /* $ */) return false;
  const span = mathAt(state.src, state.pos);
  if (!span) {
    // An unclosed $$ is plain text as a pair (so its second $ opens nothing).
    if (state.src.charCodeAt(state.pos + 1) !== 0x24) return false;
    if (!silent) state.push("text", "", 0).content = "$$";
    state.pos += 2;
    return true;
  }
  if (!silent) {
    const token = state.push("math", "", 0);
    token.meta = { tex: span.tex, display: span.display } satisfies NoteMath;
  }
  state.pos = span.to;
  return true;
});

md.renderer.rules.math = (tokens, idx, _options, env) => {
  const math = tokens[idx].meta as unknown as NoteMath;
  const list = (env as { math: NoteMath[] }).math;
  list.push(math);
  const delim = math.display ? "$$" : "$";
  return `<span class="note-math${math.display ? " display" : ""}" data-math="${list.length - 1}">${md.utils.escapeHtml(
    delim + math.tex + delim,
  )}</span>`;
};

export interface RenderedNote {
  html: string;
  /** The formulas, indexed by the placeholders' `data-math`. */
  math: NoteMath[];
}

export function renderNote(text: string): RenderedNote {
  const env = { math: [] as NoteMath[] };
  const html = md.render(text, env);
  return { html, math: env.math };
}
