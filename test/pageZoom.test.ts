import { isPageZoomKey, preventPageZoom } from "../src/platform/pageZoom";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, code: "", ctrlKey: true, metaKey: false, altKey: false, ...mods });

describe("the webview's own zoom", () => {
  it("knows its zoom keys", () => {
    expect(isPageZoomKey(key("="))).toBe(true);
    expect(isPageZoomKey(key("+"))).toBe(true);
    expect(isPageZoomKey(key("-"))).toBe(true);
    expect(isPageZoomKey(key("0"))).toBe(true);
    expect(isPageZoomKey(key("+", { code: "NumpadAdd" }))).toBe(true);
    expect(isPageZoomKey(key("=", { ctrlKey: false }))).toBe(false);
    expect(isPageZoomKey(key("0", { altKey: true }))).toBe(false);
    expect(isPageZoomKey(key("s"))).toBe(false);
  });

  it("is cancelled for Ctrl+wheel and zoom keys, leaving other events alone", () => {
    const stop = preventPageZoom(window);
    const wheel = (ctrlKey: boolean) => {
      const e = new WheelEvent("wheel", { deltaY: -4, ctrlKey, cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(wheel(true)).toBe(true);
    expect(wheel(false)).toBe(false);
    const press = (k: string) => {
      const e = new KeyboardEvent("keydown", { key: k, ctrlKey: true, cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(press("=")).toBe(true);
    expect(press("f")).toBe(false);
    stop();
    expect(wheel(true)).toBe(false);
  });
});
