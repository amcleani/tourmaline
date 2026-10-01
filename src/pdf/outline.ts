import type { PDFDocumentProxy } from "pdfjs-dist";

/** Where a link or outline entry points: a page (0-based) and optionally a PDF-space y to scroll to. */
export interface Target {
  page: number;
  y: number | null;
  /** Where across the page, when the destination says (for previews: which column). */
  x?: number | null;
}

export interface OutlineNode {
  id: string;
  title: string;
  target: Target | null;
  children: OutlineNode[];
}

type Dest = string | unknown[] | null;

/** Resolves a PDF destination (named or explicit) to a page and position. */
export async function resolveDest(doc: PDFDocumentProxy, dest: Dest): Promise<Target | null> {
  const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || explicit.length === 0) return null;

  const [ref, mode, ...args] = explicit as [unknown, { name?: string } | undefined, ...Array<number | null>];
  let page: number;
  if (typeof ref === "number") page = ref;
  else if (ref && typeof ref === "object") page = await doc.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
  else return null;

  // Destination types (PDF 32000-1, 12.3.2.2); only the vertical position matters here.
  let y: number | null = null;
  let x: number | null = null;
  switch (mode?.name) {
    case "XYZ":
      x = args[0] ?? null;
      y = args[1] ?? null;
      break;
    case "FitH":
    case "FitBH":
      y = args[0] ?? null;
      break;
    case "FitR":
      y = args[3] ?? null;
      break;
  }
  return { page, y: typeof y === "number" ? y : null, x: typeof x === "number" ? x : null };
}

export async function loadOutline(doc: PDFDocumentProxy): Promise<OutlineNode[]> {
  const raw = await doc.getOutline();
  if (!raw) return [];
  let counter = 0;
  const convert = async (items: typeof raw): Promise<OutlineNode[]> =>
    Promise.all(
      items.map(async (item) => ({
        id: `o${counter++}`,
        title: item.title.trim() || "(untitled)",
        target: await resolveDest(doc, item.dest).catch(() => null),
        children: await convert(item.items ?? []),
      })),
    );
  return convert(raw);
}
