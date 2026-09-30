// Obsidian's rules for where a formula starts and ends, shared by the
// sidebar's markdown-it rule (notes/markdown.ts) and the editor's markdown
// parser (notes/mathSyntax.ts). Each parser handles escapes, code, links and
// quotes itself and asks here only at a `$`:
//   $$ … $$  display math, may span lines (an unclosed $$ is plain text);
//   $ … $    inline math: the opening $ is followed by a non-space, the
//            closing $ is preceded by a non-space and not followed by a digit
//            ("costs $5 and $10" is text), and it doesn't cross a blank line.

export interface MathSpan {
  /** Offsets of the whole formula, delimiters included. */
  from: number;
  to: number;
  /** The TeX between the delimiters. */
  tex: string;
  display: boolean;
}

/** The formula starting at the `$` at `start`, if that `$` opens one. */
export function mathAt(text: string, start: number): MathSpan | null {
  return text[start + 1] === "$" ? displayAt(text, start) : inlineAt(text, start);
}

function displayAt(text: string, start: number): MathSpan | null {
  for (let j = start + 2; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === "$" && text[j + 1] === "$") {
      return { from: start, to: j + 2, tex: text.slice(start + 2, j), display: true };
    }
  }
  return null;
}

function inlineAt(text: string, start: number): MathSpan | null {
  const first = text[start + 1];
  if (first === undefined || /\s/.test(first)) return null;
  for (let j = start + 1; j < text.length; j++) {
    const c = text[j];
    if (c === "\\") {
      j++;
    } else if (c === "\n" && /^\n[ \t]*(\n|$)/.test(text.slice(j, j + 80))) {
      return null;
    } else if (c === "$") {
      if (/\s/.test(text[j - 1]) || /\d/.test(text[j + 1] ?? "")) continue;
      return { from: start, to: j + 1, tex: text.slice(start + 1, j), display: false };
    }
  }
  return null;
}
