import type { Category } from "../annotations/types";
import { Icon } from "./icons";

interface Props {
  categories: readonly Category[];
  style: React.CSSProperties;
  onHighlight: (categoryId: string) => void;
  onHighlightWithNote: () => void;
}

// Appears under a text selection: one button per category, plus highlight
// with a note. The same actions are keys (1-9, H, N), menu items and palette
// commands. Buttons keep the selection alive by not taking focus on mousedown.
export function SelectionToolbar({ categories, style, onHighlight, onHighlightWithNote }: Props) {
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div className="selection-toolbar" role="toolbar" aria-label="Highlight selection" style={style}>
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          className="swatch-button"
          onMouseDown={keep}
          onClick={() => onHighlight(c.id)}
          title={`Highlight as ${c.name}${c.hotkey ? ` (${c.hotkey})` : ""}`}
          aria-label={`Highlight as ${c.name}`}
          aria-keyshortcuts={c.hotkey ? String(c.hotkey) : undefined}
        >
          <span className="swatch" style={{ background: c.colour }} />
        </button>
      ))}
      <button
        type="button"
        className="icon-button"
        onMouseDown={keep}
        onClick={onHighlightWithNote}
        title="Highlight and add a note (N)"
        aria-label="Highlight and add a note"
        aria-keyshortcuts="N"
      >
        <Icon name="note" size={16} />
      </button>
    </div>
  );
}
