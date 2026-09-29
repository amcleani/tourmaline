import { CommandRegistry, type Command, type CommandContext } from "../src/commands/registry";

function setup(ctx: CommandContext = { hasDocument: false }) {
  let time = 0;
  const context = { current: ctx };
  const registry = new CommandRegistry(() => context.current, () => time);
  return { registry, context, advance: (ms: number) => (time += ms) };
}

const command = (overrides: Partial<Command> = {}): Command => ({
  id: "test.cmd",
  title: "Test",
  run: vi.fn(),
  ...overrides,
});

describe("CommandRegistry", () => {
  it("runs enabled commands and skips disabled ones", () => {
    const { registry, context } = setup();
    const run = vi.fn();
    registry.register(command({ run, when: (c) => c.hasDocument }));

    expect(registry.execute("test.cmd")).toBe(false);
    expect(run).not.toHaveBeenCalled();

    context.current = { hasDocument: true };
    expect(registry.execute("test.cmd")).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("rejects duplicate ids and conflicting shortcuts", () => {
    const { registry } = setup();
    registry.register(command({ shortcut: "Mod+O" }));
    expect(() => registry.register(command())).toThrow(/Duplicate command/);
    expect(() => registry.register(command({ id: "other", shortcut: "ctrl+o" }))).toThrow(/Shortcut Ctrl\+O/);
  });

  it("finds commands from key events", () => {
    const { registry } = setup();
    registry.register(command({ shortcut: "Mod+Shift+P" }));
    const found = registry.commandForEvent({ key: "P", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
    expect(found?.id).toBe("test.cmd");
    expect(registry.commandForEvent({ key: "p", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })).toBeUndefined();
  });

  it("ignores the same command arriving from menu and keyboard for one key press", () => {
    const { registry, advance } = setup();
    const run = vi.fn();
    registry.register(command({ run }));

    registry.execute("test.cmd", "keyboard");
    advance(20);
    registry.execute("test.cmd", "menu");
    expect(run).toHaveBeenCalledTimes(1);

    // Repeats from the same source (key held down) and later presses still run.
    registry.execute("test.cmd", "keyboard");
    advance(500);
    registry.execute("test.cmd", "menu");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("groups menu items and sorts them", () => {
    const { registry } = setup();
    registry.register(command({ id: "b", menu: { menu: "File", group: 1, order: 2 } }));
    registry.register(command({ id: "a", menu: { menu: "File", group: 1, order: 1 } }));
    registry.register(command({ id: "q", menu: { menu: "File", group: 9, order: 1 } }));
    registry.register(command({ id: "z", menu: { menu: "View", group: 1, order: 1 } }));
    expect(registry.menuGroups("File").map((g) => g.map((c) => c.id))).toEqual([["a", "b"], ["q"]]);
  });

  it("notifies subscribers and bumps the version", () => {
    const { registry } = setup();
    const listener = vi.fn();
    registry.subscribe(listener);
    const before = registry.getVersion();
    const unregister = registry.register(command());
    unregister();
    registry.notifyContextChanged();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(registry.getVersion()).toBe(before + 3);
  });
});
