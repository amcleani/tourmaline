import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_PRESET, EVERYTHING } from "../src/vault/export";
import type { PaperToExport } from "../src/vault/exportAll";
import { ExportAllDialog } from "../src/ui/ExportAllDialog";

const paper = (n: string, changes: PaperToExport["changes"]): PaperToExport => ({
  doc: { fileId: `f-${n}`, workId: `w-${n}`, path: `C:/lib/${n}.pdf`, name: `${n}.pdf`, size: 1, lastOpened: 0, citekey: n },
  citekey: n,
  title: `${n} paper`,
  entry: { citekey: n },
  notePath: `Notes/@${n}.md`,
  changes,
});

function setup(papers: PaperToExport[] | Error) {
  const onExport = vi.fn();
  const onCancel = vi.fn();
  render(
    <ExportAllDialog
      presets={[DEFAULT_PRESET]}
      startWith={DEFAULT_PRESET.id}
      categories={[]}
      load={() => (papers instanceof Error ? Promise.reject(papers) : Promise.resolve(papers))}
      onExport={onExport}
      onCancel={onCancel}
    />,
  );
  return { onExport, onCancel, status: () => screen.getByRole("status").textContent };
}

describe("ExportAllDialog", () => {
  it("ticks the papers with changes, not those whose changes are unknown, and Enter exports them", async () => {
    const user = userEvent.setup();
    const a = paper("Alpha2020", { added: 2, changed: 1, deleted: 0, templates: false });
    const b = paper("Beta2021", null);
    const { onExport, status } = setup([a, b]);
    expect(await screen.findByText("2 new, 1 changed")).toBeTruthy();
    expect(screen.getByText("Exported before Tourmaline kept track: changes unknown")).toBeTruthy();
    expect(status()).toBe("1 of 2 papers will be exported, one after another.");
    // Focus moves once the list is shown (an effect after the render).
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Export" })));
    await user.click(screen.getByRole("checkbox", { name: /Beta2021/ }));
    expect(status()).toBe("2 of 2 papers will be exported, one after another.");
    await user.click(screen.getByRole("checkbox", { name: /Alpha2020/ }));
    await user.click(screen.getByRole("checkbox", { name: /Beta2021/ }));
    expect(status()).toBe("Tick the papers to export.");
    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /Alpha2020/ }));
    screen.getByRole("button", { name: "Export" }).focus();
    await user.keyboard("{Enter}");
    expect(onExport).toHaveBeenCalledWith([a], { filter: EVERYTHING, groupBy: "none" }, DEFAULT_PRESET);
  });

  it("says when every note is up to date, or the papers couldn't be looked at", async () => {
    const { status } = setup([]);
    expect(await screen.findByText("Every exported paper's note is up to date.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
    expect(status()).toContain("up to date");
  });

  it("reports a failure to look", async () => {
    setup(new Error("no library"));
    expect(await screen.findByText("Could not look for changes: no library")).toBeTruthy();
  });
});
