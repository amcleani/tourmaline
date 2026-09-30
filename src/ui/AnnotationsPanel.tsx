import { useEffect, useId, useMemo, useState } from "react";
import { normaliseQuery } from "../pdf/search";
import { readAttachment } from "../platform";
import { colourOf, type Annotation, type Category } from "../annotations/types";
import { NoteView } from "../notes/NoteView";
import { Icon } from "./icons";

interface Props {
  annotations: readonly Annotation[];
  categories: readonly Category[];
  selectedId: string | null;
  reanchoring: boolean;
  pageLabel: (page: number) => string;
  onSelect: (id: string) => void;
  onEditNote: () => void;
  /** Rendered under the list when the selected entry can't be shown on the page (orphans). */
  inlineEditor?: React.ReactNode;
}

const STATUS_TEXT: Record<string, string> = {
  orphan: "Not found in this version",
  fuzzy: "Position uncertain in this version",
};

// The annotation sidebar: filter by text and category, click or arrow to an
// annotation to select it and scroll to it. It's a listbox: Up/Down/Home/End
// move, Enter edits the note, Delete deletes (via the command).
export function AnnotationsPanel({
  annotations,
  categories,
  selectedId,
  reanchoring,
  pageLabel,
  onSelect,
  onEditNote,
  inlineEditor,
}: Props) {
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

  useEffect(() => {
    if (selectedId) document.getElementById(`${listId}-${selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, listId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keys typed in the inline editor are its own.
    if (visible.length === 0 || e.target !== e.currentTarget) return;
    const go = (i: number) => onSelect(visible[Math.max(0, Math.min(i, visible.length - 1))].id);
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

  const toggle = (id: string) =>
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
                onClick={() => toggle(c.id)}
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
          No annotations yet. Select text and press H (or a category key 1–9), or use Annotate › Capture area.
        </p>
      ) : visible.length === 0 ? (
        <p className="panel-status muted">No annotations match.</p>
      ) : (
        <ul
          className="annotation-list"
          role="listbox"
          aria-label={`Annotations, ${visible.length} of ${annotations.length}`}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${visible[activeIndex].id}` : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {visible.map((a) => {
            const status = a.placement?.status ?? "orphan";
            const selected = a.id === selectedId;
            return (
              <li
                key={a.id}
                id={`${listId}-${a.id}`}
                role="option"
                aria-selected={selected}
                className="annotation-item"
                style={{ ["--mark-colour" as string]: colourOf(a, categories) }}
                onClick={() => onSelect(a.id)}
              >
                <div className="annotation-meta">
                  <span className="swatch small" />
                  <span>{a.placement && status !== "orphan" ? `p. ${pageLabel(a.placement.page)}` : "—"}</span>
                  {a.kind === "area" && <span className="muted">Area</span>}
                  {STATUS_TEXT[status] && (
                    <span className="status-badge" title={STATUS_TEXT[status]}>
                      <Icon name="warning" size={14} /> {STATUS_TEXT[status]}
                    </span>
                  )}
                </div>
                {a.kind === "area" && a.imagePath && <AttachmentImage id={a.id} />}
                {a.quote && <p className="annotation-quote">{a.quote}</p>}
                {a.note && <NoteView className="annotation-note" text={a.note} />}
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
