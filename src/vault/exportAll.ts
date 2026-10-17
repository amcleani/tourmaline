// Export › Export all papers with changes (phase 11c): which papers' notes
// are behind their annotations. A paper counts when it was exported before
// (it has an ExportRecord) and since then an annotation was made, changed or
// deleted, moved to another page (a new version) or its category edited, or
// the templates changed. That is told from the annotations' own times and
// what the record kept, so no PDF has to be read to find out; the export
// itself then renders and compares as usual (a paper that turns out to be up
// to date is left alone). Papers exported before records were kept are
// listed apart: whether they changed can't be told.

import type { Annotation, Category } from "../annotations/types";
import { loadPdf } from "../pdf/loader";
import { loadOutline, type OutlineNode } from "../pdf/outline";
import { annotatedWorks, getState, listAnnotations, readPdf, type DocumentInfo } from "../platform";
import { citationVariables, type Bibliography } from "./bibliography";
import { blockBasis, exportNotePath, templatesKey, type ExportPreset, type ExportRecord, type ExportSettings } from "./export";
import type { VaultSettings } from "./notes";
import { loadExportRecord, runExport, sectionStateKey, type ExportJob, type ExportOutcome } from "./runExport";

/** What changed in a paper since it was last exported. */
export interface PaperChanges {
  added: number;
  changed: number;
  deleted: number;
  /** The templates or heading changed since (every block may read differently). */
  templates: boolean;
}

export const hasChanges = (c: PaperChanges) => c.added + c.changed + c.deleted > 0 || c.templates;

/**
 * Annotations made since the last whole export and not in the note; those
 * in the note edited since they were written (by the whole export, or
 * Export selected), moved to another page or whose category was edited;
 * blocks whose annotations are gone; and whether the templates changed
 * (`templates` is templatesKey of the settings now).
 */
export function changesSince(
  record: ExportRecord,
  annotations: readonly Annotation[],
  categories: readonly Category[],
  templates: string,
): PaperChanges {
  const live = annotations.filter((a) => a.kind !== "ink");
  const ids = new Set(live.map((a) => a.blockId));
  let added = 0;
  let changed = 0;
  for (const a of live) {
    if (record.blocks[a.blockId] === undefined) {
      if (a.created > record.exportedAt) added++;
      continue;
    }
    const edited = a.updated > (record.writtenAt?.[a.blockId] ?? record.exportedAt);
    const was = record.basis?.[a.blockId];
    if (edited || (was !== undefined && was !== blockBasis(a, categories))) changed++;
  }
  const deleted = Object.keys(record.blocks).filter((id) => !ids.has(id)).length;
  return { added, changed, deleted, templates: record.templates !== undefined && record.templates !== templates };
}

/** "2 new, 1 changed, 1 deleted; templates changed". */
export function describeChanges(c: PaperChanges): string {
  const counts = (
    [
      [c.added, "new"],
      [c.changed, "changed"],
      [c.deleted, "deleted"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n} ${what}`)
    .join(", ");
  return [counts, c.templates && "templates changed"].filter(Boolean).join("; ");
}

/** A paper to offer for exporting: the file its annotations are placed on, its entry and note. */
export interface PaperToExport {
  doc: DocumentInfo;
  citekey: string;
  title: string;
  /** The Citations plugin's variables for its entry. */
  entry: Record<string, unknown>;
  /** Its note, relative to the vault. */
  notePath: string;
  /** What changed since it was exported; null if it was exported before records were kept. */
  changes: PaperChanges | null;
}

/**
 * The papers whose notes are behind their annotations, by citekey; also
 * those exported before records were kept (changes null). Papers never
 * exported, or not in the bibliography, aren't listed.
 */
export async function papersToExport(
  citations: VaultSettings["citations"],
  settings: ExportSettings,
  categories: readonly Category[],
  bibliography: Bibliography,
): Promise<PaperToExport[]> {
  const templates = templatesKey(settings);
  // Each paper's lookups are independent: all at once, kept in citekey order.
  const papers = await Promise.all(
    (await annotatedWorks()).map(async (doc): Promise<PaperToExport | null> => {
      const bib = doc.citekey ? bibliography.get(doc.citekey) : undefined;
      if (!doc.citekey || !bib) return null;
      const entry = citationVariables(bib);
      const notePath = exportNotePath(citations, settings, entry);
      const record = await loadExportRecord(doc.workId, notePath);
      if (!record && (await getState(sectionStateKey(doc.workId, notePath))) === null) return null;
      const changes = record ? changesSince(record, await listAnnotations(doc.workId, doc.fileId), categories, templates) : null;
      if (changes && !hasChanges(changes)) return null;
      return { doc, citekey: doc.citekey, title: String(entry.title ?? ""), entry, notePath, changes };
    }),
  );
  return papers.filter((p): p is PaperToExport => p !== null);
}

export interface PaperResult {
  paper: PaperToExport;
  outcome?: ExportOutcome;
  error?: unknown;
}

export interface ExportAllJob {
  vault: string;
  vaultSettings: VaultSettings;
  settings: ExportSettings;
  /** Which annotations and how grouped, for every paper. */
  preset: ExportPreset;
  categories: readonly Category[];
  ask: ExportJob["ask"];
  /** Before each paper (0-based). */
  onPaper?: (index: number, paper: PaperToExport) => void;
  /** Checked before each paper: stop when it says so. */
  stopped?: () => boolean;
}

/**
 * Exports the papers one after another, each as a single export would (the
 * same questions), reading its PDF only for page labels and, when grouping
 * by section, its outline. A paper that fails is reported and the rest go on.
 */
export async function exportPapers(papers: readonly PaperToExport[], job: ExportAllJob): Promise<PaperResult[]> {
  const results: PaperResult[] = [];
  for (const [i, paper] of papers.entries()) {
    if (job.stopped?.()) break;
    job.onPaper?.(i, paper);
    try {
      const { doc } = paper;
      if (!doc.path) throw new Error("its file can't be found");
      const pdf = await loadPdf(await readPdf(doc.path, doc.fileId));
      let labels: string[] | null = null;
      let outline: OutlineNode[] | null = null;
      try {
        labels = await pdf.getPageLabels().catch(() => null);
        if (job.preset.groupBy === "section") outline = await loadOutline(pdf).catch(() => []);
      } finally {
        await pdf.loadingTask.destroy();
      }
      // As they are now (they may have changed since the papers were listed).
      const readAt = Date.now();
      const annotations = await listAnnotations(doc.workId, doc.fileId);
      const outcome = await runExport({
        vault: job.vault,
        vaultSettings: job.vaultSettings,
        settings: job.settings,
        preset: job.preset,
        workId: doc.workId,
        input: {
          annotations,
          categories: job.categories,
          pageLabel: (p) => labels?.[p] ?? String(p + 1),
          entry: paper.entry,
          fileName: doc.name,
          outline,
        },
        ask: job.ask,
        readAt,
      });
      results.push({ paper, outcome });
    } catch (error) {
      results.push({ paper, error });
    }
  }
  return results;
}

/** "Updated 2 notes; 1 was up to date; 1 was skipped", and the papers that failed with why. */
export function summarise(results: readonly PaperResult[], stopped = 0): { notice: string; failures: string | null } {
  const count = (status: ExportOutcome["status"]) => results.filter((r) => r.outcome?.status === status).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const failed = results.filter((r) => r.error !== undefined);
  const parts = [
    count("written") > 0 && `updated ${plural(count("written"), "note", "notes")}`,
    count("unchanged") > 0 && `${plural(count("unchanged"), "was", "were")} up to date`,
    count("cancelled") > 0 && `${plural(count("cancelled"), "was", "were")} skipped`,
    failed.length > 0 && `${failed.length} failed`,
    stopped > 0 && `stopped before ${plural(stopped, "paper", "papers")}`,
  ].filter(Boolean) as string[];
  const notice = parts.join("; ").replace(/^./, (c) => c.toUpperCase()) || "Nothing was exported";
  const failures = failed.length
    ? `Could not export ${failed.map((r) => `@${r.paper.citekey} (${r.error instanceof Error ? r.error.message : String(r.error)})`).join(", ")}.`
    : null;
  return { notice, failures };
}
