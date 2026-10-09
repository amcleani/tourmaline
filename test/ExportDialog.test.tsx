import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Annotation, Category } from "../src/annotations/types";
import { DEFAULT_PRESET, EVERYTHING, type ExportPreset } from "../src/vault/export";
import { ExportDialog } from "../src/ui/ExportDialog";

const categories: Category[] = [
  { id: "c1", name: "Claim", colour: "#f7d14c", callout: "quote", hotkey: 1, deleted: false },
  { id: "c2", name: "Question", colour: "#4ca3f7", callout: "question", hotkey: 2, deleted: false },
];

const at = (id: string, extra: Partial<Annotation>): Annotation => ({
  id,
  workId: "w",
  kind: "highlight",
  categoryId: "c1",
  colour: null,
  note: "",
  quote: `quote ${id}`,
  prefix: null,
  suffix: null,
  imagePath: null,
  blockId: `hl-${id.padStart(6, "0")}`,
  source: "tourmaline",
  created: 1,
  updated: 1,
  placement: { page: 0, geometry: { rects: [[0, 10, 90, 100, 100]] }, textStart: 0, textEnd: 1, status: "exact" },
  fallback: null,
  ...extra,
});
const annotations = [at("1", { note: "mine" }), at("2", { categoryId: "c2" }), at("3", { categoryId: "c2", note: "why?" })];

const comments: ExportPreset = { id: "comments", name: "Comments", filter: { ...EVERYTHING, withNote: true }, groupBy: "category" };

function setup(startWith = DEFAULT_PRESET.id, presets: ExportPreset[] = [DEFAULT_PRESET, comments]) {
  const onExport = vi.fn();
  const onCancel = vi.fn();
  render(
    <ExportDialog
      presets={presets}
      startWith={startWith}
      categories={categories}
      annotations={annotations}
      notePath="Obsidian/Library/@Goodman2023GG.md"
      onExport={onExport}
      onCancel={onCancel}
    />,
  );
  return { onExport, onCancel, status: () => screen.getByRole("status").textContent };
}

describe("ExportDialog (asked on every export)", () => {
  it("starts from the default preset with Export focused, so Enter exports as before", async () => {
    const user = userEvent.setup();
    const { onExport, status } = setup();
    expect(screen.getByRole("dialog", { name: "Export to Obsidian" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Export" }));
    expect(status()).toBe("All 3 annotations into Obsidian/Library/@Goodman2023GG.md.");
    await user.keyboard("{Enter}");
    expect(onExport).toHaveBeenCalledWith({ filter: EVERYTHING, groupBy: "none" }, DEFAULT_PRESET);
  });

  it("lets this export's choices differ, counting what goes in", async () => {
    const user = userEvent.setup();
    const { onExport, status } = setup();
    await user.click(screen.getByLabelText("Only those with a note"));
    expect(status()).toBe("2 of 3 annotations into Obsidian/Library/@Goodman2023GG.md.");
    await user.click(screen.getByLabelText("Every category"));
    await user.click(within(screen.getByRole("group", { name: "Categories" })).getByLabelText("Claim"));
    expect(status()).toContain("1 of 3 annotations");
    await user.click(screen.getByLabelText("By category"));
    // No longer the preset as saved: it's exported as these choices.
    expect((screen.getByLabelText("Start from") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Everything (changed)");
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalledWith(
      { filter: { ...EVERYTHING, withNote: true, categories: ["c2", "none"] }, groupBy: "category" },
      null,
    );
  });

  it("starts from another preset when asked, and switches between them", async () => {
    const user = userEvent.setup();
    const { onExport, status } = setup("comments");
    expect((screen.getByLabelText("Only those with a note") as HTMLInputElement).checked).toBe(true);
    expect(status()).toContain("2 of 3");
    await user.selectOptions(screen.getByLabelText("Start from"), DEFAULT_PRESET.id);
    expect((screen.getByLabelText("Only those with a note") as HTMLInputElement).checked).toBe(false);
    await user.selectOptions(screen.getByLabelText("Start from"), "comments");
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalledWith({ filter: comments.filter, groupBy: "category" }, comments);
  });

  it("won't export choices that let nothing through, and says when the section will be empty", async () => {
    const user = userEvent.setup();
    const { onExport, status } = setup(DEFAULT_PRESET.id, [DEFAULT_PRESET]);
    // One preset: nothing to start from but it.
    expect(screen.queryByLabelText("Start from")).toBeNull();
    for (const kind of ["Highlights", "Area captures", "Notes (without highlighted text)"]) await user.click(screen.getByLabelText(kind));
    expect(status()).toBe("Choose at least one kind of annotation.");
    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByLabelText("Area captures"));
    expect(status()).toBe("0 of 3 annotations into Obsidian/Library/@Goodman2023GG.md: the section will be empty.");
    expect(onExport).not.toHaveBeenCalled();
  });

  it("closes with Escape without exporting", async () => {
    const user = userEvent.setup();
    const { onExport, onCancel } = setup();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
    expect(onExport).not.toHaveBeenCalled();
  });
});
