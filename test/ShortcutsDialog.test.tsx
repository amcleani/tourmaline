import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandRegistry, IDLE_CONTEXT, type ShortcutOverrides } from "../src/commands/registry";
import { ShortcutsDialog } from "../src/ui/ShortcutsDialog";

function setup() {
  const registry = new CommandRegistry(() => IDLE_CONTEXT);
  registry.register({ id: "view.palette", title: "Command palette", shortcut: "Mod+K", menu: { menu: "View", group: 1, order: 1 }, run: vi.fn() });
  registry.register({ id: "annot.copyLink", title: "Copy link", menu: { menu: "Annotate", group: 1, order: 1 }, run: vi.fn() });
  const saved: ShortcutOverrides[] = [];
  function Host() {
    const [overrides, setOverrides] = useState<ShortcutOverrides>({});
    return (
      <ShortcutsDialog
        registry={registry}
        overrides={overrides}
        onChange={(next) => {
          saved.push(next);
          registry.setOverrides(next);
          setOverrides(next);
        }}
        onEditCategories={vi.fn()}
        onClose={vi.fn()}
      />
    );
  }
  render(<Host />);
  return { registry, saved };
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const row = (name: string) => screen.getByRole("rowheader", { name }).closest("tr")!;
const buttonIn = (tr: HTMLElement, name: string) => [...tr.querySelectorAll("button")].find((b) => b.textContent === name)!;

describe("ShortcutsDialog", () => {
  it("records a new shortcut, and Escape cancels without closing", async () => {
    const user = userEvent.setup();
    const { registry, saved } = setup();
    await user.click(buttonIn(row("Copy link"), "Change"));
    expect(registry.isRecording()).toBe(true);
    await user.keyboard("{Escape}");
    await flush();
    expect(registry.isRecording()).toBe(false);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(buttonIn(row("Copy link"), "Change"));

    await user.click(buttonIn(row("Copy link"), "Change"));
    await user.keyboard("{Control>}j{/Control}");
    await flush();
    expect(saved.at(-1)).toEqual({ "annot.copyLink": "Ctrl+J" });
    expect(registry.get("annot.copyLink")?.shortcut).toBe("Ctrl+J");
    expect(screen.getByRole("status").textContent).toContain("Ctrl+J now runs");
  });

  it("refuses reserved keys and asks before taking another command's", async () => {
    const user = userEvent.setup();
    const { registry, saved } = setup();
    await user.click(buttonIn(row("Copy link"), "Change"));
    await user.keyboard("{Alt>}f{/Alt}");
    expect(screen.getByRole("alert").textContent).toContain("opens a menu");
    await user.keyboard("{Control>}k{/Control}");
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("runs “Command palette”");
    expect(saved).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Use it here" }));
    expect(registry.get("annot.copyLink")?.shortcut).toBe("Ctrl+K");
    expect(registry.get("view.palette")?.shortcut).toBeUndefined();
  });

  it("removes and resets, keeping focus in the row", async () => {
    const user = userEvent.setup();
    const { registry } = setup();
    await user.click(buttonIn(row("Command palette"), "Remove"));
    await flush();
    expect(registry.get("view.palette")?.shortcut).toBeUndefined();
    expect(document.activeElement).toBe(buttonIn(row("Command palette"), "Change"));
    await user.click(buttonIn(row("Command palette"), "Reset"));
    await flush();
    expect(registry.get("view.palette")?.shortcut).toBe("Ctrl+K");
    expect(document.activeElement).toBe(buttonIn(row("Command palette"), "Change"));
  });
});
