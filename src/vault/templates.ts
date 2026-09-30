// Handlebars templates for literature notes and highlights, with the
// Obsidian Citations plugin's syntax and field names. Parsed by Handlebars
// itself; rendered by the small interpreter below, because Handlebars'
// compiler needs `new Function`, which the app's CSP forbids. Output is not
// HTML-escaped (the plugin compiles with `noEscape`).
//
// Supported: {{path}}, {{{path}}}, ../ and this, @index/@first/@last/@key/@root,
// block params, {{#if}} {{#unless}} {{#each}} {{#with}} with {{else}} chains,
// {{lookup}}, sections over arrays and objects, comments and ~ whitespace
// control. Partials and decorators are not.

import { parse } from "handlebars/dist/cjs/handlebars/compiler/base";

// ---- The parts of Handlebars' syntax tree used here -------------------------

interface Loc {
  start: { line: number; column: number };
}
interface Base {
  loc?: Loc;
}
export interface HbsProgram extends Base {
  type: "Program";
  body: Statement[];
  blockParams?: string[];
}
interface PathExpression extends Base {
  type: "PathExpression";
  data: boolean;
  depth: number;
  parts: string[];
  original: string;
}
interface SubExpression extends Base {
  type: "SubExpression";
  path: PathExpression;
  params: Expression[];
  hash?: Hash;
}
interface Literal extends Base {
  type: "StringLiteral" | "NumberLiteral" | "BooleanLiteral" | "UndefinedLiteral" | "NullLiteral";
  value?: unknown;
}
type Expression = PathExpression | SubExpression | Literal;
interface Hash {
  pairs: { key: string; value: Expression }[];
}
interface Mustache extends Base {
  type: "MustacheStatement";
  path: PathExpression | Literal;
  params: Expression[];
  hash?: Hash;
}
interface Block extends Base {
  type: "BlockStatement";
  path: PathExpression;
  params: Expression[];
  hash?: Hash;
  program?: HbsProgram;
  inverse?: HbsProgram;
}
type Statement =
  | Mustache
  | Block
  | (Base & { type: "ContentStatement"; value: string })
  | (Base & { type: "CommentStatement" })
  | (Base & { type: "PartialStatement" | "PartialBlockStatement" | "DecoratorBlock" | "Decorator" });

export class TemplateError extends Error {}

// ---- Rendering ----------------------------------------------------------------

/**
 * One block level. As in Handlebars, `../` counts only levels that changed
 * the context ({{#if}} inside {{#each}} doesn't), and `@../` only levels that
 * brought new data (@index...).
 */
interface Frame {
  context: unknown;
  data: Record<string, unknown>;
  params: Record<string, unknown>;
  newContext: boolean;
  newData: boolean;
}

const own = (value: unknown, key: string): unknown =>
  value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key)
    ? (value as Record<string, unknown>)[key]
    : typeof value === "string" && key === "length"
      ? value.length
      : undefined;

/** Handlebars' idea of empty: falsy (but not 0) or an empty array. */
const isEmpty = (v: unknown) => (!v && v !== 0) || (Array.isArray(v) && v.length === 0);

function toText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

const where = (node: Base) => (node.loc ? ` (line ${node.loc.start.line})` : "");

class Output {
  text = "";

  /**
   * Appends a value. Continuation lines of a multi-line value written inside
   * a callout or quote get that line's `>` prefix, so notes and $$ blocks
   * stay inside the callout.
   */
  value(s: string) {
    s = s.replace(/\r\n?/g, "\n");
    if (s.includes("\n")) {
      const line = this.text.slice(this.text.lastIndexOf("\n") + 1);
      const prefix = /^[ \t]*(?:>[ \t]?)+/.exec(line)?.[0];
      if (prefix) {
        const bare = prefix.trimEnd();
        s = s
          .replace(/\n+$/, "")
          .split("\n")
          .map((l, i) => (i === 0 ? l : l ? prefix + l : bare))
          .join("\n");
      }
    }
    this.text += s;
  }
}

type Options = {
  fn: (context: unknown, data?: Record<string, unknown>, params?: unknown[]) => void;
  inverse: (context: unknown) => void;
  hash: Record<string, unknown>;
};

class Renderer {
  constructor(
    private out: Output,
    private root: unknown,
  ) {}

  program(program: HbsProgram | undefined, stack: Frame[]) {
    for (const s of program?.body ?? []) this.statement(s, stack);
  }

  statement(s: Statement, stack: Frame[]) {
    switch (s.type) {
      case "ContentStatement":
        this.out.text += s.value;
        return;
      case "CommentStatement":
        return;
      case "MustacheStatement":
        this.out.value(toText(this.mustache(s, stack)));
        return;
      case "BlockStatement":
        this.block(s, stack);
        return;
      default:
        throw new TemplateError(`${s.type.replace(/Statement|Block/, "").toLowerCase() || "this"}s aren't supported${where(s)}`);
    }
  }

  mustache(m: Mustache | SubExpression, stack: Frame[]): unknown {
    const path = m.path;
    if (path.type === "PathExpression" && isHelperName(path)) {
      const name = path.parts[0];
      if (name === "lookup") {
        const [obj, key] = m.params.map((p) => this.expression(p, stack));
        return own(obj, toText(key));
      }
      if (name === "log") return "";
      if (BLOCK_HELPERS.has(name) && m.params.length) throw new TemplateError(`{{${name}}} needs a block: {{#${name} …}}${where(m)}`);
    }
    if (m.params.length) throw new TemplateError(`unknown helper "${toText(path.type === "PathExpression" ? path.original : "")}"${where(m)}`);
    return this.expression(path, stack);
  }

  expression(e: Expression, stack: Frame[]): unknown {
    switch (e.type) {
      case "PathExpression":
        return this.lookup(e, stack);
      case "SubExpression":
        return this.mustache(e, stack);
      case "UndefinedLiteral":
        return undefined;
      case "NullLiteral":
        return null;
      default:
        return e.value;
    }
  }

  lookup(path: PathExpression, stack: Frame[]): unknown {
    const up = (kind: "newContext" | "newData") => {
      const levels = stack.filter((f) => f[kind]);
      return levels[Math.max(0, levels.length - 1 - path.depth)];
    };
    let value: unknown;
    let parts = path.parts;
    if (path.data) {
      if (parts[0] === "root") value = this.root;
      else value = own(path.depth ? up("newData").data : stack[stack.length - 1].data, parts[0]);
      parts = parts.slice(1);
    } else if (!isScoped(path) && path.depth === 0 && parts.length && hasParam(stack, parts[0])) {
      value = paramValue(stack, parts[0]);
      parts = parts.slice(1);
    } else {
      value = up("newContext").context;
    }
    for (const part of parts) value = own(value, part);
    return value;
  }

  hash(hash: Hash | undefined, stack: Frame[]): Record<string, unknown> {
    return Object.fromEntries((hash?.pairs ?? []).map((p) => [p.key, this.expression(p.value, stack)]));
  }

  block(b: Block, stack: Frame[]) {
    const top = stack[stack.length - 1];
    const options: Options = {
      hash: this.hash(b.hash, stack),
      fn: (context, data, params) => {
        const names = b.program?.blockParams ?? [];
        const frame: Frame = {
          context,
          data: { ...top.data, ...data },
          params: Object.fromEntries(names.map((n, i) => [n, params?.[i]])),
          newContext: context !== top.context,
          newData: data !== undefined,
        };
        this.program(b.program, [...stack, frame]);
      },
      inverse: (context) =>
        this.program(
          b.inverse,
          context === top.context ? stack : [...stack, { ...top, context, params: {}, newContext: true, newData: false }],
        ),
    };
    const name = isHelperName(b.path) ? b.path.parts[0] : null;
    const params = b.params.map((p) => this.expression(p, stack));
    if (name && BLOCK_HELPERS.has(name)) {
      if (params.length !== 1) throw new TemplateError(`{{#${name}}} takes one value${where(b)}`);
      BLOCK_HELPERS.get(name)!(params[0], options, top.context);
      return;
    }
    if (params.length) throw new TemplateError(`unknown helper "${b.path.original}"${where(b)}`);
    // A section: {{#items}}…{{/items}} repeats, enters an object, or shows if true.
    const value = this.lookup(b.path, stack);
    if (value === true) options.fn(top.context);
    else if (isEmpty(value)) options.inverse(top.context);
    else if (Array.isArray(value)) each(value, options, top.context);
    else options.fn(value);
  }
}

/** A plain name (not this.x, ./x, ../x or @x) that could be a helper. */
function isHelperName(path: PathExpression | Literal): path is PathExpression {
  return path.type === "PathExpression" && !path.data && path.depth === 0 && path.parts.length === 1 && !isScoped(path);
}
const isScoped = (path: PathExpression) => /^\.|this\b/.test(path.original);
const hasParam = (stack: Frame[], name: string) => stack.some((f) => Object.hasOwn(f.params, name));
const paramValue = (stack: Frame[], name: string) =>
  [...stack].reverse().find((f) => Object.hasOwn(f.params, name))!.params[name];

function each(value: unknown, options: Options, context: unknown) {
  if (Array.isArray(value) && value.length) {
    value.forEach((item, i) =>
      options.fn(item, { index: i, key: i, first: i === 0, last: i === value.length - 1 }, [item, i]),
    );
  } else if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) {
    const keys = Object.keys(value);
    keys.forEach((key, i) =>
      options.fn((value as Record<string, unknown>)[key], { index: i, key, first: i === 0, last: i === keys.length - 1 }, [
        (value as Record<string, unknown>)[key],
        key,
      ]),
    );
  } else {
    options.inverse(context);
  }
}

const BLOCK_HELPERS = new Map<string, (value: unknown, options: Options, context: unknown) => void>([
  [
    "if",
    (v, o, context) => {
      const truthy = o.hash.includeZero ? v === 0 || !isEmpty(v) : !!v && !isEmpty(v);
      if (truthy) o.fn(context);
      else o.inverse(context);
    },
  ],
  [
    "unless",
    (v, o, context) => {
      const truthy = o.hash.includeZero ? v === 0 || !isEmpty(v) : !!v && !isEmpty(v);
      if (truthy) o.inverse(context);
      else o.fn(context);
    },
  ],
  ["each", (v, o, context) => each(v, o, context)],
  [
    "with",
    (v, o, context) => {
      if (isEmpty(v)) o.inverse(context);
      else o.fn(v, undefined, [v]);
    },
  ],
]);

const parsed = new Map<string, HbsProgram>();

function compile(source: string): HbsProgram {
  const cached = parsed.get(source);
  if (cached) return cached;
  let program: HbsProgram;
  try {
    program = parse(source);
  } catch (e) {
    throw new TemplateError(e instanceof Error ? e.message : String(e));
  }
  if (parsed.size > 50) parsed.clear();
  parsed.set(source, program);
  return program;
}

/** Renders a template. Throws TemplateError for syntax errors and unsupported features. */
export function renderTemplate(source: string, context: Record<string, unknown>): string {
  const program = compile(source);
  const out = new Output();
  new Renderer(out, context).program(program, [{ context, data: { root: context }, params: {}, newContext: true, newData: true }]);
  return out.text;
}

/** Checks a template: null if it can be used, else what's wrong. */
export function templateProblem(source: string, sample: Record<string, unknown>): string | null {
  try {
    renderTemplate(source, sample);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
