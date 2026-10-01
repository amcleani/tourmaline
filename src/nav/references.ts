// References inside a paper: what a citation, "Figure 2" or "Eq. (3)"
// points to, for papers whose links are missing (no hyperref, scans with a
// text layer, JSTOR copies). The bibliography is read from the lines after
// its heading; citations are then found in the text by pattern, numeric
// ("[12]", "[2, 5–7]") or author-year ("Lewis (1986)", "(Fine 2012a, p. 3)",
// "Bacon and Dorr 2024"), keeping only those that match an entry.
//
// Pure functions over the lines of focus/lines.ts, so they are tested
// without pdf.js.

import type { PageRect } from "../annotations/types";
import type { PageText, PdfRect, TextItemLike } from "../pdf/search";
import type { Line } from "../focus/lines";
import { captionRegion, type FocusPage } from "../focus/steps";

// ---- The bibliography ------------------------------------------------------------

export interface BibEntry {
  /** "12" for "[12]" or "12.", "BD24" for "[BD24]"; null in author-year lists. */
  label: string | null;
  /** Capitalised words before the year: the authors' names (first names too, harmlessly). */
  names: string[];
  /** "1986" or "1986a"; null if none. */
  year: string | null;
  text: string;
  rects: PageRect[];
}

const HEADING = /^(?:\d+(?:\.\d+)*\.?\s+|[A-Z]\.\s+)?(references|bibliography|works cited|literature cited|literature|cited works|reference list)\s*$/i;
const END = /^(?:appendix|appendices|index|notes|endnotes|supplementary)\b/i;
const YEAR = /(?<![\d.])(1[5-9]\d\d|20\d\d)([a-z])?(?!\d)/;
const LABEL = /^\s*(?:\[([^\]]{1,12})\]|(\d{1,3})\.(?=\s))/;
const DASHES = /^\s*(?:[—–]+|[-_]{2,})/;

const heightOf = (l: Line) => l.bbox[3] - l.bbox[1];

/** The lines after the last bibliography heading, with their pages; empty if there is none. */
export function bibliographyLines(pages: readonly FocusPage[]): { page: number; line: Line }[] {
  for (let p = pages.length - 1; p >= 0; p--) {
    const lines = pages[p].lines;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!HEADING.test(lines[i].text.trim())) continue;
      const out: { page: number; line: Line }[] = [];
      const take = (page: number, from: Line[]) => {
        for (const line of from) {
          if (END.test(line.text.trim()) && heightOf(line) >= heightOf(lines[i]) * 0.9) return false;
          out.push({ page, line });
        }
        return true;
      };
      if (take(pages[p].page, lines.slice(i + 1))) {
        for (let q = p + 1; q < pages.length; q++) if (!take(pages[q].page, [...pages[q].lines])) break;
      }
      return out;
    }
  }
  return [];
}

/** Splits bibliography lines into entries: by label, hanging indent, or the space between entries. */
export function parseBibliography(lines: readonly { page: number; line: Line }[]): BibEntry[] {
  // Page numbers and running heads aren't entries.
  const body = lines.filter(({ line }) => !/^\s*\d{1,4}\s*$/.test(line.text));
  if (body.length === 0) return [];
  const labelled = body.filter(({ line }) => LABEL.test(line.text)).length >= Math.min(3, body.length);

  // Each column's left edge (page + column), and whether entries hang (later lines indented).
  const edge = new Map<string, number>();
  const where = (b: { page: number; line: Line }) => `${b.page}:${b.line.column}`;
  for (const b of body) edge.set(where(b), Math.min(edge.get(where(b)) ?? Infinity, b.line.bbox[0]));
  const size = median(body.map((b) => heightOf(b.line)));
  const indented = (b: { page: number; line: Line }) => b.line.bbox[0] > edge.get(where(b))! + 0.6 * size;
  const hanging = body.filter(indented).length >= 0.2 * body.length;
  const gaps: number[] = [];
  body.forEach((b, i) => {
    const prev = body[i - 1];
    if (prev && prev.page === b.page && prev.line.column === b.line.column) gaps.push(prev.line.bbox[1] - b.line.bbox[3]);
  });
  const typicalGap = median(gaps);

  const starts = body.map((b, i) => {
    if (i === 0) return true;
    if (labelled) return LABEL.test(b.line.text);
    if (hanging) return !indented(b);
    const prev = body[i - 1];
    if (prev.page !== b.page || prev.line.column !== b.line.column) return /^\s*\p{Lu}/u.test(b.line.text);
    return prev.line.bbox[1] - b.line.bbox[3] > typicalGap + 0.3 * size;
  });

  const entries: BibEntry[] = [];
  let current: { page: number; line: Line }[] = [];
  const flush = () => {
    if (!current.length) return;
    const text = current
      .map((c) => c.line.text.trim())
      .join(" ")
      .replace(/(\p{L})- (\p{Ll})/gu, "$1$2");
    const label = labelled ? (LABEL.exec(text)?.[1] ?? LABEL.exec(text)?.[2] ?? null) : null;
    const year = YEAR.exec(text);
    const authors = (year ? text.slice(0, year.index) : text.slice(0, 80)).replace(LABEL, "");
    let names = [...authors.matchAll(/\p{Lu}[\p{L}'’-]+/gu)].map((m) => m[0]).filter((n) => n.length > 1);
    // "——— 1986b.": the same authors as the entry before.
    if (DASHES.test(authors) && entries.length) names = entries[entries.length - 1].names;
    entries.push({
      label,
      names,
      year: year ? year[1] + (year[2] ?? "") : null,
      text,
      rects: current.map((c) => [c.page, ...c.line.bbox] as PageRect),
    });
    current = [];
  };
  body.forEach((b, i) => {
    if (starts[i]) flush();
    current.push(b);
  });
  flush();
  return entries;
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

// ---- Citations in the text ----------------------------------------------------------

/** The page's text as found by search, with its capitals back (search text is folded to lower case). */
export function casedText(page: PageText, items: ReadonlyArray<unknown>): string {
  let out = "";
  for (let i = 0; i < page.text.length; i++) {
    const c = page.text[i];
    const src = page.source[i];
    const original = src ? (items[src[0]] as TextItemLike).str.codePointAt(src[1]) : undefined;
    const upper = original !== undefined && String.fromCodePoint(original) !== String.fromCodePoint(original).toLowerCase();
    const u = c.toUpperCase();
    out += upper && u.length === 1 ? u : c;
  }
  return out;
}


export type CitationTarget =
  | { kind: "entry"; entry: number }
  | { kind: "figure" | "table"; label: string }
  | { kind: "equation"; label: string }
  | { kind: "section"; label: string }
  /** "Theorem 2", "Lemma 3.1", "Definition 4". */
  | { kind: "theorem"; name: string; label: string };

export interface Citation {
  /** Offsets in the text searched. */
  start: number;
  end: number;
  target: CitationTarget;
}

/** Expands "2, 5–7" into ["2", "5", "6", "7"] (and keeps "BD24"-style labels). */
function labelsIn(list: string): string[] | null {
  const out: string[] = [];
  for (const part of list.split(/[,;]/)) {
    const p = part.trim();
    const range = /^(\d+)\s*[–—-]\s*(\d+)$/.exec(p);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      if (b < a || b - a > 30) return null;
      for (let n = a; n <= b; n++) out.push(String(n));
    } else if (/^\d+$/.test(p) || /^[A-Z][A-Za-z+]*\d{2,4}[a-z]?$/.test(p)) out.push(p);
    else return null;
  }
  return out.length ? out : null;
}

const NAME = "\\p{Lu}[\\p{L}'’-]+";

export const THEOREM_NAMES = [
  "Theorem", "Lemma", "Proposition", "Corollary", "Definition", "Claim", "Conjecture",
  "Example", "Remark", "Fact", "Observation", "Axiom", "Postulate", "Principle", "Thesis",
];

/**
 * Citations in a text (with its original capitals), matched to the
 * bibliography: only those that point to an entry are returned, so stray
 * brackets and years don't become links. A bare "(2)" is an equation only
 * if the document numbers an equation so (`equations`).
 */
export function findCitations(text: string, entries: readonly BibEntry[], equations: ReadonlySet<string> = new Set()): Citation[] {
  const out: Citation[] = [];
  const byLabel = new Map<string, number>();
  entries.forEach((e, i) => e.label && !byLabel.has(e.label) && byLabel.set(e.label, i));

  // [12], [2, 5–7], [BD24]: one citation per label, each over its own label.
  for (const m of text.matchAll(/\[([^\[\]]{1,60})\]/g)) {
    const labels = labelsIn(m[1]);
    if (!labels || !labels.every((l) => byLabel.has(l))) continue;
    if (labels.length === 1) {
      out.push({ start: m.index, end: m.index + m[0].length, target: { kind: "entry", entry: byLabel.get(labels[0])! } });
      continue;
    }
    // Each listed label is its own spot ("2" and "5" in "[2, 5]"); a range points to its first.
    let from = m.index + 1;
    for (const part of m[1].split(/[,;]/)) {
      const at = text.indexOf(part.trim(), from);
      const first = labelsIn(part)?.[0];
      if (at !== -1 && first) out.push({ start: at, end: at + part.trim().length, target: { kind: "entry", entry: byLabel.get(first)! } });
      from = at + part.length;
    }
  }

  // Author-year: a name from the bibliography, then (after "and Other", "et al.",
  // "’s", a bracket or a comma) one or more years.
  // (Not with a numbered bibliography: its entries' "names" include title words.)
  const names = new Set(byLabel.size ? [] : entries.flatMap((e) => (e.year ? e.names : [])));
  if (names.size) {
    const re = new RegExp(
      `(${NAME})(?:(?:,? (?:and|&) ${NAME})+| et al\\.?)?(?:['’]s)?[ ,]*\\(?\\s*((?:1[5-9]|20)\\d\\d[a-z]?)`,
      "gu",
    );
    for (const m of text.matchAll(re)) {
      if (!names.has(m[1])) continue;
      const surname = m[1];
      const cite = (year: string, start: number, end: number) => {
        const entry = matchEntry(entries, surname, year);
        if (entry !== -1) out.push({ start, end, target: { kind: "entry", entry } });
      };
      const yearEnd = m.index + m[0].length;
      cite(m[2], m.index, yearEnd);
      // "Lewis (1973, 1986a)", "Lewis 1983; 1986": more years of the same author.
      // Separators, each perhaps with a page ("p. 3", "ch. 2", "§4"), then the year.
      const more = /^((?:\s*[,;]\s*(?:(?:p{1,2}\.|ch\.|§)\s*[\dxvi–-]+)?)+\s*)((?:1[5-9]|20)\d\d[a-z]?)/u;
      let at = yearEnd;
      for (let k = 0; k < 6; k++) {
        const next = more.exec(text.slice(at, at + 40));
        if (!next) break;
        const start = at + next[1].length;
        cite(next[2], start, start + next[2].length);
        at = start + next[2].length;
      }
    }
  }

  // Figures, tables, equations, sections.
  for (const m of text.matchAll(/\b(Figures?|Figs?\.|Tables?|Tab\.)\s*(\d+(?:\.\d+)?[a-z]?)/g)) {
    const kind = /^t/i.test(m[1]) ? "table" : "figure";
    out.push({ start: m.index, end: m.index + m[0].length, target: { kind, label: m[2] } });
  }
  for (const m of text.matchAll(/\b(?:Eqs?\.|Equations?)\s*\(?(\d+(?:\.\d+)?[a-z]?)\)?/g)) {
    out.push({ start: m.index, end: m.index + m[0].length, target: { kind: "equation", label: m[1] } });
  }
  for (const m of text.matchAll(/\b(?:Sections?|Sect?\.|§)\s*(\d+(?:\.\d+)*)/g)) {
    out.push({ start: m.index, end: m.index + m[0].length, target: { kind: "section", label: m[1] } });
  }
  const theorems = new RegExp(`\\b(${THEOREM_NAMES.join("|")})s?\\s+(\\d+(?:\\.\\d+)*[a-z]?)`, "g");
  for (const m of text.matchAll(theorems)) {
    out.push({ start: m.index, end: m.index + m[0].length, target: { kind: "theorem", name: m[1], label: m[2] } });
  }
  if (equations.size) {
    for (const m of text.matchAll(/\((\d{1,3}(?:\.\d+)?[a-z]?)\)/g)) {
      if (equations.has(m[1])) out.push({ start: m.index, end: m.index + m[0].length, target: { kind: "equation", label: m[1] } });
    }
  }
  // Overlaps (an author-year match inside a bracket already taken): keep the first.
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  let end = -1;
  return out.filter((c) => {
    if (c.start < end) return false;
    end = c.end;
    return true;
  });
}

/** The entry by `surname` from `year` ("1986a" also matches "1986" if that's all there is). */
export function matchEntry(entries: readonly BibEntry[], surname: string, year: string): number {
  const candidates = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.names.includes(surname));
  const exact = candidates.filter(({ e }) => e.year === year);
  const pick = (list: typeof candidates) => (list.find(({ e }) => e.names[0] === surname) ?? list[0])?.i ?? -1;
  if (exact.length) return pick(exact);
  // "Bacon 2018" for an entry listed as 2018a: only if it is the one such entry.
  const near = candidates.filter(({ e }) => e.year?.slice(0, 4) === year.slice(0, 4) && year.length === 4);
  return near.length === 1 ? near[0].i : -1;
}

// ---- Where figures, equations and sections are ---------------------------------------

/** A line that captions `label` ("Figure 2:", "Fig. 2.", "Table 2"). */
export function isCaption(line: Line, kind: "figure" | "table", label: string): boolean {
  const word = kind === "figure" ? "(?:Figure|Fig\\.?)" : "(?:Table|Tab\\.?)";
  return new RegExp(`^${word}\\s*${label.replace(".", "\\.")}(?:[.:—–\\s]|$)`, "i").test(line.text.trim());
}

/**
 * The number of a displayed equation on a line: a "(2)" text item at its
 * right end (stacked formulas such as matrices put it mid-text, but never
 * anywhere but rightmost). Null if none.
 */
export function equationLabel(page: FocusPage, line: Line): string | null {
  for (const index of line.items) {
    const item = page.items[index] as TextItemLike | undefined;
    const m = item && /^\((\d{1,3}(?:\.\d+)?[a-z]?)\)$/.exec(item.str.trim());
    if (m && item.transform[4] + item.width >= line.bbox[2] - 2) return m[1];
  }
  // Some PDFs split "(", "2", ")" into items: then the text must end with it.
  return /\((\d{1,3}(?:\.\d+)?[a-z]?)\)\s*$/.exec(line.text.trim())?.[1] ?? null;
}

/** A theorem-like statement: a line starting "Theorem 2." or "Lemma 3.1 (Name)". */
export function isTheorem(line: Line, name: string, label: string): boolean {
  return new RegExp(`^${name}\\s+${label.replace(/\./g, "\\.")}(?:[.:(\\s]|$)`).test(line.text.trim());
}

/** The equation numbers of a page. */
export function equationNumbers(page: FocusPage): string[] {
  return page.lines.flatMap((l) => equationLabel(page, l) ?? []);
}

/** A heading numbered `label` ("2 Model", "2.1. Results"). */
export function isSection(line: Line, label: string, next: Line | undefined): boolean {
  const m = new RegExp(`^${label.replace(/\./g, "\\.")}\\.?\\s+(\\p{Lu}.*)$`, "u").exec(line.text.trim());
  if (!m || /[.,;]$/.test(m[1]) || m[1].length > 90) return false;
  // Headings are larger than the text below, or set apart.
  return !next || heightOf(line) > heightOf(next) * 1.1 || line.bbox[1] - next.bbox[3] > 0.6 * heightOf(next);
}

/**
 * Whether line `i` of a page is what a figure, table, equation, section or
 * theorem reference points to, and if so the region to show.
 */
export function targetIn(page: FocusPage, i: number, target: Exclude<CitationTarget, { kind: "entry" }>): PdfRect | null {
  const line = page.lines[i];
  switch (target.kind) {
    case "figure":
    case "table":
      if (!isCaption(line, target.kind, target.label)) return null;
      return captionRegion(page, line) ?? around(page, blockFrom(page, i, 3));
    case "equation":
      return equationLabel(page, line) === target.label ? around(page, [line]) : null;
    case "theorem":
      return isTheorem(line, target.name, target.label) ? around(page, blockFrom(page, i, 6)) : null;
    case "section":
      return isSection(line, target.label, page.lines[i + 1])
        ? around(page, page.lines.slice(i, i + 4).filter((l) => l.column === line.column))
        : null;
  }
}

/** Lines of a page in one column from `start`, while they look like one block (at most `max`). */
export function blockFrom(page: FocusPage, start: number, max: number): Line[] {
  const lines = page.lines;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length && out.length < max; i++) {
    const prev = out[out.length - 1];
    const line = lines[i];
    if (line.column !== prev.column || prev.bbox[1] - line.bbox[3] > 1.2 * heightOf(prev)) break;
    out.push(line);
  }
  return out;
}

/** The smallest rectangle around some lines, widened to their column, with a margin. */
export function around(page: FocusPage, lines: readonly Line[], margin = 4): PdfRect {
  const column = lines[0].column;
  const own = page.lines.filter((l) => l.column === column);
  const x0 = Math.min(...own.map((l) => l.bbox[0]), ...lines.map((l) => l.bbox[0]));
  const x1 = Math.max(...own.map((l) => l.bbox[2]), ...lines.map((l) => l.bbox[2]));
  return [
    x0 - margin,
    Math.min(...lines.map((l) => l.bbox[1])) - margin,
    x1 + margin,
    Math.max(...lines.map((l) => l.bbox[3])) + margin,
  ];
}

/**
 * What a link's destination shows, as a rectangle of its page: the lines
 * from the point it names down to the end of that block (a bibliography
 * entry, a paragraph's start), or, if the space below the point is empty
 * (a figure), down to the caption that follows.
 */
export function regionAt(page: FocusPage, y: number | null, x: number | null = null): PdfRect {
  const lines = page.lines;
  const top = y ?? Math.max(...lines.map((l) => l.bbox[3]), page.top ?? 0);
  // The first line in reading order whose top is at or below the point (in the column of x, if known).
  const inColumn = (l: Line) => x === null || l.column === -1 || (l.bbox[0] <= x + 20 && l.bbox[2] >= x - 20);
  let start = lines.findIndex((l) => l.bbox[3] <= top + 2 && inColumn(l));
  if (start === -1) start = lines.findIndex((l) => l.bbox[3] <= top + 2);
  if (start === -1) return [0, Math.max(0, top - 200), 612, top];
  const first = lines[start];
  const size = heightOf(first);
  // An empty band first: a figure, shown down to its caption.
  if (top - first.bbox[3] > 4 * size) {
    const caption = lines.slice(start).find((l) => /^(fig(ure)?|table|tab)\.?\s*[\dIVX]/i.test(l.text.trim()));
    const end = caption ?? first;
    const rect = around(page, [end]);
    return [rect[0], rect[1], rect[2], top + 4];
  }
  return around(page, blockFrom(page, start, 6));
}
