import type { Command, CommandContext } from "./registry";

export interface AppActions {
  openFile: () => Promise<void>;
  openRecent: () => void;
  closeTab: () => void;
  saveIntoPdf: () => void;
  chooseVault: () => Promise<void>;
  linkEntry: () => void;
  openNote: () => Promise<void>;
  exportToVault: () => void;
  toggleFocus: () => void;
  focusNext: () => void;
  focusPrevious: () => void;
  focusStepSize: () => void;
  focusEyeLine: () => void;
  focusColumns: () => void;
  exportSettings: () => void;
  showAppearance: () => void;
  cycleTheme: () => void;
  cyclePageColours: () => void;
  uiLarger: () => void;
  uiSmaller: () => void;
  uiReset: () => void;
  quit: () => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  fitWidth: () => void;
  fitPage: () => void;
  toggleOutline: () => void;
  showPalette: () => void;
  showShortcuts: () => void;
  showAbout: () => void;
  checkForUpdates: () => void;
  find: () => void;
  findNext: () => void;
  findPrevious: () => void;
  closeFind: () => void;
  selectMatch: () => Promise<void>;
  goToPage: () => void;
  firstPage: () => void;
  lastPage: () => void;
  nextTab: () => void;
  previousTab: () => void;
  goBack: () => void;
  toggleSplit: () => void;
  switchPane: () => void;
  goForward: () => void;
  cancel: () => void;
  undo: () => void;
  copyText: () => Promise<void>;
  openLinkedNote: () => void;
  redo: () => void;
  toggleAnnotations: () => void;
  highlight: () => void;
  editNote: () => void;
  deleteAnnotation: () => void;
  captureArea: () => void;
  editCategories: () => void;
  copyMarkdown: () => Promise<void>;
  copyLink: () => Promise<void>;
}

const hasDocument = (ctx: CommandContext) => ctx.hasDocument;
const severalTabs = (ctx: CommandContext) => ctx.tabCount > 1;
const hasSelection = (ctx: CommandContext) => ctx.hasDocument && ctx.hasTextSelection;
const annotationSelected = (ctx: CommandContext) => ctx.hasDocument && ctx.annotationSelected;

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
      id: "file.openRecent",
      title: "Open recent…",
      keywords: ["history", "previous", "last"],
      shortcut: "Mod+R",
      menu: { menu: "File", group: 1, order: 2 },
      run: a.openRecent,
    },
    {
      id: "file.closeTab",
      title: "Close tab",
      keywords: ["document"],
      shortcut: "Mod+W",
      menu: { menu: "File", group: 1, order: 3 },
      // Any tab, including one whose file couldn't be opened.
      when: (ctx) => ctx.tabCount > 0,
      run: a.closeTab,
    },
    {
      id: "file.saveIntoPdf",
      title: "Save annotations into PDF",
      keywords: ["write", "export", "embed", "okular", "acrobat", "obsidian", "pdfLink"],
      shortcut: "Mod+S",
      menu: { menu: "File", group: 2, order: 1 },
      when: (ctx) => ctx.hasDocument && ctx.canSaveIntoPdf,
      run: a.saveIntoPdf,
    },
    {
      id: "file.chooseVault",
      title: "Choose Obsidian vault…",
      keywords: ["obsidian", "vault", "preamble", "macros", "mathjax", "settings"],
      menu: { menu: "File", group: 5, order: 1 },
      run: a.chooseVault,
    },
    {
      id: "file.linkEntry",
      title: "Link to bibliography entry…",
      keywords: ["citekey", "jabref", "bibtex", "citation", "reference", "match"],
      menu: { menu: "File", group: 5, order: 2 },
      when: (ctx) => ctx.hasDocument && ctx.hasBibliography,
      run: a.linkEntry,
    },
    {
      id: "file.openNote",
      title: "Open literature note in Obsidian",
      keywords: ["obsidian", "vault", "citekey", "notes"],
      menu: { menu: "File", group: 5, order: 3 },
      when: (ctx) => ctx.hasDocument && ctx.hasCitekey,
      run: a.openNote,
    },
    {
      id: "app.quit",
      title: "Quit Tourmaline",
      keywords: ["exit"],
      shortcut: "Mod+Q",
      menu: { menu: "File", group: 9, order: 1 },
      run: a.quit,
    },

    // Edit
    {
      id: "edit.undo",
      title: "Undo",
      keywords: ["annotation", "revert"],
      shortcut: "Mod+Z",
      icon: "undo",
      menu: { menu: "Edit", group: 1, order: 1 },
      when: (ctx) => ctx.hasDocument && ctx.canUndo,
      run: a.undo,
    },
    {
      id: "edit.redo",
      title: "Redo",
      keywords: ["annotation"],
      shortcut: "Mod+Y",
      icon: "redo",
      menu: { menu: "Edit", group: 1, order: 2 },
      when: (ctx) => ctx.hasDocument && ctx.canRedo,
      run: a.redo,
    },
    {
      id: "edit.copyText",
      title: "Copy text",
      keywords: ["clipboard", "selection", "quote"],
      // Ctrl+C copies selected text natively; this is the same for menus.
      menu: { menu: "Edit", group: 2, order: 1 },
      when: hasSelection,
      run: a.copyText,
    },
    {
      id: "edit.cancel",
      title: "Close find bar, stop capturing or deselect",
      keywords: ["escape", "cancel"],
      shortcut: "Escape",
      when: (ctx) => ctx.findOpen || ctx.captureMode || ctx.annotationSelected || ctx.hasTextSelection,
      run: a.cancel,
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

    {
      id: "view.split",
      title: "Split view",
      keywords: ["second pane", "side by side", "two", "references", "compare"],
      shortcut: "Mod+Shift+S",
      icon: "split",
      toolbar: true,
      menu: { menu: "View", group: 1, order: 4 },
      when: hasDocument,
      run: a.toggleSplit,
    },
    {
      id: "view.switchPane",
      title: "Switch pane",
      keywords: ["split", "other pane", "focus"],
      shortcut: "F6",
      menu: { menu: "View", group: 1, order: 5 },
      when: (ctx) => ctx.hasDocument && ctx.splitOpen,
      run: a.switchPane,
    },
    {
      id: "view.toggleAnnotations",
      title: "Show or hide annotations",
      keywords: ["sidebar", "highlights", "notes", "list"],
      shortcut: "Mod+Shift+A",
      icon: "annotations",
      toolbar: true,
      menu: { menu: "View", group: 1, order: 3 },
      when: hasDocument,
      run: a.toggleAnnotations,
    },

    // Focus mode (View menu)
    {
      id: "view.focusMode",
      title: "Focus mode",
      keywords: ["reading", "ruler", "line", "sentence", "concentrate", "dim", "guide"],
      shortcut: "F",
      icon: "focus",
      toolbar: true,
      menu: { menu: "View", group: 3, order: 1 },
      when: hasDocument,
      run: a.toggleFocus,
    },
    {
      id: "focus.next",
      title: "Focus: next step",
      keywords: ["down", "forward", "line", "sentence"],
      shortcut: "ArrowDown",
      menu: { menu: "View", group: 3, order: 2 },
      when: (ctx) => ctx.hasDocument && ctx.focusMode,
      run: a.focusNext,
    },
    {
      id: "focus.previous",
      title: "Focus: previous step",
      keywords: ["up", "back", "line", "sentence"],
      shortcut: "ArrowUp",
      menu: { menu: "View", group: 3, order: 3 },
      when: (ctx) => ctx.hasDocument && ctx.focusMode,
      run: a.focusPrevious,
    },
    {
      id: "focus.stepSize",
      title: "Focus: change step size",
      keywords: ["lines", "sentence", "one", "two", "three"],
      shortcut: "S",
      menu: { menu: "View", group: 3, order: 4 },
      when: (ctx) => ctx.hasDocument && ctx.focusMode,
      run: a.focusStepSize,
    },
    {
      id: "focus.eyeLine",
      title: "Focus: change eye line",
      keywords: ["height", "position", "top", "middle", "third"],
      menu: { menu: "View", group: 3, order: 5 },
      when: (ctx) => ctx.hasDocument && ctx.focusMode,
      run: a.focusEyeLine,
    },
    {
      id: "focus.columns",
      title: "Focus: detect columns in this paper (on/off)",
      keywords: ["two-column", "layout", "reading order", "gutter"],
      menu: { menu: "View", group: 3, order: 6 },
      when: hasDocument,
      run: a.focusColumns,
    },

    // Appearance (View menu)
    {
      id: "view.appearance",
      title: "Appearance…",
      keywords: ["theme", "dark", "light", "high contrast", "colours", "sepia", "size", "scale", "font", "larger", "settings"],
      icon: "appearance",
      menu: { menu: "View", group: 4, order: 1 },
      run: a.showAppearance,
    },
    {
      id: "view.theme",
      title: "Switch theme",
      keywords: ["dark", "light", "high contrast", "colours", "appearance"],
      menu: { menu: "View", group: 4, order: 2 },
      run: a.cycleTheme,
    },
    {
      id: "view.pageColours",
      title: "Switch page colours",
      keywords: ["dark pages", "night", "invert", "sepia", "appearance"],
      menu: { menu: "View", group: 4, order: 3 },
      run: a.cyclePageColours,
    },
    {
      id: "view.uiLarger",
      title: "Larger interface",
      keywords: ["size", "scale", "bigger", "text", "font", "appearance"],
      menu: { menu: "View", group: 4, order: 4 },
      run: a.uiLarger,
    },
    {
      id: "view.uiSmaller",
      title: "Smaller interface",
      keywords: ["size", "scale", "text", "font", "appearance"],
      menu: { menu: "View", group: 4, order: 5 },
      run: a.uiSmaller,
    },
    {
      id: "view.uiReset",
      title: "Default interface size",
      keywords: ["size", "scale", "100%", "reset", "appearance"],
      menu: { menu: "View", group: 4, order: 6 },
      run: a.uiReset,
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
      id: "nav.selectMatch",
      title: "Select the found text",
      keywords: ["find", "match", "highlight", "keyboard", "selection"],
      shortcut: "Alt+Enter",
      menu: { menu: "Navigate", group: 1, order: 4 },
      when: (ctx) => ctx.findOpen,
      run: a.selectMatch,
    },
    {
      id: "nav.closeFind",
      title: "Close find bar",
      menu: { menu: "Navigate", group: 1, order: 5 },
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
    {
      id: "nav.back",
      title: "Back",
      keywords: ["previous place", "history", "return", "link"],
      shortcut: "Alt+ArrowLeft",
      icon: "back",
      toolbar: true,
      menu: { menu: "Navigate", group: 4, order: 1 },
      when: (ctx) => ctx.hasDocument && ctx.canGoBack,
      run: a.goBack,
    },
    {
      id: "nav.forward",
      title: "Forward",
      keywords: ["next place", "history", "link"],
      shortcut: "Alt+ArrowRight",
      icon: "forward",
      toolbar: true,
      menu: { menu: "Navigate", group: 4, order: 2 },
      when: (ctx) => ctx.hasDocument && ctx.canGoForward,
      run: a.goForward,
    },

    // Annotate
    {
      id: "annot.highlight",
      title: "Highlight selection",
      keywords: ["mark", "annotate", "colour"],
      shortcut: "H",
      icon: "highlight",
      toolbar: true,
      menu: { menu: "Annotate", group: 1, order: 1 },
      when: hasSelection,
      run: a.highlight,
    },
    {
      id: "annot.editNote",
      title: "Add or edit note",
      keywords: ["comment", "annotation", "write"],
      shortcut: "N",
      icon: "note",
      menu: { menu: "Annotate", group: 1, order: 2 },
      when: (ctx) => hasSelection(ctx) || annotationSelected(ctx),
      run: a.editNote,
    },
    {
      id: "annot.captureArea",
      title: "Capture area",
      keywords: ["figure", "equation", "image", "screenshot", "rectangle", "region"],
      shortcut: "A",
      icon: "area",
      toolbar: true,
      menu: { menu: "Annotate", group: 1, order: 3 },
      when: hasDocument,
      run: a.captureArea,
    },
    {
      id: "annot.delete",
      title: "Delete annotation",
      keywords: ["remove", "highlight"],
      shortcut: "Delete",
      menu: { menu: "Annotate", group: 2, order: 1 },
      when: annotationSelected,
      run: a.deleteAnnotation,
    },
    {
      id: "annot.copyMarkdown",
      title: "Copy as Markdown",
      keywords: ["obsidian", "callout", "quote", "clipboard", "export", "note"],
      // Ctrl+C copies selected text as usual; with an annotation selected
      // (and no text), it copies the annotation.
      shortcut: "Mod+C",
      menu: { menu: "Annotate", group: 2, order: 2 },
      when: (ctx) => annotationSelected(ctx) && !ctx.hasTextSelection,
      run: a.copyMarkdown,
    },
    {
      id: "annot.copyLink",
      title: "Copy link to annotation",
      keywords: ["tourmaline", "url", "clipboard", "obsidian", "reopen"],
      menu: { menu: "Annotate", group: 2, order: 3 },
      when: annotationSelected,
      run: a.copyLink,
    },
    {
      id: "annot.openLinkedNote",
      title: "Open linked note in Obsidian",
      keywords: ["wikilink", "link", "note", "obsidian", "follow"],
      menu: { menu: "Annotate", group: 2, order: 4 },
      when: (ctx) => ctx.annotationHasLinks,
      run: a.openLinkedNote,
    },
    {
      id: "annot.categories",
      title: "Edit categories…",
      keywords: ["colours", "colors", "callouts", "keys"],
      icon: "categories",
      menu: { menu: "Annotate", group: 9, order: 1 },
      run: a.editCategories,
    },

    // Export
    {
      id: "export.toVault",
      title: "Export annotations to Obsidian",
      keywords: ["obsidian", "vault", "literature note", "markdown", "highlights", "write", "sync"],
      shortcut: "Mod+Shift+X",
      icon: "export",
      toolbar: true,
      menu: { menu: "Export", group: 1, order: 1 },
      when: (ctx) => ctx.hasDocument && ctx.hasCitekey && ctx.hasVault,
      run: a.exportToVault,
    },
    {
      id: "export.settings",
      title: "Export settings and templates…",
      keywords: ["obsidian", "handlebars", "template", "heading", "callout", "note", "preview"],
      menu: { menu: "Export", group: 2, order: 1 },
      run: a.exportSettings,
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
    {
      id: "help.checkUpdates",
      title: "Check for updates…",
      keywords: ["update", "upgrade", "new version", "install", "release"],
      menu: { menu: "Help", group: 2, order: 1 },
      run: a.checkForUpdates,
    },
    {
      id: "help.about",
      title: "About Tourmaline",
      keywords: ["version", "updates"],
      menu: { menu: "Help", group: 2, order: 2 },
      run: a.showAbout,
    },
  ];
}
