import { eventToShortcut, formatShortcut, normaliseShortcut, toAccelerator } from "../src/commands/shortcuts";

const key = (key: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
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
    expect(eventToShortcut(key("+", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+=");
    expect(eventToShortcut(key("ArrowDown"))).toBe("ArrowDown");
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
