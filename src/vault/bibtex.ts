// A BibTeX reader for the JabRef bibliography: entries, @string macros, and
// LaTeX in field values turned into plain text the way the Citations plugin
// shows it (accents composed, case-protecting braces dropped). Read only:
// JabRef owns the file.

export interface BibName {
  first: string;
  von: string;
  last: string;
  jr: string;
  /** A name in braces ({World Health Organization}): used as is. */
  literal?: string;
}

export interface BibEntry {
  /** The citekey. */
  key: string;
  /** Lower case: article, book, incollection... */
  type: string;
  /** Values as text, by lower-case field name. */
  fields: Record<string, string>;
  /** Values exactly as written (inside the outer braces), for file, url, doi. */
  raw: Record<string, string>;
  authors: BibName[];
  editors: BibName[];
}

export interface BibDatabase {
  entries: BibEntry[];
  /**
   * JabRef's file directories for this library (`jabref-meta: fileDirectory`
   * and the per-user `fileDirectory-<user>-<host>` ones), per-user first.
   */
  fileDirectories: string[];
  /** Entries that couldn't be read, as "line N: message". */
  errors: string[];
}

/** Fields whose values are identifiers or paths, not prose: never converted. */
const VERBATIM = new Set(["file", "url", "doi", "eprint", "isbn", "issn", "urldate", "pdf", "howpublished"]);

const MONTHS: Record<string, string> = {
  jan: "January",
  feb: "February",
  mar: "March",
  apr: "April",
  may: "May",
  jun: "June",
  jul: "July",
  aug: "August",
  sep: "September",
  oct: "October",
  nov: "November",
  dec: "December",
};

class Syntax extends Error {}

export function parseBibtex(text: string): BibDatabase {
  const strings = new Map(Object.entries(MONTHS));
  const entries: BibEntry[] = [];
  const errors: string[] = [];
  const generalDirectories: string[] = [];
  const userDirectories: string[] = [];
  let pos = 0;

  const lineAt = (i: number) => text.slice(0, i).split("\n").length;
  const skipSpace = () => {
    while (pos < text.length && /\s/.test(text[pos])) pos++;
  };
  const expect = (ch: string) => {
    skipSpace();
    if (text[pos] !== ch) throw new Syntax(`expected "${ch}"`);
    pos++;
  };
  /** A braced group's content; `pos` is at the opening brace. */
  const braced = (): string => {
    const start = ++pos;
    let depth = 1;
    while (pos < text.length) {
      const c = text[pos++];
      if (c === "\\") pos++;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return text.slice(start, pos - 1);
    }
    throw new Syntax("unclosed brace");
  };
  const quoted = (): string => {
    const start = ++pos;
    let depth = 0;
    while (pos < text.length) {
      const c = text[pos++];
      if (c === "\\") pos++;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === '"' && depth === 0) return text.slice(start, pos - 1);
    }
    throw new Syntax("unclosed quote");
  };
  const identifier = (): string => {
    skipSpace();
    const m = /^[^\s"#%'(),={}]+/.exec(text.slice(pos, pos + 200));
    if (!m) throw new Syntax("expected a name");
    pos += m[0].length;
    return m[0];
  };
  /** A value: pieces joined with #. Returns the raw text. */
  const value = (): string => {
    let out = "";
    for (;;) {
      skipSpace();
      const c = text[pos];
      if (c === "{") out += braced();
      else if (c === '"') out += quoted();
      else if (/[0-9]/.test(c)) out += identifier();
      else {
        const name = identifier();
        const known = strings.get(name.toLowerCase());
        if (known === undefined) throw new Syntax(`unknown @string "${name}"`);
        out += known;
      }
      skipSpace();
      if (text[pos] !== "#") return out;
      pos++;
    }
  };

  while ((pos = text.indexOf("@", pos)) !== -1) {
    const start = pos++;
    try {
      const type = identifier().toLowerCase();
      skipSpace();
      const open = text[pos];
      if (open !== "{" && open !== "(") throw new Syntax("expected { or (");
      const close = open === "{" ? "}" : ")";
      if (type === "comment") {
        const body = open === "{" ? braced() : "";
        const meta = /^\s*jabref-meta:\s*(fileDirectory(?:-[^:]*)?):([\s\S]*?);?\s*$/.exec(body);
        if (meta) {
          const dir = unescapeJabref(meta[2]);
          (meta[1] === "fileDirectory" ? generalDirectories : userDirectories).push(dir);
        }
        continue;
      }
      pos++;
      if (type === "preamble") {
        value();
        expect(close);
        continue;
      }
      if (type === "string") {
        const name = identifier();
        expect("=");
        strings.set(name.toLowerCase(), value());
        expect(close);
        continue;
      }
      skipSpace();
      const keyMatch = /^[^,\s}]+/.exec(text.slice(pos, pos + 500));
      if (!keyMatch) throw new Syntax("expected a citekey");
      const key = keyMatch[0];
      pos += key.length;
      const raw: Record<string, string> = {};
      for (;;) {
        skipSpace();
        if (text[pos] === ",") pos++;
        skipSpace();
        if (text[pos] === close) {
          pos++;
          break;
        }
        if (pos >= text.length) throw new Syntax("unexpected end of file");
        const name = identifier().toLowerCase();
        expect("=");
        raw[name] = value();
      }
      const fields: Record<string, string> = {};
      for (const [name, v] of Object.entries(raw)) fields[name] = VERBATIM.has(name) ? v.trim() : latexToText(v);
      entries.push({
        key,
        type,
        fields,
        raw,
        authors: raw.author ? parseNames(raw.author) : [],
        editors: raw.editor ? parseNames(raw.editor) : [],
      });
    } catch (e) {
      if (!(e instanceof Syntax)) throw e;
      errors.push(`line ${lineAt(start)}: ${e.message}`);
      // Carry on from the next line that starts an entry.
      const next = text.slice(start + 1).search(/\n\s*@/);
      pos = next === -1 ? text.length : start + 1 + next + 1;
    }
  }
  return { entries, fileDirectories: [...userDirectories, ...generalDirectories], errors };
}

// ---- LaTeX to text -----------------------------------------------------------

/** Accent commands and the combining character each puts on its argument. */
const ACCENTS: Record<string, string> = {
  "`": "\u0300",
  "'": "\u0301",
  "^": "\u0302",
  "~": "\u0303",
  "=": "\u0304",
  u: "\u0306",
  ".": "\u0307",
  '"': "\u0308",
  r: "\u030A",
  H: "\u030B",
  v: "\u030C",
  d: "\u0323",
  c: "\u0327",
  k: "\u0328",
  b: "\u0331",
};

const SYMBOLS: Record<string, string> = {
  i: "ı",
  j: "ȷ",
  o: "ø",
  O: "Ø",
  aa: "å",
  AA: "Å",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  ss: "ß",
  l: "ł",
  L: "Ł",
  dh: "ð",
  DH: "Ð",
  th: "þ",
  TH: "Þ",
  "&": "&",
  "%": "%",
  $: "$",
  "#": "#",
  _: "_",
  "{": "{",
  "}": "}",
  " ": " ",
  ",": " ",
  ";": " ",
  "\\": " ",
  "/": "",
  "-": "",
  textbackslash: "\\",
  textbar: "|",
  textendash: "–",
  textemdash: "—",
  textquoteleft: "‘",
  textquoteright: "’",
  textquotedblleft: "“",
  textquotedblright: "”",
  ldots: "…",
  dots: "…",
  textellipsis: "…",
  S: "§",
  P: "¶",
  copyright: "©",
  textregistered: "®",
  texttrademark: "™",
  textdegree: "°",
  pounds: "£",
  euro: "€",
  textasciitilde: "~",
  textasciicircum: "^",
  textunderscore: "_",
  guillemotleft: "«",
  guillemotright: "»",
};

/**
 * Field text as the Citations plugin shows it: accents and symbols as
 * Unicode, --/---/``/'' as dashes and quotes, formatting commands dropped
 * (their argument kept), braces removed, whitespace collapsed. `$…$` math is
 * kept as written, which Obsidian renders.
 */
export function latexToText(src: string): string {
  let out = "";
  let i = 0;
  /** The next argument: a braced group or a single character (or \command). */
  const argument = (): string => {
    while (src[i] === " ") i++;
    if (src[i] === "{") {
      const end = closingBrace(src, i);
      const inner = src.slice(i + 1, end);
      i = end + 1;
      // A dotless i or j under an accent is just the letter: \'{\i} is í.
      const dotless = /^\s*\\([ij])\s*$/.exec(inner);
      return dotless ? dotless[1] : latexToText(inner);
    }
    if (src[i] === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (m) {
        i += m[0].length;
        // A dotless i or j under an accent is just the letter: \'{\i} is í.
        if (m[1] === "i" || m[1] === "j") return m[1];
        return SYMBOLS[m[1]] ?? m[1];
      }
    }
    return src[i++] ?? "";
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (!m) {
        i++;
        continue;
      }
      const name = m[1];
      i += m[0].length;
      const isWord = /^[a-zA-Z]/.test(name);
      if (ACCENTS[name] !== undefined && (!isWord || name.length === 1)) {
        const arg = argument();
        out += arg.slice(0, 1) + ACCENTS[name] + arg.slice(1);
      } else if (SYMBOLS[name] !== undefined) {
        out += SYMBOLS[name];
        // A command word swallows the space after it (\ss a -> ßa).
        if (isWord && src[i] === " ") i++;
        else if (isWord && src.startsWith("{}", i)) i += 2;
      } else if (isWord) {
        // \emph{x}, \textit{x}, \url{x}, unknown commands: keep the argument.
        while (src[i] === " ") i++;
      }
      continue;
    }
    if (c === "$") {
      const end = src.indexOf("$", i + 1);
      if (end !== -1) {
        out += src.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (c === "{" || c === "}") {
      i++;
      continue;
    }
    if (src.startsWith("---", i)) {
      out += "—";
      i += 3;
    } else if (src.startsWith("--", i)) {
      out += "–";
      i += 2;
    } else if (src.startsWith("``", i)) {
      out += "“";
      i += 2;
    } else if (src.startsWith("''", i)) {
      out += "”";
      i += 2;
    } else if (c === "~") {
      out += " ";
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out.normalize("NFC").replace(/\s+/g, " ").trim();
}

function closingBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "\\") i++;
    else if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  return src.length;
}

// ---- Names -------------------------------------------------------------------

/** Splits at a separator that is outside braces. */
function splitTopLevel(src: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0) {
      const m = separator.exec(src.slice(i));
      if (m && m.index === 0) {
        parts.push(src.slice(start, i));
        i += m[0].length - 1;
        start = i + 1;
      }
    }
  }
  parts.push(src.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

const isLowerWord = (word: string) => /^\p{Ll}/u.test(latexToText(word));

/** BibTeX names: "First von Last", "von Last, First" or "von Last, Jr, First". */
export function parseNames(raw: string): BibName[] {
  return splitTopLevel(raw, /^\s+and\s+/).map((name) => {
    const trimmed = name.trim();
    if (trimmed.startsWith("{") && closingBrace(trimmed, 0) === trimmed.length - 1) {
      return { first: "", von: "", last: "", jr: "", literal: latexToText(trimmed) };
    }
    const parts = splitTopLevel(trimmed, /^,/);
    const words = (s: string) => splitTopLevel(s, /^\s+/);
    let first: string[] = [];
    let von: string[] = [];
    let last: string[] = [];
    let jr: string[] = [];
    if (parts.length === 1) {
      const w = words(parts[0]);
      const firstLower = w.findIndex((x, i) => i < w.length - 1 && isLowerWord(x));
      if (firstLower === -1) {
        first = w.slice(0, -1);
        last = w.slice(-1);
      } else {
        let lastLower = firstLower;
        while (lastLower + 1 < w.length - 1 && isLowerWord(w[lastLower + 1])) lastLower++;
        first = w.slice(0, firstLower);
        von = w.slice(firstLower, lastLower + 1);
        last = w.slice(lastLower + 1);
      }
    } else {
      const w = words(parts[0]);
      let v = 0;
      while (v < w.length - 1 && isLowerWord(w[v])) v++;
      von = w.slice(0, v);
      last = w.slice(v);
      if (parts.length === 2) first = words(parts[1]);
      else {
        jr = words(parts[1]);
        first = words(parts.slice(2).join(","));
      }
    }
    const text = (w: string[]) => latexToText(w.join(" "));
    return { first: text(first), von: text(von), last: text(last), jr: text(jr) };
  });
}

/** "First von Last Jr", as the Citations plugin writes names. */
export function displayName(n: BibName): string {
  return n.literal ?? [n.first, n.von, n.last, n.jr].filter((x) => x).join(" ");
}

// ---- JabRef's file field -----------------------------------------------------

export interface LinkedFile {
  description: string;
  /** A path (absolute or relative to the file directory) or a URL. */
  link: string;
  type: string;
}

/** Removes JabRef's backslash escapes (`\:`, `\;`, `\\`). */
/** Removes JabRef's escapes (`\:`, `\;`, `\\`); other backslashes are path separators. */
function unescapeJabref(s: string): string {
  return s.replace(/\\([\\:;])/g, "$1");
}

/** JabRef's `file` field: `description:link:type` items separated by `;`, with `\` escapes. */
export function parseFileField(raw: string): LinkedFile[] {
  const split = (s: string, sep: string) => {
    const parts: string[] = [];
    let current = "";
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "\\" && "\\:;".includes(s[i + 1] ?? "")) current += s[i] + s[++i];
      else if (s[i] === sep) {
        parts.push(current);
        current = "";
      } else current += s[i];
    }
    parts.push(current);
    return parts;
  };
  return split(raw, ";")
    .filter((item) => item.trim() !== "")
    .map((item) => {
      const parts = split(item, ":").map(unescapeJabref);
      // A bare path with no description or type.
      if (parts.length === 1) return { description: "", link: parts[0].trim(), type: "" };
      // An unescaped drive letter (:C:\Papers\x.pdf:PDF) splits the link in two.
      if (parts.length >= 4 && /^[a-zA-Z]$/.test(parts[1]) && /^[\\/]/.test(parts[2])) {
        return { description: parts[0], link: `${parts[1]}:${parts[2]}`.trim(), type: parts[3] };
      }
      // Newer JabRef adds the URL the file was downloaded from as a fourth part.
      return { description: parts[0], link: (parts[1] ?? "").trim(), type: parts[2] ?? "" };
    });
}
