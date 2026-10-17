// Exporting a paper's annotations into the vault (phase 4c). Tourmaline owns
// one section of one note, between `%% tourmaline:begin %%` and
// `%% tourmaline:end %%`; everything outside it is the user's and is never
// rewritten. By default the section sits under `# Annotations` in the
// literature note (PLAN.md, "Where highlights go").
//
// This module is pure: rendering the section and merging it into a note's
// text. Reading and writing files is App.tsx's (through platform/index.ts).

import type { Annotation, Category } from "../annotations/types";
import type { OutlineNode } from "../pdf/outline";
import { DEFAULT_HIGHLIGHT_TEMPLATE, highlightVariables, literatureNotePath, type VaultSettings } from "./notes";
import { renderTemplate } from "./templates";

export const REGION_BEGIN = "%% tourmaline:begin %%";
export const REGION_END = "%% tourmaline:end %%";

/** The highlights section: every highlight, rendered with the highlight template, one after another. */
export const DEFAULT_SECTION_TEMPLATE = `{{#each highlights}}
{{markdown}}
{{/each}}`;

export const DEFAULT_HEADING = "# Annotations";
export const DEFAULT_SEPARATE_TITLE = "@{{citekey}} highlights";

/** What a filter can choose by kind (ink isn't exported). */
export type ExportKind = "highlight" | "area" | "note";
export const EXPORT_KINDS: { value: ExportKind; label: string }[] = [
  { value: "highlight", label: "Highlights" },
  { value: "area", label: "Area captures" },
  { value: "note", label: "Notes (without highlighted text)" },
];

/** Stands for annotations without a category in a filter's category list. */
export const NO_CATEGORY = "none";

/** Which annotations an export writes. */
export interface ExportFilter {
  /** Category ids (NO_CATEGORY for none); null for every category. */
  categories: string[] | null;
  /** Only annotations with a note written on them. */
  withNote: boolean;
  kinds: ExportKind[];
  /** Annotations not found again in a new version of the PDF (exported last, without a page). */
  includeUnplaced: boolean;
}

export type ExportGrouping = "none" | "category" | "section";

/** A named way of exporting: which annotations, and how they're grouped. */
export interface ExportPreset {
  id: string;
  name: string;
  filter: ExportFilter;
  groupBy: ExportGrouping;
}

export const EVERYTHING: ExportFilter = { categories: null, withNote: false, kinds: ["highlight", "area", "note"], includeUnplaced: true };
export const DEFAULT_PRESET: ExportPreset = { id: "everything", name: "Everything", filter: EVERYTHING, groupBy: "none" };

export interface ExportSettings {
  /** Under a heading in the literature note, or alone in a note of their own. */
  destination: "heading" | "note";
  /** The heading the section goes under (destination "heading"). */
  heading: string;
  /** Title template of the separate note (destination "note"), in the literature note folder. */
  separateTitle: string;
  highlightTemplate: string;
  sectionTemplate: string;
  /** Literature note title, folder and new-note template; null = the Citations plugin's. */
  noteTitle: string | null;
  noteFolder: string | null;
  noteTemplate: string | null;
  presets: ExportPreset[];
  /** The preset Export to Obsidian (Ctrl+Shift+X) uses. */
  defaultPreset: string;
  /** Highlight templates of their own, by category id; the others use highlightTemplate. */
  categoryTemplates: Record<string, string>;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  destination: "heading",
  heading: DEFAULT_HEADING,
  separateTitle: DEFAULT_SEPARATE_TITLE,
  highlightTemplate: DEFAULT_HIGHLIGHT_TEMPLATE,
  sectionTemplate: DEFAULT_SECTION_TEMPLATE,
  noteTitle: null,
  noteFolder: null,
  noteTemplate: null,
  presets: [DEFAULT_PRESET],
  defaultPreset: DEFAULT_PRESET.id,
  categoryTemplates: {},
};

const GROUPINGS: ExportGrouping[] = ["none", "category", "section"];

function parsePreset(value: unknown): ExportPreset | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const f = (v.filter && typeof v.filter === "object" ? v.filter : {}) as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id || typeof v.name !== "string" || !v.name.trim()) return null;
  const kinds = Array.isArray(f.kinds) ? EXPORT_KINDS.map((k) => k.value).filter((k) => (f.kinds as unknown[]).includes(k)) : EVERYTHING.kinds;
  return {
    id: v.id,
    name: v.name.trim(),
    filter: {
      categories: Array.isArray(f.categories) ? f.categories.filter((c): c is string => typeof c === "string") : null,
      withNote: f.withNote === true,
      kinds,
      includeUnplaced: f.includeUnplaced !== false,
    },
    groupBy: GROUPINGS.includes(v.groupBy as ExportGrouping) ? (v.groupBy as ExportGrouping) : "none",
  };
}

function parsePresets(saved: Record<string, unknown>): Pick<ExportSettings, "presets" | "defaultPreset"> {
  const ids = new Set<string>();
  const presets: ExportPreset[] = [];
  for (const value of Array.isArray(saved.presets) ? saved.presets : []) {
    const preset = parsePreset(value);
    if (!preset || ids.has(preset.id)) continue;
    ids.add(preset.id);
    presets.push(preset);
  }
  if (!presets.length) presets.push(DEFAULT_PRESET);
  const chosen = typeof saved.defaultPreset === "string" && presets.some((p) => p.id === saved.defaultPreset) ? saved.defaultPreset : presets[0].id;
  return { presets, defaultPreset: chosen };
}

function parseCategoryTemplates(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== ""),
  );
}

/** Saved settings, with defaults for anything missing or of the wrong type. */
export function parseExportSettings(json: string | null): ExportSettings {
  let saved: Record<string, unknown> = {};
  try {
    const value: unknown = json ? JSON.parse(json) : {};
    if (value && typeof value === "object") saved = value as Record<string, unknown>;
  } catch {
    // Unreadable: defaults.
  }
  const text = (key: keyof ExportSettings) => (typeof saved[key] === "string" ? (saved[key] as string) : null);
  const s = DEFAULT_EXPORT_SETTINGS;
  return {
    destination: saved.destination === "note" ? "note" : "heading",
    heading: text("heading")?.trim() || s.heading,
    separateTitle: text("separateTitle")?.trim() || s.separateTitle,
    highlightTemplate: text("highlightTemplate") ?? s.highlightTemplate,
    sectionTemplate: text("sectionTemplate") ?? s.sectionTemplate,
    noteTitle: text("noteTitle"),
    noteFolder: text("noteFolder"),
    noteTemplate: text("noteTemplate"),
    ...parsePresets(saved),
    categoryTemplates: parseCategoryTemplates(saved.categoryTemplates),
  };
}

/** Whether two sets of choices export the same thing (lists compared as sets). */
export function sameChoices(a: Pick<ExportPreset, "filter" | "groupBy">, b: Pick<ExportPreset, "filter" | "groupBy">): boolean {
  const sameSet = (x: readonly string[] | null, y: readonly string[] | null) =>
    x === null || y === null ? x === y : x.length === y.length && x.every((v) => y.includes(v));
  return (
    a.groupBy === b.groupBy &&
    a.filter.withNote === b.filter.withNote &&
    a.filter.includeUnplaced === b.filter.includeUnplaced &&
    sameSet(a.filter.kinds, b.filter.kinds) &&
    sameSet(a.filter.categories, b.filter.categories)
  );
}

/** The preset Export to Obsidian uses. */
export const defaultPreset = (s: Pick<ExportSettings, "presets" | "defaultPreset">): ExportPreset =>
  s.presets.find((p) => p.id === s.defaultPreset) ?? s.presets[0] ?? DEFAULT_PRESET;

/** The highlight template for a category's annotations: its own, else the shared one. */
export const highlightTemplateFor = (s: Pick<ExportSettings, "highlightTemplate"> & { categoryTemplates?: Record<string, string> }, categoryId: string | null) =>
  (categoryId && s.categoryTemplates?.[categoryId]) || s.highlightTemplate;

// ---- Where -------------------------------------------------------------------

/** The Citations plugin's note settings, with the user's overrides. */
export function noteSettings(citations: VaultSettings["citations"], s: ExportSettings): VaultSettings["citations"] {
  return {
    ...citations,
    noteTitleTemplate: s.noteTitle ?? citations.noteTitleTemplate,
    noteFolder: (s.noteFolder ?? citations.noteFolder).replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
    noteTemplate: s.noteTemplate ?? citations.noteTemplate,
  };
}

/** The note the section goes into, relative to the vault. */
export function exportNotePath(citations: VaultSettings["citations"], s: ExportSettings, entry: Record<string, unknown>): string {
  const notes = noteSettings(citations, s);
  return s.destination === "note"
    ? literatureNotePath({ ...notes, noteTitleTemplate: s.separateTitle }, entry)
    : literatureNotePath(notes, entry);
}

/**
 * The folder area images go into, from Obsidian's "Default location for new
 * attachments": the vault root (unset or "/"), next to the note ("./" or
 * "./sub"), or a vault folder.
 */
export function attachmentFolder(setting: string | null, notePath: string): string {
  const s = (setting ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (s === "." || s.startsWith("./")) {
    const noteFolder = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
    const sub = s.slice(2);
    return [noteFolder, sub].filter(Boolean).join("/");
  }
  return s;
}

/** The vault file name of an area annotation's image (block ids never change, so neither does this). */
export const imageFileName = (a: Annotation) => `tourmaline-${a.blockId}.png`;

// ---- What --------------------------------------------------------------------

export interface SectionInput {
  annotations: readonly Annotation[];
  categories: readonly Category[];
  /** The page as printed for a 0-based page. */
  pageLabel: (page: number) => string;
  /** The Citations plugin's variables for the paper. */
  entry: Record<string, unknown>;
  /** The PDF's file name, for {{pdfLink}}. */
  fileName?: string;
  /** The PDF's outline, for grouping by section. */
  outline?: readonly OutlineNode[] | null;
}

const isPlaced = (a: Annotation) => !!a.placement && a.placement.status !== "orphan";

/** Where an annotation starts: its page and the top of its first rectangle there (PDF y grows upward); unplaced: null. */
function startOf(a: Annotation): { page: number; top: number } | null {
  const p = a.placement;
  if (!p || p.status === "orphan") return null;
  const first = p.geometry.rects.filter((r) => r[0] === p.page);
  return { page: p.page, top: Math.max(...first.map((r) => Math.max(r[2], r[4])), -Infinity) };
}

/**
 * An annotation's category for filters and groups: its own while that
 * category exists (given the categories), else NO_CATEGORY — a deleted
 * category can't be chosen, so its annotations count as having none.
 */
export function exportCategory(a: Annotation, categories?: readonly Category[]): string {
  if (!a.categoryId) return NO_CATEGORY;
  if (!categories) return a.categoryId;
  return categories.some((c) => c.id === a.categoryId && !c.deleted) ? a.categoryId : NO_CATEGORY;
}

/** Whether an export with this filter writes an annotation. */
export function passes(a: Annotation, f: ExportFilter, categories?: readonly Category[]): boolean {
  if (a.kind === "ink" || !f.kinds.includes(a.kind)) return false;
  if (f.withNote && !a.note.trim()) return false;
  if (f.categories && !f.categories.includes(exportCategory(a, categories))) return false;
  return f.includeUnplaced || isPlaced(a);
}

/** The annotations that go into notes (all but ink, or those a filter lets through), in reading order; unplaced last. */
export function exportable(
  annotations: readonly Annotation[],
  filter: ExportFilter = EVERYTHING,
  categories?: readonly Category[],
): Annotation[] {
  const key = (a: Annotation): [number, number] => {
    const at = startOf(a);
    return at ? [at.page, -at.top] : [Infinity, 0];
  };
  return annotations
    .filter((a) => passes(a, filter, categories))
    .map((a) => ({ a, at: key(a) }))
    .sort((x, y) => x.at[0] - y.at[0] || x.at[1] - y.at[1] || x.a.created - y.a.created)
    .map(({ a }) => a);
}

/** Outline entries in reading order, each with where it starts (no y: the top of its page). */
function outlineMarks(outline: readonly OutlineNode[]): { title: string; page: number; top: number }[] {
  const out: { title: string; page: number; top: number; order: number }[] = [];
  const walk = (nodes: readonly OutlineNode[]) => {
    for (const n of nodes) {
      if (n.target) out.push({ title: n.title, page: n.target.page, top: n.target.y ?? Infinity, order: out.length });
      walk(n.children);
    }
  };
  walk(outline);
  // Parents before children at the same place, so the deeper entry is the later one.
  return out.sort((x, y) => x.page - y.page || y.top - x.top || x.order - y.order);
}

export const UNPLACED_GROUP = "Not found in this version of the PDF";
const NO_CATEGORY_GROUP = "No category";

/** The annotations (in reading order) split into titled groups, in order; one untitled group when not grouping. */
export function groupAnnotations(
  annotations: readonly Annotation[],
  groupBy: ExportGrouping,
  categories: readonly Category[],
  outline: readonly OutlineNode[] | null | undefined,
): { title: string | null; annotations: Annotation[] }[] {
  const marks = groupBy === "section" && outline ? outlineMarks(outline) : [];
  if (groupBy === "none" || (groupBy === "section" && marks.length === 0)) return [{ title: null, annotations: [...annotations] }];
  const groups = new Map<string, Annotation[]>();
  const add = (title: string, a: Annotation) => {
    const list = groups.get(title);
    if (list) list.push(a);
    else groups.set(title, [a]);
  };
  if (groupBy === "category") {
    // By category id (two categories may share a name), in the categories'
    // own order, those without one (or with a deleted one) last.
    const live = categories.filter((c) => !c.deleted);
    const byCategory = new Map<string, Annotation[]>();
    for (const a of annotations) {
      const key = exportCategory(a, live);
      byCategory.set(key, [...(byCategory.get(key) ?? []), a]);
    }
    return [...live.map((c) => ({ id: c.id, title: c.name })), { id: NO_CATEGORY, title: NO_CATEGORY_GROUP }]
      .filter((g) => byCategory.has(g.id))
      .map((g) => ({ title: g.title, annotations: byCategory.get(g.id)! }));
  }
  for (const a of annotations) {
    const at = startOf(a);
    if (!at) {
      add(UNPLACED_GROUP, a);
      continue;
    }
    let section: string | null = null;
    for (const m of marks) {
      if (m.page < at.page || (m.page === at.page && m.top >= at.top)) section = m.title;
      else break;
    }
    add(section ?? `Before “${marks[0].title}”`, a);
  }
  // A Map keeps first appearance, which is reading order (unplaced last).
  return [...groups.entries()].map(([title, list]) => ({ title, annotations: list }));
}

/** The level of group subheadings: one below the export heading (in a note of their own: level 2). */
export function groupHeadingLevel(s: Pick<ExportSettings, "destination" | "heading">): number {
  const level = s.destination === "heading" ? (/^(#{1,6})(?:\s|$)/.exec(s.heading.trim())?.[1].length ?? 1) : 1;
  return Math.min(6, level + 1);
}

type BlockSettings = Pick<ExportSettings, "highlightTemplate"> & Partial<Pick<ExportSettings, "categoryTemplates">>;

/** One annotation's template variables, with its rendered `markdown`. */
function highlightBlock(s: BlockSettings, input: SectionInput, a: Annotation) {
  const vars = highlightVariables({
    annotation: a,
    category: input.categories.find((c) => c.id === a.categoryId),
    pageLabel: isPlaced(a) ? input.pageLabel(a.placement!.page) : "?",
    entry: input.entry,
    fileName: input.fileName,
  });
  if (a.kind === "area" && a.imagePath) vars.image = `![[${imageFileName(a)}]]`;
  return { ...vars, markdown: renderTemplate(highlightTemplateFor(s, a.categoryId), vars) };
}

/** One annotation as the export writes it (the highlight template's output). Throws TemplateError. */
export const renderAnnotation = (s: BlockSettings, input: SectionInput, a: Annotation): string => String(highlightBlock(s, input, a).markdown);

/**
 * The text of Tourmaline's section (without its markers): each highlight
 * rendered with the highlight template, then the lot with the section
 * template. Throws TemplateError if a template is broken.
 */
export function renderSection(
  s: Pick<ExportSettings, "highlightTemplate" | "sectionTemplate"> & Partial<Pick<ExportSettings, "categoryTemplates" | "destination" | "heading">>,
  input: SectionInput,
  preset: Pick<ExportPreset, "filter" | "groupBy"> = DEFAULT_PRESET,
  /** Given, each annotation's own text (by annotation id) is put in it, so it isn't rendered again. */
  rendered?: Map<string, string>,
): string {
  const render = (a: Annotation) => {
    const block = highlightBlock(s, input, a);
    rendered?.set(a.id, String(block.markdown));
    return block;
  };
  const groups = groupAnnotations(exportable(input.annotations, preset.filter, input.categories), preset.groupBy, input.categories, input.outline);
  const hashes = "#".repeat(groupHeadingLevel({ destination: s.destination ?? "heading", heading: s.heading ?? DEFAULT_HEADING }));
  const parts = groups.map((g) => {
    const highlights = g.annotations.map(render);
    const text = renderTemplate(s.sectionTemplate, { ...input.entry, highlights, count: highlights.length, group: g.title }).replace(/\s+$/, "");
    return g.title === null ? text : `${hashes} ${g.title}\n\n${text.replace(/^\s+/, "")}`;
  });
  return parts.join("\n\n").replace(/\s+$/, "");
}

// ---- Merging into the note ------------------------------------------------------

export class NoteFormatError extends Error {}

export interface Region {
  /** Offsets of the begin marker's line start and just after the end marker's line (its newline included). */
  start: number;
  end: number;
  /** The text between the marker lines. */
  body: string;
}

interface Line {
  text: string;
  start: number;
  /** Offset after the line's newline. */
  next: number;
}

function lines(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  while (start < text.length) {
    const nl = text.indexOf("\n", start);
    const next = nl === -1 ? text.length : nl + 1;
    out.push({ text: text.slice(start, nl === -1 ? text.length : nl).replace(/\r$/, ""), start, next });
    start = next;
  }
  return out;
}

/** Lines that are markdown text: not frontmatter and not inside a code fence. */
function proseLines(text: string): Line[] {
  const all = lines(text);
  let i = 0;
  // (A byte order mark may come before the frontmatter.)
  if (all[0]?.text.replace(/^\uFEFF/, "") === "---") {
    const close = all.findIndex((l, j) => j > 0 && /^(---|\.\.\.)\s*$/.test(l.text));
    if (close !== -1) i = close + 1;
  }
  const out: Line[] = [];
  let fence: string | null = null;
  for (; i < all.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(all[i].text);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      continue;
    }
    if (m) {
      fence = m[1];
      continue;
    }
    out.push(all[i]);
  }
  return out;
}

/** Tourmaline's section in a note, if it has one. Throws NoteFormatError if its markers are muddled. */
export function findRegion(text: string): Region | null {
  const prose = proseLines(text);
  const begins = prose.filter((l) => l.text.trim() === REGION_BEGIN);
  const ends = prose.filter((l) => l.text.trim() === REGION_END);
  if (begins.length === 0 && ends.length === 0) return null;
  if (begins.length !== 1 || ends.length !== 1 || ends[0].start < begins[0].start) {
    throw new NoteFormatError(
      `its Tourmaline section is unclear: it should have one "${REGION_BEGIN}" line, then one "${REGION_END}" line`,
    );
  }
  const body = text.slice(begins[0].next, ends[0].start).replace(/\r?\n$/, "");
  return { start: begins[0].start, end: ends[0].next, body };
}

/** The `^hl-…` block ids in some markdown. */
export function blockIds(markdown: string): Set<string> {
  return new Set([...markdown.matchAll(/\^(hl-[0-9a-z]{6})\s*$/gm)].map((m) => m[1]));
}

/** Compares section texts the way they'd look in Obsidian (line endings and trailing spaces aside). */
export const normaliseSection = (body: string) =>
  body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();

const regionText = (body: string) => `${REGION_BEGIN}\n${body}\n${REGION_END}\n`;

const headingLevel = (line: string) => /^(#{1,6})(?:\s|$)/.exec(line)?.[1].length ?? 0;
const sameHeading = (a: string, b: string) => a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");

export interface Merge {
  /** The note's new text. */
  text: string;
  /** Tourmaline's section as it was in the note, if it had one. */
  previous: string | null;
}

/**
 * Puts the section into a note. An existing section is replaced in place;
 * otherwise it goes directly under the heading (destination "heading"),
 * which is added at the end of the note if missing, or at the end of a
 * separate note. `note` is null when the note doesn't exist yet; it is then
 * `newNote` (the new-note template's output) plus the section. Keeps the
 * note's line endings.
 */
export function mergeIntoNote(note: string | null, body: string, s: Pick<ExportSettings, "destination" | "heading">, newNote = ""): Merge {
  const heading = s.destination === "heading" ? s.heading : null;
  if (note === null) {
    const start = newNote.replace(/\s+$/, "");
    const parts = [start, heading, regionText(body)].filter(Boolean);
    return { text: parts.join("\n\n"), previous: null };
  }
  const eol = note.includes("\r\n") ? "\r\n" : "\n";
  const withEol = (t: string) => (eol === "\n" ? t : t.replace(/\n/g, eol));
  const region = findRegion(note);
  if (region) {
    const text = note.slice(0, region.start) + withEol(regionText(body)) + note.slice(region.end);
    return { text, previous: region.body };
  }
  const under = heading ? proseLines(note).find((l) => headingLevel(l.text) > 0 && sameHeading(l.text, heading)) : undefined;
  if (under) {
    // A blank line after the heading, the section, then a blank line before what followed.
    const rest = note.slice(under.next).replace(/^(?:[ \t]*\r?\n)+/, "");
    const head = note.slice(0, under.next) + (under.next === note.length && !note.endsWith("\n") ? eol : "");
    const text = head + eol + withEol(regionText(body)) + (rest ? eol + rest : "");
    return { text, previous: null };
  }
  const trimmed = note.replace(/\s+$/, "");
  const added = [heading, regionText(body)].filter(Boolean).join("\n\n");
  return { text: (trimmed ? trimmed + eol + eol : "") + withEol(added), previous: null };
}

/** Whether some markdown links to a block (`[[note#^hl-…]]`, `![[#^hl-…]]`, `[x](note.md#^hl-…)`). */
export const linksToBlock = (markdown: string, blockId: string) => markdown.includes(`#^${blockId}`);

// ---- What was exported (phase 11b) ------------------------------------------------

/**
 * What Tourmaline last wrote into a note for a paper, block by block: each
 * exported annotation's text (normalised), by block id, and when the paper
 * was last exported whole (annotations created since, and not in the note,
 * are new; older ones were left out on purpose).
 */
export interface ExportRecord {
  /** When the annotations of the last whole export were read. */
  exportedAt: number;
  blocks: Record<string, string>;
  /** When blocks were written by Export selected since (by block id); the others at `exportedAt`. */
  writtenAt?: Record<string, number>;
  /** What each block depended on besides its annotation's own fields (blockBasis), by block id. */
  basis?: Record<string, string>;
  /** templatesKey of the settings the whole export used. */
  templates?: string;
}

/**
 * What an annotation's block depends on besides the annotation's own
 * fields (whose changes its `updated` time shows): its page, and its
 * category's name, callout and colour. A new version that moves it to
 * another page, or an edited category, changes this.
 */
export function blockBasis(a: Annotation, categories: readonly Category[]): string {
  const page = isPlaced(a) ? String(a.placement!.page) : "-";
  const id = exportCategory(a, categories);
  const c = categories.find((x) => x.id === id);
  return c ? `${page}|${c.name}|${c.callout}|${c.colour}` : page;
}

/** The settings that shape every block and section (templates and heading), as one string to compare. */
export const templatesKey = (s: ExportSettings) =>
  JSON.stringify([s.highlightTemplate, s.sectionTemplate, s.categoryTemplates, s.destination, s.heading]);

const stringsOf = (v: unknown) =>
  v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"))
    : {};

export function parseExportRecord(json: string | null): ExportRecord | null {
  try {
    const v: unknown = json ? JSON.parse(json) : null;
    if (!v || typeof v !== "object") return null;
    const r = v as Record<string, unknown>;
    if (typeof r.exportedAt !== "number" || !r.blocks || typeof r.blocks !== "object") return null;
    const record: ExportRecord = { exportedAt: r.exportedAt, blocks: stringsOf(r.blocks) };
    if (r.writtenAt && typeof r.writtenAt === "object") {
      record.writtenAt = Object.fromEntries(
        Object.entries(r.writtenAt as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === "number"),
      );
    }
    if (r.basis && typeof r.basis === "object") record.basis = stringsOf(r.basis);
    if (typeof r.templates === "string") record.templates = r.templates;
    return record;
  } catch {
    return null;
  }
}

export type BlockStatus = "new" | "changed";

export interface ExportStatus {
  /** Annotations not in the note yet (made since the last export) or changed since it, by annotation id. */
  byId: Map<string, BlockStatus>;
  /** Block ids in the note whose annotations were deleted in Tourmaline. */
  deleted: string[];
  /** Changes not exported yet: new, changed and deleted. */
  count: number;
}

/** How a paper's annotations differ from what was last exported; `render` is renderAnnotation for the paper. */
export function exportStatus(record: ExportRecord, annotations: readonly Annotation[], render: (a: Annotation) => string): ExportStatus {
  const byId = new Map<string, BlockStatus>();
  const live = new Set<string>();
  for (const a of annotations) {
    if (a.kind === "ink") continue;
    live.add(a.blockId);
    const before = record.blocks[a.blockId];
    if (before === undefined) {
      if (a.created > record.exportedAt) byId.set(a.id, "new");
      continue;
    }
    let now: string | null;
    try {
      now = normaliseSection(render(a));
    } catch {
      now = null; // A broken template: exporting will say so.
    }
    if (now !== null && now !== before) byId.set(a.id, "changed");
  }
  const deleted = Object.keys(record.blocks).filter((id) => !live.has(id));
  return { byId, deleted, count: byId.size + deleted.length };
}

/** Where a block is in a section's text (\n line endings): from its first line to the end of its `^id` line. */
export interface BlockSpan {
  start: number;
  end: number;
}

const blockIdOf = (line: string) => /\^(hl-[0-9a-z]{6})\s*$/.exec(line)?.[1];

/**
 * The blocks of a section by id. A block is what Obsidian gives the id to:
 * the lines from the last blank line (or heading, or other block, or the
 * section's start) down to its `^id` line; an id on a line of its own after
 * a blank line, as the default template writes it, takes the paragraph
 * above. When `known` (what Tourmaline
 * wrote for it) ends at that line, the block is all of that, blank lines
 * inside included.
 */
export function sectionBlocks(body: string, known: Record<string, string> = {}): Map<string, BlockSpan> {
  const out = new Map<string, BlockSpan>();
  const all = lines(body);
  for (let i = 0; i < all.length; i++) {
    const id = blockIdOf(all[i].text);
    if (!id || out.has(id)) continue;
    const end = all[i].start + all[i].text.length;
    const paragraphStart = (from: number) => {
      let j = from;
      while (j > 0 && all[j - 1].text.trim() !== "" && headingLevel(all[j - 1].text) === 0 && !blockIdOf(all[j - 1].text)) j--;
      return j;
    };
    let j = paragraphStart(i);
    if (j === i && all[i].text.trim() === `^${id}`) {
      // An id alone after a blank line belongs to the paragraph (callout, list) above it.
      let k = i;
      while (k > 0 && all[k - 1].text.trim() === "") k--;
      if (k > 0 && k < i && headingLevel(all[k - 1].text) === 0 && !blockIdOf(all[k - 1].text)) j = paragraphStart(k - 1);
    }
    let start = all[j].start;
    const wrote = known[id];
    if (wrote) {
      // As many lines back as Tourmaline wrote, if they are what it wrote.
      const k = i - (wrote.split("\n").length - 1);
      if (k >= 0 && k < j && normaliseSection(body.slice(all[k].start, end)) === wrote) start = all[k].start;
    }
    out.set(id, { start, end });
  }
  return out;
}

export interface BlockUpdate {
  blockId: string;
  /** The block's new text. */
  text: string;
}

/**
 * A section with some blocks added or replaced and everything else as it
 * was (Export selected). A block already there is replaced in place. A new
 * one goes where a whole export would put it: `groups` are the block ids of
 * each group in order (one group when not grouping). It goes after the
 * nearest block before it in its own group, else before the nearest one
 * after it there (so under that group's subheading); with none of its group
 * in the note, after the nearest block before it anywhere, else before the
 * nearest after, else at the end.
 */
export function mergeBlocks(
  previous: string | null,
  updates: readonly BlockUpdate[],
  groups: readonly (readonly string[])[],
  known: Record<string, string> = {},
): string {
  const order = groups.flat();
  let body = (previous ?? "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
  for (const u of updates) {
    const text = u.text.replace(/\r\n/g, "\n").trim();
    const spans = sectionBlocks(body, known);
    const here = spans.get(u.blockId);
    if (here) {
      body = body.slice(0, here.start) + text + body.slice(here.end);
      continue;
    }
    const group = groups.find((g) => g.includes(u.blockId)) ?? [];
    const near = (list: readonly string[]) => {
      const at = list.indexOf(u.blockId);
      if (at === -1) return { before: undefined, after: undefined };
      return {
        before: list.slice(0, at).reverse().find((id) => spans.has(id)),
        after: list.slice(at + 1).find((id) => spans.has(id)),
      };
    };
    const inGroup = near(group);
    const { before, after } = inGroup.before || inGroup.after ? inGroup : near(order);
    // Spaced like its neighbour and the block next to that (list items on
    // consecutive lines, callouts a blank line apart).
    const sorted = [...spans.values()].sort((x, y) => x.start - y.start);
    const spacing = (span: BlockSpan) => {
      const i = sorted.indexOf(span);
      for (const [x, y] of [
        [sorted[i], sorted[i + 1]],
        [sorted[i - 1], sorted[i]],
      ]) {
        const gap = x && y ? body.slice(x.end, y.start) : "";
        if (gap && !gap.trim()) return gap.includes("\n\n") ? "\n\n" : "\n";
      }
      return "\n\n";
    };
    if (before) {
      const span = spans.get(before)!;
      body = `${body.slice(0, span.end)}${spacing(span)}${text}${body.slice(span.end)}`;
    } else if (after) {
      const span = spans.get(after)!;
      body = `${body.slice(0, span.start)}${text}${spacing(span)}${body.slice(span.start)}`;
    } else {
      body = body ? `${body}\n\n${text}` : text;
    }
  }
  return body;
}

/** A block's text as it is in a section (normalised), if the section has it. */
export function blockText(body: string, blockId: string, known: Record<string, string> = {}): string | null {
  const text = body.replace(/\r\n/g, "\n");
  const span = sectionBlocks(text, known).get(blockId);
  return span ? normaliseSection(text.slice(span.start, span.end)) : null;
}

/** A block as one line of plain text, for lists (the preview): callout and link syntax and the block id left out. */
export function blockSnippet(markdown: string, max = 160): string {
  const text = markdown
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^(?:>\s?)+/, "")
        .replace(/^\[![^\]]*\][+-]?\s*/, "")
        .replace(/^(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/, "")
        .replace(/\s*\^hl-[0-9a-z]{6}\s*$/, "")
        .replace(/!?\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .trim(),
    )
    .filter(Boolean)
    .join(" ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
