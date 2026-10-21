import { useEffect, useId, useRef, useState } from "react";
import type { Category } from "../annotations/types";
import { sameChoices, type ExportPreset } from "../vault/export";
import { describeChanges, type PaperToExport } from "../vault/exportAll";
import { ExportChoices, choicesProblem, type Choices } from "./ExportChoices";

interface Props {
  presets: readonly ExportPreset[];
  /** The preset the choices start from. */
  startWith: string;
  categories: readonly Category[];
  /** Finds the papers with changes (when the dialog opens). */
  load: () => Promise<PaperToExport[]>;
  /** The papers ticked, in order; `preset` as in ExportDialog. */
  onExport: (papers: PaperToExport[], choices: Choices, preset: ExportPreset | null) => void;
  onCancel: () => void;
}

const paperId = (p: PaperToExport) => p.doc.workId;

// Export › Export all papers with changes: every paper whose annotations
// changed since its note was last written, ticked; those exported before
// Tourmaline kept track are listed unticked. The same choices as a single
// export apply to all of them. Enter exports.
export function ExportAllDialog({ presets, startWith, categories, load, onExport, onCancel }: Props) {
  const id = useId();
  const initial = presets.find((p) => p.id === startWith) ?? presets[0];
  const [presetId, setPresetId] = useState(initial.id);
  const [choices, setChoices] = useState<Choices>({ filter: initial.filter, groupBy: initial.groupBy });
  // The list and what is ticked arrive together, so Export is never shown disabled first.
  const [loaded, setLoaded] = useState<{ papers: PaperToExport[]; ticked: ReadonlySet<string> } | null>(null);
  const papers = loaded?.papers ?? null;
  const ticked = loaded?.ticked ?? new Set<string>();
  const [failed, setFailed] = useState<string | null>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    let stale = false;
    load()
      .then((list) => {
        if (stale) return;
        setLoaded({ papers: list, ticked: new Set(list.filter((p) => p.changes).map(paperId)) });
      })
      .catch((e) => !stale && setFailed(String(e?.message ?? e)));
    return () => {
      stale = true;
      previous?.focus?.();
    };
    // Load once, when the dialog opens.
  }, []);
  // Once there is something to export, Enter exports it.
  useEffect(() => {
    if (papers?.length && exportRef.current && !exportRef.current.disabled) exportRef.current.focus();
  }, [papers]);

  const preset = presets.find((p) => p.id === presetId) ?? initial;
  const problem = choicesProblem(choices);
  const chosen = (papers ?? []).filter((p) => ticked.has(paperId(p)));
  const field = (name: string) => `${id}-${name}`;
  const toggle = (p: PaperToExport) =>
    setLoaded((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.ticked);
      if (next.has(paperId(p))) next.delete(paperId(p));
      else next.add(paperId(p));
      return { ...prev, ticked: next };
    });

  const status =
    failed !== null
      ? `Could not look for changes: ${failed}`
      : papers === null
        ? "Looking for papers with changes…"
        : papers.length === 0
          ? "Every exported paper's note is up to date."
          : (problem ?? (chosen.length === 0 ? "Tick the papers to export." : `${chosen.length} of ${papers.length} papers will be exported, one after another.`));

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div
        className="dialog export-all-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={field("title")}
        aria-describedby={field("status")}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className="dialog-header">
          <h2 id={field("title")}>Export all papers with changes</h2>
        </div>
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (!problem && chosen.length) onExport(chosen, choices, sameChoices(choices, preset) ? preset : null);
          }}
        >
          {papers !== null && papers.length > 0 && (
            <fieldset className="fieldset">
              <legend>Papers</legend>
              <ul className="paper-list">
                {papers.map((p) => (
                  <li key={paperId(p)}>
                    <label className="checkbox">
                      <input type="checkbox" checked={ticked.has(paperId(p))} onChange={() => toggle(p)} />
                      <span>
                        <strong>@{p.citekey}</strong> {p.title}
                        <span className="muted small paper-changes">
                          {p.changes ? describeChanges(p.changes) : "Exported before Tourmaline kept track: changes unknown"}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {papers !== null && papers.length > 0 && (
            <>
              {presets.length > 1 && (
                <div className="preset-row">
                  <label className="field-label" htmlFor={field("preset")}>
                    Start from
                  </label>
                  <select
                    id={field("preset")}
                    className="select"
                    value={preset.id}
                    onChange={(e) => {
                      const p = presets.find((x) => x.id === e.target.value) ?? initial;
                      setPresetId(p.id);
                      setChoices({ filter: p.filter, groupBy: p.groupBy });
                    }}
                  >
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {!sameChoices(choices, p) && p.id === preset.id ? " (changed)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <ExportChoices filter={choices.filter} groupBy={choices.groupBy} categories={categories} onChange={setChoices} />
            </>
          )}
          <p id={field("status")} className="small" role="status">
            {status}
          </p>
          <div className="dialog-actions">
            <span className="spacer" />
            <button ref={cancelRef} type="button" className="button" onClick={onCancel}>
              {papers?.length ? "Cancel" : "Close"}
            </button>
            {papers !== null && papers.length > 0 && (
              <button ref={exportRef} type="submit" className="button primary" disabled={!!problem || chosen.length === 0}>
                Export
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
