import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { mathGeneration, onMathChange, renderMath } from "../math/engine";
import { renderNote } from "./markdown";

function blockLinks(e: React.MouseEvent) {
  if ((e.target as HTMLElement).closest("a")) e.preventDefault();
}

/** Re-renders when the math settings (preamble, font) change. */
export function useMathGeneration(): number {
  return useSyncExternalStore(onMathChange, mathGeneration);
}

// A note rendered as Obsidian's reading view shows it: markdown with MathJax.
export function NoteView({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useMemo(() => renderNote(text), [text]);
  const generation = useMathGeneration();

  useEffect(() => {
    let cancelled = false;
    for (const el of ref.current?.querySelectorAll<HTMLElement>(".note-math") ?? []) {
      const span = rendered.math[Number(el.dataset.math)];
      renderMath(span.tex, span.display)
        .then((node) => {
          if (!cancelled) el.replaceChildren(node);
        })
        .catch((e) => console.error("Could not render math", e));
    }
    return () => {
      cancelled = true;
    };
  }, [rendered, generation]);

  return (
    <div
      ref={ref}
      className={`note-view${className ? ` ${className}` : ""}`}
      dangerouslySetInnerHTML={{ __html: rendered.html }}
      // Links would navigate the app's own window away (middle-click: open a new one).
      onClick={blockLinks}
      onAuxClick={blockLinks}
    />
  );
}
