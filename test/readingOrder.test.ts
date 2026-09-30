// @vitest-environment node
//
// Checks focus-mode line detection (src/focus/lines.ts) against the reading
// order in the fixture ground truth (test/fixtures/expected/*.json): every
// anchor must appear in the detected lines in the expected order, and the
// detected column count must match.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { detectLines } from "../src/focus/lines";

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
