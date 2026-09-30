// Handlebars' parser on its own. Its compiler builds functions with
// `new Function`, which the app's Content Security Policy forbids, so
// templates.ts interprets the parsed syntax tree instead.
declare module "handlebars/dist/cjs/handlebars/compiler/base" {
  import type { HbsProgram } from "./templates";
  export function parse(input: string): HbsProgram;
}
