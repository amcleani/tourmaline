import { useCallback, useMemo } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { FocusPage } from "../focus/steps";
import { resolveDest } from "../pdf/outline";
import { getPageLines } from "../pdf/pageLines";
import { matchRects, type PdfRect } from "../pdf/search";
import { getPageText } from "../pdf/textCache";
import { textUnderRects } from "../annotations/importPdf";
import {
  around,
  bibliographyLines,
  equationNumbers,
  findCitations,
  parseBibliography,
  casedText,
  regionAt,
  targetIn,
  type BibEntry,
  type CitationTarget,
} from "./references";

/** Something on a page that points elsewhere: a link in the PDF, or a citation found in its text. */
export interface Spot {
  id: string;
  rects: PdfRect[];
  /** Read out for the spot ("Link to page 12", "[12]"). */
  label: string;
  to:
    | { kind: "dest"; dest: string | unknown[] }
    | { kind: "url"; url: string }
    | { kind: "text"; target: CitationTarget };
}

/** Where a spot leads: the page and point to go to, and the part of the page to preview. */
export interface Destination {
  page: number;
  y: number | null;
  /** Null when there is nothing to show (an external link). */
  preview: PdfRect | null;
  /** For external links. */
  url?: string;
}

interface LinkData {
  subtype: string;
  id: string;
  rect: number[];
  dest?: string | unknown[] | null;
  url?: string | null;
  unsafeUrl?: string | null;
}

interface Index {
  bibliography: Promise<BibEntry[]>;
  /** Numbers of the document's displayed equations, so a bare "(2)" can be told from other brackets. */
  equations: Promise<Set<string>>;
  spots: Map<number, Promise<Spot[]>>;
  found: Map<string, Promise<{ page: number; rect: PdfRect } | null>>;
}
const indexes = new WeakMap<PDFDocumentProxy, Index>();

function indexOf(pdf: PDFDocumentProxy): Index {
  let index = indexes.get(pdf);
  if (!index) {
    index = { bibliography: readBibliography(pdf), equations: readEquations(pdf), spots: new Map(), found: new Map() };
    Promise.all([index.bibliography, index.equations]).catch(() => indexes.delete(pdf));
    indexes.set(pdf, index);
  }
  return index;
}

/**
 * Reads pages from the end until a bibliography heading turns up, in the
 * last third of the document at most (every page's citations wait for it).
 */
async function readBibliography(pdf: PDFDocumentProxy): Promise<BibEntry[]> {
  const pages: FocusPage[] = [];
  const last = Math.max(0, pdf.numPages - Math.min(80, Math.max(15, Math.ceil(pdf.numPages / 3))));
  for (let i = pdf.numPages - 1; i >= last; i--) {
    pages.unshift(await getPageLines(pdf, i));
    const lines = bibliographyLines(pages);
    if (lines.length) return parseBibliography(lines);
  }
  return [];
}

/** Papers only (a book would take long to read whole): the equation numbers of every page. */
async function readEquations(pdf: PDFDocumentProxy): Promise<Set<string>> {
  const out = new Set<string>();
  if (pdf.numPages > 150) return out;
  for (let i = 0; i < pdf.numPages; i++) for (const n of equationNumbers(await getPageLines(pdf, i))) out.add(n);
  return out;
}

const overlaps = (a: PdfRect, b: PdfRect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

async function pageSpots(pdf: PDFDocumentProxy, pageIndex: number, index: Index): Promise<Spot[]> {
  const page = await pdf.getPage(pageIndex + 1);
  const { text, content } = await getPageText(pdf, pageIndex);
  // A link is named by the text it covers ("[12]", "Figure 2").
  const under = (rect: PdfRect) => textUnderRects(text, content.items, [rect])?.quote.trim() || null;
  const spots: Spot[] = [];
  for (const a of (await page.getAnnotations({ intent: "display" })) as LinkData[]) {
    if (a.subtype !== "Link") continue;
    const [x0, y0, x1, y1] = a.rect;
    const rect: PdfRect = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
    if (a.dest) spots.push({ id: `l${a.id}`, rects: [rect], label: under(rect) ?? "Link", to: { kind: "dest", dest: a.dest } });
    else if (a.url) spots.push({ id: `l${a.id}`, rects: [rect], label: `${under(rect) ?? "Link"} (opens ${a.url})`, to: { kind: "url", url: a.url } });
  }
  // Citations and references in the text, where the PDF has no link of its own.
  const [entries, equations] = await Promise.all([index.bibliography, index.equations]);
  const cased = casedText(text, content.items);
  findCitations(cased, entries, equations).forEach((c, i) => {
    const rects = matchRects(text, content.items, { page: pageIndex, start: c.start, end: c.end });
    if (!rects.length || spots.some((s) => s.rects.some((r) => rects.some((q) => overlaps(r, q))))) return;
    spots.push({ id: `t${pageIndex}-${i}`, rects, label: cased.slice(c.start, c.end), to: { kind: "text", target: c.target } });
  });
  return spots;
}

/** The first page (from `from` on, then from the start) with a line passing `test`, and where. */
async function findLine(
  pdf: PDFDocumentProxy,
  from: number,
  test: (page: FocusPage, i: number) => PdfRect | null,
): Promise<{ page: number; rect: PdfRect } | null> {
  const n = pdf.numPages;
  for (let k = 0; k < n; k++) {
    const pageIndex = (from + k) % n;
    const page = await getPageLines(pdf, pageIndex);
    for (let i = 0; i < page.lines.length; i++) {
      const rect = test(page, i);
      if (rect) return { page: pageIndex, rect };
    }
  }
  return null;
}

async function locate(pdf: PDFDocumentProxy, target: CitationTarget, from: number, index: Index) {
  if (target.kind === "entry") {
    const entry = (await index.bibliography)[target.entry];
    if (!entry) return null;
    const page = entry.rects[0][0];
    const lines = (await getPageLines(pdf, page)).lines.filter((l) =>
      entry.rects.some(([p, ...r]) => p === page && r.every((v, i) => v === l.bbox[i])),
    );
    return lines.length ? { page, rect: around(await getPageLines(pdf, page), lines) } : null;
  }
  const key = `${target.kind}:${target.kind === "theorem" ? target.name : ""}:${target.label}`;
  let found = index.found.get(key);
  if (!found) {
    // Sections and theorems are searched from the start (cited after they are stated);
    // figures and equations from where they are cited (often just after).
    found = findLine(pdf, target.kind === "section" || target.kind === "theorem" ? 0 : from, (page, i) => targetIn(page, i, target));
    index.found.set(key, found);
  }
  return found;
}

/**
 * Links and citations of a document: the spots on each page, and where each
 * leads. Everything is worked out on demand and kept for the document.
 */
export function useReferences(pdf: PDFDocumentProxy | null) {
  const spotsFor = useCallback(
    (pageIndex: number): Promise<Spot[]> => {
      if (!pdf) return Promise.resolve([]);
      const index = indexOf(pdf);
      let spots = index.spots.get(pageIndex);
      if (!spots) {
        spots = pageSpots(pdf, pageIndex, index);
        spots.catch(() => index.spots.delete(pageIndex));
        index.spots.set(pageIndex, spots);
      }
      return spots;
    },
    [pdf],
  );

  const destinationOf = useCallback(
    async (spot: Spot, fromPage: number): Promise<Destination | null> => {
      if (!pdf) return null;
      if (spot.to.kind === "url") return { page: fromPage, y: null, preview: null, url: spot.to.url };
      if (spot.to.kind === "dest") {
        const target = await resolveDest(pdf, spot.to.dest);
        if (!target) return null;
        const page = await getPageLines(pdf, target.page);
        // A link into the bibliography shows the whole entry.
        const entries = await indexOf(pdf).bibliography;
        const y = target.y;
        const entry =
          y === null
            ? undefined
            : entries
                .filter((e) => e.rects[0][0] === target.page && e.rects[0][4] <= y + 4)
                .sort((a, b) => b.rects[0][4] - a.rects[0][4])
                .find((e) => y - e.rects[0][4] < 3 * (e.rects[0][4] - e.rects[0][2]) + 20);
        const entryLines = entry
          ? page.lines.filter((l) => entry.rects.some(([p, ...r]) => p === target.page && r[1] === l.bbox[1] && r[0] === l.bbox[0]))
          : [];
        const preview = entryLines.length ? around(page, entryLines) : regionAt(page, y, target.x ?? null);
        return { page: target.page, y, preview };
      }
      const found = await locate(pdf, spot.to.target, fromPage, indexOf(pdf));
      return found ? { page: found.page, y: found.rect[3], preview: found.rect } : null;
    },
    [pdf],
  );

  return useMemo(() => ({ spotsFor, destinationOf }), [spotsFor, destinationOf]);
}
