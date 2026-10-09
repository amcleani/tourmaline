import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Annotation, Category } from "../src/annotations/types";
import { DEFAULT_EXPORT_SETTINGS, type ExportSettings, type SectionInput } from "../src/vault/export";
import { ExportSettingsDialog } from "../src/ui/ExportSettingsDialog";

const categories: Category[] = [
  { id: "c1", name: "Claim", colour: "#f7d14c", callout: "quote", hotkey: 1, deleted: false },
  { id: "c2", name: "Question", colour: "#4ca3f7", callout: "question", hotkey: 2, deleted: false },
];

const at = (id: string, page: number, extra: Partial<Annotation>): Annotation => ({
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
  placement: { page, geometry: { rects: [[page, 10, 90, 100, 100]] }, textStart: 0, textEnd: 1, status: "exact" },
  fallback: null,
  ...extra,
});

const preview: SectionInput = {
  annotations: [at("1", 0, { note: "a comment" }), at("2", 1, { categoryId: "c2" }), at("3", 2, { categoryId: "c2", note: "why?" })],
  categories,
  pageLabel: (p) => String(p + 1),
  entry: { citekey: "Goodman2023GG", title: "Grounding Generalizations" },
};

function setup() {
  const onSave = vi.fn<(s: ExportSettings) => void>();
  render(<ExportSettingsDialog settings={DEFAULT_EXPORT_SETTINGS} preview={preview} citations={null} categories={categories} onSave={onSave} onCancel={vi.fn()} />);
  const previewText = () => screen.getByLabelText("What is written into the note").textContent ?? "";
  return { onSave, previewText };
}

describe("ExportSettingsDialog presets", () => {
  it("makes a 'Comments' preset: notes only, grouped by category, previewed as it's set up", async () => {
    const user = userEvent.setup();
    const { onSave, previewText } = setup();
    expect(previewText()).toContain("^hl-000002");

    await user.click(screen.getByRole("button", { name: "New" }));
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Comments");
    await user.click(screen.getByLabelText("Only those with a note"));
    await user.click(screen.getByLabelText("By category"));
    expect(previewText()).not.toContain("^hl-000002");
    expect(previewText()).toContain("## Claim");
    expect(previewText()).toContain("## Question");
    expect(screen.getByText("2 of 3 annotations")).toBeTruthy();

    await user.click(screen.getByLabelText("What the export starts with"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saved = onSave.mock.calls[0][0];
    expect(saved.presets.map((p) => p.name)).toEqual(["Everything", "Comments"]);
    expect(saved.presets[1]).toMatchObject({ filter: { withNote: true }, groupBy: "category" });
    expect(saved.defaultPreset).toBe(saved.presets[1].id);
  });

  it("chooses categories, and won't save a preset that exports nothing or shares a name", async () => {
    const user = userEvent.setup();
    const { onSave, previewText } = setup();
    await user.click(screen.getByLabelText("Every category"));
    const group = screen.getByRole("group", { name: "Categories" });
    await user.click(within(group).getByLabelText("Claim"));
    expect(previewText()).not.toContain("^hl-000001");
    await user.click(within(group).getByLabelText("Question"));
    await user.click(within(group).getByLabelText("No category"));
    expect(screen.getByRole("alert").textContent).toContain("at least one category");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(group).getByLabelText("Question"));

    await user.click(screen.getByRole("button", { name: "New" }));
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "everything");
    expect(screen.getByRole("alert").textContent).toContain("Another preset");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0][0].presets).toHaveLength(1);
    expect(onSave.mock.calls[0][0].presets[0].filter.categories).toEqual(["c2"]);
  });

  it("gives a category a template of its own", async () => {
    const user = userEvent.setup();
    const { onSave, previewText } = setup();
    await user.selectOptions(screen.getByLabelText("Highlight template for"), "c2");
    await user.click(screen.getByLabelText(/A template of its own/));
    const field = screen.getByLabelText("Highlight template for Question");
    await user.clear(field);
    // Pasted: userEvent reads [ and { in typed text as key names.
    await user.click(field);
    await user.paste("- [ ] {{quote}} ^{{blockId}}");
    expect(previewText()).toContain("- [ ] quote 2 ^hl-000002");
    expect(previewText()).toContain("> [!quote]");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0][0].categoryTemplates).toEqual({ c2: "- [ ] {{quote}} ^{{blockId}}" });
  });
});
