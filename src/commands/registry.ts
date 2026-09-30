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
  /** Dragging on a page draws an area to capture. */
  captureMode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** The vault's JabRef bibliography has been read. */
  hasBibliography: boolean;
  /** The open paper is linked to a bibliography entry. */
  hasCitekey: boolean;
}

/** Context with no document open and nothing going on. */
export const IDLE_CONTEXT: CommandContext = {
  hasDocument: false,
  tabCount: 0,
  findOpen: false,
  modalOpen: false,
  hasTextSelection: false,
  annotationSelected: false,
  captureMode: false,
  canUndo: false,
  canRedo: false,
  hasBibliography: false,
  hasCitekey: false,
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

export class CommandRegistry {
  private commands = new Map<string, Command>();
  private byShortcut = new Map<string, string>();
  private listeners = new Set<Listener>();
  private lastRun: { id: string; source: ExecutionSource; at: number } | null = null;
  private version = 0;
  private structureVersion = 0;

  constructor(
    private getContext: () => CommandContext,
    private now: () => number = () => performance.now(),
  ) {}

  register(command: Command): () => void {
    if (this.commands.has(command.id)) throw new Error(`Duplicate command id "${command.id}"`);
    if (command.shortcut) {
      const key = normaliseShortcut(command.shortcut);
      const existing = this.byShortcut.get(key);
      if (existing) throw new Error(`Shortcut ${key} is used by both "${existing}" and "${command.id}"`);
      this.byShortcut.set(key, command.id);
    }
    this.commands.set(command.id, command);
    this.structureVersion++;
    this.emit();
    return () => this.unregister(command.id);
  }

  unregister(id: string) {
    const command = this.commands.get(id);
    if (!command) return;
    if (command.shortcut) this.byShortcut.delete(normaliseShortcut(command.shortcut));
    this.commands.delete(id);
    this.structureVersion++;
    this.emit();
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
