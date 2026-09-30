import { eventToShortcut, formatShortcut, isTextEditingShortcut, normaliseShortcut, toAccelerator, toAriaShortcut } from "../src/commands/shortcuts";
import { nativeAcceleratorOk } from "../src/platform/menu";

const key = (key: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> & { code?: string } = {}) => ({
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("shortcuts", () => {
  it("normalises modifier order and case", () => {
    expect(normaliseShortcut("shift+mod+p")).toBe("Ctrl+Shift+P");
    expect(normaliseShortcut("Alt+Ctrl+k")).toBe("Ctrl+Alt+K");
  });

  it("accepts the plus key and aliases", () => {
    expect(normaliseShortcut("Mod++")).toBe("Ctrl+=");
    expect(normaliseShortcut("Mod+plus")).toBe("Ctrl+=");
    expect(normaliseShortcut("esc")).toBe("Escape");
    expect(normaliseShortcut("space")).toBe("Space");
  });

  it("matches key events against definitions", () => {
    expect(eventToShortcut(key("o", { ctrlKey: true }))).toBe(normaliseShortcut("Mod+O"));
    expect(eventToShortcut(key("P", { ctrlKey: true, shiftKey: true }))).toBe(normaliseShortcut("Mod+Shift+P"));
    expect(eventToShortcut(key("+", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+=");
    expect(eventToShortcut(key("ArrowDown"))).toBe("ArrowDown");
  });

  it("matches symbols by character on layouts where they need Shift", () => {
    // Italian layout: "/" is Shift+7, "=" is Shift+0, "+" has its own key.
    expect(eventToShortcut(key("/", { ctrlKey: true, shiftKey: true, code: "Digit7" }))).toBe(normaliseShortcut("Mod+/"));
    expect(eventToShortcut(key("=", { ctrlKey: true, shiftKey: true, code: "Digit0" }))).toBe(normaliseShortcut("Mod+="));
    expect(eventToShortcut(key("+", { ctrlKey: true, code: "BracketRight" }))).toBe(normaliseShortcut("Mod+="));
    // Shift in a definition is meaningless for a symbol and is dropped.
    expect(normaliseShortcut("Mod+Shift+/")).toBe("Ctrl+/");
  });

  it("matches digits by physical key so layouts that shift digits still work", () => {
    // French layout: Ctrl+0 produces "à" without Shift.
    expect(eventToShortcut(key("à", { ctrlKey: true, code: "Digit0" }))).toBe(normaliseShortcut("Mod+0"));
    expect(eventToShortcut(key("0", { ctrlKey: true, code: "Numpad0" }))).toBe(normaliseShortcut("Mod+0"));
    // Shift+digit gives a layout-dependent symbol, which wins; so avoid defining Shift+digit shortcuts.
    expect(eventToShortcut(key("!", { ctrlKey: true, shiftKey: true, code: "Digit1" }))).toBe("Ctrl+!");
  });

  it("formats aria-keyshortcuts values", () => {
    expect(toAriaShortcut("Mod+O")).toBe("Control+O");
    expect(toAriaShortcut("Mod+Shift+P")).toBe("Control+Shift+P");
  });

  it("ignores bare modifier presses", () => {
    expect(eventToShortcut(key("Control", { ctrlKey: true }))).toBeNull();
    expect(eventToShortcut(key("Shift", { shiftKey: true }))).toBeNull();
  });

  it("formats for display and for the native menu", () => {
    expect(formatShortcut("Mod+=")).toBe("Ctrl++");
    expect(formatShortcut("Mod+Shift+ArrowUp")).toBe("Ctrl+Shift+↑");
    expect(toAccelerator("Mod+=")).toBe("Ctrl+Equal");
    expect(toAccelerator("Mod+-")).toBe("Ctrl+Minus");
    expect(toAccelerator("Mod+Shift+O")).toBe("Ctrl+Shift+O");
  });

  it("rejects shortcuts without a key", () => {
    expect(() => normaliseShortcut("Ctrl+Shift")).toThrow();
  });
});

describe("text-editing shortcuts", () => {
  it("are recognised in any spelling and never become native accelerators", () => {
    expect(isTextEditingShortcut("mod+z")).toBe(true);
    expect(isTextEditingShortcut("Mod+Shift+Z")).toBe(true);
    expect(isTextEditingShortcut("Mod+K")).toBe(false);
    expect(nativeAcceleratorOk("Mod+Z")).toBe(false);
    expect(nativeAcceleratorOk("Mod+Shift+A")).toBe(true);
    expect(nativeAcceleratorOk("Delete")).toBe(false);
  });
});
