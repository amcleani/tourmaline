// Live preview of math in the note editor, like Obsidian's: each formula is
// drawn in place with MathJax, and turns back into its TeX while the cursor
// is in it (or next to it), so moving into a formula edits it.

import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { findMath } from "../math/delimiters";
import { mathGeneration, renderMath } from "../math/engine";

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly generation: number,
  ) {
    super();
  }

  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display && other.generation === this.generation;
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = this.display ? "cm-math display" : "cm-math";
    // The source shows until MathJax is ready.
    el.textContent = this.display ? `$$${this.tex}$$` : `$${this.tex}$`;
    renderMath(this.tex, this.display)
      .then((node) => el.replaceChildren(node))
      .catch((e) => console.error("Could not render math", e));
    return el;
  }

  // Clicks go to the editor, which puts the cursor there and so reveals the TeX.
  ignoreEvent() {
    return false;
  }
}

/** Dispatched when the math settings change, to redraw every formula. */
export const refreshMath = StateEffect.define<null>();
const setFocused = StateEffect.define<boolean>();

interface PreviewState {
  focused: boolean;
  decorations: DecorationSet;
}

const sourceMark = Decoration.mark({ class: "cm-math-source" });

function decorate(state: EditorState, focused: boolean): DecorationSet {
  const generation = mathGeneration();
  const ranges = [];
  for (const span of findMath(state.doc.toString())) {
    const editing = focused && state.selection.ranges.some((r) => r.from <= span.to && r.to >= span.from);
    ranges.push(
      editing
        ? sourceMark.range(span.from, span.to)
        : Decoration.replace({ widget: new MathWidget(span.tex, span.display, generation) }).range(span.from, span.to),
    );
  }
  return Decoration.set(ranges);
}

// A state field (not a view plugin) because display formulas can replace line breaks.
const preview = StateField.define<PreviewState>({
  create: (state) => ({ focused: false, decorations: decorate(state, false) }),
  update(value, tr) {
    let focused = value.focused;
    let refresh = false;
    for (const e of tr.effects) {
      if (e.is(setFocused)) focused = e.value;
      if (e.is(refreshMath)) refresh = true;
    }
    if (!refresh && !tr.docChanged && !tr.selection && focused === value.focused) return value;
    return { focused, decorations: decorate(tr.state, focused) };
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.decorations),
});

export function mathPreview(): Extension {
  return [preview, EditorView.focusChangeEffect.of((_, focusing) => setFocused.of(focusing))];
}
