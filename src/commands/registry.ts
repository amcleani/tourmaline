import { eventToShortcut, normaliseShortcut, type ShortcutEvent } from "./shortcuts";

// Every user-facing action is a Command. Menus, the toolbar, the command
// palette, context menus and keyboard shortcuts are all generated from this one
// list, so nothing is reachable by keyboard only or by mouse only.

export type MenuId = "File" | "Edit" | "View" | "Navigate" | "Annotate" | "Export" | "Help";
export const MENU_ORDER: MenuId[] = ["File", "Edit", "View", "Navigate", "Annotate", "Export", "Help"];

export interface CommandContext {
  hasDocument: boolean;
  tabCount: number;
  findOpen: boolean;
  /** A modal dialog is open: keyboard shortcuts and the menu don't act behind it. */
  modalOpen: boolean;
  /** Text is selected in the document. */
  hasTextSelection: boolean;
  annotationSelected: boolean;
  /** The selected annotation's note links to notes in the vault. */
  annotationHasLinks: boolean;
  /** Dragging on a page draws an area to capture. */
  captureMode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** The vault's JabRef bibliography has been read. */
  hasBibliography: boolean;
  /** The open paper is linked to a bibliography entry. */
  hasCitekey: boolean;
  /** An Obsidian vault has been chosen and its settings read. */
  hasVault: boolean;
  /** Focus mode is on for the open document. */
  focusMode: boolean;
  /** The open tab has places to go back or forward to (after following links). */
  canGoBack: boolean;
  canGoForward: boolean;
  /** The second pane (View › Split view) is open. */
  splitOpen: boolean;
  /** Annotations can be saved into the open file (desktop app, file on disk). */
  canSaveIntoPdf: boolean;
}

/** Context with no document open and nothing going on. */
export const IDLE_CONTEXT: CommandContext = {
  hasDocument: false,
  tabCount: 0,
  findOpen: false,
  modalOpen: false,
  hasTextSelection: false,
  annotationSelected: false,
  annotationHasLinks: false,
  captureMode: false,
  canUndo: false,
  canRedo: false,
  hasBibliography: false,
  hasCitekey: false,
  hasVault: false,
  focusMode: false,
  canGoBack: false,
  canGoForward: false,
  splitOpen: false,
  canSaveIntoPdf: false,
};

export interface MenuPlacement {
  menu: MenuId;
  /** Items are grouped by this number; separators go between groups. */
  group: number;
  order: number;
}

export type ExecutionSource = "keyboard" | "menu" | "palette" | "toolbar" | "other";

export interface Command {
  id: string;
  title: string;
  /** Extra words the palette should match on. */
  keywords?: string[];
  shortcut?: string;
  menu?: MenuPlacement;
  /** Icon name from the toolbar icon set; commands with an icon may appear in the toolbar. */
  icon?: string;
  toolbar?: boolean;
  /** Hidden from the palette (e.g. the palette's own open command). */
  hideInPalette?: boolean;
  /** Whether the command can run in the current context. Defaults to always. */
  when?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => unknown;
}

type Listener = () => void;

/** Window in which a second trigger of the same command from a different source is ignored. */
const DUPLICATE_WINDOW_MS = 150;

/** Shortcuts the user chose (Help › Keyboard shortcuts), by command id; null removes a command's shortcut. */
export type ShortcutOverrides = Readonly<Record<string, string | null>>;

export class CommandRegistry {
  /** Commands as registered (with their default shortcuts). */
  private originals = new Map<string, Command>();
  /** The same, with the shortcut in effect. */
  private commands = new Map<string, Command>();
  private byShortcut = new Map<string, string>();
  private overrides: ShortcutOverrides = {};
  private listeners = new Set<Listener>();
  private lastRun: { id: string; source: ExecutionSource; at: number } | null = null;
  private version = 0;
  private structureVersion = 0;

  constructor(
    private getContext: () => CommandContext,
    private now: () => number = () => performance.now(),
  ) {}

  register(command: Command): () => void {
    if (this.originals.has(command.id)) throw new Error(`Duplicate command id "${command.id}"`);
    if (command.shortcut) {
      // Two default shortcuts the same is a mistake in the code (a user's choice is checked by the editor).
      const key = normaliseShortcut(command.shortcut);
      for (const other of this.originals.values()) {
        if (other.shortcut && normaliseShortcut(other.shortcut) === key) {
          throw new Error(`Shortcut ${key} is used by both "${other.id}" and "${command.id}"`);
        }
      }
    }
    this.originals.set(command.id, command);
    this.rebind();
    this.structureVersion++;
    this.emit();
    return () => this.unregister(command.id);
  }

  unregister(id: string) {
    if (!this.originals.delete(id)) return;
    this.rebind();
    this.structureVersion++;
    this.emit();
  }

  /** The shortcuts the user chose, replacing the defaults of those commands (ids not registered yet are kept for later). */
  setOverrides(overrides: ShortcutOverrides) {
    this.overrides = { ...overrides };
    this.rebind();
    this.structureVersion++;
    this.emit();
  }

  private recording = false;
  /**
   * While the shortcut editor listens for a key, the native menu drops its
   * accelerators: Windows hands an accelerator's key to the menu, never to the page.
   */
  setRecording(on: boolean) {
    if (this.recording === on) return;
    this.recording = on;
    this.structureVersion++;
    this.emit();
  }

  isRecording(): boolean {
    return this.recording;
  }

  getOverrides(): ShortcutOverrides {
    return this.overrides;
  }

  /** A command's shortcut before the user changed it. */
  defaultShortcut(id: string): string | undefined {
    return this.originals.get(id)?.shortcut;
  }

  /** The command a shortcut runs now, if any. */
  commandForShortcut(shortcut: string): Command | undefined {
    const id = this.byShortcut.get(normaliseShortcut(shortcut));
    return id ? this.commands.get(id) : undefined;
  }

  // The user's shortcuts first, then the defaults of the other commands; a
  // default the user gave to another command is dropped.
  private rebind() {
    this.byShortcut.clear();
    this.commands.clear();
    const effective = new Map<string, string | undefined>();
    for (const id of this.originals.keys()) {
      if (!Object.hasOwn(this.overrides, id)) continue;
      const chosen = this.overrides[id];
      let key: string | undefined;
      try {
        key = chosen ? normaliseShortcut(chosen) : undefined;
      } catch {
        key = undefined; // Unreadable (edited by hand): no shortcut.
      }
      if (key && this.byShortcut.has(key)) key = undefined;
      if (key) this.byShortcut.set(key, id);
      effective.set(id, key);
    }
    for (const [id, original] of this.originals) {
      if (effective.has(id)) continue;
      let key = original.shortcut ? normaliseShortcut(original.shortcut) : undefined;
      if (key && this.byShortcut.has(key)) key = undefined;
      if (key) this.byShortcut.set(key, id);
      effective.set(id, key);
    }
    for (const [id, original] of this.originals) {
      const key = effective.get(id);
      this.commands.set(id, key === original.shortcut || (!key && !original.shortcut) ? original : { ...original, shortcut: key });
    }
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  all(): Command[] {
    return [...this.commands.values()];
  }

  context(): CommandContext {
    return this.getContext();
  }

  isEnabled(id: string, ctx: CommandContext = this.getContext()): boolean {
    const command = this.commands.get(id);
    return !!command && (command.when?.(ctx) ?? true);
  }

  /**
   * Runs a command if it is enabled. Returns true if it ran.
   *
   * The native menu and the in-page keyboard handler can both see the same
   * key press on some platforms; a repeat of the same command from a different
   * source within a few milliseconds is treated as that duplicate and ignored.
   */
  execute(id: string, source: ExecutionSource = "other"): boolean {
    const command = this.commands.get(id);
    if (!command) return false;
    const ctx = this.getContext();
    if (!(command.when?.(ctx) ?? true)) return false;
    // A modal dialog owns the keyboard; shortcuts and the menu must not act
    // on the document behind it. (The palette runs its choice after closing.)
    if (ctx.modalOpen && (source === "keyboard" || source === "menu")) return false;

    const at = this.now();
    const last = this.lastRun;
    if (last && last.id === id && last.source !== source && at - last.at < DUPLICATE_WINDOW_MS) {
      return false;
    }
    this.lastRun = { id, source, at };

    const result = command.run(ctx);
    if (result instanceof Promise) {
      result.catch((err) => console.error(`Command "${id}" failed`, err));
    }
    return true;
  }

  /** Finds the command bound to a key event, if any. */
  commandForEvent(e: ShortcutEvent): Command | undefined {
    const shortcut = eventToShortcut(e);
    if (!shortcut) return undefined;
    const id = this.byShortcut.get(shortcut);
    return id ? this.commands.get(id) : undefined;
  }

  /** Commands for one menu, sorted and split into groups. */
  menuGroups(menu: MenuId): Command[][] {
    const items = this.all()
      .filter((c) => c.menu?.menu === menu)
      .sort((a, b) => a.menu!.group - b.menu!.group || a.menu!.order - b.menu!.order);
    const groups: Command[][] = [];
    let current: number | null = null;
    for (const item of items) {
      if (item.menu!.group !== current) {
        groups.push([]);
        current = item.menu!.group;
      }
      groups[groups.length - 1].push(item);
    }
    return groups;
  }

  /** Changes whenever commands or their context change; for useSyncExternalStore. */
  getVersion(): number {
    return this.version;
  }

  /** Changes only when commands are added or removed; menus rebuild when it does. */
  getStructureVersion(): number {
    return this.structureVersion;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Call when something the `when` conditions depend on has changed. */
  notifyContextChanged() {
    this.emit();
  }

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }
}

/** True if the key event comes from a text field, where plain keys must not trigger commands. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
