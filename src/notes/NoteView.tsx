import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { mathGeneration, onMathChange, renderMath } from "../math/engine";
import { openInObsidian } from "../platform";
import { lineBreakSetting, renderNote } from "./markdown";
import { parseWikilink, wikilinkUrl } from "./wikilinks";

function blockLinks(e: React.MouseEvent) {
  if ((e.target as HTMLElement).closest("a")) e.preventDefault();
}

/** A wikilink opens its note in Obsidian (Enter on a focused link clicks it too). */
function followLinks(e: React.MouseEvent) {
  blockLinks(e);
  const target = (e.target as HTMLElement).closest<HTMLElement>("a.wikilink")?.dataset.wikilink;
  if (target === undefined) return;
  // Only the link: not also whatever holds the note (an annotation in the list).
  e.stopPropagation();
  const url = wikilinkUrl(parseWikilink(target));
  if (url) openInObsidian(url).catch((err) => console.error("Could not open the note in Obsidian", err));
}

/** Re-renders when the math settings (preamble, font) change. */
export function useMathGeneration(): number {
  return useSyncExternalStore(onMathChange, mathGeneration);
}

// A note rendered as Obsidian's reading view shows it: markdown with MathJax.
// In a list whose items are chosen with the arrow keys (`inList`), links
// aren't Tab stops of their own: a click still follows one, and the
// keyboard uses Annotate › Open linked note.
export function NoteView({ text, className, inList = false }: { text: string; className?: string; inList?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const strict = useSyncExternalStore(lineBreakSetting.subscribe, lineBreakSetting.strict);
  // `strict` changes how the same text renders.
  const rendered = useMemo(() => renderNote(text), [text, strict]);
  const generation = useMathGeneration();

  useEffect(() => {
    if (!inList) return;
    for (const a of ref.current?.querySelectorAll("a.wikilink") ?? []) a.removeAttribute("href");
  }, [rendered, inList]);

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
      onClick={followLinks}
      onAuxClick={blockLinks}
    />
  );
}
