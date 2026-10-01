import { contextMenuEntries, contextMenuKind } from "../src/commands/contextMenus";
import { CommandRegistry, IDLE_CONTEXT, type CommandContext } from "../src/commands/registry";

const doc: CommandContext = { ...IDLE_CONTEXT, hasDocument: true, tabCount: 1 };

function setup() {
  const registry = new CommandRegistry(() => doc);
  const add = (id: string, when?: (c: CommandContext) => boolean) => registry.register({ id, title: id, when, run: vi.fn() });
  add("annot.highlight", (c) => c.hasTextSelection);
  add("annot.category.a", (c) => c.hasTextSelection || c.annotationSelected);
  add("annot.category.b", (c) => c.hasTextSelection || c.annotationSelected);
  add("annot.editNote", (c) => c.hasTextSelection || c.annotationSelected);
  add("edit.copyText", (c) => c.hasTextSelection);
  add("annot.delete", (c) => c.annotationSelected);
  add("nav.back", (c) => c.canGoBack);
  add("nav.find");
  add("view.zoomIn");
  return registry;
}

describe("context menus", () => {
  it("are about the selected text, else the annotation, else the page", () => {
    expect(contextMenuKind({ ...doc, hasTextSelection: true, annotationSelected: true })).toBe("selection");
    expect(contextMenuKind({ ...doc, annotationSelected: true })).toBe("annotation");
    expect(contextMenuKind(doc)).toBe("page");
  });

  it("list the commands that can run, categories expanded, without empty groups", () => {
    const registry = setup();
    const ids = (kind: Parameters<typeof contextMenuEntries>[1], ctx: CommandContext) =>
      contextMenuEntries(registry, kind, ctx).map((e) => (e === "-" ? "-" : e.id));
    expect(ids("selection", { ...doc, hasTextSelection: true })).toEqual([
      "annot.highlight",
      "annot.category.a",
      "annot.category.b",
      "-",
      "annot.editNote",
      "edit.copyText",
    ]);
    expect(ids("annotation", { ...doc, annotationSelected: true })).toEqual([
      "annot.editNote",
      "annot.category.a",
      "annot.category.b",
      "-",
      "annot.delete",
    ]);
    // Back can't run, so its group is gone, separator included.
    expect(ids("page", doc)).toEqual(["nav.find", "-", "view.zoomIn"]);
  });
});
