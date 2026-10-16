import { useEffect, useId, useMemo, useRef, useState } from "react";
import { normaliseQuery } from "../pdf/search";
import { readAttachment } from "../platform";
import { colourOf, type Annotation, type Category } from "../annotations/types";
import { NoteView } from "../notes/NoteView";
import { Icon } from "./icons";
import { useShortcut } from "../commands/useShortcut";
import type { BlockStatus } from "../vault/export";

interface Props {
  annotations: readonly Annotation[];
  categories: readonly Category[];
  /** The active annotation (the one the popover and single-annotation commands are about). */
  selectedId: string | null;
  /** Every selected annotation (the active one among them, unless it was just unticked). */
  selection: ReadonlySet<string>;
  /** New and changed since the last export, by annotation id (none if never exported). */
  exportStatus?: ReadonlyMap<string, BlockStatus>;
  reanchoring: boolean;
  pageLabel: (page: number) => string;
  /** Selects just this one. */
  onSelect: (id: string) => void;
  /** Selects these (in list order), `active` being the active one. */
  onChoose: (ids: string[], active: string) => void;
  onEditNote: () => void;
  /** Rendered under the list when the selected entry can't be shown on the page (orphans). */
  inlineEditor?: React.ReactNode;
}

const STATUS_TEXT: Record<string, string> = {
  orphan: "Not found in this version",
  fuzzy: "Position uncertain in this version",
};

const EXPORT_TEXT: Record<BlockStatus, { label: string; title: string }> = {
  new: { label: "New", title: "Not exported to the note yet" },
  changed: { label: "Changed", title: "Changed since it was last exported" },
};

// The annotation sidebar: filter by text and category, click or arrow to an
// annotation to select it and scroll to it. It's a multi-select listbox:
// Up/Down/Home/End move, with Shift they select a range, Ctrl+Up/Down move
// without changing the selection and Space adds or removes the active one,
// Ctrl+A selects all shown; Ctrl+click and Shift+click do the same by
// mouse. Enter edits the note, Delete deletes (via the command).
export function AnnotationsPanel({
  annotations,
  categories,
  selectedId,
  selection,
  exportStatus,
  reanchoring,
  pageLabel,
  onSelect,
  onChoose,
  onEditNote,
  inlineEditor,
}: Props) {
  const highlightKey = useShortcut("annot.highlight");
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const listId = useId();

  // Chips for the categories in use, plus any hidden one (so it can be shown again).
  const used = useMemo(() => {
    const ids = new Set(annotations.map((a) => a.categoryId ?? ""));
    return categories.filter((c) => ids.has(c.id) || hidden.has(c.id));
  }, [annotations, categories, hidden]);

  const visible = useMemo(() => {
    const q = normaliseQuery(query);
    return annotations.filter(
      (a) =>
        !hidden.has(a.categoryId ?? "") &&
        (!q || normaliseQuery(`${a.quote ?? ""} ${a.note}`).includes(q)),
    );
  }, [annotations, hidden, query]);

  const activeIndex = visible.findIndex((a) => a.id === selectedId);
  /** Where a Shift range starts: the last annotation chosen on its own or added. */
  const anchor = useRef<string | null>(null);
  const indexOf = (id: string | null) => visible.findIndex((a) => a.id === id);

  const only = (id: string) => {
    anchor.current = id;
    onSelect(id);
  };
  const range = (to: number) => {
    // From the anchor while it's part of the selection; else (the selection
    // was made elsewhere, e.g. on the page) from the active annotation.
    const anchored = anchor.current !== null && selection.has(anchor.current) ? indexOf(anchor.current) : -1;
    const from = anchored === -1 ? Math.max(activeIndex, 0) : anchored;
    anchor.current = visible[from].id;
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    onChoose(visible.slice(lo, hi + 1).map((a) => a.id), visible[to].id);
  };
  const toggle = (id: string) => {
    anchor.current = id;
    const next = selection.has(id) ? [...selection].filter((x) => x !== id) : [...selection, id];
    onChoose(visible.filter((a) => next.includes(a.id)).map((a) => a.id), id);
  };

  useEffect(() => {
    if (selectedId) document.getElementById(`${listId}-${selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, listId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keys typed in the inline editor are its own.
    if (visible.length === 0 || e.target !== e.currentTarget) return;
    const clamp = (i: number) => Math.max(0, Math.min(i, visible.length - 1));
    const mod = e.ctrlKey || e.metaKey;
    // Shift extends the selection; Ctrl moves without changing it.
    const go = (i: number) => {
      const to = clamp(i);
      if (e.shiftKey) range(to);
      else if (mod) onChoose(visible.filter((a) => selection.has(a.id)).map((a) => a.id), visible[to].id);
      else only(visible[to].id);
    };
    if (e.altKey) return;
    switch (e.key) {
      case "ArrowDown":
        go(activeIndex + 1);
        break;
      case "ArrowUp":
        go(activeIndex === -1 ? visible.length - 1 : activeIndex - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(visible.length - 1);
        break;
      case " ":
        if (activeIndex === -1) return;
        toggle(visible[activeIndex].id);
        break;
      case "a":
      case "A":
        if (!mod || e.shiftKey) return;
        onChoose(visible.map((a) => a.id), selectedId && activeIndex !== -1 ? selectedId : visible[0].id);
        break;
      case "Enter":
        if (activeIndex === -1) return;
        onEditNote();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const toggleCategory = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="annotations-panel">
      <div className="panel-filters">
        <input
          type="search"
          className="text-input"
          placeholder="Filter annotations"
          aria-label="Filter annotations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(used.length > 1 || hidden.size > 0) && (
          <div className="category-filter" role="group" aria-label="Show categories">
            {used.map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip"
                aria-pressed={!hidden.has(c.id)}
                onClick={() => toggleCategory(c.id)}
              >
                <span className="swatch small" style={{ background: c.colour }} />
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {reanchoring && (
        <p className="panel-status muted" role="status">
          Finding annotations in this version of the file…
        </p>
      )}
      {annotations.length === 0 ? (
        <p className="panel-status muted">
          No annotations yet. Select text and {highlightKey ? `press ${highlightKey} (or a category key)` : "use Annotate › Highlight selection"}, or use Annotate › Capture area.
        </p>
      ) : visible.length === 0 ? (
        <p className="panel-status muted">No annotations match.</p>
      ) : (
        <ul
          className="annotation-list"
          role="listbox"
          aria-multiselectable="true"
          aria-label={`Annotations, ${visible.length} of ${annotations.length}${selection.size > 1 ? `, ${selection.size} selected` : ""}`}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${visible[activeIndex].id}` : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {visible.map((a) => {
            const status = a.placement?.status ?? "orphan";
            const selected = selection.has(a.id);
            const exported = exportStatus?.get(a.id);
            return (
              <li
                key={a.id}
                id={`${listId}-${a.id}`}
                role="option"
                aria-selected={selected}
                className={`annotation-item${a.id === selectedId ? " active" : ""}`}
                style={{ ["--mark-colour" as string]: colourOf(a, categories) }}
                onClick={(e) => {
                  if (e.shiftKey) range(indexOf(a.id));
                  else if (e.ctrlKey || e.metaKey) toggle(a.id);
                  else only(a.id);
                }}
                // Shift+click selects a range, not text.
                onMouseDown={(e) => e.shiftKey && e.preventDefault()}
              >
                <div className="annotation-meta">
                  <span className="swatch small" />
                  <span>{a.placement && status !== "orphan" ? `p. ${pageLabel(a.placement.page)}` : "—"}</span>
                  {a.kind === "area" && <span className="muted">Area</span>}
                  {exported && (
                    <span className={`export-badge ${exported}`} title={EXPORT_TEXT[exported].title}>
                      {EXPORT_TEXT[exported].label}
                      <span className="visually-hidden">: {EXPORT_TEXT[exported].title.toLowerCase()}</span>
                    </span>
                  )}
                  {STATUS_TEXT[status] && (
                    <span className="status-badge" title={STATUS_TEXT[status]}>
                      <Icon name="warning" size={14} /> {STATUS_TEXT[status]}
                    </span>
                  )}
                </div>
                {a.kind === "area" && a.imagePath && <AttachmentImage id={a.id} />}
                {a.quote && <p className="annotation-quote">{a.quote}</p>}
                {a.note && <NoteView className="annotation-note" text={a.note} inList />}
              </li>
            );
          })}
        </ul>
      )}
      {inlineEditor && <div className="panel-editor">{inlineEditor}</div>}
    </div>
  );
}

/** Thumbnail of an area annotation's saved picture. */
function AttachmentImage({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    readAttachment(id)
      .then((bytes) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }));
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return url ? <img className="annotation-image" src={url} alt="Captured area" /> : null;
}
