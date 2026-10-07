// One export of a paper's annotations into its note (Export › Export to
// Obsidian). Asks before overwriting edits made inside Tourmaline's section
// (decision 5) and before removing highlights other notes link to
// (decision 3); writes nothing if the user says no, and nothing if the note
// would not change.

import { exportImage, findBlockLinks, getState, readNote, setState, writeNote } from "../platform";
import { sha256Hex } from "../util/hash";
import {
  attachmentFolder,
  blockIds,
  exportable,
  exportNotePath,
  findRegion,
  imageFileName,
  linksToBlock,
  mergeIntoNote,
  normaliseSection,
  NoteFormatError,
  noteSettings,
  renderSection,
  type ExportPreset,
  type ExportSettings,
  type SectionInput,
} from "./export";
import type { VaultSettings } from "./notes";
import { renderTemplate } from "./templates";

export type ExportQuestion =
  /** The section in the note isn't what Tourmaline last wrote there. */
  | { kind: "edited"; path: string }
  /** Highlights deleted in Tourmaline that notes link to. */
  | { kind: "links"; path: string; links: { path: string; blockId: string }[] };

export interface ExportJob {
  vault: string;
  vaultSettings: VaultSettings;
  settings: ExportSettings;
  /** Which annotations, grouped how. */
  preset: ExportPreset;
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
const stateKey = (workId: string, path: string) => `export.section:${workId}:${path}`;

const sectionHash = async (body: string) => sha256Hex(new TextEncoder().encode(normaliseSection(body)));

export async function runExport(job: ExportJob): Promise<ExportOutcome> {
  const { vault, settings, input } = job;
  const path = exportNotePath(job.vaultSettings.citations, settings, input.entry);
  const body = renderSection(settings, input, job.preset);
  const written = exportable(input.annotations, job.preset.filter);
  const count = written.length;
  const note = await readNote(vault, path);
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
  const remember = async () => setState(stateKey(job.workId, path), await sectionHash(body));
  const outcome = (status: ExportOutcome["status"]): ExportOutcome => ({
    status,
    path,
    count,
    total: exportable(input.annotations).length,
    created: note === null,
  });

  if (merge.previous !== null) {
    if (normaliseSection(merge.previous) === normaliseSection(body)) {
      // Remembered even so: the next change then isn't taken for the user's edit.
      await remember();
      return outcome("unchanged");
    }
    const edited = (await getState(stateKey(job.workId, path))) !== (await sectionHash(merge.previous));
    if (edited && !(await job.ask({ kind: "edited", path }))) return outcome("cancelled");

    const kept = blockIds(body);
    const removed = [...blockIds(merge.previous)].filter((id) => !kept.has(id));
    if (removed.length) {
      const elsewhere = await findBlockLinks(vault, removed, path);
      // Links from this note too, inside the section as well (another highlight's note).
      const here = removed.filter((id) => linksToBlock(merge.text, id)).map((blockId) => ({ path, blockId }));
      const links = [...here, ...elsewhere];
      if (links.length && !(await job.ask({ kind: "links", path, links }))) return outcome("cancelled");
    }
  }

  const folder = attachmentFolder(job.vaultSettings.attachmentFolder, path);
  for (const a of written) {
    if (a.kind === "area" && a.imagePath) await exportImage(vault, a.id, folder, imageFileName(a));
  }
  await writeNote(vault, path, merge.text, note?.sha256 ?? null);
  await remember();
  return outcome("written");
}
