// Markdown for notes, rendered like Obsidian's reading view: single line
// breaks kept unless the vault has "Strict line breaks" on, no raw HTML. Math is an inline rule using the same `$` rules as the
// editor (math/delimiters.ts), so markdown-it itself decides what is code,
// a link or a quote. Formulas come out as placeholders showing their source;
// NoteView fills them with MathJax.

import MarkdownIt from "markdown-it";
import { mathAt } from "../math/delimiters";
import { parseWikilink, wikilinkLength, type Wikilink } from "./wikilinks";

export interface NoteMath {
  tex: string;
  display: boolean;
}

const md = new MarkdownIt({ html: false, linkify: false, breaks: true });

let strictLineBreaks = false;
const lineBreakListeners = new Set<() => void>();

/** Obsidian's "Strict line breaks": a single newline doesn't break the line. */
export function setStrictLineBreaks(strict: boolean) {
  if (strict === strictLineBreaks) return;
  strictLineBreaks = strict;
  md.set({ breaks: !strict });
  lineBreakListeners.forEach((l) => l());
}

/** For useSyncExternalStore: notes re-render when the setting changes. */
export const lineBreakSetting = {
  subscribe(listener: () => void) {
    lineBreakListeners.add(listener);
    return () => void lineBreakListeners.delete(listener);
  },
  strict: () => strictLineBreaks,
};

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

// Wikilinks, before markdown links (and images, for `![[…]]`); code spans
// and formulas come first, so `[[` inside them stays text.
md.inline.ruler.before("link", "wikilink", (state, silent) => {
  const length = wikilinkLength(state.src, state.pos);
  if (!length) return false;
  if (!silent) {
    const embed = state.src.charCodeAt(state.pos) === 0x21;
    const inner = state.src.slice(state.pos + (embed ? 3 : 2), state.pos + length - 2);
    state.push("wikilink", "", 0).meta = { ...parseWikilink(inner, embed) };
  }
  state.pos += length;
  return true;
});

md.renderer.rules.wikilink = (tokens, idx) => {
  const link = tokens[idx].meta as unknown as Wikilink;
  const sub = link.subpath?.replace(/^\^/, "");
  const shown = link.alias ?? ([link.note, sub].filter(Boolean).join(" > ") || "");
  const target = link.note + (link.subpath ? `#${link.subpath}` : "");
  return `<a href="#" class="wikilink" data-wikilink="${md.utils.escapeHtml(target)}" title="Open ${md.utils.escapeHtml(link.note || "this note")} in Obsidian">${md.utils.escapeHtml(shown)}</a>`;
};

md.renderer.rules.math = (tokens, idx, _options, env) => {
  const math = tokens[idx].meta as unknown as NoteMath;
  const list = (env as { math: NoteMath[] }).math;
  list.push(math);
  const delim = math.display ? "$$" : "$";
  return `<span class="note-math${math.display ? " display" : ""}" data-math="${list.length - 1}">${md.utils.escapeHtml(
    delim + math.tex + delim,
  )}</span>`;
};

/** The wikilinks in a note, in order (as the reading view finds them: not in code or formulas). */
export function noteWikilinks(text: string): Wikilink[] {
  const links: Wikilink[] = [];
  const walk = (tokens: ReturnType<typeof md.parse>) => {
    for (const t of tokens) {
      if (t.type === "wikilink") links.push(t.meta as unknown as Wikilink);
      if (t.children) walk(t.children);
    }
  };
  walk(md.parse(text, { math: [] }));
  return links;
}

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
