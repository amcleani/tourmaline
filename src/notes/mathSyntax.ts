// Tells the editor's markdown parser that `$…$` and `$$…$$` are single
// units, so underscores and asterisks in TeX aren't read as emphasis
// (`(\cdot)_+ … \alg{A}_+` would otherwise italicise the text between).
// Same rules as math/delimiters.ts; escapes and code spans are parsed first.

import type { MarkdownConfig } from "@lezer/markdown";
import { mathAt } from "../math/delimiters";

const DOLLAR = 36;

export const mathSyntax: MarkdownConfig = {
  defineNodes: ["Math"],
  parseInline: [
    {
      name: "Math",
      before: "Emphasis",
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1;
        const span = mathAt(cx.slice(pos, cx.end), 0);
        if (span) return cx.addElement(cx.elt("Math", pos, pos + span.to));
        // An unclosed $$ is plain text as a pair, as in findMath.
        return cx.char(pos + 1) === DOLLAR ? pos + 2 : -1;
      },
    },
  ],
};
