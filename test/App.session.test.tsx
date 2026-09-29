import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";

// The platform bridge is replaced with an in-memory fake; opening a PDF never
// resolves, so tabs stay in their "loading" state.
const store = new Map<string, string>();
vi.mock("../src/platform", () => ({
  isTauri: () => false,
  getState: vi.fn(async (key: string) => store.get(key) ?? null),
  setState: vi.fn(async (key: string, value: string) => void store.set(key, value)),
  recentDocuments: vi.fn(async () => []),
  openPdfAtPath: vi.fn(() => new Promise(() => {})),
  pickAndOpenPdf: vi.fn(async () => null),
  savePosition: vi.fn(async () => {}),
  quitApp: vi.fn(async () => {}),
}));
vi.mock("../src/pdf/loader", () => ({ loadPdf: vi.fn(), PDF_TO_CSS: 96 / 72 }));

import { App } from "../src/App";

const saved = JSON.stringify({
  v: 1,
  tabs: [
    { path: "C:/lib/a.pdf", name: "a.pdf" },
    { path: "C:/lib/b.pdf", name: "b.pdf" },
  ],
  active: 1,
  outlineOpen: true,
});

describe("session restore", () => {
  beforeEach(() => {
    store.clear();
    store.set("session", saved);
  });

  it("restores the saved tabs and doesn't overwrite them on startup", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    const b = await screen.findByRole("tab", { name: "b.pdf" });
    expect(b.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "a.pdf" })).toBeTruthy();
    await waitFor(() => {
      const session = JSON.parse(store.get("session")!);
      expect(session.tabs.map((t: { name: string }) => t.name)).toEqual(["a.pdf", "b.pdf"]);
      expect(session.active).toBe(1);
      expect(session.outlineOpen).toBe(true);
    });
  });
});
