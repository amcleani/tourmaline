import { DEFAULT_APPEARANCE, PAGE_COLOURS, THEMES, applyAppearance, cycle, parseAppearance, stepScale } from "../src/app/appearance";

describe("appearance", () => {
  it("reads saved settings, ignoring anything unknown", () => {
    expect(parseAppearance('{"theme":"contrast","pages":"sepia","uiScale":1.25}')).toEqual({ theme: "contrast", pages: "sepia", uiScale: 1.25 });
    expect(parseAppearance('{"theme":"neon","pages":7,"uiScale":3}')).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("{")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });

  it("cycles and steps within the choices", () => {
    expect(cycle(THEMES, "system")).toBe("light");
    expect(cycle(THEMES, "contrast")).toBe("system");
    expect(cycle(PAGE_COLOURS, "sepia")).toBe("normal");
    expect(stepScale(1, 1)).toBe(1.1);
    expect(stepScale(2, 1)).toBe(2);
    expect(stepScale(0.8, -1)).toBe(0.8);
    expect(stepScale(1.3, -1)).toBe(0.9); // unknown: from 100%
  });

  it("sets the attributes the stylesheet uses", () => {
    const root = document.createElement("html");
    applyAppearance({ theme: "dark", pages: "sepia", uiScale: 1 }, root);
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.pages).toBe("sepia");
    applyAppearance(DEFAULT_APPEARANCE, root);
    expect(root.dataset.theme).toBeUndefined();
    expect(root.dataset.pages).toBeUndefined();
  });
});
