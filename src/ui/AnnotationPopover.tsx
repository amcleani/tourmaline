import { useEffect, useRef, useState } from "react";
import { colourOf, type Annotation, type Category } from "../annotations/types";
import { formatShortcut } from "../commands/shortcuts";
import { NoteEditor, type NoteEditorHandle } from "../notes/NoteEditor";
import { Icon } from "./icons";

interface Props {
  annotation: Annotation;
  categories: readonly Category[];
  style?: React.CSSProperties;
  /** The note field should take focus (Edit note); onNoteFocused acknowledges it. */
  focusNote: boolean;
  onNoteFocused: () => void;
  onCategory: (categoryId: string) => void;
  onNote: (note: string) => Promise<void> | void;
  onDelete: () => void;
  onClose: () => void;
  /** Lets the app save the draft before the window closes; returns an unregister function. */
  registerFlush?: (flush: () => Promise<void> | void) => () => void;
}

/** Typing pauses this long before the note is saved. */
const SAVE_DELAY_MS = 1000;

// Shown next to the selected annotation: category, note and delete. The note
// is saved shortly after typing stops, when the field loses focus, on
// Ctrl+Enter, on closing, and before the window closes. Escape closes it
// (unless the editor's completion list is open).
// Key it by annotation id so the draft resets.
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
  registerFlush,
}: Props) {
  const [draft, setDraft] = useState(annotation.note);
  const noteRef = useRef<NoteEditorHandle>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saved = useRef(annotation.note);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Take outside changes (undo) unless the user is typing.
  useEffect(() => {
    if (!noteRef.current?.hasFocus()) setDraft(annotation.note);
    saved.current = annotation.note;
  }, [annotation.note]);

  useEffect(() => {
    if (!focusNote) return;
    noteRef.current?.focus();
    onNoteFocused();
  }, [focusNote, onNoteFocused]);

  const saveRef = useRef<() => Promise<void> | void>(() => undefined);
  saveRef.current = () => {
    clearTimeout(timer.current);
    if (draftRef.current === saved.current) return;
    saved.current = draftRef.current;
    return onNote(draftRef.current);
  };
  const save = () => saveRef.current();

  // Save when the popover goes away (another annotation selected, tab
  // closed, page scrolled off), and let the app flush it on quitting.
  useEffect(() => {
    const unregister = registerFlush?.(() => saveRef.current());
    return () => {
      unregister?.();
      void saveRef.current();
    };
  }, [registerFlush]);

  const close = () => {
    void save();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The editor already used this Escape (closing its completion list).
    if (e.key === "Escape" && !e.defaultPrevented) {
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
      <div className="category-choices" role="group" aria-label="Category">
        {live.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={annotation.categoryId === c.id}
            className="swatch-button"
            onClick={() => onCategory(c.id)}
            title={`${c.name}${c.hotkey ? ` (${c.hotkey})` : ""}`}
            aria-label={c.name}
          >
            <span className="swatch" style={{ background: c.colour }} />
          </button>
        ))}
      </div>
      <div className="note-label">
        <span aria-hidden="true">Note</span>
        <NoteEditor
          ref={noteRef}
          value={draft}
          ariaLabel="Note"
          placeholder="Markdown and $math$; type \ for commands"
          onChange={(text) => {
            setDraft(text);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => void saveRef.current(), SAVE_DELAY_MS);
          }}
          onBlur={() => void save()}
          onSubmit={close}
        />
      </div>
      <div className="popover-actions">
        <span className="muted small">{formatShortcut("Mod+Enter")} to finish</span>
        <button type="button" className="button danger" onClick={onDelete} title="Delete (Delete)">
          <Icon name="delete" size={16} /> Delete
        </button>
      </div>
    </div>
  );
}
