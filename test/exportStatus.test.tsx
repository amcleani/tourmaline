import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { Annotation, Category } from "../src/annotations/types";
import { blockSnippet, blockText, mergeBlocks, parseExportRecord, sectionBlocks } from "../src/vault/export";
import { AnnotationsPanel } from "../src/ui/AnnotationsPanel";
import type { BlockStatus } from "../src/vault/export";

const block = (n: number, extra = "") => `> [!quote] [p. ${n}](link)\n> quote ${n}${extra}\n\n^hl-00000${n}`;

describe("blocks in a section", () => {
  it("are what Obsidian gives each id to: the paragraph, or the one above an id on its own line", () => {
    const body = ["## Claim", block(1), "- a list item ^hl-000002", "Text\nover two lines\n^hl-000003"].join("\n\n");
    const spans = sectionBlocks(body);
    const text = (id: string) => body.slice(spans.get(id)!.start, spans.get(id)!.end);
    expect(text("hl-000001")).toBe(block(1));
    expect(text("hl-000002")).toBe("- a list item ^hl-000002");
    expect(text("hl-000003")).toBe("Text\nover two lines\n^hl-000003");
  });

  it("take in blank lines Tourmaline wrote inside a block", () => {
    const wrote = "![[image.png]]\n\n> quote\n\n^hl-000001";
    const body = `Intro\n\n${wrote}`;
    expect(blockText(body, "hl-000001", { "hl-000001": wrote })).toBe(wrote);
    // Without knowing, only the paragraph above the id.
    expect(blockText(body, "hl-000001")).toBe("> quote\n\n^hl-000001");
  });

  it("are replaced in place or put next to their neighbours, the rest kept", () => {
    const body = ["Mine.", block(1), "## Question", block(3)].join("\n\n");
    const order = ["hl-000001", "hl-000002", "hl-000003", "hl-000004"];
    expect(mergeBlocks(body, [{ blockId: "hl-000001", text: block(1, " (new)") }], order)).toBe(
      ["Mine.", block(1, " (new)"), "## Question", block(3)].join("\n\n"),
    );
    expect(mergeBlocks(body, [{ blockId: "hl-000002", text: block(2) }], order)).toBe(
      ["Mine.", block(1), block(2), "## Question", block(3)].join("\n\n"),
    );
    expect(mergeBlocks(body, [{ blockId: "hl-000004", text: block(4) }], order)).toBe(`${body}\n\n${block(4)}`);
    // First in order: before the first block there.
    expect(mergeBlocks(block(3), [{ blockId: "hl-000001", text: block(1) }], order)).toBe(`${block(1)}\n\n${block(3)}`);
    // Line endings come in as the note has them.
    expect(mergeBlocks(body.replace(/\n/g, "\r\n"), [], order)).toBe(body);
    expect(mergeBlocks(null, [{ blockId: "hl-000002", text: block(2) }], order)).toBe(block(2));
  });

  it("read as one line in the preview", () => {
    expect(blockSnippet("> [!quote] [p. 3](tourmaline://x)\n> Some *quote*\n>\n> My [[Note|note]]\n\n^hl-000001")).toBe(
      "p. 3 Some *quote* My note",
    );
    expect(blockSnippet("x".repeat(200), 10)).toBe("xxxxxxxxx…");
  });

  it("are remembered as a record that reads back, or not at all", () => {
    expect(parseExportRecord(JSON.stringify({ exportedAt: 5, blocks: { "hl-000001": "a", x: 3 } }))).toEqual({
      exportedAt: 5,
      blocks: { "hl-000001": "a" },
    });
    expect(parseExportRecord("{")).toBeNull();
    expect(parseExportRecord(JSON.stringify({ blocks: {} }))).toBeNull();
    expect(parseExportRecord(null)).toBeNull();
  });
});

const categories: Category[] = [{ id: "c1", name: "Claim", colour: "#f7d14c", callout: "quote", hotkey: 1, deleted: false }];
const at = (n: number): Annotation => ({
  id: `id-${n}`,
  workId: "w",
  kind: "highlight",
  categoryId: "c1",
  colour: null,
  note: "",
  quote: `quote ${n}`,
  prefix: null,
  suffix: null,
  imagePath: null,
  blockId: `hl-00000${n}`,
  source: "tourmaline",
  created: n,
  updated: n,
  placement: { page: 0, geometry: { rects: [[0, 0, 0, 1, 1]] }, textStart: 0, textEnd: 1, status: "exact" },
  fallback: null,
});
const LIST = [1, 2, 3, 4, 5].map(at);

// The panel with App's selection rules: several chosen while the active one stays the same.
function Harness({ status }: { status?: Map<string, BlockStatus> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ ids: ReadonlySet<string>; active: string } | null>(null);
  const selection = chosen && chosen.active === selectedId ? chosen.ids : new Set(selectedId ? [selectedId] : []);
  return (
    <AnnotationsPanel
      annotations={LIST}
      categories={categories}
      selectedId={selectedId}
      selection={selection}
      exportStatus={status}
      reanchoring={false}
      pageLabel={(p) => String(p + 1)}
      onSelect={setSelectedId}
      onChoose={(ids, active) => {
        setChosen({ ids: new Set(ids), active });
        setSelectedId(active);
      }}
      onEditNote={() => {}}
    />
  );
}

const selectedQuotes = () =>
  screen
    .getAllByRole("option")
    .filter((o) => o.getAttribute("aria-selected") === "true")
    .map((o) => o.querySelector(".annotation-quote")!.textContent);

describe("the annotations list", () => {
  it("selects several by keyboard: Shift+arrows for a range, Ctrl+arrows and Space for others, Ctrl+A for all", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const list = screen.getByRole("listbox");
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    list.focus();
    await user.keyboard("{ArrowDown}{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
    expect(selectedQuotes()).toEqual(["quote 1", "quote 2", "quote 3"]);
    expect(list.getAttribute("aria-label")).toBe("Annotations, 5 of 5, 3 selected");
    // Move on without changing the selection, then add the fifth.
    await user.keyboard("{Control>}{ArrowDown}{ArrowDown}{/Control} ");
    expect(selectedQuotes()).toEqual(["quote 1", "quote 2", "quote 3", "quote 5"]);
    // Space again takes it out.
    await user.keyboard(" ");
    expect(selectedQuotes()).toEqual(["quote 1", "quote 2", "quote 3"]);
    await user.keyboard("{Control>}a{/Control}");
    expect(selectedQuotes()).toHaveLength(5);
    // A plain arrow selects just one again.
    await user.keyboard("{ArrowUp}");
    expect(selectedQuotes()).toHaveLength(1);
  });

  it("selects several by mouse: Ctrl+click adds, Shift+click a range", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const option = (n: number) => screen.getAllByRole("option")[n - 1];
    await user.click(option(2));
    await user.keyboard("{Control>}");
    await user.click(option(4));
    await user.keyboard("{/Control}");
    expect(selectedQuotes()).toEqual(["quote 2", "quote 4"]);
    await user.keyboard("{Shift>}");
    await user.click(option(5));
    await user.keyboard("{/Shift}");
    expect(selectedQuotes()).toEqual(["quote 4", "quote 5"]);
    await user.click(option(1));
    expect(selectedQuotes()).toEqual(["quote 1"]);
  });

  it("marks what is new or changed since the last export", () => {
    render(
      <Harness
        status={
          new Map<string, BlockStatus>([
            ["id-2", "new"],
            ["id-3", "changed"],
          ])
        }
      />,
    );
    const [, second, third] = screen.getAllByRole("option");
    expect(second.textContent).toContain("New: not exported to the note yet");
    expect(third.textContent).toContain("Changed: changed since it was last exported");
    expect(screen.getAllByRole("option")[0].querySelector(".export-badge")).toBeNull();
  });
});
