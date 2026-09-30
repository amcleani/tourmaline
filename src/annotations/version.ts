import type { PDFDocumentProxy } from "pdfjs-dist";
import { getPageText } from "../pdf/textCache";

// A file that replaces another at the same path is usually a new version of
// the same paper (and inherits its annotations), but a generic download name
// ("fulltext.pdf") can also bring a different paper. Comparing the start of
// the text tells them apart.

const SAMPLE_CHARS = 3000;
/** Shorter samples (scans, figure-only pages) can't be compared. */
const MIN_COMPARABLE = 200;
/** Share of word triples in common above which two files count as the same paper. */
const SAME_PAPER = 0.4;

/** The start of the normalised text of the first pages. */
export async function textSample(pdf: PDFDocumentProxy): Promise<string> {
  const parts: string[] = [];
  let length = 0;
  for (let page = 0; page < Math.min(pdf.numPages, 3) && length < SAMPLE_CHARS; page++) {
    const { text } = await getPageText(pdf, page);
    parts.push(text.text);
    length += text.text.length + 1;
  }
  return parts.join(" ").slice(0, SAMPLE_CHARS);
}

function triples(text: string): Set<string> {
  const words = text.split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

/**
 * Whether two text samples look like the same paper. Uses the share of word
 * triples the smaller sample has in common with the other, so added or
 * removed paragraphs in a revision don't count against it. When there isn't
 * enough text to compare, it assumes they are.
 */
export function looksLikeSamePaper(a: string, b: string): boolean {
  if (a.length < MIN_COMPARABLE || b.length < MIN_COMPARABLE) return true;
  const ta = triples(a);
  const tb = triples(b);
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (small.size === 0) return true;
  let shared = 0;
  for (const t of small) if (large.has(t)) shared++;
  return shared / small.size >= SAME_PAPER;
}
