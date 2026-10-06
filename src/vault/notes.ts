// What goes into the vault: highlights rendered with a Handlebars template,
// and where the Citations plugin keeps a paper's literature note.

import type { Annotation, Category } from "../annotations/types";
import { readerLink } from "./links";
import { renderTemplate } from "./templates";

/** The vault's settings as read by `vault_settings` (src-tauri/src/vault.rs). */
export interface VaultSettings {
  /** The vault's name in Obsidian (its folder name). */
  name: string;
  citations: {
    enabled: boolean;
    format: string;
    /** Absolute path of the bibliography. */
    bibliography: string | null;
    noteTitleTemplate: string;
    /** Relative to the vault, forward slashes. */
    noteFolder: string;
    noteTemplate: string;
  };
  attachmentFolder: string | null;
  strictLineBreaks: boolean;
  /** Obsidian's "New link format". */
  newLinkFormat: "shortest" | "relative" | "absolute";
}

/**
 * One highlight as a callout. Multi-line notes and $$ blocks stay inside the
 * callout (each line gets its `>`); the block id goes on its own line after
 * it, which is how Obsidian anchors a callout.
 */
export const DEFAULT_HIGHLIGHT_TEMPLATE = `> [!{{category.callout}}] [p. {{page}}]({{readerLink}})
{{#if image}}
> {{image}}
{{/if}}
{{#if quote}}
> {{quote}}
{{/if}}
{{#if note}}
{{#if quote}}
>
{{else if image}}
>
{{/if}}
> {{note}}
{{/if}}

^{{blockId}}
`;

export interface HighlightInput {
  annotation: Annotation;
  category: Category | undefined;
  /** The page as printed (its label), else its number. */
  pageLabel: string;
  /** The Citations plugin's variables for the paper, if it has an entry. */
  entry?: Record<string, unknown>;
  /** The PDF's file name, for {{pdfLink}}. */
  fileName?: string;
}

/** Everything a highlight template can use: the paper's fields, then the highlight's. */
export function highlightVariables({ annotation: a, category, pageLabel, entry, fileName }: HighlightInput): Record<string, unknown> {
  const page = a.placement && a.placement.status !== "orphan" ? a.placement.page : null;
  const pdfRef = page === null ? null : a.placement?.pdfRef;
  return {
    ...entry,
    quote: a.quote ?? "",
    note: a.note.trim(),
    kind: a.kind,
    page: pageLabel,
    pageNumber: page === null ? "" : String(page + 1),
    category: {
      name: category?.name ?? "",
      callout: category?.callout ?? "quote",
      colour: category?.colour ?? "",
    },
    colour: a.colour ?? category?.colour ?? "",
    blockId: a.blockId,
    readerLink: readerLink(a.workId, { blockId: a.blockId }),
    // Opens Obsidian's own PDF viewer at the annotation; needs it to be in the
    // file (imported from it, or saved into it).
    pdfLink: pdfRef && fileName ? `[[${fileName}#page=${page! + 1}&annotation=${pdfRef}]]` : "",
    // An area's image embed (![[…]]), set on export once the image is in the vault.
    image: "",
    created: new Date(a.created).toISOString().slice(0, 10),
  };
}

export function renderHighlight(template: string, input: HighlightInput): string {
  return renderTemplate(template, highlightVariables(input));
}

// Characters the Citations plugin replaces in note titles.
const DISALLOWED_IN_TITLE = /[*"\\/<>:|?]/g;

/** The literature note's path in the vault, as the Citations plugin names it. */
export function literatureNotePath(settings: VaultSettings["citations"], entry: Record<string, unknown>): string {
  const title = renderTemplate(settings.noteTitleTemplate, entry).replace(DISALLOWED_IN_TITLE, "_");
  return `${settings.noteFolder ? `${settings.noteFolder}/` : ""}${title}.md`;
}

/** Opens a note in Obsidian. */
export function obsidianUrl(vaultName: string, notePath: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(notePath.replace(/\.md$/, ""))}`;
}
