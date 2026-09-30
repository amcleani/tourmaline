// Reads the macro definitions out of a preamble (preamble.sty) so the editor
// can offer them in autocomplete with the right number of arguments. MathJax
// itself runs the preamble; this only needs names, arguments and bodies.

export interface MacroDef {
  /** Without the backslash. */
  name: string;
  /** Number of arguments, including the optional one. */
  args: number;
  /** Default of the optional first argument, when there is one. */
  optional: string | null;
  body: string;
}

const DEFINE = /\\(?:(?:new|renew|provide)command\*?|DeclareMathOperator\*?|def)(?![a-zA-Z])/g;

/** Macros defined in `src`, in order; a later definition replaces an earlier one. */
export function parseMacros(src: string): MacroDef[] {
  const text = stripComments(src);
  const found = new Map<string, MacroDef>();
  for (const match of text.matchAll(DEFINE)) {
    const def = parseDefinition(text, match.index + match[0].length, match[0]);
    if (def) {
      found.delete(def.name);
      found.set(def.name, def);
    }
  }
  return [...found.values()];
}

/** Removes % comments, keeping \% (a literal percent sign). */
function stripComments(src: string): string {
  return src.replace(/(^|[^\\])%.*$/gm, "$1");
}

function parseDefinition(text: string, pos: number, command: string): MacroDef | null {
  const ws = () => {
    while (/\s/.test(text[pos] ?? "")) pos++;
  };
  ws();
  // The name: {\name} or \name.
  let name: string | null = null;
  if (text[pos] === "{") {
    const m = /^\{\s*\\([a-zA-Z]+|.)\s*\}/.exec(text.slice(pos));
    if (m) {
      name = m[1];
      pos += m[0].length;
    }
  } else {
    const m = /^\\([a-zA-Z]+|.)/.exec(text.slice(pos));
    if (m) {
      name = m[1];
      pos += m[0].length;
    }
  }
  if (!name) return null;

  let args = 0;
  let optional: string | null = null;
  if (command === "\\def") {
    // \def\name#1#2{body}
    const m = /^((?:#\d)*)\s*/.exec(text.slice(pos))!;
    args = m[1].length / 2;
    pos += m[0].length;
  } else if (!command.startsWith("\\DeclareMathOperator")) {
    ws();
    const count = /^\[\s*(\d)\s*\]/.exec(text.slice(pos));
    if (count) {
      args = Number(count[1]);
      pos += count[0].length;
      ws();
      if (text[pos] === "[") {
        const end = balanced(text, pos, "[", "]");
        if (end === -1) return null;
        optional = text.slice(pos + 1, end);
        pos = end + 1;
      }
    }
  }
  ws();
  if (text[pos] !== "{") return null;
  const end = balanced(text, pos, "{", "}");
  if (end === -1) return null;
  return { name, args, optional, body: text.slice(pos + 1, end).trim() };
}

/** Index of the bracket closing the one at `start`, skipping escaped characters; -1 if unclosed. */
function balanced(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}
