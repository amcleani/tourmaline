import { fuzzyMatch, rankByFuzzy } from "../src/commands/fuzzy";
import { nextZoom } from "../src/commands/appCommands";

describe("fuzzy matching", () => {
  it("requires characters in order", () => {
    expect(fuzzyMatch("zi", "Zoom in")).not.toBeNull();
    expect(fuzzyMatch("iz", "Zoom in")).toBeNull();
  });

  it("prefers word-start matches", () => {
    const ranked = rankByFuzzy("zi", ["Zoom in", "Resize image"], (s) => [s]);
    expect(ranked[0].item).toBe("Zoom in");
  });

  it("matches keywords but ranks title matches higher", () => {
    const items = [
      { title: "Quit Tourmaline", keywords: ["exit"] },
      { title: "Exit focus mode", keywords: [] as string[] },
    ];
    const ranked = rankByFuzzy("exit", items, (i) => [i.title, ...i.keywords]);
    expect(ranked.map((r) => r.item.title)).toEqual(["Exit focus mode", "Quit Tourmaline"]);
  });
});

describe("zoom steps", () => {
  it("steps through the preset levels and clamps at the ends", () => {
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(1, -1)).toBe(0.9);
    expect(nextZoom(1.05, 1)).toBe(1.1);
    expect(nextZoom(4, 1)).toBe(4);
    expect(nextZoom(0.5, -1)).toBe(0.5);
  });
});
