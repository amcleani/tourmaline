import type {
  Annotation,
  AnnotationEdit,
  Category,
  ImportResult,
  NewAnnotation,
  PageHash,
  Placement,
  PlacementUpdate,
} from "../annotations/types";

// Stand-in for the Rust library when the UI runs in a plain browser (vite dev
// server, tests). Mirrors src-tauri/src/annotations.rs closely enough to try
// the UI; nothing is persisted.

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "default-1", name: "Highlight", colour: "#f7d14c", callout: "quote", hotkey: 1, deleted: false },
  { id: "default-2", name: "Important", colour: "#f28b82", callout: "important", hotkey: 2, deleted: false },
  { id: "default-3", name: "Definition", colour: "#8ab4f8", callout: "info", hotkey: 3, deleted: false },
  { id: "default-4", name: "Question", colour: "#c58af9", callout: "question", hotkey: 4, deleted: false },
  { id: "default-5", name: "Method", colour: "#81c995", callout: "example", hotkey: 5, deleted: false },
];

interface Stored extends Omit<Annotation, "placement" | "fallback"> {
  deleted: boolean;
  sourceNm: string | null;
  placements: Map<string, Placement & { placedAt: number }>;
}

export class MemoryLibrary {
  private annotations = new Map<string, Stored>();
  private pageHashes = new Map<string, string>();
  private categories: Category[] = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  readonly attachments = new Map<string, Uint8Array>();
  private clock = 0;

  private now() {
    return Math.max(Date.now(), ++this.clock);
  }

  private view(s: Stored, fileId: string): Annotation {
    const { deleted: _d, sourceNm: _s, placements, ...rest } = s;
    const own = placements.get(fileId);
    let fallback: Annotation["fallback"] = null;
    if (!own) {
      const other = [...placements.entries()]
        .filter(([f, p]) => f !== fileId && p.status !== "orphan")
        .sort((a, b) => b[1].placedAt - a[1].placedAt)[0];
      if (other) {
        const [f, { placedAt: _p, ...placement }] = other;
        fallback = { fileId: f, placement, pageHash: this.pageHashes.get(`${f}:${placement.page}`) ?? null };
      }
    }
    const placement = own ? (({ placedAt: _p, ...p }) => p)(own) : null;
    return { ...rest, placement, fallback };
  }

  private recordHashes(fileId: string, hashes: PageHash[]) {
    for (const h of hashes) {
      const key = `${fileId}:${h.page}`;
      if (!this.pageHashes.has(key)) this.pageHashes.set(key, h.hash);
    }
  }

  list(workId: string, fileId: string): Annotation[] {
    return [...this.annotations.values()]
      .filter((a) => a.workId === workId && !a.deleted)
      .map((a) => this.view(a, fileId))
      .sort(
        (a, b) =>
          Number(a.placement === null) - Number(b.placement === null) ||
          (a.placement?.page ?? 0) - (b.placement?.page ?? 0) ||
          a.created - b.created,
      );
  }

  create(n: NewAnnotation): Annotation {
    const id = crypto.randomUUID();
    const now = this.now();
    const blockId = `hl-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
    this.annotations.set(id, {
      id,
      workId: n.workId,
      kind: n.kind,
      categoryId: n.categoryId,
      colour: n.colour,
      note: n.note,
      quote: n.quote,
      prefix: n.prefix,
      suffix: n.suffix,
      imagePath: null,
      blockId,
      source: n.sourceNm ? "imported" : "tourmaline",
      sourceNm: n.sourceNm ?? null,
      created: n.created ?? now,
      updated: now,
      deleted: false,
      placements: new Map([[n.fileId, { ...n.placement, placedAt: now }]]),
    });
    this.recordHashes(n.fileId, n.pageHashes);
    return this.view(this.annotations.get(id)!, n.fileId);
  }

  importedKeys(workId: string): string[] {
    return [...this.annotations.values()].filter((a) => a.workId === workId && a.sourceNm).map((a) => a.sourceNm!);
  }

  /** Mirrors import_annotations: each source key once per work, even if deleted since. */
  import(list: NewAnnotation[]): ImportResult {
    const created: Annotation[] = [];
    const existing: string[] = [];
    for (const n of list) {
      const known = [...this.annotations.values()].some((a) => a.workId === n.workId && a.sourceNm === n.sourceNm);
      if (known) existing.push(n.sourceNm!);
      else created.push(this.create(n));
    }
    return { created, existing };
  }

  private get(id: string): Stored {
    const a = this.annotations.get(id);
    if (!a) throw new Error(`no annotation ${id}`);
    return a;
  }

  update(id: string, fileId: string, edit: AnnotationEdit): Annotation {
    const a = this.get(id);
    Object.assign(a, edit, { updated: this.now() });
    return this.view(a, fileId);
  }

  delete(id: string) {
    this.get(id).deleted = true;
  }

  restore(id: string, fileId: string): Annotation {
    const a = this.get(id);
    a.deleted = false;
    return this.view(a, fileId);
  }

  savePlacements(fileId: string, updates: PlacementUpdate[], hashes: PageHash[]) {
    const now = this.now();
    for (const u of updates) this.get(u.annotationId).placements.set(fileId, { ...u.placement, placedAt: now });
    this.recordHashes(fileId, hashes);
  }

  listCategories(): Category[] {
    return this.categories.map((c) => ({ ...c }));
  }

  saveCategories(list: Category[]): Category[] {
    const keys = list.filter((c) => !c.deleted && c.hotkey !== null).map((c) => c.hotkey);
    if (new Set(keys).size !== keys.length) throw new Error("Two categories can't use the same key.");
    const kept = new Set(list.map((c) => c.id));
    const removed = this.categories.filter((c) => !kept.has(c.id)).map((c) => ({ ...c, hotkey: null, deleted: true }));
    this.categories = [...list.map((c) => ({ ...c, name: c.name.trim() })), ...removed];
    return this.listCategories();
  }

  saveAttachment(id: string, png: Uint8Array): string {
    const a = this.get(id);
    this.attachments.set(id, png);
    a.imagePath = `attachments/${id}.png`;
    return a.imagePath;
  }
}
