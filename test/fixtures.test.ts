// @vitest-environment node
//
// Sanity checks that the committed PDF fixtures in test/fixtures/ match their
// ground truth in test/fixtures/expected/*.json (see test/fixtures/README.md).
// This deliberately does NOT test reading order: every anchor only has to
// occur somewhere in its page's text. Order is what the focus-mode algorithm
// will be tested on, against the same JSON.
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

const SIZE_TOLERANCE = 0.05; // PDF points; pdfTeX rounds MediaBox values
const LINK_ANNOTATION = 2; // pdf.js AnnotationType.LINK

interface Anchor {
  text: string;
  kind: string;
  fullWidth?: boolean;
  column?: "left" | "right";
}
interface ExpectedPage {
  page: number;
  size: [number, number];
  rotate: number;
  columns: 1 | 2;
  readingOrder: Anchor[];
}
interface ExpectedRef {
  text: string;
  page: number;
  target: { kind: string; label: string; page: number };
}
interface Expected {
  file: string;
  hasTextLayer: boolean;
  pageCount: number;
  pages: ExpectedPage[];
  outline: { title: string; level: number; page: number }[];
  links?: ExpectedRef[];
  linksComplete?: boolean;
  references?: ExpectedRef[];
  search?: { query: string; pages: number[]; acrossLineBreak?: boolean }[];
  hasLinks: boolean;
}

/** NFKC (expands ligatures such as U+FB03) and collapse whitespace. */
function normaliseText(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** Page text: pdf.js items in stream order, with a space at each line end. */
async function pageText(pdf: PDFDocumentProxy, pageNo: number): Promise<string> {
  const page = await pdf.getPage(pageNo);
  const content = await page.getTextContent();
  let text = "";
  for (const item of content.items) {
    if ("str" in item) text += item.str + (item.hasEOL ? " " : "");
  }
  return normaliseText(text);
}

async function destPage(pdf: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || !explicit[0]) return null;
  const ref = explicit[0];
  if (typeof ref === "number") return ref + 1;
  return (await pdf.getPageIndex(ref)) + 1;
}

async function flattenOutline(pdf: PDFDocumentProxy) {
  const out: { title: string; level: number; page: number | null }[] = [];
  async function walk(items: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>, level: number) {
    for (const item of items ?? []) {
      out.push({ title: normaliseText(item.title), level, page: await destPage(pdf, item.dest) });
      await walk(item.items, level + 1);
    }
  }
  await walk(await pdf.getOutline(), 1);
  return out;
}

async function linkTargetPages(pdf: PDFDocumentProxy, pageNo: number): Promise<(number | null)[]> {
  const page = await pdf.getPage(pageNo);
  const annotations = await page.getAnnotations();
  const links = annotations.filter((a) => a.annotationType === LINK_ANNOTATION && a.dest);
  return Promise.all(links.map((a) => destPage(pdf, a.dest)));
}

// Loaded through Vite (PDFs as base64 data URLs) so this file needs no Node
// type definitions.
const expectedByPath = import.meta.glob<Expected>("./fixtures/expected/*.json", {
  eager: true,
  import: "default",
});
const pdfDataUrls = import.meta.glob<string>("./fixtures/*.pdf", {
  eager: true,
  query: "?inline",
  import: "default",
});
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const expectedFiles = Object.keys(expectedByPath).map(baseName).sort();

function fixtureBytes(file: string): Uint8Array {
  const url = pdfDataUrls[`./fixtures/${file}`];
  if (!url?.startsWith("data:")) throw new Error(`Fixture ${file} is missing or was not inlined`);
  return Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));
}

describe("PDF fixtures", () => {
  it("has an expected JSON for every fixture PDF and vice versa", () => {
    const pdfs = Object.keys(pdfDataUrls).map(baseName).sort();
    const named = Object.values(expectedByPath).map((e) => e.file).sort();
    expect(named).toEqual(pdfs);
  });

  describe.each(expectedFiles)("%s", (jsonName) => {
    const expected = expectedByPath[`./fixtures/expected/${jsonName}`];
    let pdf: PDFDocumentProxy;

    beforeAll(async () => {
      pdf = await getDocument({ data: fixtureBytes(expected.file), verbosity: 0 }).promise;
    });
    afterAll(async () => {
      await pdf?.loadingTask.destroy();
    });

    it("has well-formed column annotations in its JSON", () => {
      for (const p of expected.pages) {
        for (const a of p.readingOrder) {
          const where = `page ${p.page} "${a.text}"`;
          if (p.columns === 1) {
            expect(a.fullWidth ?? a.column, where).toBeUndefined();
          } else {
            expect(typeof a.fullWidth, where).toBe("boolean");
            expect(a.column, where).toEqual(a.fullWidth ? undefined : expect.stringMatching(/^(left|right)$/));
          }
        }
      }
    });

    it("has the expected page count, sizes and rotations", async () => {
      expect(expected.pages).toHaveLength(expected.pageCount);
      expect(pdf.numPages).toBe(expected.pageCount);
      for (const p of expected.pages) {
        const page = await pdf.getPage(p.page);
        const [x0, y0, x1, y1] = page.view;
        expect(Math.abs(x1 - x0 - p.size[0]), `page ${p.page} width`).toBeLessThan(SIZE_TOLERANCE);
        expect(Math.abs(y1 - y0 - p.size[1]), `page ${p.page} height`).toBeLessThan(SIZE_TOLERANCE);
        expect(page.rotate, `page ${p.page} rotation`).toBe(p.rotate);
      }
    });

    it(expected.hasTextLayer ? "has a text layer containing every anchor" : "has no text layer", async () => {
      for (const p of expected.pages) {
        const text = await pageText(pdf, p.page);
        if (!expected.hasTextLayer) {
          expect(text, `page ${p.page}`).toBe("");
          continue;
        }
        expect(text.length, `page ${p.page}`).toBeGreaterThan(0);
        const missing = p.readingOrder.map((a) => normaliseText(a.text)).filter((a) => !text.includes(a));
        expect(missing, `anchors missing from page ${p.page}`).toEqual([]);
      }
    });

    it("has the expected outline", async () => {
      expect(await flattenOutline(pdf)).toEqual(expected.outline);
    });

    it(expected.hasLinks ? "has link annotations to the expected targets" : "has no link annotations", async () => {
      const sortNums = (a: (number | null)[]) => [...a].sort((x, y) => (x ?? 0) - (y ?? 0));
      for (let n = 1; n <= pdf.numPages; n++) {
        const actual = sortNums(await linkTargetPages(pdf, n));
        if (!expected.hasLinks) {
          expect(actual, `links on page ${n}`).toEqual([]);
          continue;
        }
        // Compare the target pages of the links on this page as multisets:
        // exactly when the expected list is complete, otherwise as a subset.
        const wanted = sortNums((expected.links ?? []).filter((l) => l.page === n).map((l) => l.target.page));
        if (expected.linksComplete) {
          expect(actual, `link targets on page ${n}`).toEqual(wanted);
        } else {
          const remaining = [...actual];
          for (const target of wanted) {
            const i = remaining.indexOf(target);
            expect(i, `a link on page ${n} to page ${target}`).toBeGreaterThanOrEqual(0);
            remaining.splice(i, 1);
          }
        }
      }
    });

    it.runIf(Boolean(expected.search))("finds each plain search term on exactly the expected pages", async () => {
      const texts: string[] = [];
      for (let n = 1; n <= pdf.numPages; n++) texts.push((await pageText(pdf, n)).toLowerCase());
      // Terms hyphenated across a line break need a search that joins lines; skip them here.
      for (const term of (expected.search ?? []).filter((s) => !s.acrossLineBreak)) {
        const query = normaliseText(term.query).toLowerCase();
        const pages = texts.flatMap((t, i) => (t.includes(query) ? [i + 1] : []));
        expect(pages, `"${term.query}"`).toEqual(term.pages);
      }
    });

    it.runIf(Boolean(expected.references))("has every text-only reference on its page", async () => {
      for (const ref of expected.references ?? []) {
        expect(await pageText(pdf, ref.page), `"${ref.text}"`).toContain(normaliseText(ref.text));
        expect(await pageText(pdf, ref.target.page), `target of "${ref.text}"`).toContain(ref.target.label);
      }
    });
  });
});
