// @vitest-environment node
//
// Checks focus-mode line detection (src/focus/lines.ts) against the reading
// order in the fixture ground truth (test/fixtures/expected/*.json): every
// anchor must appear in the detected lines in the expected order, and the
// detected column count must match.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { detectLines } from "../src/focus/lines";
import { buildSteps } from "../src/focus/steps";

interface Anchor {
  text: string;
  fullWidth?: boolean;
  column?: "left" | "right";
}
interface ExpectedPage {
  page: number;
  columns: 1 | 2;
  readingOrder: Anchor[];
}
interface Expected {
  file: string;
  hasTextLayer: boolean;
  pages: ExpectedPage[];
}

// Loaded through Vite, like test/fixtures.test.ts, so no Node types are needed.
const expectedByPath = import.meta.glob<Expected>("./fixtures/expected/*.json", { eager: true, import: "default" });
const pdfDataUrls = import.meta.glob<string>("./fixtures/*.pdf", { eager: true, query: "?inline", import: "default" });
const fixtures = Object.values(expectedByPath).filter((e) => e.hasTextLayer);

function fixtureBytes(file: string): Uint8Array {
  const url = pdfDataUrls[`./fixtures/${file}`];
  return Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));
}

const normalise = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();

describe.each(fixtures.map((e): [string, Expected] => [e.file, e]))("%s", (file, expected) => {
  const loaded = getDocument({ data: fixtureBytes(file) }).promise;

  it.each(expected.pages.map((p): [number, ExpectedPage] => [p.page, p]))("page %i is read in order", async (pageNo, page) => {
    const pdf = await loaded;
    const pdfPage = await pdf.getPage(pageNo);
    const content = await pdfPage.getTextContent();
    const result = detectLines(content.items, { rotation: pdfPage.rotate });
    const text = normalise(result.lines.map((l) => l.text).join(" "));

    let from = 0;
    const missing: string[] = [];
    for (const anchor of page.readingOrder) {
      const at = text.indexOf(normalise(anchor.text), from);
      if (at === -1) {
        const anywhere = text.indexOf(normalise(anchor.text));
        missing.push(`${anchor.text} (${anywhere === -1 ? "not found" : "out of order"})`);
      } else {
        from = at + anchor.text.length;
      }
    }
    expect(missing, `anchors on ${file} p.${pageNo}`).toEqual([]);
    expect(result.columns, `columns on ${file} p.${pageNo}`).toBe(page.columns);
  });
});

describe("focus steps on two-column.pdf", () => {
  it("are sentences in reading order, with figures as steps", async () => {
    const pdf = await getDocument({ data: fixtureBytes("two-column.pdf") }).promise;
    const pages = [];
    for (let i = 0; i < pdf.numPages; i++) {
      const p = await pdf.getPage(i + 1);
      const content = await p.getTextContent();
      pages.push({ page: i, lines: detectLines(content.items).lines, items: content.items, rotation: p.rotate, top: p.view[3] });
    }
    const steps = buildSteps(pages, "sentence");
    const sentences = steps.map((s) => s.text);
    const order = [
      "Column-Aware Reading Order for Scholarly Documents",
      "Abstract",
      "1 Introduction",
      "A two-column page is read as two narrow pages placed side by side.",
      "2 Related Work",
      "Wide elements such as this figure are read where they sit, before the columns below.",
      "3 Approach",
    ].map((s) => sentences.indexOf(s));
    expect(order.every((i) => i !== -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(steps.filter((s) => s.kind === "figure").length).toBeGreaterThanOrEqual(2);
  });
});
