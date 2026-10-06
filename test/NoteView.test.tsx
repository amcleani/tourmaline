import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const openInObsidian = vi.fn(async (_url: string) => {});
vi.mock("../src/platform", () => ({ openInObsidian: (url: string) => openInObsidian(url) }));

import { NoteView } from "../src/notes/NoteView";
import { noteWikilinks } from "../src/notes/markdown";
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

  it("in a list, a link isn't a Tab stop and a click on it is only the link's", async () => {
    setWikilinkContext({ vaultName: "Academia", index: null });
    const user = userEvent.setup();
    const onItem = vi.fn();
    const { container } = render(
      <div onClick={onItem}>
        <NoteView text="[[concept]] and `[[code]]`" inList />
      </div>,
    );
    const link = container.querySelector<HTMLElement>("a.wikilink")!;
    expect(link.hasAttribute("href")).toBe(false);
    expect(screen.queryByRole("link")).toBeNull();
    await user.click(link);
    expect(openInObsidian).toHaveBeenLastCalledWith("obsidian://open?vault=Academia&file=concept");
    expect(onItem).not.toHaveBeenCalled();
    setWikilinkContext({ vaultName: null });
  });
});

describe("noteWikilinks", () => {
  it("lists the links the reading view finds", () => {
    expect(noteWikilinks("[[a#h|x]], `[[code]]`, $[[m]]$ and ![[b]]").map((l) => l.note)).toEqual(["a", "b"]);
  });
});
