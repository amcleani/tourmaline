// The JabRef bibliography: which entry a PDF belongs to, searching entries,
// and the template variables the Obsidian Citations plugin gives each entry.

import { displayName, parseBibtex, parseFileField, type BibEntry } from "./bibtex";

export type MatchedBy = "file field" | "file name";

export interface EntryMatch {
  citekey: string;
  by: MatchedBy;
}

/** Forward slashes, `.` and `..` resolved, lower case (Windows paths ignore case). */
export function normalisePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "..") parts.length > 1 ? parts.pop() : parts.push(part);
    else if (part !== "." && (part !== "" || parts.length === 0)) parts.push(part);
  }
  return parts.join("/").toLowerCase();
}

const isAbsolute = (p: string) => /^([a-zA-Z]:)?[\\/]/.test(p);
const dirname = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
const basename = (p: string) => p.replace(/^.*[\\/]/, "");

export class Bibliography {
  readonly entries: ReadonlyMap<string, BibEntry>;
  /** Entries that couldn't be read. */
  readonly errors: string[];
  private byPath = new Map<string, string[]>();
  private byName = new Map<string, string[]>();
  private byLowerKey = new Map<string, string[]>();

  /** `path` is where the .bib file is: JabRef resolves relative file links against it. */
  constructor(
    text: string,
    readonly path: string,
  ) {
    const db = parseBibtex(text);
    this.errors = db.errors;
    const entries = new Map<string, BibEntry>();
    for (const e of db.entries) if (!entries.has(e.key)) entries.set(e.key, e);
    this.entries = entries;

    const bibDir = dirname(path);
    const fileDir = db.fileDirectory
      ? isAbsolute(db.fileDirectory)
        ? db.fileDirectory
        : `${bibDir}/${db.fileDirectory}`
      : bibDir;
    const add = (map: Map<string, string[]>, k: string, key: string) => {
      const list = map.get(k);
      if (!list) map.set(k, [key]);
      else if (!list.includes(key)) list.push(key);
    };
    for (const e of entries.values()) {
      add(this.byLowerKey, e.key.toLowerCase(), e.key);
      for (const f of e.raw.file ? parseFileField(e.raw.file) : []) {
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(f.link)) continue; // a URL
        add(this.byPath, normalisePath(isAbsolute(f.link) ? f.link : `${fileDir}/${f.link}`), e.key);
        add(this.byName, basename(f.link).toLowerCase(), e.key);
      }
    }
  }

  get(citekey: string): BibEntry | undefined {
    return this.entries.get(citekey);
  }

  /**
   * The entry a PDF belongs to: the entry whose JabRef `file` field names it
   * (by full path, else by file name if only one entry has that name), else
   * the citekey its name starts with ("Goodman2023GG - Grounding….pdf").
   */
  match(path: string): EntryMatch | null {
    const byPath = this.byPath.get(normalisePath(path));
    if (byPath?.length === 1) return { citekey: byPath[0], by: "file field" };
    const byName = this.byName.get(basename(path).toLowerCase());
    if (byName?.length === 1) return { citekey: byName[0], by: "file field" };

    const stem = basename(path).replace(/\.pdf$/i, "");
    // The longest prefix that ends at a space (or the whole name) and is a citekey.
    const ends = [stem.length, ...[...stem.matchAll(/\s/g)].map((m) => m.index!).reverse()];
    for (const end of ends) {
      const candidate = stem.slice(0, end).trim();
      if (!candidate) continue;
      if (this.entries.has(candidate)) return { citekey: candidate, by: "file name" };
      const other = this.byLowerKey.get(candidate.toLowerCase());
      if (other?.length === 1) return { citekey: other[0], by: "file name" };
    }
    return null;
  }

  /**
   * Entries matching every word of the query in their citekey, title,
   * authors, editors or year (ignoring case and accents), best first.
   */
  search(query: string, limit = 50): BibEntry[] {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const scored: { entry: BibEntry; score: number }[] = [];
    for (const entry of this.entries.values()) {
      const key = fold(entry.key);
      const haystack = searchText(entry);
      let score = 0;
      for (const w of words) {
        const at = haystack.indexOf(w);
        if (at === -1) {
          score = -1;
          break;
        }
        if (key.startsWith(w)) score += 10;
        else if (at === 0 || /\s/.test(haystack[at - 1])) score += 3;
        else score += 1;
      }
      if (score >= 0) scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key));
    return scored.slice(0, limit).map((s) => s.entry);
  }
}

/** Lower case without accents, for searching. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const searchTexts = new WeakMap<BibEntry, string>();
function searchText(e: BibEntry): string {
  let text = searchTexts.get(e);
  if (text === undefined) {
    const names = [...e.authors, ...e.editors].map(displayName).join(" ");
    text = fold([e.key, e.fields.title ?? "", names, e.fields.year ?? ""].join(" "));
    searchTexts.set(e, text);
  }
  return text;
}

// ---- The Citations plugin's template variables -------------------------------

/** "Andrew Bacon, Cian Dorr", as the Citations plugin writes authors. */
export function authorString(e: BibEntry): string | undefined {
  return e.authors.length ? e.authors.map(displayName).join(", ") : undefined;
}

/**
 * The variables the Citations plugin gives a BibLaTeX entry (its
 * `getTemplateVariablesForCitekey`), so templates written for it work here.
 * One difference: a year that isn't a number ("forthcoming") is kept as
 * written, where the plugin shows NaN.
 */
export function citationVariables(e: BibEntry): Record<string, unknown> {
  const f = e.fields;
  const yearText = f.year ?? (f.date ? String(new Date(f.date).getUTCFullYear()) : undefined);
  const year = yearText === undefined ? undefined : /^\d+/.test(yearText) ? String(parseInt(yearText, 10)) : yearText;
  // Later fields win, as in the plugin's mapping (journaltitle over journal over booktitle).
  const containerTitle =
    f.journaltitle ??
    f.journal ??
    f.booktitle ??
    (f.eprint
      ? `${f.eprinttype ? `${f.eprinttype}:` : ""}${f.eprint}${f.primaryclass ? ` [${f.primaryclass}]` : ""}`
      : undefined);
  const note = f.note?.replace(/(zotero:\/\/.+)/g, "[Link]($1)");
  const variables = {
    citekey: e.key,
    abstract: f.abstract,
    authorString: authorString(e),
    containerTitle,
    DOI: f.doi,
    eprint: f.eprint,
    eprinttype: f.eprinttype,
    eventPlace: f.venue,
    note,
    page: f.pages,
    publisher: f.publisher,
    publisherPlace: f.location,
    title: f.title,
    titleShort: f.shorttitle,
    URL: f.url,
    year,
    zoteroSelectURI: `zotero://select/items/@${e.key}`,
  };
  const entry = {
    ...variables,
    id: e.key,
    type: e.type,
    issued: f.date,
    event: f.eventtitle,
    containerTitleShort: f.shortjournal,
    author: e.authors.map((a) => ({ given: a.first || undefined, family: a.last || a.literal })),
    files: e.raw.file ? parseFileField(e.raw.file).map((x) => x.link) : [],
  };
  return { ...variables, entry };
}
