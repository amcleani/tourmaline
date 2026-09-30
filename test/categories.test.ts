import { validateCategories } from "../src/ui/CategoriesDialog";
import { DEFAULT_CATEGORIES } from "../src/platform/memoryLibrary";

describe("validateCategories", () => {
  it("accepts the defaults", () => {
    expect(validateCategories(DEFAULT_CATEGORIES)).toBeNull();
  });
  it("needs names and distinct keys", () => {
    expect(validateCategories([{ ...DEFAULT_CATEGORIES[0], name: "  " }])).toMatch(/name/);
    const [a, b] = DEFAULT_CATEGORIES;
    expect(validateCategories([a, { ...b, hotkey: a.hotkey }])).toMatch(/Key 1/);
    expect(validateCategories([a, { ...b, hotkey: null }, { ...b, id: "x", hotkey: null }])).toBeNull();
  });
});
