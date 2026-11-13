import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The platform bridge is replaced with an in-memory fake; opening a PDF never
// resolves, so tabs stay in their "loading" state.
const store = new Map<string, string>();
vi.mock("../src/platform", () => ({
  isTauri: () => false,
  getState: vi.fn(async (key: string) => store.get(key) ?? null),
  setState: vi.fn(async (key: string, value: string) => void store.set(key, value)),
  setUiScale: vi.fn(async () => {}),
  onOpenFiles: vi.fn(async () => () => {}),
  checkForUpdate: vi.fn(async () => null),
  appVersion: vi.fn(async () => "test"),
  recentDocuments: vi.fn(async () => []),
  openPdfAtPath: vi.fn(() => new Promise(() => {})),
  pickAndOpenPdf: vi.fn(async () => null),
  savePosition: vi.fn(async () => {}),
  quitApp: vi.fn(async () => {}),
  onWindowClose: vi.fn(async () => () => {}),
  listCategories: vi.fn(async () => []),
  saveCategories: vi.fn(async (c: unknown) => c),
  listAnnotations: vi.fn(async () => []),
  savedVault: vi.fn(async () => null),
  chooseVault: vi.fn(async () => null),
  onReaderLinks: vi.fn(async () => () => {}),
  copyText: vi.fn(async () => {}),
}));
vi.mock("../src/pdf/loader", () => ({ loadPdf: vi.fn(), PDF_TO_CSS: 96 / 72 }));

import { App } from "../src/App";
import { copyText, openPdfAtPath } from "../src/platform";

const saved = JSON.stringify({
  v: 1,
  tabs: ["a", "b", "c", "d"].map((n) => ({ path: `C:/lib/${n}.pdf`, name: `${n}.pdf` })),
  active: 2,
});

const tabNames = () => screen.queryAllByRole("tab").map((t) => t.textContent);
const selectedTab = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.textContent;

async function openTabMenu(tab: string) {
  fireEvent.contextMenu(screen.getByRole("tab", { name: tab }));
  return screen.findByRole("menu", { name: "Tab" });
}

/** Right-clicks a tab and chooses an entry of its menu. */
async function fromTabMenu(tab: string, entry: string) {
  const menu = await openTabMenu(tab);
  fireEvent.click(within(menu).getByRole("menuitem", { name: new RegExp(`^${entry}`) }));
}

async function start() {
  render(<App />);
  await screen.findByRole("tab", { name: "a.pdf" });
}

describe("tab menu", () => {
  beforeEach(() => {
    store.clear();
    store.set("session", saved);
  });

  it("lists what can be done to that tab, which needn't be the active one", async () => {
    await start();
    const menu = await openTabMenu("a.pdf");
    // The first tab: nothing to its left, nothing to reopen yet.
    expect(within(menu).getAllByRole("menuitem").map((i) => i.dataset.title)).toEqual([
      "Close tab",
      "Close other tabs",
      "Close tabs to the right",
      "Close all tabs",
      "Move tab right",
      "Copy file path",
      "Show in folder",
    ]);
  });

  it("closes the tabs to the right of the one right-clicked", async () => {
    await start();
    await fromTabMenu("b.pdf", "Close tabs to the right");
    await waitFor(() => expect(tabNames()).toEqual(["a.pdf", "b.pdf"]));
    // The active tab (c) was closed: the last one left takes over.
    expect(selectedTab()).toBe("b.pdf");
  });

  it("closes the tabs to the left, keeping the active one", async () => {
    await start();
    await fromTabMenu("d.pdf", "Close tabs to the left");
    await waitFor(() => expect(tabNames()).toEqual(["d.pdf"]));
    expect(selectedTab()).toBe("d.pdf");
  });

  it("moves tabs and closes the others", async () => {
    await start();
    await fromTabMenu("d.pdf", "Move tab left");
    await waitFor(() => expect(tabNames()).toEqual(["a.pdf", "b.pdf", "d.pdf", "c.pdf"]));
    expect(selectedTab()).toBe("c.pdf");
    await fromTabMenu("b.pdf", "Close other tabs");
    await waitFor(() => expect(tabNames()).toEqual(["b.pdf"]));
    expect(selectedTab()).toBe("b.pdf");
  });

  it("copies the path of the tab right-clicked", async () => {
    await start();
    await fromTabMenu("a.pdf", "Copy file path");
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("C:/lib/a.pdf"));
  });

  it("hides the tab's tooltip while its menu is open", async () => {
    await start();
    expect(screen.getByRole("tab", { name: "b.pdf" }).getAttribute("title")).toBe("C:/lib/b.pdf");
    await openTabMenu("b.pdf");
    expect(screen.getByRole("tab", { name: "b.pdf" }).getAttribute("title")).toBeNull();
  });

  it("focuses the tab that takes over when the focused one closes", async () => {
    await start();
    const c = screen.getByRole("tab", { name: "c.pdf" });
    c.focus();
    fireEvent.keyDown(c, { key: "Delete" });
    await waitFor(() => expect(document.activeElement?.textContent).toBe("d.pdf"));
  });

  it("reopens closed tabs where they were, leftmost first", async () => {
    await start();
    fireEvent.keyDown(window, { key: "W", code: "KeyW", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(tabNames()).toEqual([]));
    vi.mocked(openPdfAtPath).mockClear();
    fireEvent.keyDown(window, { key: "T", code: "KeyT", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(openPdfAtPath).toHaveBeenCalledWith("C:/lib/a.pdf"));
  });
});
