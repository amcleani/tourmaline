import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandRegistry, IDLE_CONTEXT, type Command } from "../src/commands/registry";
import { ContextMenu } from "../src/ui/ContextMenu";

function setup() {
  const registry = new CommandRegistry(() => IDLE_CONTEXT);
  const runs: string[] = [];
  const add = (id: string, title: string, shortcut?: string): Command => {
    const c = { id, title, shortcut, run: () => void runs.push(id) };
    registry.register(c);
    return registry.get(id)!;
  };
  const entries = [add("a", "Find…", "Mod+F"), add("b", "Go to page…"), "-" as const, add("c", "Zoom in")];
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const onClose = vi.fn();
  const view = render(<ContextMenu registry={registry} entries={entries} at={{ x: 10, y: 10 }} label="Page" onClose={onClose} />);
  return { runs, onClose, opener, view };
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe("ContextMenu", () => {
  it("is a menu whose first item has focus, moved with the arrows and letters", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole("menu", { name: "Page" })).toBeTruthy();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.dataset.title)).toEqual(["Find…", "Go to page…", "Zoom in"]);
    expect(items[0].getAttribute("aria-keyshortcuts")).toBe("Control+F");
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(items[2]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard("z");
    expect(document.activeElement).toBe(items[2]);
  });

  it("runs an item with Enter after closing", async () => {
    const user = userEvent.setup();
    const { runs, onClose } = setup();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onClose).toHaveBeenCalled();
    await flush();
    expect(runs).toEqual(["b"]);
  });

  it("closes with Escape, and gives focus back when it goes", async () => {
    const user = userEvent.setup();
    const { onClose, opener, view } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    view.unmount();
    expect(document.activeElement).toBe(opener);
  });

  it("closes on a click elsewhere", async () => {
    const user = userEvent.setup();
    const { onClose, opener } = setup();
    await user.click(opener);
    expect(onClose).toHaveBeenCalled();
  });

  it("hands an entry made for one menu to onRun instead of the registry", async () => {
    const user = userEvent.setup();
    const registry = new CommandRegistry(() => IDLE_CONTEXT);
    const onRun = vi.fn();
    const entries: Command[] = [{ id: "linked-note-0", title: "concept", run: vi.fn() }];
    render(<ContextMenu registry={registry} entries={entries} at={{ x: 0, y: 0 }} label="Linked notes" onClose={vi.fn()} onRun={onRun} />);
    await user.keyboard("{Enter}");
    await flush();
    expect(onRun).toHaveBeenCalledWith(entries[0]);
  });
});
