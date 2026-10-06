// Wikilinks in notes: `[[` autocomplete from the vault's notes, the syntax
// node both note parsers share (so nothing is suggested inside code or
// formulas), the link text Obsidian's "New link format" would write, and
// where a rendered link leads (obsidian://).

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { pickedCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";
import { obsidianUrl } from "../vault/notes";

/** What `vault_index` (src-tauri/src/vault_index.rs) returns. */
export interface VaultIndex {
  notes: IndexedNote[];
  /** Names notes link to that have no note, most linked first. */
  unresolved: { name: string; count: number }[];
}

export interface IndexedNote {
  /** Relative to the vault, forward slashes, with `.md`. */
  path: string;
  aliases: string[];
  headings: { level: number; text: string }[];
  blocks: string[];
}

/** Obsidian's "New link format" (Files and links). */
export type LinkFormat = "shortest" | "relative" | "absolute";

export interface WikilinkContext {
  index: VaultIndex | null;
  /** The vault's name, for obsidian:// links. */
  vaultName: string | null;
  format: LinkFormat;
  /** The note the text will end up in (the paper's literature note), for relative links. */
  from: string | null;
}

let context: WikilinkContext = { index: null, vaultName: null, format: "shortest", from: null };

/** Set by the app as the vault, its settings and the open paper change. */
export function setWikilinkContext(next: Partial<WikilinkContext>) {
  context = { ...context, ...next };
}

export function wikilinkContext(): WikilinkContext {
  return context;
}

// ---- Parsing -----------------------------------------------------------------

export interface Wikilink {
  /** The note as written (`Folder/note`), possibly empty (`[[#heading]]`). */
  note: string;
  /** After `#`: a heading, or `^id` for a block. */
  subpath: string | null;
  /** After `|`: the text shown. */
  alias: string | null;
  embed: boolean;
}

/** `note#sub|alias` (what's between the brackets). */
export function parseWikilink(inner: string, embed = false): Wikilink {
  const bar = inner.indexOf("|");
  const link = bar === -1 ? inner : inner.slice(0, bar);
  const alias = bar === -1 ? null : inner.slice(bar + 1).trim() || null;
  const hash = link.indexOf("#");
  return {
    note: (hash === -1 ? link : link.slice(0, hash)).trim(),
    subpath: hash === -1 ? null : link.slice(hash + 1).trim() || null,
    alias,
    embed,
  };
}

/**
 * The length of a wikilink starting at `pos` in `text` (`[[…]]`, or `![[…]]`
 * for an embed), or 0.
 */
export function wikilinkLength(text: string, pos: number): number {
  const start = text.charCodeAt(pos) === 33 /* ! */ ? pos + 1 : pos;
  if (text.charCodeAt(start) !== 91 || text.charCodeAt(start + 1) !== 91) return 0;
  const close = text.indexOf("]]", start + 2);
  if (close <= start + 2) return 0;
  const inner = text.slice(start + 2, close);
  // Note names can't hold brackets; a link stays on one line.
  if (/[[\]\n]/.test(inner) || !inner.trim()) return 0;
  return close + 2 - pos;
}

/** For CodeMirror's markdown parser: a `Wikilink` node, styled as a link. */
export const wikilinkSyntax: MarkdownConfig = {
  defineNodes: [{ name: "Wikilink", style: tags.link }],
  parseInline: [
    {
      name: "Wikilink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== 91 /* [ */) return -1;
        const length = wikilinkLength(cx.slice(pos, cx.end), 0);
        return length ? cx.addElement(cx.elt("Wikilink", pos, pos + length)) : -1;
      },
    },
    {
      // `![[…]]`, before the image syntax takes the `![`.
      name: "WikilinkEmbed",
      before: "Image",
      parse(cx, next, pos) {
        if (next !== 33 /* ! */) return -1;
        const length = wikilinkLength(cx.slice(pos, cx.end), 0);
        return length ? cx.addElement(cx.elt("Wikilink", pos, pos + length)) : -1;
      },
    },
  ],
};

// ---- Notes and link text -------------------------------------------------------

const stemOf = (path: string) => path.replace(/\.md$/i, "");
const baseOf = (stem: string) => stem.slice(stem.lastIndexOf("/") + 1);
const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** `a/b/../c` → `a/c`; null if it climbs out of the vault. */
function normalise(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

/** The note a link names (by path or name, ignoring case, as Obsidian does), if any. */
export function resolveNote(index: VaultIndex, name: string, from: string | null = null): IndexedNote | null {
  let target = stemOf(name.trim().replace(/\\/g, "/")).replace(/^\/+/, "");
  if (/^\.\.?\//.test(target)) target = normalise(`${folderOf(from ?? "")}/${target}`) ?? "";
  const key = target.toLowerCase();
  if (!key) return null;
  let byName: IndexedNote | null = null;
  for (const note of index.notes) {
    const stem = stemOf(note.path).toLowerCase();
    if (stem === key) return note;
    // Several notes of that name: the one nearest the root, as Obsidian prefers.
    if (!key.includes("/") && baseOf(stem) === key && (!byName || note.path.split("/").length < byName.path.split("/").length)) {
      byName = note;
    }
  }
  return byName;
}

/** How many notes have each name (lower case), to tell when a name alone is ambiguous. */
function nameCounts(index: VaultIndex): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of index.notes) {
    const base = baseOf(stemOf(note.path)).toLowerCase();
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return counts;
}

/** What goes between the brackets for a note, as Obsidian's "New link format" writes it. */
export function linkText(note: IndexedNote, format: LinkFormat, from: string | null, counts: Map<string, number>): string {
  const stem = stemOf(note.path);
  if (format === "absolute") return stem;
  if (format === "relative" && from !== null) {
    const fromParts = folderOf(from).split("/").filter(Boolean);
    const parts = stem.split("/");
    let common = 0;
    while (common < fromParts.length && common < parts.length - 1 && fromParts[common] === parts[common]) common++;
    return [...Array(fromParts.length - common).fill(".."), ...parts.slice(common)].join("/");
  }
  const base = baseOf(stem);
  return (counts.get(base.toLowerCase()) ?? 0) > 1 ? stem : base;
}

/** A heading as a link can name it: Obsidian leaves out characters links can't hold. */
export function headingLinkText(heading: string): string {
  return heading
    .replace(/[#^|[\]\\:]|%%/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The obsidian:// link opening the note a wikilink names (its heading isn't part of it). */
export function wikilinkUrl(link: Wikilink, ctx: WikilinkContext = context): string | null {
  if (!ctx.vaultName || !link.note) return null;
  const note = ctx.index ? resolveNote(ctx.index, link.note, ctx.from) : null;
  return obsidianUrl(ctx.vaultName, note ? note.path : link.note);
}

// ---- Autocomplete ---------------------------------------------------------------

/** Nodes inside which `[[` is text, not a link. */
const LITERAL = new Set(["InlineCode", "CodeText", "FencedCode", "CodeBlock", "Math", "URL", "Autolink"]);

function inLiteral(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (LITERAL.has(node.name)) return true;
  }
  return false;
}

/** Inserts `text]]` over the typed part (and a `]]` already after it), leaving the cursor after the link. */
function closing(text: string) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const end = view.state.sliceDoc(to, to + 2) === "]]" ? to + 2 : view.state.sliceDoc(to, to + 1) === "]" ? to + 1 : to;
    const insert = `${text}]]`;
    view.dispatch({
      changes: { from, to: end, insert },
      selection: { anchor: from + insert.length },
      userEvent: "input.complete",
      annotations: pickedCompletion.of(completion),
    });
  };
}

let cachedOptions: { index: VaultIndex; format: LinkFormat; from: string | null; options: Completion[] } | null = null;

/** Every note (and its aliases), then the names linked to but not created yet. */
export function noteOptions(ctx: WikilinkContext): Completion[] {
  const index = ctx.index;
  if (!index) return [];
  if (cachedOptions && cachedOptions.index === index && cachedOptions.format === ctx.format && cachedOptions.from === ctx.from) {
    return cachedOptions.options;
  }
  const counts = nameCounts(index);
  const options: Completion[] = [];
  for (const note of index.notes) {
    const stem = stemOf(note.path);
    const base = baseOf(stem);
    const text = linkText(note, ctx.format, ctx.from, counts);
    const ambiguous = (counts.get(base.toLowerCase()) ?? 0) > 1;
    options.push({ label: base, detail: ambiguous ? folderOf(note.path) || "/" : undefined, type: "text", apply: closing(text) });
    for (const alias of note.aliases) {
      options.push({ label: alias, detail: `alias of ${base}`, type: "text", apply: closing(`${text}|${alias}`) });
    }
  }
  for (const { name } of index.unresolved) {
    options.push({ label: name, detail: "not created yet", type: "text", boost: -20, apply: closing(name) });
  }
  cachedOptions = { index, format: ctx.format, from: ctx.from, options };
  return options;
}

/**
 * `[[` suggests the vault's notes; `[[note#` its headings; `[[note#^` its
 * block IDs. Not inside code or formulas.
 */
export function wikilinkCompletionSource(cx: CompletionContext, ctx: WikilinkContext = context): CompletionResult | null {
  if (!ctx.index) return null;
  const typed = cx.matchBefore(/\[\[[^[\]\n|]*$/);
  if (!typed || inLiteral(cx.state, typed.from)) return null;
  const inner = typed.text.slice(2);
  const start = typed.from + 2;
  const hash = inner.indexOf("#");
  if (hash === -1) return { from: start, options: noteOptions(ctx), validFor: /^[^[\]#|\n]*$/ };

  const note = resolveNote(ctx.index, inner.slice(0, hash), ctx.from);
  if (!note) return null;
  const sub = inner.slice(hash + 1);
  if (sub.startsWith("^")) {
    return {
      from: start + hash + 2,
      options: note.blocks.map((id) => ({ label: id, type: "constant", apply: closing(id) })),
      validFor: /^[\w-]*$/,
    };
  }
  return {
    from: start + hash + 1,
    options: note.headings.map((h) => {
      const text = headingLinkText(h.text);
      return { label: text, detail: `H${h.level}`, type: "property", apply: closing(text) };
    }),
    validFor: /^[^[\]#|^\n]*$/,
  };
}
