import { MENU_ORDER, type CommandRegistry } from "../commands/registry";
import { isTextEditingShortcut, normaliseShortcut, toAccelerator } from "../commands/shortcuts";
import { isTauri } from "./index";

// Builds the native menu bar from the command registry. When commands are
// added or removed the whole menu is rebuilt; otherwise only each item's
// enabled state is updated.

/**
 * Whether a shortcut is safe as a native accelerator: it needs Ctrl/Alt/Meta,
 * and must not be a caret or editing key or a text-editing shortcut (undo,
 * copy...), which text fields need (a native accelerator takes the key before
 * the page sees it).
 */
export const nativeAcceleratorOk = (shortcut: string) => {
  const s = normaliseShortcut(shortcut);
  return (
    /^(Ctrl|Alt|Meta)\+/.test(s) &&
    !/\+(Home|End|Arrow\w+|PageUp|PageDown|Backspace|Delete|Tab)$/.test(s) &&
    !isTextEditingShortcut(s)
  );
};

type MenuItemHandle = Awaited<ReturnType<typeof import("@tauri-apps/api/menu").MenuItem.new>>;

export async function installNativeMenu(registry: CommandRegistry): Promise<() => void> {
  if (!isTauri()) return () => {};

  let items = new Map<string, MenuItemHandle>();
  let builtFor = -1;
  // Rebuilds and syncs are async; chaining them keeps them from interleaving.
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;

  const update = () => {
    queue = queue
      .then(async () => {
        if (disposed) return;
        if (builtFor !== registry.getStructureVersion()) {
          builtFor = registry.getStructureVersion();
          items = await buildMenu(registry);
        } else {
          const ctx = registry.context();
          await Promise.all([...items].map(([id, item]) => item.setEnabled(registry.isEnabled(id, ctx))));
        }
      })
      .catch((e) => console.error("Could not update the menu", e));
  };

  update();
  const unsubscribe = registry.subscribe(update);
  return () => {
    disposed = true;
    unsubscribe();
  };
}

async function buildMenu(registry: CommandRegistry): Promise<Map<string, MenuItemHandle>> {
  const { Menu, Submenu, MenuItem, PredefinedMenuItem } = await import("@tauri-apps/api/menu");
  const items = new Map<string, MenuItemHandle>();
  const submenus = [];

  for (const menuId of MENU_ORDER) {
    const groups = registry.menuGroups(menuId);
    if (groups.length === 0) continue;

    const entries = [];
    for (const [i, group] of groups.entries()) {
      if (i > 0) entries.push(await PredefinedMenuItem.new({ item: "Separator" }));
      for (const command of group) {
        // Only shortcuts with Ctrl/Alt/Meta become native accelerators. A
        // native accelerator takes the key before the page sees it, even when
        // its item is disabled, so registering plain keys (Escape, F3) would
        // break them in dialogs and text fields. Those still work through the
        // page's keydown handler and are listed in the palette and Help.
        // (Tab-separated shortcut text in the label is not an option: it
        // blanks the window on Windows.)
        const shortcut = command.shortcut;
        const item = await MenuItem.new({
          text: command.title,
          accelerator: shortcut && nativeAcceleratorOk(shortcut) ? toAccelerator(shortcut) : undefined,
          enabled: registry.isEnabled(command.id),
          action: () => registry.execute(command.id, "menu"),
        });
        items.set(command.id, item);
        entries.push(item);
      }
    }
    // "&" marks the Alt-key mnemonic on Windows (Alt+F opens File, etc.).
    submenus.push(await Submenu.new({ text: `&${menuId}`, items: entries }));
  }

  const menu = await Menu.new({ items: submenus });
  await menu.setAsAppMenu();
  return items;
}
