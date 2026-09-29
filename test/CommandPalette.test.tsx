import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandRegistry } from "../src/commands/registry";
import { CommandPalette } from "../src/ui/CommandPalette";

function setup() {
  const registry = new CommandRegistry(() => ({ hasDocument: false, tabCount: 0, findOpen: false }));
  const open = vi.fn();
  const zoom = vi.fn();
  registry.register({ id: "file.open", title: "Open…", shortcut: "Mod+O", menu: { menu: "File", group: 1, order: 1 }, run: open });
  registry.register({ id: "view.zoomIn", title: "Zoom in", when: (c) => c.hasDocument, run: zoom });
  registry.register({ id: "help.shortcuts", title: "Keyboard shortcuts", run: vi.fn() });
  const onClose = vi.fn();
  render(<CommandPalette registry={registry} onClose={onClose} />);
  return { open, zoom, onClose };
}

// Commands run in a microtask after the palette closes.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("CommandPalette", () => {
  it("lists only commands available in the current context", () => {
    setup();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options.some((t) => t?.includes("Open…"))).toBe(true);
    expect(options.some((t) => t?.includes("Zoom in"))).toBe(false);
  });

  it("filters as you type and runs the active command with Enter", async () => {
    const user = userEvent.setup();
    const { open, onClose } = setup();
    await user.keyboard("open{Enter}");
    await flush();
    expect(onClose).toHaveBeenCalled();
    expect(open).toHaveBeenCalledOnce();
  });

  it("moves the active option with the arrow keys", async () => {
    const user = userEvent.setup();
    setup();
    const input = screen.getByRole("combobox");
    const first = input.getAttribute("aria-activedescendant");
    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).not.toBe(first);
  });

  it("runs a command when clicked", async () => {
    const user = userEvent.setup();
    const { open } = setup();
    await user.click(screen.getByRole("option", { name: /Open…/ }));
    await flush();
    expect(open).toHaveBeenCalledOnce();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
