import { CommandRegistry, IDLE_CONTEXT, type Command } from "../src/commands/registry";
import { assignShortcut, checkShortcut, parseOverrides } from "../src/commands/keymap";

const command = (id: string, shortcut?: string): Command => ({ id, title: id, shortcut, run: vi.fn() });

function setup() {
  const registry = new CommandRegistry(() => IDLE_CONTEXT);
  registry.register(command("file.open", "Mod+O"));
  registry.register(command("view.palette", "Mod+K"));
  registry.register(command("edit.undo", "Mod+Z"));
  registry.register(command("edit.cancel", "Escape"));
  registry.register(command("annot.copyLink"));
  return registry;
}

describe("user shortcuts", () => {
  it("replace the defaults, and a taken default is dropped", () => {
    const registry = setup();
    registry.setOverrides({ "annot.copyLink": "Ctrl+K", "view.palette": null });
    expect(registry.get("annot.copyLink")?.shortcut).toBe("Ctrl+K");
    expect(registry.get("view.palette")?.shortcut).toBeUndefined();
    expect(registry.commandForEvent({ key: "k", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })?.id).toBe("annot.copyLink");
    expect(registry.defaultShortcut("view.palette")).toBe("Mod+K");
    // An override wins over a default even without an explicit null.
    registry.setOverrides({ "annot.copyLink": "Ctrl+O" });
    expect(registry.get("annot.copyLink")?.shortcut).toBe("Ctrl+O");
    expect(registry.get("file.open")?.shortcut).toBeUndefined();
    registry.setOverrides({});
    expect(registry.get("file.open")?.shortcut).toBe("Ctrl+O");
  });

  it("apply to commands registered later", () => {
    const registry = setup();
    registry.setOverrides({ "later.cmd": "Ctrl+J" });
    registry.register(command("later.cmd"));
    expect(registry.get("later.cmd")?.shortcut).toBe("Ctrl+J");
  });

  it("are checked", () => {
    const registry = setup();
    expect(checkShortcut(registry, "annot.copyLink", "Ctrl+J")).toEqual({ kind: "ok", shortcut: "Ctrl+J" });
    expect(checkShortcut(registry, "annot.copyLink", "Tab").kind).toBe("invalid");
    expect(checkShortcut(registry, "annot.copyLink", "Alt+F").kind).toBe("invalid");
    expect(checkShortcut(registry, "annot.copyLink", "Alt+J").kind).toBe("ok");
    expect(checkShortcut(registry, "annot.copyLink", "Ctrl+Alt+J").kind).toBe("invalid");
    expect(checkShortcut(registry, "annot.copyLink", "Escape").kind).toBe("invalid");
    expect(checkShortcut(registry, "annot.copyLink", "Ctrl+V").kind).toBe("invalid");
    // A command may keep (or get back) its own default.
    expect(checkShortcut(registry, "edit.undo", "Ctrl+Z").kind).toBe("ok");
    expect(checkShortcut(registry, "edit.cancel", "Escape").kind).toBe("ok");
    const conflict = checkShortcut(registry, "annot.copyLink", "Ctrl+K");
    expect(conflict.kind).toBe("conflict");
    expect(conflict.kind === "conflict" && conflict.other.id).toBe("view.palette");
  });

  it("taking a shortcut from another command leaves it without one", () => {
    const registry = setup();
    const next = assignShortcut(registry, {}, "annot.copyLink", "Ctrl+K");
    expect(next).toEqual({ "annot.copyLink": "Ctrl+K", "view.palette": null });
    registry.setOverrides(next);
    // Giving it back to its default command is no override for that one.
    const back = assignShortcut(registry, next, "view.palette", "Mod+K");
    // (copyLink has no default: nothing to record for it.)
    expect(back).toEqual({});
    registry.setOverrides(back);
    expect(registry.get("view.palette")?.shortcut).toBe("Ctrl+K");
    expect(registry.get("annot.copyLink")?.shortcut).toBeUndefined();
  });

  it("are read back defensively", () => {
    expect(parseOverrides('{"a":"ctrl+shift+j","b":null,"c":3,"d":"+"}')).toEqual({ a: "Ctrl+Shift+J", b: null, d: "=" });
    expect(parseOverrides("not json")).toEqual({});
    expect(parseOverrides("[1]")).toEqual({});
    expect(parseOverrides(null)).toEqual({});
  });
});
