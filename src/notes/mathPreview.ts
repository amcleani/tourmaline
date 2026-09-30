// Live preview of math in the note editor, like Obsidian's: each formula is
// drawn in place with MathJax, and turns back into its TeX while the cursor
// is in it (or next to it), so moving into a formula edits it. Formulas are
// the markdown parser's Math nodes (mathSyntax.ts), so code stays code.

import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
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

  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = this.display ? "cm-math display" : "cm-math";
    // The source shows until MathJax is ready.
    el.textContent = this.display ? `$$${this.tex}$$` : `$${this.tex}$`;
    renderMath(this.tex, this.display)
      .then((node) => {
        el.replaceChildren(node);
        view.requestMeasure(); // the formula's height differs from its source's
      })
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

interface Formula {
  from: number;
  to: number;
  tex: string;
  display: boolean;
}

function inQuote(node: SyntaxNode): boolean {
  for (let n: SyntaxNode | null = node.parent; n; n = n.parent) if (n.name === "Blockquote") return true;
  return false;
}

/** The formulas in the note, with their TeX (exported for tests). */
export function formulas(state: EditorState): Formula[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const out: Formula[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name !== "Math") return;
      const raw = state.sliceDoc(node.from, node.to);
      const display = raw.startsWith("$$");
      let tex = display ? raw.slice(2, -2) : raw.slice(1, -1);
      // In a quote or callout, later lines of the formula start with "> ".
      if (inQuote(node.node)) tex = tex.replace(/\n[ \t]*(?:>[ \t]?)+/g, "\n");
      out.push({ from: node.from, to: node.to, tex, display });
      return false;
    },
  });
  return out;
}

function decorate(state: EditorState, focused: boolean): DecorationSet {
  const generation = mathGeneration();
  const ranges = [];
  for (const span of formulas(state)) {
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
