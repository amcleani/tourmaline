import { useEffect, useId, useRef, useState } from "react";
import type { Annotation } from "../annotations/types";
import {
  DEFAULT_EXPORT_SETTINGS,
  exportNotePath,
  REGION_BEGIN,
  REGION_END,
  renderSection,
  type ExportSettings,
  type SectionInput,
} from "../vault/export";
import type { VaultSettings } from "../vault/notes";
import { renderTemplate } from "../vault/templates";

interface Props {
  settings: ExportSettings;
  /** The open paper's annotations, for the preview; a made-up paper if none. */
  preview: SectionInput | null;
  /** The vault's Citations plugin settings, if a vault is chosen. */
  citations: VaultSettings["citations"] | null;
  onSave: (settings: ExportSettings) => void;
  onCancel: () => void;
}

const SAMPLE_WORK = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b";
const sampleAnnotation = (n: number, extra: Partial<Annotation>): Annotation => ({
  id: `sample-${n}`,
  workId: SAMPLE_WORK,
  kind: "highlight",
  categoryId: null,
  colour: null,
  note: "",
  quote: null,
  prefix: null,
  suffix: null,
  imagePath: null,
  blockId: `hl-sampl${n}`,
  source: "tourmaline",
  created: Date.UTC(2025, 2, 14),
  updated: Date.UTC(2025, 2, 14),
  placement: { page: n, geometry: { rects: [[n, 0, 0, 1, 1]] }, textStart: null, textEnd: null, status: "exact" },
  fallback: null,
  ...extra,
});

/** A made-up paper for the preview when none is open. */
const SAMPLE: SectionInput = {
  annotations: [
    sampleAnnotation(1, { quote: "Every generalization is grounded in its instances." }),
    sampleAnnotation(2, { quote: "A second highlight", note: "With a note, and math: $x \\in A$." }),
  ],
  categories: [],
  pageLabel: (p) => String(p + 1),
  entry: { citekey: "Goodman2023GG", title: "Grounding Generalizations", authorString: "Jeremy Goodman", year: "2023" },
  fileName: "Goodman2023GG - Grounding Generalizations.pdf",
};

const VARIABLES =
  "quote, note, page, pageNumber, category.name, category.callout, colour, blockId, readerLink, pdfLink, image, created, kind — and the paper's: citekey, title, authorString, year, DOI…";

// Export › Export settings: where the highlights go in the vault, and the
// Handlebars templates they're written with, previewed live on the open
// paper. Nothing is saved until Save.
export function ExportSettingsDialog({ settings, preview, citations, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<ExportSettings>(settings);
  const [ownNote, setOwnNote] = useState(settings.noteTitle !== null || settings.noteFolder !== null || settings.noteTemplate !== null);
  const id = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    firstRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const set = (patch: Partial<ExportSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const input = preview && preview.annotations.length ? preview : SAMPLE;
  const effective: ExportSettings = ownNote
    ? {
        ...draft,
        noteTitle: draft.noteTitle ?? citations?.noteTitleTemplate ?? "@{{citekey}}",
        noteFolder: draft.noteFolder ?? citations?.noteFolder ?? "",
        noteTemplate: draft.noteTemplate ?? citations?.noteTemplate ?? "",
      }
    : { ...draft, noteTitle: null, noteFolder: null, noteTemplate: null };

  // Each template is tried on its own, so the error shows by the one that's wrong.
  const attempt = (f: () => unknown) => {
    try {
      f();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };
  const problems = {
    highlight: attempt(() => renderSection({ ...draft, sectionTemplate: DEFAULT_EXPORT_SETTINGS.sectionTemplate }, input)),
    section: attempt(() => renderSection({ ...draft, highlightTemplate: DEFAULT_EXPORT_SETTINGS.highlightTemplate }, input)),
    title: attempt(() => renderTemplate(draft.destination === "note" ? draft.separateTitle : (effective.noteTitle ?? "x"), input.entry)),
    note: ownNote ? attempt(() => renderTemplate(effective.noteTemplate ?? "", input.entry)) : null,
  };
  const broken = Object.values(problems).some(Boolean);

  const output = broken
    ? null
    : {
        path: citations ? exportNotePath(citations, effective, input.entry) : null,
        text: `${REGION_BEGIN}\n${renderSection(effective, input)}\n${REGION_END}`,
      };

  const field = (name: string) => `${id}-${name}`;
  const templateField = (
    name: "highlight" | "section",
    label: string,
    key: "highlightTemplate" | "sectionTemplate",
    rows: number,
  ) => (
    <>
      <div className="template-label">
        <label className="field-label" htmlFor={field(name)}>
          {label}
        </label>
        <button
          type="button"
          className="button small"
          disabled={draft[key] === DEFAULT_EXPORT_SETTINGS[key]}
          onClick={() => set({ [key]: DEFAULT_EXPORT_SETTINGS[key] })}
        >
          Reset to default
        </button>
      </div>
      <textarea
        id={field(name)}
        className="text-input template-input"
        rows={rows}
        spellCheck={false}
        value={draft[key]}
        aria-invalid={!!problems[name]}
        aria-describedby={problems[name] ? field(`${name}-error`) : undefined}
        onChange={(e) => set({ [key]: e.target.value })}
      />
      {problems[name] && (
        <p className="field-error" id={field(`${name}-error`)}>
          {problems[name]}
        </p>
      )}
    </>
  );

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div
        className="dialog export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={field("title")}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className="dialog-header">
          <h2 id={field("title")}>Export settings</h2>
        </div>
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (!broken) onSave(effective);
          }}
        >
          <div className="export-settings">
            <div>
              <fieldset className="fieldset">
                <legend>Where highlights go</legend>
                <label className="checkbox">
                  <input
                    ref={draft.destination === "heading" ? firstRef : undefined}
                    type="radio"
                    name={field("destination")}
                    checked={draft.destination === "heading"}
                    onChange={() => set({ destination: "heading" })}
                  />
                  Under a heading in the literature note
                </label>
                {draft.destination === "heading" && (
                  <input
                    className="text-input indented"
                    aria-label="Heading"
                    value={draft.heading}
                    onChange={(e) => set({ heading: e.target.value })}
                  />
                )}
                <label className="checkbox">
                  <input
                    ref={draft.destination === "note" ? firstRef : undefined}
                    type="radio"
                    name={field("destination")}
                    checked={draft.destination === "note"}
                    onChange={() => set({ destination: "note" })}
                  />
                  In a note of their own, in the literature note folder
                </label>
                {draft.destination === "note" && (
                  <input
                    className="text-input indented"
                    aria-label="Title of the highlights note"
                    aria-invalid={!!problems.title}
                    value={draft.separateTitle}
                    onChange={(e) => set({ separateTitle: e.target.value })}
                  />
                )}
              </fieldset>

              <fieldset className="fieldset">
                <legend>Literature note</legend>
                <label className="checkbox">
                  <input type="checkbox" checked={!ownNote} onChange={(e) => setOwnNote(!e.target.checked)} />
                  Title, folder and template from the Citations plugin
                </label>
                {ownNote && (
                  <>
                    <label className="field-label" htmlFor={field("note-title")}>
                      Title
                    </label>
                    <input
                      id={field("note-title")}
                      className="text-input"
                      value={effective.noteTitle ?? ""}
                      aria-invalid={!!problems.title}
                      onChange={(e) => set({ noteTitle: e.target.value })}
                    />
                    <label className="field-label" htmlFor={field("note-folder")}>
                      Folder in the vault
                    </label>
                    <input
                      id={field("note-folder")}
                      className="text-input"
                      value={effective.noteFolder ?? ""}
                      onChange={(e) => set({ noteFolder: e.target.value })}
                    />
                    <label className="field-label" htmlFor={field("note-template")}>
                      New note template
                    </label>
                    <textarea
                      id={field("note-template")}
                      className="text-input template-input"
                      rows={6}
                      spellCheck={false}
                      value={effective.noteTemplate ?? ""}
                      aria-invalid={!!problems.note}
                      onChange={(e) => set({ noteTemplate: e.target.value })}
                    />
                    {problems.note && <p className="field-error">{problems.note}</p>}
                  </>
                )}
                {problems.title && <p className="field-error">Title: {problems.title}</p>}
              </fieldset>

              {templateField("highlight", "Each highlight", "highlightTemplate", 12)}
              {templateField("section", "All highlights ({{#each highlights}} … {{markdown}} …)", "sectionTemplate", 4)}
              <p className="muted small">Fields: {VARIABLES}</p>
            </div>

            <section aria-labelledby={field("preview")} className="export-preview">
              <h3 id={field("preview")}>
                Preview{input === SAMPLE ? " (a made-up paper)" : ""}
              </h3>
              {output?.path && (
                <p className="small">
                  Into <code>{output.path}</code>
                </p>
              )}
              <pre className="template-preview" tabIndex={0} aria-label="What is written into the note">
                {output ? output.text : "Fix the template to see the preview."}
              </pre>
            </section>
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                setDraft(DEFAULT_EXPORT_SETTINGS);
                setOwnNote(false);
              }}
            >
              Reset all
            </button>
            <span className="spacer" />
            <button type="button" className="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={broken}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
