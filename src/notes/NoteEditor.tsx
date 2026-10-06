import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { autocompletion, nextSnippetField, prevSnippetField, snippetKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { onMathChange } from "../math/engine";
import { texCompletionSource } from "../math/completions";
import { mathPreview, refreshMath } from "./mathPreview";
import { mathSyntax } from "./mathSyntax";
import { wikilinkCompletionSource, wikilinkSyntax } from "./wikilinks";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Mod+Enter. */
  onSubmit?: () => void;
  ariaLabel: string;
  placeholder?: string;
}

export interface NoteEditorHandle {
  focus: () => void;
  hasFocus: () => boolean;
}

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "600" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.monospace, fontFamily: "ui-monospace, Consolas, monospace" },
  { tag: [tags.link, tags.url], color: "var(--accent)" },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.quote], color: "var(--text-muted)" },
]);

// The note editor: markdown with formulas previewed in place (mathPreview.ts)
// and `\` autocomplete from the vault's preamble. Undo/redo (Ctrl+Z/Y) are
// the editor's own while it has focus. Escape is left to the surrounding
// popover unless the completion list is open. `[[` suggests the vault's
// notes (wikilinks.ts). Uncontrolled: `value` is
// applied when it differs from the text (an outside change, like undo).
export const NoteEditor = forwardRef<NoteEditorHandle, Props>(function NoteEditor(
  { value, onChange, onBlur, onSubmit, ariaLabel, placeholder },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onBlur, onSubmit });
  callbacks.current = { onChange, onBlur, onSubmit };

  useImperativeHandle(
    ref,
    () => ({ focus: () => view.current?.focus(), hasFocus: () => view.current?.hasFocus ?? false }),
    [],
  );

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                run: () => {
                  callbacks.current.onSubmit?.();
                  return true;
                },
              },
            ]),
          ),
          history(),
          // Escape belongs to the popover (close), except to close the completion list.
          keymap.of([...defaultKeymap.filter((b) => b.key !== "Escape"), ...historyKeymap]),
          snippetKeymap.of([{ key: "Tab", run: nextSnippetField, shift: prevSnippetField }]),
          markdown({ extensions: [mathSyntax, wikilinkSyntax] }),
          syntaxHighlighting(highlight),
          mathPreview(),
          autocompletion({ override: [texCompletionSource, (cx) => wikilinkCompletionSource(cx)], icons: false }),
          EditorView.lineWrapping,
          placeholderText(placeholder ?? ""),
          EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
            if (u.focusChanged && !u.view.hasFocus) callbacks.current.onBlur?.();
          }),
        ],
      }),
    });
    view.current = v;
    const unsubscribe = onMathChange(() => v.dispatch({ effects: refreshMath.of(null) }));
    return () => {
      unsubscribe();
      v.destroy();
      view.current = null;
    };
    // The editor is created once; later props go through refs and the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    });
  }, [value]);

  return <div ref={host} className="note-editor" />;
});
