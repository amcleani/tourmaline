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
  imageFileName,
  linksToBlock,
  mergeIntoNote,
  normaliseSection,
  noteSettings,
  outsideRegion,
  renderSection,
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
  /** Whether the note was created. */
  created: boolean;
}

/** What Tourmaline last wrote into a paper's note: to tell the user's edits from its own. */
const stateKey = (workId: string) => `export.section:${workId}`;

const sectionHash = async (body: string) => sha256Hex(new TextEncoder().encode(normaliseSection(body)));

export async function runExport(job: ExportJob): Promise<ExportOutcome> {
  const { vault, settings, input } = job;
  const path = exportNotePath(job.vaultSettings.citations, settings, input.entry);
  const body = renderSection(settings, input);
  const count = exportable(input.annotations).length;
  const note = await readNote(vault, path);
  const newNote =
    note === null && settings.destination === "heading"
      ? renderTemplate(noteSettings(job.vaultSettings.citations, settings).noteTemplate, input.entry)
      : "";
  const merge = mergeIntoNote(note?.text ?? null, body, settings, newNote);
  const outcome = (status: ExportOutcome["status"]): ExportOutcome => ({ status, path, count, created: note === null });

  if (merge.previous !== null) {
    if (normaliseSection(merge.previous) === normaliseSection(body)) {
      // Remembered even so: the next change then isn't taken for the user's edit.
      await setState(stateKey(job.workId), JSON.stringify({ path, hash: await sectionHash(body) }));
      return outcome("unchanged");
    }
    const saved = parseSaved(await getState(stateKey(job.workId)));
    const edited = saved?.path !== path || saved.hash !== (await sectionHash(merge.previous));
    if (edited && !(await job.ask({ kind: "edited", path }))) return outcome("cancelled");

    const kept = blockIds(body);
    const removed = [...blockIds(merge.previous)].filter((id) => !kept.has(id));
    if (removed.length) {
      const elsewhere = await findBlockLinks(vault, removed, path);
      const outside = outsideRegion(merge.text);
      const here = removed.filter((id) => linksToBlock(outside, id)).map((blockId) => ({ path, blockId }));
      const links = [...here, ...elsewhere];
      if (links.length && !(await job.ask({ kind: "links", path, links }))) return outcome("cancelled");
    }
  }

  const folder = attachmentFolder(job.vaultSettings.attachmentFolder, path);
  for (const a of exportable(input.annotations)) {
    if (a.kind === "area" && a.imagePath) await exportImage(vault, a.id, folder, imageFileName(a));
  }
  await writeNote(vault, path, merge.text, note?.sha256 ?? null);
  await setState(stateKey(job.workId), JSON.stringify({ path, hash: await sectionHash(body) }));
  return outcome("written");
}

function parseSaved(json: string | null): { path: string; hash: string } | null {
  try {
    const v = json ? (JSON.parse(json) as { path?: unknown; hash?: unknown }) : null;
    return v && typeof v.path === "string" && typeof v.hash === "string" ? { path: v.path, hash: v.hash } : null;
  } catch {
    return null;
  }
}
