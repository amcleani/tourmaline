import { useEffect, useId, useRef } from "react";
import type { ExportPlan, PlanItem } from "../vault/runExport";

interface Props {
  plan: ExportPlan;
  /** The note, relative to the vault. */
  path: string;
  /** Export selected (nothing else in the section changes). */
  selected: boolean;
  onExport: () => void;
  onCancel: () => void;
  /** Another way out (e.g. Stop exporting), before Cancel. */
  extra?: { label: string; onClick: () => void };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// What an export will change in the note's section, before writing it:
// shown when highlights would leave the note (then Cancel has focus, as in
// any question that removes something), when asked for (Export › Preview
// export), and as the prompt of Export selected (then Enter exports).
export function ExportPreviewDialog({ plan, path, selected, onExport, onCancel, extra }: Props) {
  const id = useId();
  const focusRef = useRef<HTMLButtonElement>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const removes = plan.removed.length > 0;
  const linked = plan.removed.filter((r) => r.linkedFrom.length > 0).length;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (removes ? focusRef : exportRef).current?.focus();
    return () => previous?.focus?.();
    // Focus once, when the dialog opens.
  }, []);

  const nothing = !plan.added.length && !plan.updated.length && !removes;
  const changes =
    [
      plan.added.length && `adds ${count(plan.added.length, "highlight")}`,
      plan.updated.length && `updates ${plan.updated.length}`,
      removes && `removes ${plan.removed.length}`,
    ]
      .filter(Boolean)
      .join(", ") +
    (plan.unchanged ? `; ${plan.unchanged} stay as they are` : "") +
    (selected ? ". Nothing else in the section changes." : ".");

  const list = (title: string, items: readonly (PlanItem & { linkedFrom?: string[] })[], className?: string) =>
    items.length > 0 && (
      <section className={`export-plan ${className ?? ""}`} aria-label={title}>
        <h3>
          {title} ({items.length})
        </h3>
        <ul className="link-list">
          {items.map((item) => (
            <li key={item.blockId}>
              {item.text || <code>^{item.blockId}</code>}
              {item.linkedFrom?.length ? (
                <div className="field-error">
                  Linked from {item.linkedFrom.map((p, i) => (
                    <span key={p}>
                      {i > 0 && ", "}
                      <code>{p}</code>
                    </span>
                  ))}
                  : those links will stop working.
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div
        className="dialog export-preview-dialog"
        role={removes ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-summary`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className="dialog-header">
          <h2 id={`${id}-title`}>{removes ? "Remove highlights from the note?" : selected ? "Export selected annotations" : "Export preview"}</h2>
        </div>
        <div className="dialog-body">
          <p id={`${id}-summary`}>
            {nothing ? (
              <>
                Nothing in <code>{path}</code> would change.
              </>
            ) : (
              <>
                In <code>{path}</code>: {changes}
              </>
            )}
          </p>
          {list("Removed", plan.removed, "removed")}
          {list("Added", plan.added)}
          {list("Updated", plan.updated)}
          {removes && (
            <p className="muted small">
              {linked
                ? "To keep a linked highlight, cancel and export with choices that include it (or undo its deletion first)."
                : "They are left out by this export's choices, or were deleted in Tourmaline."}
            </p>
          )}
          <div className="dialog-actions">
            {extra && (
              <button type="button" className="button" onClick={extra.onClick}>
                {extra.label}
              </button>
            )}
            <span className="spacer" />
            {/* Nothing to change: one button, which goes on (the note is then counted as up to date). */}
            {!nothing && (
              <button ref={focusRef} type="button" className="button" onClick={onCancel}>
                Cancel
              </button>
            )}
            <button ref={exportRef} type="button" className={removes ? "button danger" : "button primary"} onClick={onExport}>
              {removes ? "Export and remove" : nothing ? "OK" : "Export"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
