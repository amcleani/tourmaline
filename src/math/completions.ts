// `\` autocomplete for TeX in notes: the vault preamble's macros first (with
// their arguments as tab stops and a rendered example), then everything
// MathJax defines with the current packages, and `\begin{…}` environments.

import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { currentMathConfig, mathGeneration, renderMath, texNames } from "./engine";
import { parseMacros, type MacroDef } from "./preamble";

/** Common built-ins that take arguments, so completing them adds the braces. */
const BUILTIN_ARGS: Record<string, number> = {
  frac: 2, dfrac: 2, tfrac: 2, cfrac: 2, binom: 2, dbinom: 2, tbinom: 2, overset: 2, underset: 2, stackrel: 2,
  sqrt: 1, text: 1, textbf: 1, textit: 1, textrm: 1, textsf: 1, texttt: 1, mathrm: 1, mathbf: 1, mathit: 1,
  mathsf: 1, mathtt: 1, mathcal: 1, mathfrak: 1, mathbb: 1, mathscr: 1, boldsymbol: 1, operatorname: 1,
  overline: 1, underline: 1, overbrace: 1, underbrace: 1, hat: 1, widehat: 1, bar: 1, tilde: 1, widetilde: 1,
  vec: 1, dot: 1, ddot: 1, check: 1, breve: 1, acute: 1, grave: 1, cancel: 1, bcancel: 1, xcancel: 1, ce: 1,
  xrightarrow: 1, xleftarrow: 1, xLeftarrow: 1, xRightarrow: 1, boxed: 1, phantom: 1, tag: 1, label: 1,
  pmod: 1, bmod: 0, color: 1, textcolor: 2, fbox: 1, mbox: 1, hbox: 1,
};

/** `\name{#{1}}{#{2}}#{0}`: one tab stop per required argument, then one after the braces. */
function template(name: string, required: number): string {
  let out = `\\${name}`;
  for (let i = 1; i <= required; i++) out += `{#{${i}}}`;
  // Tab after the last argument leaves the braces.
  return `${out}#{0}`;
}

function preambleCompletion(m: MacroDef): Completion {
  const required = m.args - (m.optional !== null ? 1 : 0);
  const example = `\\${m.name}${["A", "B", "C", "D", "E", "F", "G", "H", "I"].slice(0, required).map((a) => `{${a}}`).join("")}`;
  const option: Completion = {
    label: `\\${m.name}`,
    detail: m.args ? `preamble, ${m.args} argument${m.args > 1 ? "s" : ""}` : "preamble",
    type: "function",
    boost: 10,
    info: async () => {
      const box = document.createElement("div");
      box.className = "completion-info";
      const code = document.createElement("code");
      code.textContent = m.optional !== null ? `[${m.optional}] ${m.body}` : m.body;
      box.append(code);
      try {
        const math = await renderMath(example, false);
        math.classList.add("completion-example");
        box.append(math);
      } catch {
        // The definition alone is still useful.
      }
      return box;
    },
  };
  return required > 0 ? snippetCompletion(template(m.name, required), option) : option;
}

let cached: { generation: number; macros: Completion[]; environments: Completion[] } | null = null;

async function completions() {
  const generation = mathGeneration();
  if (cached?.generation === generation) return cached;
  const [config, names] = await Promise.all([currentMathConfig(), texNames()]);
  const own = parseMacros(config.preamble);
  const ownNames = new Set(own.map((m) => m.name));
  const macros = [
    ...own.map(preambleCompletion),
    ...names.macros
      .filter((n) => !ownNames.has(n))
      .map((n): Completion => {
        const option: Completion = { label: `\\${n}`, type: "keyword" };
        return BUILTIN_ARGS[n] ? snippetCompletion(template(n, BUILTIN_ARGS[n]), option) : option;
      }),
  ];
  const environments = names.environments.map((env) =>
    snippetCompletion(`${env}}\n\t#{1}\n\\end{${env}}#{0}`, { label: env, type: "type" }),
  );
  cached = { generation, macros, environments };
  return cached;
}

export async function texCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
  const env = context.matchBefore(/\\begin\{[a-zA-Z]*\*?/);
  if (env) {
    return { from: env.text.indexOf("{") + 1 + env.from, options: (await completions()).environments, validFor: /^[a-zA-Z]*\*?$/ };
  }
  const word = context.matchBefore(/\\[a-zA-Z]*/);
  // `\\` is a TeX line break, not the start of a command.
  if (!word || context.state.sliceDoc(word.from - 1, word.from) === "\\") return null;
  return { from: word.from, options: (await completions()).macros, validFor: /^\\[a-zA-Z]*$/ };
}
