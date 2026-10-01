import type { Command, CommandContext, CommandRegistry } from "./registry";

// Right-click (and Shift+F10 / the menu key) menus on the document, made of
// registry commands like everything else: which commands, in what order.
// "-" separates groups; "annot.category.*" stands for every category.

export type ContextMenuKind = "selection" | "annotation" | "page";

const MENUS: Record<ContextMenuKind, readonly string[]> = {
  selection: ["annot.highlight", "annot.category.*", "-", "annot.editNote", "edit.copyText"],
  annotation: ["annot.editNote", "annot.category.*", "-", "annot.copyMarkdown", "annot.copyLink", "-", "annot.delete"],
  page: [
    "nav.back",
    "nav.forward",
    "-",
    "annot.captureArea",
    "nav.find",
    "nav.goToPage",
    "-",
    "view.focusMode",
    "view.split",
    "-",
    "view.zoomIn",
    "view.zoomOut",
    "view.fitWidth",
    "-",
    "view.commandPalette",
  ],
};

/** Which menu a right-click opens: about the selected text, else the selected annotation, else the page. */
export function contextMenuKind(ctx: CommandContext): ContextMenuKind {
  if (ctx.hasTextSelection) return "selection";
  if (ctx.annotationSelected) return "annotation";
  return "page";
}

export type ContextMenuEntry = Command | "-";

/** The menu's commands that can run now, with separators only between non-empty groups. */
export function contextMenuEntries(registry: CommandRegistry, kind: ContextMenuKind, ctx: CommandContext = registry.context()): ContextMenuEntry[] {
  const groups: Command[][] = [[]];
  for (const id of MENUS[kind]) {
    if (id === "-") {
      groups.push([]);
      continue;
    }
    const commands = id.endsWith(".*") ? registry.all().filter((c) => c.id.startsWith(id.slice(0, -1))) : [registry.get(id)];
    for (const c of commands) if (c && registry.isEnabled(c.id, ctx)) groups[groups.length - 1].push(c);
  }
  const out: ContextMenuEntry[] = [];
  for (const group of groups.filter((g) => g.length > 0)) {
    if (out.length > 0) out.push("-");
    out.push(...group);
  }
  return out;
}
