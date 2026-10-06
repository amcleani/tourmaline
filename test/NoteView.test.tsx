import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const openInObsidian = vi.fn(async (_url: string) => {});
vi.mock("../src/platform", () => ({ openInObsidian: (url: string) => openInObsidian(url) }));

import { NoteView } from "../src/notes/NoteView";
import { setWikilinkContext } from "../src/notes/wikilinks";

describe("NoteView", () => {
  it("opens a wikilink's note in Obsidian, by mouse and by keyboard", async () => {
    setWikilinkContext({
      vaultName: "Academia",
      index: { notes: [{ path: "Obsidian/concept.md", aliases: [], headings: [], blocks: [] }], unresolved: [] },
    });
    const user = userEvent.setup();
    render(<NoteView text="See [[concept#Uses|the idea]]." />);
    const link = screen.getByRole("link", { name: "the idea" });
    await user.click(link);
    expect(openInObsidian).toHaveBeenLastCalledWith("obsidian://open?vault=Academia&file=Obsidian%2Fconcept");
    link.focus();
    await user.keyboard("{Enter}");
    expect(openInObsidian).toHaveBeenCalledTimes(2);
    setWikilinkContext({ vaultName: null, index: null });
  });
});
