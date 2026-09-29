import type { Command, CommandContext } from "./registry";

export interface AppActions {
  openFile: () => Promise<void>;
  closeTab: () => void;
  quit: () => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  fitWidth: () => void;
  fitPage: () => void;
  toggleOutline: () => void;
  showPalette: () => void;
  showShortcuts: () => void;
  find: () => void;
  findNext: () => void;
  findPrevious: () => void;
  closeFind: () => void;
  goToPage: () => void;
  firstPage: () => void;
  lastPage: () => void;
  nextTab: () => void;
  previousTab: () => void;
}

const hasDocument = (ctx: CommandContext) => ctx.hasDocument;
const severalTabs = (ctx: CommandContext) => ctx.tabCount > 1;

// Shortcut notes: avoid Ctrl+Alt (AltGr on many European layouts) and
// Shift+digit (layout-dependent symbols); see shortcuts.ts.
export function appCommands(a: AppActions): Command[] {
  return [
    // File
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
      id: "file.closeTab",
      title: "Close tab",
      keywords: ["document"],
      shortcut: "Mod+W",
      menu: { menu: "File", group: 1, order: 2 },
      when: hasDocument,
      run: a.closeTab,
    },
    {
      id: "app.quit",
      title: "Quit Tourmaline",
      keywords: ["exit"],
      shortcut: "Mod+Q",
      menu: { menu: "File", group: 9, order: 1 },
      run: a.quit,
    },

    // View
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
      id: "view.toggleOutline",
      title: "Show or hide outline",
      keywords: ["sidebar", "contents", "toc", "bookmarks", "sections"],
      shortcut: "Mod+Shift+O",
      icon: "outline",
      toolbar: true,
      menu: { menu: "View", group: 1, order: 2 },
      when: hasDocument,
      run: a.toggleOutline,
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
      id: "view.fitWidth",
      title: "Fit width",
      keywords: ["zoom"],
      shortcut: "Mod+E",
      icon: "fit-width",
      toolbar: true,
      menu: { menu: "View", group: 2, order: 4 },
      when: hasDocument,
      run: a.fitWidth,
    },
    {
      id: "view.fitPage",
      title: "Fit page",
      keywords: ["zoom", "whole page"],
      shortcut: "Mod+Shift+E",
      menu: { menu: "View", group: 2, order: 5 },
      when: hasDocument,
      run: a.fitPage,
    },

    // Navigate
    {
      id: "nav.find",
      title: "Find…",
      keywords: ["search", "text"],
      shortcut: "Mod+F",
      icon: "search",
      toolbar: true,
      menu: { menu: "Navigate", group: 1, order: 1 },
      when: hasDocument,
      run: a.find,
    },
    {
      id: "nav.findNext",
      title: "Find next",
      shortcut: "F3",
      menu: { menu: "Navigate", group: 1, order: 2 },
      when: hasDocument,
      run: a.findNext,
    },
    {
      id: "nav.findPrevious",
      title: "Find previous",
      shortcut: "Shift+F3",
      menu: { menu: "Navigate", group: 1, order: 3 },
      when: hasDocument,
      run: a.findPrevious,
    },
    {
      id: "nav.closeFind",
      title: "Close find bar",
      shortcut: "Escape",
      menu: { menu: "Navigate", group: 1, order: 4 },
      when: (ctx) => ctx.findOpen,
      run: a.closeFind,
    },
    {
      id: "nav.goToPage",
      title: "Go to page…",
      keywords: ["jump", "number"],
      shortcut: "Mod+G",
      menu: { menu: "Navigate", group: 2, order: 1 },
      when: hasDocument,
      run: a.goToPage,
    },
    {
      id: "nav.firstPage",
      title: "First page",
      keywords: ["start", "beginning"],
      shortcut: "Mod+Home",
      menu: { menu: "Navigate", group: 2, order: 2 },
      when: hasDocument,
      run: a.firstPage,
    },
    {
      id: "nav.lastPage",
      title: "Last page",
      keywords: ["end"],
      shortcut: "Mod+End",
      menu: { menu: "Navigate", group: 2, order: 3 },
      when: hasDocument,
      run: a.lastPage,
    },
    {
      id: "nav.nextTab",
      title: "Next tab",
      shortcut: "Mod+Tab",
      menu: { menu: "Navigate", group: 3, order: 1 },
      when: severalTabs,
      run: a.nextTab,
    },
    {
      id: "nav.previousTab",
      title: "Previous tab",
      shortcut: "Mod+Shift+Tab",
      menu: { menu: "Navigate", group: 3, order: 2 },
      when: severalTabs,
      run: a.previousTab,
    },

    // Help
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
