// Finds the math in a markdown note the way Obsidian does, so the editor, the
// sidebar and the vault agree on what is a formula:
//   $$ … $$  display math, may span lines;
//   $ … $    inline math: the opening $ is followed by a non-space, the
//            closing $ is preceded by a non-space and not followed by a digit
//            ("costs $5 and $10" is text), and it doesn't cross a blank line;
//   \$ is a literal dollar, and nothing inside `code` or fenced blocks is math.

export interface MathSpan {
  /** Offsets of the whole formula, delimiters included. */
  from: number;
  to: number;
  /** The TeX between the delimiters. */
  tex: string;
  display: boolean;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function findMath(text: string): MathSpan[] {
  const spans: MathSpan[] = [];
  let i = 0;
  let lineStart = true;
  while (i < text.length) {
    const ch = text[i];
    if (lineStart) {
      lineStart = false;
      const fence = FENCE.exec(text.slice(i, i + 200));
      if (fence) {
        i = skipFencedBlock(text, i, fence[1]);
        lineStart = true;
        continue;
      }
    }
    if (ch === "\n") {
      lineStart = true;
      i++;
    } else if (ch === "\\") {
      i += 2;
    } else if (ch === "`") {
      i = skipCodeSpan(text, i);
    } else if (ch === "$") {
      const span = text[i + 1] === "$" ? displayAt(text, i) : inlineAt(text, i);
      if (span) {
        spans.push(span);
        i = span.to;
      } else {
        i += text[i + 1] === "$" ? 2 : 1;
      }
    } else {
      i++;
    }
  }
  return spans;
}

/** Returns the offset after the closing fence (or the end of the text). */
function skipFencedBlock(text: string, start: number, fence: string): number {
  let pos = text.indexOf("\n", start);
  while (pos !== -1) {
    const lineEnd = text.indexOf("\n", pos + 1);
    const line = text.slice(pos + 1, lineEnd === -1 ? text.length : lineEnd);
    const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
      return lineEnd === -1 ? text.length : lineEnd;
    }
    pos = lineEnd;
  }
  return text.length;
}

/** A code span closes at the next run of exactly as many backticks; unclosed runs are text. */
function skipCodeSpan(text: string, start: number): number {
  let run = 0;
  while (text[start + run] === "`") run++;
  let j = start + run;
  while (j < text.length) {
    if (text[j] !== "`") {
      j++;
      continue;
    }
    let n = 0;
    while (text[j + n] === "`") n++;
    if (n === run) return j + n;
    j += n;
  }
  return start + run;
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
