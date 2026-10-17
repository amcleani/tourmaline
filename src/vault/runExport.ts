// One export of a paper's annotations into its note (Export › Export to
// Obsidian), or of some of them (Export selected: those blocks added or
// replaced, the rest of the section left as it is). Asks before overwriting
// edits made inside Tourmaline's section (decision 5) and shows what will
// change before removing highlights from the note, saying which ones notes
// link to (decision 3); writes nothing if the user says no, and nothing if
// the note would not change.

import { exportImage, findBlockLinks, getState, readNote, setState, writeNote } from "../platform";
import { sha256Hex } from "../util/hash";
import {
  attachmentFolder,
  blockSnippet,
  blockText,
  DEFAULT_PRESET,
  exportable,
  exportNotePath,
  findRegion,
  groupAnnotations,
  imageFileName,
  linksToBlock,
  mergeBlocks,
  mergeIntoNote,
  normaliseSection,
  NoteFormatError,
  noteSettings,
  parseExportRecord,
  renderAnnotation,
  renderSection,
  sectionBlocks,
  type ExportPreset,
  type ExportRecord,
  type ExportSettings,
  type SectionInput,
} from "./export";
import type { VaultSettings } from "./notes";
import { renderTemplate } from "./templates";

/** One highlight in the preview: its block id and a line of its text. */
export interface PlanItem {
  blockId: string;
  text: string;
}

/** What an export will change in the section. */
export interface ExportPlan {
  added: PlanItem[];
  updated: PlanItem[];
  /** Highlights that leave the note, with the notes that link to each. */
  removed: (PlanItem & { linkedFrom: string[] })[];
  unchanged: number;
}

export type ExportQuestion =
  /**
   * The section in the note isn't what Tourmaline last wrote there (whole
   * export), or these blocks of it aren't (`blocks`, Export selected).
   */
  | { kind: "edited"; path: string; blocks?: string[] }
  /** What will change, before writing: asked when highlights would leave the note, or when asked for. */
  | { kind: "preview"; path: string; plan: ExportPlan; selected: boolean };

export interface ExportJob {
  vault: string;
  vaultSettings: VaultSettings;
  settings: ExportSettings;
  /** Which annotations, grouped how. */
  preset: ExportPreset;
  /** Export selected: only these annotations (by id), the rest of the section left as it is. */
  only?: ReadonlySet<string>;
  /** Show what will change even if nothing leaves the note. */
  preview?: boolean;
  workId: string;
  input: SectionInput;
  /** Resolves to whether to go on. */
  ask: (question: ExportQuestion) => Promise<boolean>;
}

export interface ExportOutcome {
  status: "written" | "unchanged" | "cancelled";
  /** The note, relative to the vault. */
  path: string;
  /** Annotations in the section. */
  count: number;
  /** The paper's annotations that could be exported (before the preset's filter). */
  total: number;
  /** Whether the note was created. */
  created: boolean;
}

/** What Tourmaline last wrote into a paper's section of a note: to tell the user's edits from its own. */
export const sectionStateKey = (workId: string, path: string) => `export.section:${workId}:${path}`;
/** The same, block by block (ExportRecord): the sidebar's status and Export selected. */
export const recordKey = (workId: string, path: string) => `export.blocks:${workId}:${path}`;

export async function loadExportRecord(workId: string, path: string): Promise<ExportRecord | null> {
  return parseExportRecord(await getState(recordKey(workId, path)));
}

const sectionHash = async (body: string) => sha256Hex(new TextEncoder().encode(normaliseSection(body)));

export async function runExport(job: ExportJob): Promise<ExportOutcome> {
  const { vault, settings, input } = job;
  const path = exportNotePath(job.vaultSettings.citations, settings, input.entry);
  const note = await readNote(vault, path);
  const previous = (() => {
    if (note === null) return null;
    return findRegion(note.text)?.body ?? null;
  })();
  const record = await loadExportRecord(job.workId, path);
  const known = record?.blocks ?? {};
  // Each annotation's text, rendered once for the section and the record.
  const rendered = new Map<string, string>();
  const render = (a: (typeof input.annotations)[number]) => {
    let text = rendered.get(a.id);
    if (text === undefined) rendered.set(a.id, (text = renderAnnotation(settings, input, a)));
    return normaliseSection(text);
  };

  // What goes in: the preset's annotations, or the selected ones.
  const selected = job.only;
  const written = selected
    ? exportable(input.annotations).filter((a) => selected.has(a.id))
    : exportable(input.annotations, job.preset.filter, input.categories);
  const body = selected
    ? mergeBlocks(
        previous,
        written.map((a) => ({ blockId: a.blockId, text: render(a) })),
        // New blocks go where a whole export with the default grouping would put them.
        groupAnnotations(exportable(input.annotations), defaultGrouping(settings), input.categories, input.outline).map((g) =>
          g.annotations.map((a) => a.blockId),
        ),
        known,
      )
    : renderSection(settings, input, job.preset, rendered);
  const count = written.length;
  const newNote =
    note === null && settings.destination === "heading"
      ? renderTemplate(noteSettings(job.vaultSettings.citations, settings).noteTemplate, input.entry)
      : "";
  const merge = mergeIntoNote(note?.text ?? null, body, settings, newNote);
  // A section that wouldn't read back as written (a marker line or an
  // unclosed code fence from a template or note) would lock the note.
  const readBack = (() => {
    try {
      return findRegion(merge.text)?.body ?? null;
    } catch {
      return null;
    }
  })();
  if (readBack === null || normaliseSection(readBack) !== normaliseSection(body)) {
    throw new NoteFormatError(
      "the exported section would not read back intact: a template or note contains a Tourmaline marker line or an unclosed code block",
    );
  }
  const outcome = (status: ExportOutcome["status"]): ExportOutcome => ({
    status,
    path,
    count,
    total: exportable(input.annotations).length,
    created: note === null,
  });

  const oldHash = await getState(sectionStateKey(job.workId, path));
  const sectionWasOurs = previous !== null && oldHash === (await sectionHash(previous));
  const remember = async () => {
    const blocks = Object.fromEntries(written.map((a) => [a.blockId, render(a)]));
    const next: ExportRecord = selected
      ? {
          exportedAt: record?.exportedAt ?? 0,
          blocks: { ...known, ...blocks },
          writtenAt: { ...record?.writtenAt, ...Object.fromEntries(written.map((a) => [a.blockId, Date.now()])) },
        }
      : { exportedAt: Date.now(), blocks };
    // After Export selected, the section is still the user's edit if it was one.
    if (!selected || previous === null || sectionWasOurs) await setState(sectionStateKey(job.workId, path), await sectionHash(body));
    await setState(recordKey(job.workId, path), JSON.stringify(next));
  };

  const unchanged = previous !== null && normaliseSection(previous) === normaliseSection(body);
  if (previous !== null && !unchanged) {
    if (selected) {
      // Only the blocks being replaced matter: the rest stays as it is. A
      // block Tourmaline has no record of (exported before records were
      // kept) counts as edited unless the whole section is as it wrote it.
      const edited = written
        .map((a) => a.blockId)
        .filter((id) => {
          const now = blockText(previous, id, known);
          if (now === null || now === render(written.find((a) => a.blockId === id)!)) return false;
          return known[id] !== undefined ? now !== known[id] : !sectionWasOurs;
        });
      if (edited.length && !(await job.ask({ kind: "edited", path, blocks: edited }))) return outcome("cancelled");
    } else if (!sectionWasOurs) {
      if (!(await job.ask({ kind: "edited", path }))) return outcome("cancelled");
    }
  }

  if (!unchanged || job.preview) {
    const plan = await planOf(vault, path, previous, body, merge.text, known);
    if ((plan.removed.length || job.preview) && !(await job.ask({ kind: "preview", path, plan, selected: !!selected }))) {
      return outcome("cancelled");
    }
  }
  if (unchanged) {
    // Remembered even so: the next change then isn't taken for the user's edit.
    await remember();
    return outcome("unchanged");
  }

  const folder = attachmentFolder(job.vaultSettings.attachmentFolder, path);
  for (const a of written) {
    if (a.kind === "area" && a.imagePath) await exportImage(vault, a.id, folder, imageFileName(a));
  }
  await writeNote(vault, path, merge.text, note?.sha256 ?? null);
  await remember();
  return outcome("written");
}

/** The default preset's grouping (where Export selected puts new highlights). */
const defaultGrouping = (s: ExportSettings) => (s.presets.find((p) => p.id === s.defaultPreset) ?? s.presets[0] ?? DEFAULT_PRESET).groupBy;

/** What replacing the section `previous` with `body` adds, updates and removes. */
async function planOf(
  vault: string,
  path: string,
  previous: string | null,
  body: string,
  noteText: string,
  known: Record<string, string>,
): Promise<ExportPlan> {
  const before = previous === null ? new Map() : sectionBlocks(previous.replace(/\r\n/g, "\n"), known);
  const after = sectionBlocks(body, known);
  const textIn = (text: string, span: { start: number; end: number }) => normaliseSection(text.slice(span.start, span.end));
  const old = (previous ?? "").replace(/\r\n/g, "\n");
  const plan: ExportPlan = { added: [], updated: [], removed: [], unchanged: 0 };
  for (const [blockId, span] of after) {
    const now = textIn(body, span);
    const was = before.get(blockId);
    if (!was) plan.added.push({ blockId, text: blockSnippet(now) });
    else if (textIn(old, was) !== now) plan.updated.push({ blockId, text: blockSnippet(now) });
    else plan.unchanged++;
  }
  const gone = [...before.keys()].filter((id) => !after.has(id));
  if (gone.length) {
    const elsewhere = await findBlockLinks(vault, gone, path);
    for (const blockId of gone) {
      // Links from this note too, inside the section as well (another highlight's note).
      const linkedFrom = [
        ...(linksToBlock(noteText, blockId) ? [path] : []),
        ...elsewhere.filter((l) => l.blockId === blockId).map((l) => l.path),
      ];
      plan.removed.push({ blockId, text: blockSnippet(textIn(old, before.get(blockId)!)), linkedFrom });
    }
  }
  return plan;
}
