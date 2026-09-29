import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { OutlineNode, Target } from "../pdf/outline";

interface Props {
  outline: OutlineNode[] | null;
  onNavigate: (target: Target) => void;
}

interface Row {
  node: OutlineNode;
  depth: number;
  parent: string | null;
}

// Outline sidebar: an ARIA tree. Up/Down move, Right expands or enters,
// Left collapses or goes to the parent, Enter/Space jumps, Home/End.
export function OutlinePanel({ outline, onNavigate }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);

  // Expand the top level by default when a new outline arrives.
  useEffect(() => {
    setExpanded(new Set(outline?.filter((n) => n.children.length).map((n) => n.id) ?? []));
    setFocused(outline?.[0]?.id ?? null);
  }, [outline]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (nodes: OutlineNode[], depth: number, parent: string | null) => {
      for (const node of nodes) {
        out.push({ node, depth, parent });
        if (expanded.has(node.id)) walk(node.children, depth + 1, node.id);
      }
    };
    walk(outline ?? [], 0, null);
    return out;
  }, [outline, expanded]);

  useEffect(() => {
    if (focused && treeRef.current?.contains(document.activeElement)) {
      treeRef.current.querySelector<HTMLElement>(`[data-id="${focused}"]`)?.focus();
    }
  }, [focused]);

  if (outline === null) return <p className="panel-empty">Loading outline…</p>;
  if (outline.length === 0) return <p className="panel-empty">This PDF has no outline.</p>;

  const toggle = (id: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  const activate = (node: OutlineNode) => node.target && onNavigate(node.target);

  const onKeyDown = (e: React.KeyboardEvent, row: Row, index: number) => {
    const { node } = row;
    const hasChildren = node.children.length > 0;
    const move = (i: number) => {
      const target = rows[Math.min(Math.max(i, 0), rows.length - 1)];
      if (target) setFocused(target.node.id);
    };
    switch (e.key) {
      case "ArrowDown": move(index + 1); break;
      case "ArrowUp": move(index - 1); break;
      case "Home": move(0); break;
      case "End": move(rows.length - 1); break;
      case "ArrowRight":
        if (hasChildren && !expanded.has(node.id)) toggle(node.id, true);
        else if (hasChildren) move(index + 1);
        break;
      case "ArrowLeft":
        if (hasChildren && expanded.has(node.id)) toggle(node.id, false);
        else if (row.parent) setFocused(row.parent);
        break;
      case "Enter":
      case " ":
        activate(node);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <ul className="outline-tree" role="tree" aria-label="Outline" ref={treeRef}>
      {rows.map((row, i) => {
        const { node, depth } = row;
        const hasChildren = node.children.length > 0;
        return (
          <li
            key={node.id}
            data-id={node.id}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? expanded.has(node.id) : undefined}
            aria-disabled={node.target ? undefined : true}
            tabIndex={node.id === focused ? 0 : -1}
            className="outline-item"
            style={{ paddingLeft: 8 + depth * 14 }}
            onKeyDown={(e) => onKeyDown(e, row, i)}
            onFocus={() => setFocused(node.id)}
            onClick={() => activate(node)}
          >
            {hasChildren ? (
              <button
                type="button"
                className="outline-twisty"
                tabIndex={-1}
                aria-hidden="true"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(node.id);
                }}
              >
                <ChevronRight size={14} className={expanded.has(node.id) ? "open" : undefined} />
              </button>
            ) : (
              <span className="outline-twisty" />
            )}
            <span className="outline-title">{node.title}</span>
            {node.target && <span className="outline-page">{node.target.page + 1}</span>}
          </li>
        );
      })}
    </ul>
  );
}
