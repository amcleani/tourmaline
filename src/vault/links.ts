// tourmaline:// links, which reopen Tourmaline at a paper, a page or a
// highlight: tourmaline://open?doc=<work id>&hl=<block id>&page=<n>.
// The work id names the paper whatever its file is called; the block id
// (the note's ^hl-… anchor) finds the highlight, and the paper too if the
// work id is unknown.

const WORK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCK_ID = /^hl-[0-9a-z]{6}$/;

export interface ReaderLink {
  workId: string | null;
  blockId: string | null;
  /** 1-based page number. */
  page: number | null;
}

export function readerLink(workId: string, target: { blockId?: string; page?: number } = {}): string {
  const params = new URLSearchParams({ doc: workId });
  if (target.blockId) params.set("hl", target.blockId);
  if (target.page) params.set("page", String(target.page));
  return `tourmaline://open?${params}`;
}

/** Reads a tourmaline:// link; null if it isn't one this version understands. */
export function parseReaderLink(url: string): ReaderLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Some launchers add a slash: tourmaline://open/?doc=…
  if (parsed.protocol !== "tourmaline:" || parsed.host !== "open" || !/^\/?$/.test(parsed.pathname)) return null;
  const doc = parsed.searchParams.get("doc");
  const hl = parsed.searchParams.get("hl")?.replace(/^\^/, "") ?? null;
  const page = Number(parsed.searchParams.get("page"));
  const link: ReaderLink = {
    workId: doc && WORK_ID.test(doc) ? doc.toLowerCase() : null,
    blockId: hl && BLOCK_ID.test(hl) ? hl : null,
    page: Number.isInteger(page) && page > 0 ? page : null,
  };
  return link.workId || link.blockId ? link : null;
}
