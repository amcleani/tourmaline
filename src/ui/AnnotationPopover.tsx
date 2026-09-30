import { useEffect, useRef, useState } from "react";
import { colourOf, type Annotation, type Category } from "../annotations/types";
import { formatShortcut } from "../commands/shortcuts";
import { Icon } from "./icons";

interface Props {
  annotation: Annotation;
  categories: readonly Category[];
  style?: React.CSSProperties;
  /** The note field should take focus (Edit note); onNoteFocused acknowledges it. */
  focusNote: boolean;
  onNoteFocused: () => void;
  onCategory: (categoryId: string) => void;
  onNote: (note: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

// Shown next to the selected annotation: category, note and delete. The note
// is saved when the field loses focus, on Ctrl+Enter and on closing.
// Escape closes it. Key it by annotation id so the draft resets.
export function AnnotationPopover({
  annotation,
  categories,
  style,
  focusNote,
  onNoteFocused,
  onCategory,
  onNote,
  onDelete,
  onClose,
}: Props) {
  const [draft, setDraft] = useState(annotation.note);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saved = useRef(annotation.note);

  // Take outside changes (undo) unless the user is typing.
  useEffect(() => {
    if (document.activeElement !== noteRef.current) setDraft(annotation.note);
    saved.current = annotation.note;
  }, [annotation.note]);

  useEffect(() => {
    if (!focusNote) return;
    noteRef.current?.focus({ preventScroll: true });
    onNoteFocused();
  }, [focusNote, onNoteFocused]);

  const save = () => {
    if (draftRef.current !== saved.current) {
      saved.current = draftRef.current;
      onNote(draftRef.current);
    }
  };
  // Save when the popover goes away (another annotation selected, page scrolled off).
  const saveOnUnmount = useRef(save);
  saveOnUnmount.current = save;
  useEffect(() => () => saveOnUnmount.current(), []);

  const close = () => {
    save();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target === noteRef.current) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const colour = colourOf(annotation, categories);
  const live = categories.filter((c) => !c.deleted);
  const titleId = `annotation-${annotation.id}-title`;
  return (
    <div
      className="annotation-popover"
      role="dialog"
      aria-labelledby={titleId}
      style={{ ...style, ["--mark-colour" as string]: colour }}
      onKeyDown={onKeyDown}
    >
      <div className="popover-header">
        <h2 id={titleId}>{annotation.kind === "area" ? "Area" : "Highlight"}</h2>
        <button type="button" className="icon-button" onClick={close} aria-label="Close" title="Close (Escape)">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="category-choices" role="radiogroup" aria-label="Category">
        {live.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={annotation.categoryId === c.id}
            className="swatch-button"
            onClick={() => onCategory(c.id)}
            title={`${c.name}${c.hotkey ? ` (${c.hotkey})` : ""}`}
            aria-label={c.name}
          >
            <span className="swatch" style={{ background: c.colour }} />
          </button>
        ))}
      </div>
      <label className="note-label">
        <span>Note</span>
        <textarea
          ref={noteRef}
          value={draft}
          rows={4}
          placeholder="Markdown and $math$"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
        />
      </label>
      <div className="popover-actions">
        <span className="muted small">{formatShortcut("Mod+Enter")} to finish</span>
        <button type="button" className="button danger" onClick={onDelete} title="Delete (Delete)">
          <Icon name="delete" size={16} /> Delete
        </button>
      </div>
    </div>
  );
}
