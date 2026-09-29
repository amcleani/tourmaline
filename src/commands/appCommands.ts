import type { Command } from "./registry";

export interface AppActions {
  openFile: () => Promise<void>;
  closeDocument: () => void;
  quit: () => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  showPalette: () => void;
  showShortcuts: () => void;
}

const hasDocument = (ctx: { hasDocument: boolean }) => ctx.hasDocument;

export function appCommands(a: AppActions): Command[] {
  return [
    {
      id: "file.open",
      title: "Open…",
      keywords: ["pdf", "file", "load"],
      shortcut: "Mod+O",
      icon: "open",
      toolbar: true,
      menu: { menu: "File", group: 1, order: 1 },
      run: a.openFile,
    },
    {
      id: "file.close",
      title: "Close document",
      shortcut: "Mod+W",
      icon: "close",
      menu: { menu: "File", group: 1, order: 2 },
      when: hasDocument,
      run: a.closeDocument,
    },
    {
      id: "app.quit",
      title: "Quit Tourmaline",
      keywords: ["exit"],
      shortcut: "Mod+Q",
      menu: { menu: "File", group: 9, order: 1 },
      run: a.quit,
    },
    {
      id: "view.zoomIn",
      title: "Zoom in",
      shortcut: "Mod+=",
      icon: "zoom-in",
      toolbar: true,
      menu: { menu: "View", group: 2, order: 1 },
      when: hasDocument,
      run: a.zoomIn,
    },
    {
      id: "view.zoomOut",
      title: "Zoom out",
      shortcut: "Mod+-",
      icon: "zoom-out",
      toolbar: true,
      menu: { menu: "View", group: 2, order: 2 },
      when: hasDocument,
      run: a.zoomOut,
    },
    {
      id: "view.zoomReset",
      title: "Actual size",
      keywords: ["zoom", "100%", "reset"],
      shortcut: "Mod+0",
      menu: { menu: "View", group: 2, order: 3 },
      when: hasDocument,
      run: a.zoomReset,
    },
    {
      id: "view.commandPalette",
      title: "Command palette…",
      keywords: ["commands", "search", "actions"],
      shortcut: "Mod+K",
      icon: "palette",
      toolbar: true,
      hideInPalette: true,
      menu: { menu: "View", group: 1, order: 1 },
      run: a.showPalette,
    },
    {
      id: "help.shortcuts",
      title: "Keyboard shortcuts",
      keywords: ["keys", "hotkeys", "help"],
      shortcut: "Mod+/",
      icon: "keyboard",
      menu: { menu: "Help", group: 1, order: 1 },
      run: a.showShortcuts,
    },
  ];
}

export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

export function nextZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) return ZOOM_STEPS.find((z) => z > current + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-6) ?? ZOOM_STEPS[0];
}
