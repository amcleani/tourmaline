import { MENU_ORDER, type CommandRegistry } from "../commands/registry";
import { toAccelerator } from "../commands/shortcuts";
import { isTauri } from "./index";

// Builds the native menu bar from the command registry and keeps each item's
// enabled state in sync with the current context.

export async function installNativeMenu(registry: CommandRegistry): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { Menu, Submenu, MenuItem, PredefinedMenuItem } = await import("@tauri-apps/api/menu");

  const items = new Map<string, Awaited<ReturnType<typeof MenuItem.new>>>();
  const submenus: Awaited<ReturnType<typeof Submenu.new>>[] = [];

  for (const menuId of MENU_ORDER) {
    const groups = registry.menuGroups(menuId);
    if (groups.length === 0) continue;

    const entries = [];
    for (const [i, group] of groups.entries()) {
      if (i > 0) entries.push(await PredefinedMenuItem.new({ item: "Separator" }));
      for (const command of group) {
        const item = await MenuItem.new({
          id: command.id,
          text: command.title,
          accelerator: command.shortcut ? toAccelerator(command.shortcut) : undefined,
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

  const sync = () => {
    const ctx = registry.context();
    for (const [id, item] of items) {
      item.setEnabled(registry.isEnabled(id, ctx)).catch(() => {});
    }
  };
  return registry.subscribe(sync);
}
