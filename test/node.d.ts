// The few Node APIs tests use to read the user's vault. @types/node isn't
// installed: its globals (setTimeout's return type...) would leak into the
// browser code's types.
declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}
