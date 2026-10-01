// @vitest-environment node
//
// Reference previews without links (src/nav/references.ts): every reference
// in the fixtures' ground truth (test/fixtures/expected/*.json, `references`)
// is found in the text and leads to the right page.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { detectLines, type Line } from "../src/focus/lines";
import type { FocusPage } from "../src/focus/steps";
import {
  bibliographyLines,
  casedText,
  equationNumbers,
  findCitations,
  looksLikeBibliography,
  matchEntry,
  parseBibliography,
  targetIn,
  type BibEntry,
} from "../src/nav/references";
import { buildPageText } from "../src/pdf/search";

interface Reference {
  text: string;
  page: number;
  target: { kind: string; label: string; page: number };
}
interface Expected {
  file: string;
  references?: Reference[];
}

const expectedByPath = import.meta.glob<Expected>("./fixtures/expected/*.json", { eager: true, import: "default" });
const pdfDataUrls = import.meta.glob<string>("./fixtures/*.pdf", { eager: true, query: "?inline", import: "default" });
const fixtures = Object.values(expectedByPath).filter((e) => e.references?.length);

function fixtureBytes(file: string): Uint8Array {
  const url = pdfDataUrls[`./fixtures/${file}`];
  return Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));
}

describe.each(fixtures.map((e): [string, Expected] => [e.file, e]))("%s", (file, expected) => {
  it("finds every reference and where it leads", async () => {
    const pdf = await getDocument({ data: fixtureBytes(file) }).promise;
    const pages: FocusPage[] = [];
    const texts: string[] = [];
    for (let i = 0; i < pdf.numPages; i++) {
      const p = await pdf.getPage(i + 1);
      const content = await p.getTextContent();
      pages.push({ page: i, lines: detectLines(content.items).lines, items: content.items, rotation: p.rotate, top: p.view[3] });
      texts.push(casedText(buildPageText(content.items), content.items));
    }
    const entries = parseBibliography(bibliographyLines(pages));
    const equations = new Set(pages.flatMap((p) => equationNumbers(p)));

    const problems: string[] = [];
    for (const ref of expected.references!) {
      const text = texts[ref.page - 1];
      const cites = findCitations(text, entries, equations);
      if (ref.target.kind === "bibliography") {
        const label = ref.target.label.replace(/^\[|\]$/g, "");
        const hit = cites.find((c) => c.target.kind === "entry" && entries[c.target.entry].label === label);
        const page = hit?.target.kind === "entry" ? entries[hit.target.entry].rects[0][0] + 1 : null;
        if (page !== ref.target.page) problems.push(`${ref.text} → ${ref.target.label}: ${hit ? `page ${page}` : "not found"}`);
        continue;
      }
      const hit = cites.find((c) => text.slice(c.start, c.end) === ref.text);
      if (!hit || hit.target.kind === "entry") {
        problems.push(`${ref.text}: not found`);
        continue;
      }
      const target = hit.target;
      const page = pages.find((p) => p.lines.some((_, i) => targetIn(p, i, target)));
      if (page?.page !== ref.target.page - 1) problems.push(`${ref.text}: leads to page ${page ? page.page + 1 : "none"}`);
    }
    expect(problems).toEqual([]);
  }, 30_000);
});

// ---- Author-year bibliographies -------------------------------------------------

const line = (text: string, x: number, y: number, size = 10): Line => ({
  text,
  bbox: [x, y, x + text.length * 5, y + size],
  items: [],
  column: -1,
});

describe("an author-year bibliography", () => {
  // Hanging indent: each entry's first line at the margin, the rest indented.
  const page: FocusPage = {
    page: 4,
    items: [],
    rotation: 0,
    lines: [
      line("References", 72, 700, 12),
      line("Bacon, Andrew (2018a). ‘The Broadest Necessity’. In Journal of", 72, 680),
      line("Philosophical Logic 47.5, pp. 733–783.", 90, 668),
      line("— (2018b). Vagueness and Thought. Oxford University Press.", 72, 656),
      line("Bacon, Andrew and Cian Dorr (2024). ‘Classicism’. In Higher-", 72, 644),
      line("Order Metaphysics. Oxford University Press.", 90, 632),
      line("Lewis, David (1986). On the Plurality of Worlds. Blackwell.", 72, 620),
    ],
  };
  const entries: BibEntry[] = parseBibliography(bibliographyLines([page]));

  it("is split into entries, with names and years", () => {
    expect(entries.map((e) => [e.year, e.names[0]])).toEqual([
      ["2018a", "Bacon"],
      ["2018b", "Bacon"],
      ["2024", "Bacon"],
      ["1986", "Lewis"],
    ]);
    expect(entries[0].rects).toHaveLength(2);
  });

  it("is cited in the usual ways", () => {
    const text =
      "As Lewis (1986) argued, and Bacon and Dorr 2024 deny (see also Bacon 2018a, p. 3; 2018b), " +
      "while (Lewis 1986, ch. 2) and Smith (2001) are left aside.";
    const found = findCitations(text, entries).map((c) => [text.slice(c.start, c.end), c.target.kind === "entry" ? c.target.entry : -1]);
    expect(found).toEqual([
      ["Lewis (1986", 3],
      ["Bacon and Dorr 2024", 2],
      ["Bacon 2018a", 0],
      ["2018b", 1],
      ["Lewis 1986", 3],
    ]);
    expect(matchEntry(entries, "Bacon", "2018")).toBe(-1);
  });
});

describe("finding the bibliography", () => {
  const names = ["Anscombe", "Bacon", "Carnap", "Dorr"];
  // Hanging indent: the second line of each entry is indented.
  const entry = (n: number, y: number) => [
    line(`${names[n - 1]}, A. (20${10 + n}). A title of a paper number ${n}. In a`, 72, y),
    line(`Journal of Examples, pp. 1-10.`, 90, y - 12),
  ];

  it("starts at the first of the running heads atop its pages, which are left out", () => {
    const pages: FocusPage[] = [
      { page: 7, items: [], rotation: 0, lines: [line("Some text before.", 72, 700), line("References", 72, 600, 12), ...entry(1, 580), ...entry(2, 550)] },
      { page: 8, items: [], rotation: 0, lines: [line("References", 72, 760, 12), ...entry(3, 740), ...entry(4, 710)] },
    ];
    const entries = parseBibliography(bibliographyLines(pages));
    expect(entries.map((e) => e.names[0])).toEqual(names);
    expect(looksLikeBibliography(entries)).toBe(true);
  });

  it("is not a review section: entries without years don't count", () => {
    const pages: FocusPage[] = [
      { page: 0, items: [], rotation: 0, lines: [line("Reference list", 72, 700, 12), line("Some prose about earlier work.", 72, 680), line("More prose here.", 72, 660)] },
    ];
    expect(looksLikeBibliography(parseBibliography(bibliographyLines(pages)))).toBe(false);
  });
});

describe("figure references", () => {
  it("find a figure from a subfigure ('Figure 2a')", () => {
    const [c] = findCitations("As Figure 2a shows.", []);
    expect(c.target).toEqual({ kind: "figure", label: "2" });
  });
});
