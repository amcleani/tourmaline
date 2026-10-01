import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { CommandRegistry, IDLE_CONTEXT, isTypingTarget, type CommandContext } from "./commands/registry";
import { appCommands } from "./commands/appCommands";
import { isTextEditingShortcut } from "./commands/shortcuts";
import { colourOf, type Annotation, type Category } from "./annotations/types";
import { useAnnotations } from "./annotations/useAnnotations";
import { usePdfImport } from "./annotations/usePdfImport";
import { annotationsToWrite } from "./annotations/writeback";
import { looksLikeSamePaper, textSample } from "./annotations/version";
import { DEFAULT_ZOOM, decodePosition, decodeSession, encodePosition, encodeSession } from "./app/session";
import { nextZoom, type Anchor } from "./pdf/layout";
import { loadPdf } from "./pdf/loader";
import { loadOutline, type OutlineNode, type Target } from "./pdf/outline";
import { PdfViewer, type Mark, type SelectionEnd, type ViewState, type ViewerHandle, type ZoomSpec } from "./pdf/PdfViewer";
import type { PdfRect } from "./pdf/search";
import { useDocumentSearch } from "./pdf/useSearch";
import {
  chooseVault,
  copyText,
  detachFile,
  getState,
  isTauri,
  linkCitekey,
  listCategories,
  locateWork,
  onReaderLinks,
  onWindowClose,
  openInObsidian,
  openPdfAtPath,
  openPdfFromUrl,
  pickAndOpenPdf,
  quitApp,
  saveAnnotationsToPdf,
  recentDocuments,
  saveCategories,
  savedVault,
  savePosition,
  setState,
  setTextSample,
  vaultFileExists,
  type DocumentInfo,
  type OpenedDocument,
} from "./platform";
import { useVaultMath } from "./math/useVaultMath";
import { stepAt, stepUnder, type StepUnit } from "./focus/steps";
import { useFocusSteps } from "./focus/useFocusSteps";
import { citationVariables } from "./vault/bibliography";
import { parseReaderLink, readerLink } from "./vault/links";
import { DEFAULT_EXPORT_SETTINGS, NoteFormatError, parseExportSettings, type ExportSettings, type SectionInput } from "./vault/export";
import { literatureNotePath, obsidianUrl, renderHighlight } from "./vault/notes";
import { runExport, type ExportQuestion } from "./vault/runExport";
import { useVault } from "./vault/useVault";
import { installNativeMenu } from "./platform/menu";
import { AnnotationPopover } from "./ui/AnnotationPopover";
import { AnnotationsPanel } from "./ui/AnnotationsPanel";
import { CategoriesDialog } from "./ui/CategoriesDialog";
import { CommandPalette } from "./ui/CommandPalette";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { EntryPicker } from "./ui/EntryPicker";
import { ExportSettingsDialog } from "./ui/ExportSettingsDialog";
import { FindBar } from "./ui/FindBar";
import { EYE_HEIGHTS, FocusBar, STEP_UNITS } from "./ui/FocusBar";
import { GoToPageDialog } from "./ui/GoToPageDialog";
import { OutlinePanel } from "./ui/OutlinePanel";
import { RecentDialog } from "./ui/RecentDialog";
import { SelectionToolbar } from "./ui/SelectionToolbar";
import { ShortcutsDialog } from "./ui/ShortcutsDialog";
import { TabBar } from "./ui/TabBar";
import { VersionDialog } from "./ui/VersionDialog";
import { WriteBackDialog } from "./ui/WriteBackDialog";
import { Toolbar } from "./ui/Toolbar";
import { Welcome } from "./ui/Welcome";

interface Tab {
  /** Stable React key for the tab; not the document id (that can change if the file changes). */
  key: string;
  path: string | null;
  name: string;
  /** SHA-256 of the loaded file; null until loaded. */
  fileId: string | null;
  /** The paper the file is a version of; owns annotations and the position. */
  workId: string | null;
  pdf: PDFDocumentProxy | null;
  status: "unloaded" | "loading" | "ready" | "error";
  error?: string;
  zoom: ZoomSpec;
  initialAnchor: Anchor | null;
  labels: string[] | null;
  /**
   * Set while asking whether this file, which replaced another at the same
   * path, is the same paper; annotations stay hidden until then.
   */
  pendingVersion?: { sample: string } | null;
  /** The paper's JabRef entry, if linked. */
  citekey: string | null;
  /** An entry this paper must not be matched to again. */
  citekeyDeclined: string | null;
}

type Dialog = "palette" | "shortcuts" | "goto" | "recent" | "categories" | "entry" | "writeback" | "exportSettings" | null;

const SAVE_POSITION_MS = 800;
let tabCounter = 0;
const newTabKey = () => `tab${++tabCounter}`;

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findFocusToken, setFindFocusToken] = useState(0);
  const [recent, setRecent] = useState<DocumentInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  // What each tab's viewer last reported. Kept in a ref so scrolling doesn't
  // re-render the app; `status` mirrors the active tab's page/zoom for display.
  const views = useRef(new Map<string, ViewState>());
  const [status, setStatus] = useState<{ page: number; zoom: number } | null>(null);
  const viewerRef = useRef<ViewerHandle>(null);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTab = tabs.find((t) => t.key === activeKey) ?? null;
  const activePdf = activeTab?.status === "ready" ? activeTab.pdf : null;

  const ctxRef = useRef<CommandContext>(IDLE_CONTEXT);
  const registry = useMemo(() => new CommandRegistry(() => ctxRef.current), []);

  const updateTab = useCallback((key: string, patch: Partial<Tab>) => {
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }, []);

  const reportError = useCallback((what: string, err: unknown) => {
    console.error(what, err);
    setError(`${what}: ${err instanceof Error ? err.message : String(err)}`);
  }, []);

  // ---- Obsidian vault: math settings for notes ---------------------------------

  const [vault, setVault] = useState<string | null>(null);
  useEffect(() => {
    savedVault()
      .then(setVault)
      .catch((e) => console.error("Could not load the vault setting", e));
  }, []);
  const reportMath = useCallback((message: string) => setError(message), []);
  useVaultMath(vault, reportMath);
  const { settings: vaultSettings, bibliography } = useVault(vault, reportMath);

  /** A short confirmation ("Copied…") shown for a few seconds. */
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const refreshRecent = useCallback(() => {
    recentDocuments().then(setRecent).catch((e) => console.error("Could not load recent documents", e));
  }, []);
  useEffect(refreshRecent, [refreshRecent]);

  // ---- Opening and loading documents -------------------------------------

  /**
   * Records the start of the file's text; if the file joined a paper as a
   * new version, first checks it's really the same paper. Returns what to
   * ask the user when it doesn't look like it.
   */
  const checkVersion = useCallback(async (pdf: PDFDocumentProxy, info: DocumentInfo) => {
    const sample = await textSample(pdf).catch(() => "");
    const previous = info.previousVersion;
    const differs = !!previous?.textSample && !looksLikeSamePaper(previous.textSample, sample);
    if (!differs) void setTextSample(info.fileId, sample).catch((e) => console.error("Could not save the text sample", e));
    return differs ? { sample } : null;
  }, []);

  /** Turns freshly read bytes into a ready tab state. */
  const prepare = useCallback(async (opened: OpenedDocument) => {
    const pdf = await loadPdf(opened.bytes);
    const labels = await pdf.getPageLabels().catch(() => null);
    const saved = decodePosition(opened.info.lastPosition);
    return {
      pendingVersion: await checkVersion(pdf, opened.info),
      citekey: opened.info.citekey ?? null,
      citekeyDeclined: opened.info.citekeyDeclined ?? null,
      pdf,
      labels,
      fileId: opened.info.fileId,
      workId: opened.info.workId,
      path: opened.info.path,
      name: opened.info.name,
      status: "ready" as const,
      error: undefined,
      zoom: saved?.zoom ?? DEFAULT_ZOOM,
      initialAnchor: saved?.anchor ?? null,
    };
  }, [checkVersion]);

  type Ready = Awaited<ReturnType<typeof prepare>>;

  /**
   * Puts a loaded document into a tab. Loads are asynchronous, so by now the
   * tab may be gone (the document is then freed), or may hold another copy of
   * the document (the one it replaces is freed after React has moved on).
   */
  const installReady = useCallback(
    (key: string, ready: Ready): boolean => {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (!tab) {
        void ready.pdf.loadingTask.destroy();
        return false;
      }
      const replaced = tab.pdf && tab.pdf !== ready.pdf ? tab.pdf : null;
      updateTab(key, ready);
      if (replaced) setTimeout(() => void replaced.loadingTask.destroy(), 0);
      return true;
    },
    [updateTab],
  );

  const showDocument = useCallback(
    async (opened: OpenedDocument) => {
      const { fileId: id, path } = opened.info;
      const sameContents = tabsRef.current.find((t) => t.fileId === id);
      if (sameContents?.status === "ready") {
        setActiveKey(sameContents.key);
        return;
      }
      // Same file whose contents changed (a new version saved over it), or a
      // restored tab not loaded yet: load into that tab rather than open a second.
      const target = sameContents ?? tabsRef.current.find((t) => t.path && t.path === path);
      const ready = await prepare(opened);
      if (target && installReady(target.key, ready)) {
        setActiveKey(target.key);
      } else {
        // Opened twice in quick succession: keep the first.
        const duplicate = tabsRef.current.find((t) => t.fileId === id && t.status === "ready");
        if (duplicate) {
          void ready.pdf.loadingTask.destroy();
          setActiveKey(duplicate.key);
          return;
        }
        const key = newTabKey();
        const tab: Tab = { key, ...ready };
        tabsRef.current = [...tabsRef.current, tab];
        setTabs((prev) => [...prev, tab]);
        setActiveKey(key);
      }
      setError(null);
      refreshRecent();
    },
    [prepare, installReady, refreshRecent],
  );

  const openFile = useCallback(async () => {
    try {
      const opened = await pickAndOpenPdf();
      if (opened) await showDocument(opened);
    } catch (err) {
      reportError("Could not open the PDF", err);
    }
  }, [showDocument, reportError]);

  // Development in a plain browser: ?pdf=<url> opens a PDF from the dev server.
  useEffect(() => {
    if (isTauri()) return;
    const url = new URLSearchParams(window.location.search).get("pdf");
    if (url) openPdfFromUrl(url).then(showDocument, (err) => reportError(`Could not open ${url}`, err));
  }, [showDocument, reportError]);

  const openRecent = useCallback(
    async (doc: DocumentInfo) => {
      if (!doc.path) return;
      try {
        await showDocument(await openPdfAtPath(doc.path));
      } catch (err) {
        reportError(`Could not open ${doc.name}`, err);
      }
    },
    [showDocument, reportError],
  );

  // Tabs restored from the last session load only when first shown.
  useEffect(() => {
    if (!activeTab || activeTab.status !== "unloaded" || !activeTab.path) return;
    const { key, path, name } = activeTab;
    updateTab(key, { status: "loading" });
    openPdfAtPath(path)
      .then(prepare)
      .then((ready) => {
        if (installReady(key, ready)) refreshRecent();
      })
      .catch((err) => updateTab(key, { status: "error", error: `Could not open ${name}: ${err?.message ?? err}` }));
  }, [activeTab, prepare, updateTab, installReady, refreshRecent]);

  // ---- Positions and session ---------------------------------------------

  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Note drafts in open popovers, saved before the window closes. */
  const draftFlushers = useRef(new Set<() => Promise<void> | void>());
  const registerFlush = useCallback((flush: () => Promise<void> | void) => {
    draftFlushers.current.add(flush);
    return () => void draftFlushers.current.delete(flush);
  }, []);
  const annotationsSettled = useRef<() => Promise<void>>(async () => {});
  const persistPosition = useCallback(async (tab: Tab) => {
    const view = views.current.get(tab.key);
    if (!tab.workId || !view) return;
    await savePosition(tab.workId, encodePosition({ anchor: view.anchor, zoom: tab.zoom })).catch((e) =>
      console.error("Could not save the reading position", e),
    );
  }, []);

  // Saves are delayed while scrolling; write any pending ones before the
  // window closes (Ctrl+Q, File > Quit or the close button).
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let disposed = false;
    onWindowClose(async () => {
      // Unsaved note drafts first, then everything queued for the library.
      await Promise.all([...draftFlushers.current].map((flush) => flush()));
      await annotationsSettled.current();
      const pending = [...saveTimers.current.keys()];
      saveTimers.current.forEach((timer) => clearTimeout(timer));
      saveTimers.current.clear();
      await Promise.all(
        pending.map((key) => {
          const tab = tabsRef.current.find((t) => t.key === key);
          return tab ? persistPosition(tab) : undefined;
        }),
      );
    })
      .then((u) => (disposed ? u() : (unsubscribe = u)))
      .catch((e) => console.error("Could not watch for the window closing", e));
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [persistPosition]);

  const onViewChange = useCallback(
    (key: string, view: ViewState) => {
      views.current.set(key, view);
      setStatus((prev) => (prev?.page === view.page && prev.zoom === view.zoom ? prev : { page: view.page, zoom: view.zoom }));
      clearTimeout(saveTimers.current.get(key));
      saveTimers.current.set(
        key,
        setTimeout(() => {
          saveTimers.current.delete(key);
          const tab = tabsRef.current.find((t) => t.key === key);
          if (tab) void persistPosition(tab);
        }, SAVE_POSITION_MS),
      );
    },
    [persistPosition],
  );

  useEffect(() => {
    let cancelled = false;
    getState("session")
      .then(async (json) => {
        if (cancelled) return;
        const session = decodeSession(json);
        if (json && !session) {
          // Unreadable (e.g. written by a newer version): keep a copy rather than
          // silently replacing it with an empty session.
          console.warn("Saved session could not be read; keeping a backup", json);
          await setState("session.unreadable", json);
        }
        if (session && session.tabs.length) {
          const restored: Tab[] = session.tabs.map((t) => ({
            key: newTabKey(),
            path: t.path,
            name: t.name,
            fileId: null,
            workId: null,
            pdf: null,
            status: "unloaded",
            zoom: DEFAULT_ZOOM,
            initialAnchor: null,
            labels: null,
            citekey: null,
            citekeyDeclined: null,
          }));
          // Keep anything the user opened while the session was loading.
          const openPaths = new Set(tabsRef.current.map((t) => t.path));
          const added = restored.filter((t) => !openPaths.has(t.path));
          setTabs((prev) => [...added, ...prev]);
          setActiveKey((current) => current ?? restored[session.active]?.key ?? null);
        }
        if (session) {
          setOutlineOpen(session.outlineOpen);
          setAnnotationsOpen(session.annotationsOpen);
        }
      })
      .catch((e) => console.error("Could not restore the session", e))
      .finally(() => {
        if (!cancelled) setSessionLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionLoaded) return;
    // Tabs that failed to open stay in the session: the file may be on a
    // drive or synced folder that is only temporarily unavailable.
    const saved = tabs.filter((t) => t.path);
    const json = encodeSession({
      tabs: saved.map((t) => ({ path: t.path!, name: t.name })),
      active: Math.max(0, saved.findIndex((t) => t.key === activeKey)),
      outlineOpen,
      annotationsOpen,
    });
    setState("session", json).catch((e) => console.error("Could not save the session", e));
  }, [tabs, activeKey, outlineOpen, annotationsOpen, sessionLoaded]);

  const closeTab = useCallback(
    (key: string) => {
      const list = tabsRef.current;
      const index = list.findIndex((t) => t.key === key);
      if (index === -1) return;
      const tab = list[index];
      clearTimeout(saveTimers.current.get(key));
      saveTimers.current.delete(key);
      void persistPosition(tab);
      views.current.delete(key);
      void tab.pdf?.loadingTask.destroy();
      const remaining = list.filter((t) => t.key !== key);
      setTabs(remaining);
      setActiveKey((current) =>
        current === key ? (remaining[Math.min(index, remaining.length - 1)]?.key ?? null) : current,
      );
    },
    [persistPosition],
  );

  // ---- Bibliography entries ------------------------------------------------------

  /** Updates a tab after its file was linked to an entry (and maybe joined another paper). */
  const applyLink = useCallback(
    async (key: string, info: DocumentInfo) => {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (!tab || tab.fileId !== info.fileId) return;
      // Switch to the paper the file now belongs to at once, so nothing made
      // meanwhile lands on a work it has left.
      updateTab(key, {
        workId: info.workId,
        citekey: info.citekey ?? null,
        citekeyDeclined: info.citekeyDeclined ?? null,
      });
      refreshRecent();
      // Joined another paper's work: check it's the same paper, as for a new version.
      if (info.previousVersion && tab.pdf) {
        const pendingVersion = await checkVersion(tab.pdf, info);
        if (pendingVersion && tabsRef.current.find((t) => t.key === key)?.fileId === info.fileId) updateTab(key, { pendingVersion });
      }
    },
    [checkVersion, updateTab, refreshRecent],
  );

  const linkTab = useCallback(
    (tab: Tab, citekey: string): Promise<void> => {
      if (!tab.fileId || !tab.workId) return Promise.resolve();
      // In a plain browser nothing is stored: just show the entry.
      const linked = isTauri()
        ? linkCitekey(tab.fileId, citekey)
        : Promise.resolve<DocumentInfo>({ fileId: tab.fileId, workId: tab.workId, path: tab.path, name: tab.name, size: 0, lastOpened: 0, citekey });
      return linked.then((info) => applyLink(tab.key, info));
    },
    [applyLink],
  );

  // Papers not yet linked (or linked to an entry since removed) are matched
  // to the bibliography by JabRef's file field, then by file name. Each
  // file/entry pair is tried once per session.
  const linkAttempts = useRef(new Set<string>());
  useEffect(() => {
    if (!bibliography) return;
    for (const tab of tabs) {
      if (tab.status !== "ready" || !tab.fileId || tab.pendingVersion) continue;
      if (tab.citekey && bibliography.get(tab.citekey)) continue;
      const match = bibliography.match(tab.path ?? tab.name);
      if (!match || match.citekey === tab.citekey || match.citekey === tab.citekeyDeclined) continue;
      const attempt = `${tab.fileId}:${match.citekey}`;
      if (linkAttempts.current.has(attempt)) continue;
      linkAttempts.current.add(attempt);
      linkTab(tab, match.citekey).catch((e) => console.warn(`Could not link ${tab.name} to ${match.citekey}`, e));
    }
  }, [tabs, bibliography, linkTab]);

  // ---- Outline, search, status --------------------------------------------

  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  useEffect(() => {
    setOutline(null);
    if (!activePdf) return;
    let cancelled = false;
    loadOutline(activePdf)
      .then((o) => !cancelled && setOutline(o))
      .catch(() => !cancelled && setOutline([]));
    return () => {
      cancelled = true;
    };
  }, [activePdf]);

  const currentPage = status?.page ?? 0;
  const search = useDocumentSearch(findOpen ? activePdf : null, currentPage);
  const activeMatch = search.activeMatch;
  useEffect(() => {
    if (activeMatch) void viewerRef.current?.revealRect(activeMatch.page, activeMatch.rects[0]);
  }, [activeMatch]);

  useEffect(() => {
    setStatus(activeKey ? (views.current.get(activeKey) ?? null) : null);
  }, [activeKey]);

  // ---- Annotations -------------------------------------------------------------

  const [categories, setCategories] = useState<Category[]>([]);
  const [lastCategory, setLastCategory] = useState<string | null>(null);
  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch((e) => reportError("Could not load the categories", e));
  }, [reportError]);
  const liveCategories = useMemo(() => categories.filter((c) => !c.deleted), [categories]);
  const currentCategory =
    liveCategories.find((c) => c.id === lastCategory)?.id ?? liveCategories[0]?.id ?? null;

  const activeWork = activeTab?.workId ?? null;
  const activeFile = activeTab?.fileId ?? null;
  const versionPending = !!activeTab?.pendingVersion;
  const openDoc = useMemo(
    () =>
      activePdf && activeWork && activeFile && !versionPending
        ? { workId: activeWork, fileId: activeFile, pdf: activePdf }
        : null,
    [activePdf, activeWork, activeFile, versionPending],
  );
  const notes = useAnnotations(openDoc, reportError);
  annotationsSettled.current = notes.settled;
  const activePath = activeTab?.path ?? null;
  const importDoc = useMemo(() => (openDoc ? { ...openDoc, path: activePath } : null), [openDoc, activePath]);
  // Annotations other programs saved in the PDF become Tourmaline's.
  const hiddenPdfAnnotations = usePdfImport(importDoc, notes.loaded, liveCategories, notes.importFound, reportError);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [captureMode, setCaptureMode] = useState(false);
  const [selectionEnd, setSelectionEnd] = useState<SelectionEnd | null>(null);
  /** Annotation whose note field should take focus when its popover shows. */
  const [noteFocusFor, setNoteFocusFor] = useState<string | null>(null);
  const clearNoteFocus = useCallback(() => setNoteFocusFor(null), []);
  const selected = notes.annotations.find((a) => a.id === selectedId) ?? null;

  // Nothing carries over between tabs.
  useEffect(() => {
    setSelectedId(null);
    setCaptureMode(false);
    setSelectionEnd(null);
  }, [activeKey]);
  // A deleted (or undone) annotation can't stay selected.
  useEffect(() => {
    if (selectedId && !notes.annotations.some((a) => a.id === selectedId)) setSelectedId(null);
  }, [notes.annotations, selectedId]);

  const marks = useMemo(() => {
    const byPage = new Map<number, Mark[]>();
    for (const a of notes.annotations) {
      if (!a.placement || a.placement.status === "orphan") continue;
      const colour = colourOf(a, categories);
      const rectsByPage = new Map<number, PdfRect[]>();
      for (const [page, ...rect] of a.placement.geometry.rects) {
        rectsByPage.set(page, [...(rectsByPage.get(page) ?? []), rect as PdfRect]);
      }
      for (const [page, rects] of rectsByPage) {
        const list = byPage.get(page) ?? [];
        list.push({ id: a.id, kind: a.kind, rects, colour, selected: a.id === selectedId });
        byPage.set(page, list);
      }
    }
    return byPage;
  }, [notes.annotations, categories, selectedId]);

  /** Selects an annotation and scrolls it into view. */
  const selectAnnotation = useCallback((a: Annotation | null) => {
    setSelectedId(a?.id ?? null);
    const first = a?.placement?.status !== "orphan" ? a?.placement?.geometry.rects[0] : undefined;
    if (first) {
      const [page, ...rect] = first;
      void viewerRef.current?.revealRect(page, rect as PdfRect);
    }
  }, []);

  const highlightSelection = useCallback(
    async (categoryId: string | null, withNote = false) => {
      const capture = viewerRef.current?.captureSelection();
      if (!capture) return;
      viewerRef.current?.clearSelection();
      setSelectionEnd(null);
      if (categoryId) setLastCategory(categoryId);
      const created = await notes.highlight(capture, categoryId);
      if (created && withNote) {
        setSelectedId(created.id);
        setNoteFocusFor(created.id);
      }
    },
    [notes],
  );

  const onCapture = useCallback(
    async (page: number, rect: PdfRect) => {
      setCaptureMode(false);
      const created = await notes.captureArea(page, rect, currentCategory);
      if (created) setSelectedId(created.id);
    },
    [notes, currentCategory],
  );

  const renderPopover = (a: Annotation, style?: React.CSSProperties) => (
    <AnnotationPopover
      key={a.id}
      annotation={a}
      categories={categories}
      style={style}
      focusNote={noteFocusFor === a.id}
      onNoteFocused={clearNoteFocus}
      onCategory={(categoryId) => {
        setLastCategory(categoryId);
        void notes.edit(a, { categoryId });
      }}
      onNote={(note) => notes.edit(a, { note })}
      registerFlush={registerFlush}
      onDelete={() => registry.execute("annot.delete", "other")}
      onClose={() => {
        setSelectedId(null);
        viewerRef.current?.focus();
      }}
    />
  );

  /** Popovers drawn over a page: the selection toolbar and the selected annotation. */
  const overlay = (page: number, toCss: (r: PdfRect) => { left: number; top: number; width: number; height: number }) => {
    const parts: React.ReactNode[] = [];
    if (selectionEnd?.page === page && !captureMode) {
      const r = toCss(selectionEnd.rect);
      parts.push(
        <SelectionToolbar
          key="selection"
          categories={liveCategories}
          style={{ left: r.left + r.width, top: r.top + r.height + 6 }}
          onHighlight={(id) => void highlightSelection(id)}
          onHighlightWithNote={() => void highlightSelection(currentCategory, true)}
        />,
      );
    }
    // The popover goes under the annotation's last rectangle.
    const rects = selected?.placement?.status !== "orphan" ? selected?.placement?.geometry.rects : undefined;
    const last = rects?.[rects.length - 1];
    if (selected && last && last[0] === page) {
      const [, ...rect] = last;
      const r = toCss(rect as PdfRect);
      parts.push(renderPopover(selected, { left: r.left, top: r.top + r.height + 6 }));
    }
    return parts;
  };

  // ---- Links and the vault -------------------------------------------------------

  /** A highlight or page to show once a tourmaline:// link's paper is open. */
  const [pendingReveal, setPendingReveal] = useState<{ workId: string; blockId: string | null; page: number | null } | null>(
    null,
  );

  const openReaderLink = useCallback(
    async (url: string) => {
      try {
        const link = parseReaderLink(url);
        if (!link) throw new Error(`${url} isn't a link Tourmaline understands`);
        const doc = await locateWork(link.workId, link.blockId);
        if (!doc?.path) throw new Error("its paper isn't in the library, or its file has moved");
        await showDocument(await openPdfAtPath(doc.path));
        setPendingReveal({ workId: doc.workId, blockId: link.blockId, page: link.page });
      } catch (e) {
        reportError("Could not open the link", e);
      }
    },
    [showDocument, reportError],
  );

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let disposed = false;
    onReaderLinks((url) => void openReaderLink(url))
      .then((u) => (disposed ? u() : (unsubscribe = u)))
      .catch((e) => console.error("Could not listen for tourmaline:// links", e));
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [openReaderLink]);

  // Once the linked paper is showing with its annotations, go to the target.
  useEffect(() => {
    const target = pendingReveal;
    if (!target || activeTab?.workId !== target.workId || !activePdf || !notes.loaded) return;
    setPendingReveal(null);
    const a = target.blockId ? notes.annotations.find((x) => x.blockId === target.blockId) : undefined;
    if (a) {
      selectAnnotation(a);
      // Orphans aren't on a page: show them in the sidebar.
      if (!a.placement || a.placement.status === "orphan") setAnnotationsOpen(true);
    } else if (target.page) {
      viewerRef.current?.goToPage(target.page - 1);
    } else if (target.blockId) {
      setError(`The highlight ${target.blockId} is no longer in ${activeTab.name}; it may have been deleted.`);
    }
  }, [pendingReveal, activeTab, activePdf, notes.loaded, notes.annotations, selectAnnotation]);

  const pageLabelOf = (tab: Tab | null, a: Annotation) => {
    const page = a.placement && a.placement.status !== "orphan" ? a.placement.page : null;
    return page === null ? "?" : (tab?.labels?.[page] ?? String(page + 1));
  };

  const copyAnnotation = async (as: "markdown" | "link") => {
    const { selected: a, activeTab: tab } = latest.current;
    if (!a) return;
    try {
      if (as === "link") {
        await copyText(readerLink(a.workId, { blockId: a.blockId }));
        setNotice("Copied a link to the annotation");
        return;
      }
      const entry = tab?.citekey ? bibliography?.get(tab.citekey) : undefined;
      const markdown = renderHighlight(exportSettings.highlightTemplate, {
        annotation: a,
        category: categories.find((c) => c.id === a.categoryId),
        pageLabel: pageLabelOf(tab, a),
        entry: entry ? citationVariables(entry) : undefined,
        fileName: tab?.name,
      });
      await copyText(markdown);
      setNotice("Copied as Markdown: paste it into a note");
    } catch (e) {
      reportError("Could not copy the annotation", e);
    }
  };

  const openLiteratureNote = async () => {
    const tab = latest.current.activeTab;
    if (!tab?.citekey || !vaultSettings) return;
    try {
      const entry = bibliography?.get(tab.citekey);
      const path = literatureNotePath(vaultSettings.citations, entry ? citationVariables(entry) : { citekey: tab.citekey });
      if (!vault || !(await vaultFileExists(vault, path))) {
        setNotice(`There is no literature note at ${path} yet.`);
        return;
      }
      await openInObsidian(obsidianUrl(vaultSettings.name, path));
    } catch (e) {
      reportError("Could not open the literature note", e);
    }
  };

  // ---- Saving annotations into the PDF ----------------------------------------

  /** Whether the user said not to ask before writing into PDFs. */
  const [writeBackConfirmed, setWriteBackConfirmed] = useState(false);
  useEffect(() => {
    getState("writeback.confirmed")
      .then((v) => setWriteBackConfirmed(v === "yes"))
      .catch(() => {});
  }, []);

  /** Set while a save runs: a second Ctrl+S waits for nothing and does nothing. */
  const saving = useRef(false);
  const saveIntoPdf = async () => {
    const tab = latest.current.activeTab;
    if (!tab?.path || !tab.fileId || !tab.workId || tab.pendingVersion || saving.current) return;
    saving.current = true;
    try {
      // Notes still being typed, and every queued change, go in too.
      await Promise.all([...draftFlushers.current].map((flush) => flush()));
      await latest.current.notes.settled();
      // The annotations shown are the active tab's: stop if that changed meanwhile.
      const now = latest.current;
      if (now.activeTab?.key !== tab.key || now.activeTab.fileId !== tab.fileId || !now.notes.loaded) {
        setNotice("Nothing was saved: the tab changed. Save again when it has loaded.");
        return;
      }
      const list = annotationsToWrite(
        now.notes.current().filter((a) => a.workId === tab.workId),
        categories,
      );
      const info = await saveAnnotationsToPdf(tab.path, tab.fileId, tab.workId, list);
      if (!info) {
        setNotice(`${tab.name} already has all its annotations.`);
        return;
      }
      // Show the file as it now is (same pages; the annotations are now in it).
      const ready = await prepare(await openPdfAtPath(tab.path));
      installReady(tab.key, ready);
      refreshRecent();
      setNotice(`Saved the annotations into ${tab.name}`);
    } catch (e) {
      reportError("Could not save the annotations into the PDF", e);
    } finally {
      saving.current = false;
    }
  };

  // ---- Exporting to the vault ----------------------------------------------------

  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);
  useEffect(() => {
    getState("export.settings")
      .then((json) => setExportSettings(parseExportSettings(json)))
      .catch((e) => console.error("Could not load the export settings", e));
  }, []);

  /** A question asked during an export, answered through `resolve`. */
  const [question, setQuestion] = useState<{ q: ExportQuestion; resolve: (yes: boolean) => void } | null>(null);
  const ask = useCallback(
    (q: ExportQuestion) =>
      new Promise<boolean>((resolve) =>
        setQuestion({
          q,
          resolve: (yes) => {
            setQuestion(null);
            resolve(yes);
          },
        }),
      ),
    [],
  );

  /** What a paper's section is made of: its annotations, entry and page labels. */
  const sectionInput = (tab: Tab, annotations: readonly Annotation[]): SectionInput => {
    const entry = tab.citekey ? bibliography?.get(tab.citekey) : undefined;
    return {
      annotations,
      categories,
      pageLabel: (page) => tab.labels?.[page] ?? String(page + 1),
      entry: entry ? citationVariables(entry) : { citekey: tab.citekey ?? "" },
      fileName: tab.name,
    };
  };

  const exporting = useRef(false);
  const exportToVault = async () => {
    const tab = latest.current.activeTab;
    if (!tab?.citekey || !tab.workId || tab.pendingVersion || !vault || !vaultSettings || exporting.current) return;
    exporting.current = true;
    try {
      // Notes still being typed, and every queued change, go in too.
      await Promise.all([...draftFlushers.current].map((flush) => flush()));
      await latest.current.notes.settled();
      const now = latest.current;
      if (now.activeTab?.key !== tab.key || now.activeTab.workId !== tab.workId || !now.notes.loaded) {
        setNotice("Nothing was exported: the tab changed. Export again when it has loaded.");
        return;
      }
      const annotations = now.notes.current().filter((a) => a.workId === tab.workId);
      const result = await runExport({
        vault,
        vaultSettings,
        settings: exportSettings,
        workId: tab.workId,
        input: sectionInput(now.activeTab, annotations),
        ask,
      });
      const what = result.count === 1 ? "1 annotation" : `${result.count} annotations`;
      if (result.status === "written") setNotice(`Exported ${what} to ${result.created ? "a new note, " : ""}${result.path}`);
      else if (result.status === "unchanged") setNotice(`${result.path} is up to date`);
      else setNotice("Nothing was exported");
    } catch (e) {
      if (e instanceof NoteFormatError) setError(`Could not export to the note: ${e.message}.`);
      else reportError("Could not export to the vault", e);
    } finally {
      exporting.current = false;
    }
  };

  // ---- Focus mode ----------------------------------------------------------------

  const [focusOn, setFocusOn] = useState(false);
  const [focusSettings, setFocusSettings] = useState<{ unit: StepUnit; eye: number }>({ unit: 1, eye: 0.35 });
  useEffect(() => {
    getState("focus.settings")
      .then((json) => {
        const v = json ? (JSON.parse(json) as { unit?: unknown; eye?: unknown }) : {};
        const unit = STEP_UNITS.find((u) => u.value === v.unit)?.value;
        const eye = EYE_HEIGHTS.find((h) => h.value === v.eye)?.value;
        setFocusSettings((prev) => ({ unit: unit ?? prev.unit, eye: eye ?? prev.eye }));
      })
      .catch((e) => console.error("Could not load the focus settings", e));
  }, []);
  /** Papers whose columns focus mode ignores (an odd layout read wrongly). */
  const [noColumns, setNoColumns] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!activeWork) return;
    getState(`focus.columns:${activeWork}`)
      .then((v) =>
        setNoColumns((prev) => {
          if (prev.has(activeWork) === (v === "off")) return prev;
          const next = new Set(prev);
          if (v === "off") next.add(activeWork);
          else next.delete(activeWork);
          return next;
        }),
      )
      .catch(() => {});
  }, [activeWork]);
  const detectColumns = !(activeWork && noColumns.has(activeWork));
  const focusActive = focusOn && activePdf !== null && !versionPending;
  const steps = useFocusSteps(activePdf, focusActive, focusSettings.unit, detectColumns, reportError);
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  /** Where to start once the steps are (re)built: the reader's eye, or the current step's place. */
  const focusAnchor = useRef<{ page: number; y: number } | null>(null);
  /** When focus mode last scrolled: a step press during its scroll doesn't count as the reader scrolling away. */
  const focusScrolledAt = useRef(0);
  const step = steps && stepIndex !== null ? (steps[stepIndex] ?? null) : null;

  // Nothing carries over between tabs.
  useEffect(() => {
    setFocusOn(false);
    setStepIndex(null);
  }, [activeKey]);

  useEffect(() => {
    if (!steps) return;
    const anchor = focusAnchor.current;
    focusAnchor.current = null;
    if (anchor) setStepIndex(steps.length ? stepAt(steps, anchor.page, anchor.y) : null);
    else setStepIndex((i) => (i === null || !steps.length ? null : Math.min(i, steps.length - 1)));
  }, [steps]);

  // The current step goes to the eye line.
  useEffect(() => {
    if (!step) return;
    const [page, ...rect] = step.rects[0];
    focusScrolledAt.current = Date.now();
    void viewerRef.current?.scrollToEye(page, rect as PdfRect, focusSettings.eye);
  }, [step, focusSettings.eye]);

  const focusRects = useMemo(() => {
    if (!focusActive || !steps) return null;
    const byPage = new Map<number, PdfRect[]>();
    for (const [page, ...rect] of step?.rects ?? []) byPage.set(page, [...(byPage.get(page) ?? []), rect as PdfRect]);
    return byPage;
  }, [focusActive, steps, step]);

  /** Starts the steps again from the current step's place (after the step size or columns change). */
  const keepFocusPlace = () => {
    const s = latest.current.step;
    if (s) focusAnchor.current = { page: s.rects[0][0], y: s.rects[0][4] + 1 };
  };

  const saveFocusSettings = (next: { unit: StepUnit; eye: number }) => {
    if (next.unit !== focusSettings.unit) keepFocusPlace();
    setFocusSettings(next);
    void setState("focus.settings", JSON.stringify(next)).catch((e) => console.error("Could not save the focus settings", e));
  };

  const setColumnsFor = (on: boolean) => {
    const work = latest.current.activeTab?.workId;
    if (!work) return;
    keepFocusPlace();
    setNoColumns((prev) => {
      const next = new Set(prev);
      if (on) next.delete(work);
      else next.add(work);
      return next;
    });
    void setState(`focus.columns:${work}`, on ? "on" : "off").catch((e) => console.error("Could not save the column setting", e));
    setNotice(on ? "Columns are detected in this paper" : "Columns are ignored in this paper: each line is read straight across");
  };

  const toggleFocus = async () => {
    if (latest.current.focusActive) {
      setFocusOn(false);
      setStepIndex(null);
      return;
    }
    // Start at the line under the eye line.
    const point = await viewerRef.current?.pointAt(latest.current.focusSettings.eye);
    focusAnchor.current = point ? { page: point.page, y: point.y } : { page: latest.current.status?.page ?? 0, y: Infinity };
    setFocusOn(true);
  };

  const moveStep = async (by: 1 | -1) => {
    const { steps: list, stepIndex: at, focusSettings: settings } = latest.current;
    if (!list?.length) return;
    const current = at === null ? null : list[at];
    // The reader scrolled elsewhere: carry on from what is at the eye line.
    if (current && Date.now() - focusScrolledAt.current > 1000) {
      const [page, ...rect] = current.rects[0];
      if (!(await viewerRef.current?.isInView(page, rect as PdfRect))) {
        const point = await viewerRef.current?.pointAt(settings.eye);
        if (point) return setStepIndex(stepAt(list, point.page, point.y));
      }
    }
    setStepIndex(at === null ? 0 : Math.min(Math.max(at + by, 0), list.length - 1));
  };

  // ---- Commands --------------------------------------------------------------

  useEffect(() => {
    ctxRef.current = {
      hasDocument: activePdf !== null,
      tabCount: tabs.length,
      findOpen: findOpen && activePdf !== null,
      modalOpen: dialog !== null || versionPending || question !== null,
      hasTextSelection: selectionEnd !== null,
      annotationSelected: selected !== null,
      captureMode,
      canUndo: notes.canUndo,
      canRedo: notes.canRedo,
      hasBibliography: bibliography !== null,
      hasCitekey: !!activeTab?.citekey,
      hasVault: vault !== null && vaultSettings !== null,
      focusMode: focusActive,
      canSaveIntoPdf: isTauri() && !!activeTab?.path && !versionPending,
    };
    registry.notifyContextChanged();
  }, [
    activePdf,
    tabs.length,
    findOpen,
    dialog,
    focusActive,
    question,
    vault,
    vaultSettings,
    versionPending,
    selectionEnd,
    selected,
    captureMode,
    notes.canUndo,
    notes.canRedo,
    bibliography,
    activeTab?.citekey,
    activeTab?.path,
    registry,
  ]);

  // Actions read the latest state through a ref, so commands register once.
  const latest = useRef({
    activeTab,
    status,
    search,
    notes,
    selected,
    currentCategory,
    highlightSelection,
    copyAnnotation,
    openLiteratureNote,
    saveIntoPdf,
    exportToVault,
    writeBackConfirmed,
    focusActive,
    focusSettings,
    steps,
    stepIndex,
    step,
    toggleFocus,
    moveStep,
    saveFocusSettings,
    setColumnsFor,
    detectColumns,
  });
  latest.current = {
    activeTab,
    status,
    search,
    notes,
    selected,
    currentCategory,
    highlightSelection,
    copyAnnotation,
    openLiteratureNote,
    saveIntoPdf,
    exportToVault,
    writeBackConfirmed,
    focusActive,
    focusSettings,
    steps,
    stepIndex,
    step,
    toggleFocus,
    moveStep,
    saveFocusSettings,
    setColumnsFor,
    detectColumns,
  };

  useEffect(() => {
    const setZoom = (make: (current: number) => ZoomSpec) => {
      const { activeTab: tab, status: s } = latest.current;
      if (tab) updateTab(tab.key, { zoom: make(s?.zoom ?? tab.zoom.zoom) });
    };
    const cycleTab = (direction: 1 | -1) => {
      const list = tabsRef.current;
      setActiveKey((current) => {
        const i = list.findIndex((t) => t.key === current);
        return list[(i + direction + list.length) % list.length]?.key ?? current;
      });
    };
    const openFind = () => {
      setFindOpen(true);
      setFindFocusToken((n) => n + 1);
    };
    const closeFind = () => {
      setFindOpen(false);
      latest.current.search.setQuery("");
      viewerRef.current?.focus();
    };

    const unregister = appCommands({
      openFile,
      chooseVault: async () => {
        try {
          const path = await chooseVault();
          if (path) setVault(path);
        } catch (e) {
          reportError("Could not use that vault", e);
        }
      },
      openRecent: () => {
        refreshRecent();
        setDialog("recent");
      },
      closeTab: () => {
        const tab = latest.current.activeTab;
        if (tab) closeTab(tab.key);
      },
      quit: quitApp,
      zoomIn: () => setZoom((z) => ({ mode: "custom", zoom: nextZoom(z, 1) })),
      zoomOut: () => setZoom((z) => ({ mode: "custom", zoom: nextZoom(z, -1) })),
      zoomReset: () => setZoom(() => ({ mode: "custom", zoom: 1 })),
      fitWidth: () => setZoom((z) => ({ mode: "fit-width", zoom: z })),
      fitPage: () => setZoom((z) => ({ mode: "fit-page", zoom: z })),
      toggleOutline: () => setOutlineOpen((open) => !open),
      showPalette: () => setDialog("palette"),
      showShortcuts: () => setDialog("shortcuts"),
      find: openFind,
      findNext: () => (latest.current.search.query ? latest.current.search.next() : openFind()),
      findPrevious: () => (latest.current.search.query ? latest.current.search.previous() : openFind()),
      closeFind,
      goToPage: () => setDialog("goto"),
      firstPage: () => viewerRef.current?.goToPage(0),
      lastPage: () => viewerRef.current?.goToPage(Number.MAX_SAFE_INTEGER),
      nextTab: () => cycleTab(1),
      previousTab: () => cycleTab(-1),
      cancel: () => {
        const ctx = registry.context();
        if (ctx.captureMode) setCaptureMode(false);
        else if (ctx.annotationSelected) setSelectedId(null);
        else if (ctx.hasTextSelection) {
          viewerRef.current?.clearSelection();
          setSelectionEnd(null);
        } else if (ctx.findOpen) closeFind();
        else if (ctx.focusMode) void latest.current.toggleFocus();
      },
      undo: async () => {
        const id = await latest.current.notes.undo();
        if (id) setSelectedId(id);
      },
      redo: async () => {
        const id = await latest.current.notes.redo();
        if (id) setSelectedId(id);
      },
      toggleAnnotations: () => setAnnotationsOpen((open) => !open),
      highlight: () => void latest.current.highlightSelection(latest.current.currentCategory),
      editNote: () => {
        if (registry.context().hasTextSelection) {
          void latest.current.highlightSelection(latest.current.currentCategory, true);
        } else if (latest.current.selected) {
          setNoteFocusFor(latest.current.selected.id);
        }
      },
      deleteAnnotation: () => {
        const a = latest.current.selected;
        if (a) void latest.current.notes.remove(a.id);
      },
      captureArea: () => {
        viewerRef.current?.clearSelection();
        setSelectionEnd(null);
        setCaptureMode((on) => !on);
        // The arrow keys place the rectangle, so the document needs focus.
        viewerRef.current?.focus();
      },
      editCategories: () => setDialog("categories"),
      linkEntry: () => setDialog("entry"),
      saveIntoPdf: () => {
        if (latest.current.writeBackConfirmed) void latest.current.saveIntoPdf();
        else setDialog("writeback");
      },
      openNote: () => latest.current.openLiteratureNote(),
      exportToVault: () => void latest.current.exportToVault(),
      exportSettings: () => setDialog("exportSettings"),
      toggleFocus: () => void latest.current.toggleFocus(),
      focusNext: () => void latest.current.moveStep(1),
      focusPrevious: () => void latest.current.moveStep(-1),
      focusStepSize: () => {
        const { focusSettings: f, saveFocusSettings: save } = latest.current;
        const i = STEP_UNITS.findIndex((u) => u.value === f.unit);
        const unit = STEP_UNITS[(i + 1) % STEP_UNITS.length];
        save({ ...f, unit: unit.value });
        setNotice(`Focus steps: ${unit.label}`);
      },
      focusEyeLine: () => {
        const { focusSettings: f, saveFocusSettings: save } = latest.current;
        const i = EYE_HEIGHTS.findIndex((h) => h.value === f.eye);
        const eye = EYE_HEIGHTS[(i + 1) % EYE_HEIGHTS.length];
        save({ ...f, eye: eye.value });
        setNotice(`Focus eye line: ${eye.label}`);
      },
      focusColumns: () => latest.current.setColumnsFor(!latest.current.detectColumns),
      copyMarkdown: () => latest.current.copyAnnotation("markdown"),
      copyLink: () => latest.current.copyAnnotation("link"),
    }).map((c) => registry.register(c));

    let uninstallMenu: (() => void) | null = null;
    let disposed = false;
    installNativeMenu(registry)
      .then((u) => (disposed ? u() : (uninstallMenu = u)))
      .catch((e) => console.error("Could not build the menu", e));

    return () => {
      disposed = true;
      uninstallMenu?.();
      unregister.forEach((u) => u());
    };
  }, [registry, openFile, closeTab, updateTab, refreshRecent, reportError]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // A modal dialog owns the keyboard; its own handlers deal with keys.
      if (document.querySelector('[aria-modal="true"]')) return;
      // In text fields only shortcuts with Ctrl/Alt/Meta, or function keys,
      // count, and never the keys used for editing and moving the caret.
      if (isTypingTarget(e.target)) {
        const functionKey = /^F\d{1,2}$/.test(e.key);
        const editingKey = /^(Home|End|Arrow\w+|PageUp|PageDown|Backspace|Delete)$/.test(e.key);
        if (editingKey || !(e.ctrlKey || e.altKey || e.metaKey || functionKey)) return;
      }
      const command = registry.commandForEvent(e);
      if (!command) return;
      const plain = !(e.ctrlKey || e.altKey || e.metaKey) && !/^F\d{1,2}$/.test(e.key);
      // A plain key whose command can't run keeps its usual meaning (the
      // arrows scroll unless focus mode is on).
      if (plain && !registry.isEnabled(command.id)) return;
      // Arrows belong to lists, trees and toolbars that have focus; they step
      // only from the document itself.
      if (/^Arrow/.test(e.key) && e.target instanceof HTMLElement && e.target !== document.body && !e.target.closest(".viewer-scroll")) {
        return;
      }
      if (command.shortcut && isTextEditingShortcut(command.shortcut)) {
        if (isTypingTarget(e.target)) return;
        // Ctrl+C, Ctrl+Z... keep their usual meaning when the command can't run
        // (Ctrl+C with text selected in the page copies the text).
        if (!registry.isEnabled(command.id)) return;
        // Text selected anywhere else (a note in the sidebar) is what Ctrl+C copies.
        if (/^[cx]$/i.test(e.key) && !(window.getSelection()?.isCollapsed ?? true)) return;
      }
      e.preventDefault();
      registry.execute(command.id, "keyboard");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [registry]);

  // One command per category: highlights the selection with it, or moves the
  // selected annotation to it. Keys 1-9 as set in Edit categories.
  useEffect(() => {
    const unregister = liveCategories.map((c, i) =>
      registry.register({
        id: `annot.category.${c.id}`,
        title: `Highlight as ${c.name}`,
        keywords: ["category", "colour", "recolour", c.callout],
        shortcut: c.hotkey ? String(c.hotkey) : undefined,
        menu: { menu: "Annotate", group: 3, order: i },
        when: (ctx) => ctx.hasDocument && (ctx.hasTextSelection || ctx.annotationSelected),
        run: (ctx) => {
          setLastCategory(c.id);
          const { selected: a, notes: n, highlightSelection: highlight } = latest.current;
          if (ctx.hasTextSelection) void highlight(c.id);
          else if (a) void n.edit(a, { categoryId: c.id });
        },
      }),
    );
    return () => unregister.forEach((u) => u());
  }, [liveCategories, registry]);

  // ---- Rendering ---------------------------------------------------------------

  const navigate = (target: Target) => void viewerRef.current?.goToTarget(target);
  const pageCount = activePdf?.numPages ?? 0;
  const pageLabel = activeTab?.labels?.[currentPage];
  const activeKeyForView = activeTab?.key;
  const handleViewChange = useCallback(
    (v: ViewState) => activeKeyForView && onViewChange(activeKeyForView, v),
    [activeKeyForView, onViewChange],
  );
  const handleZoomStep = useCallback(
    (d: 1 | -1) => registry.execute(d === 1 ? "view.zoomIn" : "view.zoomOut", "other"),
    [registry],
  );

  return (
    <div className="app">
      <Toolbar registry={registry}>
        {activePdf && status && (
          <>
            <button
              type="button"
              className="toolbar-text-button"
              onClick={() => registry.execute("nav.goToPage", "toolbar")}
              title="Go to page (Ctrl+G)"
              aria-label={`Page ${currentPage + 1} of ${pageCount}. Go to page`}
            >
              {pageLabel && pageLabel !== String(currentPage + 1) ? `${pageLabel} (${currentPage + 1})` : currentPage + 1} /{" "}
              {pageCount}
            </button>
            <span className="toolbar-status">{Math.round(status.zoom * 100)}%</span>
          </>
        )}
        {activePdf && activeTab && bibliography && (
          <button
            type="button"
            className={`toolbar-text-button toolbar-citekey${activeTab.citekey ? "" : " unlinked"}`}
            onClick={() => registry.execute("file.linkEntry", "toolbar")}
            title={
              activeTab.citekey
                ? `${bibliography.get(activeTab.citekey)?.fields.title ?? "Not in the bibliography any more"}. Link to another entry…`
                : "Link to bibliography entry…"
            }
            aria-label={
              activeTab.citekey
                ? `Bibliography entry ${activeTab.citekey}. Link to another entry`
                : "Not linked to a bibliography entry. Link to bibliography entry"
            }
          >
            {activeTab.citekey ? `@${activeTab.citekey}` : "No entry"}
          </button>
        )}
      </Toolbar>
      <TabBar
        tabs={tabs.map((t) => ({ key: t.key, title: t.name, detail: t.path }))}
        activeKey={activeKey}
        onActivate={setActiveKey}
        onClose={closeTab}
      />
      {error && (
        <div className="error" role="alert">
          {error}
          <button type="button" className="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      <div className="notice-region" role="status" aria-live="polite">
        {notice && <span className="notice">{notice}</span>}
      </div>
      <div className={captureMode ? "workspace capturing" : "workspace"}>
        {activePdf && outlineOpen && (
          <aside className="sidebar" aria-label="Outline">
            <h2 className="sidebar-heading">Outline</h2>
            <OutlinePanel outline={outline} onNavigate={navigate} />
          </aside>
        )}
        <main className="document-area">
          {activePdf && findOpen && (
            <FindBar
              query={search.query}
              onQueryChange={search.setQuery}
              count={search.matches.length}
              active={search.active}
              status={search.status}
              onNext={() => registry.execute("nav.findNext", "other")}
              onPrevious={() => registry.execute("nav.findPrevious", "other")}
              onClose={() => registry.execute("nav.closeFind", "other")}
              focusToken={findFocusToken}
            />
          )}
          {activeTab && activePdf ? (
            <PdfViewer
              key={`${activeTab.key}:${activeTab.fileId}`}
              doc={activePdf}
              name={activeTab.name}
              zoom={activeTab.zoom}
              initialAnchor={views.current.get(activeTab.key)?.anchor ?? activeTab.initialAnchor}
              highlights={findOpen ? search.highlights : undefined}
              onViewChange={handleViewChange}
              onZoomStep={handleZoomStep}
              handleRef={viewerRef}
              marks={marks}
              onMarkClick={(id) => {
                setSelectedId(id);
                // Keep keyboard shortcuts (Delete, N, 1-9) working after a click.
                viewerRef.current?.focus();
              }}
              captureMode={captureMode}
              onCapture={onCapture}
              onSelectionChange={setSelectionEnd}
              overlay={overlay}
              hiddenAnnotations={hiddenPdfAnnotations}
              focus={focusRects}
              onPageClick={(page, x, y) => {
                if (!focusActive || !steps) return;
                const i = stepUnder(steps, page, x, y);
                if (i !== -1) setStepIndex(i);
              }}
            />
          ) : activeTab ? (
            <div className="tab-placeholder" role={activeTab.status === "error" ? "alert" : "status"}>
              {activeTab.status === "error" ? activeTab.error : `Opening ${activeTab.name}…`}
            </div>
          ) : (
            <Welcome recent={recent} onOpen={() => registry.execute("file.open", "other")} onOpenRecent={openRecent} />
          )}
          {captureMode && (
            <div className="capture-hint" role="status">
              Drag over the page, or use the arrow keys (Shift+arrows to resize) and Enter, to capture an area. Escape
              or A to stop.
            </div>
          )}
          {focusActive && (
            <FocusBar
              unit={focusSettings.unit}
              eye={focusSettings.eye}
              detectColumns={detectColumns}
              position={
                !steps
                  ? "Finding the lines…"
                  : steps.length === 0
                    ? "No text to step through"
                    : `Step ${(stepIndex ?? 0) + 1} of ${steps.length}`
              }
              announcement={step ? (step.kind === "figure" ? "Figure" : step.text) : ""}
              onUnit={(unit) => saveFocusSettings({ ...focusSettings, unit })}
              onEye={(eye) => saveFocusSettings({ ...focusSettings, eye })}
              onColumns={setColumnsFor}
              onPrevious={() => registry.execute("focus.previous", "other")}
              onNext={() => registry.execute("focus.next", "other")}
              onExit={() => registry.execute("view.focusMode", "other")}
            />
          )}
        </main>
        {activePdf && annotationsOpen && (
          <aside className="sidebar right" aria-label="Annotations">
            <h2 className="sidebar-heading">Annotations</h2>
            <AnnotationsPanel
              key={activeWork ?? ""}
              annotations={notes.annotations}
              categories={categories}
              selectedId={selectedId}
              reanchoring={notes.reanchoring}
              pageLabel={(p) => activeTab?.labels?.[p] ?? String(p + 1)}
              onSelect={(id) => selectAnnotation(notes.annotations.find((a) => a.id === id) ?? null)}
              onEditNote={() => registry.execute("annot.editNote", "other")}
              inlineEditor={
                selected && (!selected.placement || selected.placement.status === "orphan")
                  ? renderPopover(selected)
                  : undefined
              }
            />
          </aside>
        )}
      </div>
      {dialog === "palette" && <CommandPalette registry={registry} onClose={() => setDialog(null)} />}
      {dialog === "shortcuts" && <ShortcutsDialog registry={registry} onClose={() => setDialog(null)} />}
      {dialog === "recent" && <RecentDialog recent={recent} onOpen={openRecent} onClose={() => setDialog(null)} />}
      {activeTab?.pendingVersion && activeTab.fileId && (
        <VersionDialog
          name={activeTab.name}
          onSame={() => {
            const { key, fileId, pendingVersion } = activeTab;
            updateTab(key, { pendingVersion: null });
            void setTextSample(fileId!, pendingVersion!.sample).catch((e) => reportError("Could not save the answer", e));
          }}
          onDifferent={() => {
            const { key, fileId, pendingVersion } = activeTab;
            detachFile(fileId!, pendingVersion!.sample)
              .then((info) => {
                updateTab(key, {
                  workId: info.workId,
                  citekey: info.citekey ?? null,
                  citekeyDeclined: info.citekeyDeclined ?? null,
                  pendingVersion: null,
                });
                refreshRecent();
              })
              .catch((e) => reportError("Could not separate the papers", e));
          }}
        />
      )}
      {dialog === "writeback" && activeTab && (
        <WriteBackDialog
          name={activeTab.name}
          count={annotationsToWrite(notes.annotations, categories).length}
          onSave={(dontAskAgain) => {
            setDialog(null);
            if (dontAskAgain) {
              setWriteBackConfirmed(true);
              void setState("writeback.confirmed", "yes").catch((e) => console.error("Could not save the setting", e));
            }
            void saveIntoPdf();
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === "exportSettings" && (
        <ExportSettingsDialog
          settings={exportSettings}
          preview={activeTab && activeTab.workId === activeWork ? sectionInput(activeTab, notes.annotations) : null}
          citations={vaultSettings?.citations ?? null}
          onSave={(next) => {
            setDialog(null);
            setExportSettings(next);
            void setState("export.settings", JSON.stringify(next)).catch((e) => reportError("Could not save the export settings", e));
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {question?.q.kind === "edited" && (
        <ConfirmDialog
          title="Replace your edits?"
          confirmLabel="Replace"
          danger
          onConfirm={() => question.resolve(true)}
          onCancel={() => question.resolve(false)}
        >
          <p>
            The Tourmaline section of <code>{question.q.path}</code> has been edited since Tourmaline last wrote it.
            Exporting replaces the whole section with the annotations as they are in Tourmaline.
          </p>
          <p className="muted">
            The section is everything between <code>%% tourmaline:begin %%</code> and <code>%% tourmaline:end %%</code>;
            the rest of the note is never changed. To keep what you wrote there, cancel and move it out of the section
            first.
          </p>
        </ConfirmDialog>
      )}
      {question?.q.kind === "links" && (
        <ConfirmDialog
          title="Remove highlights that notes link to?"
          confirmLabel="Remove them"
          danger
          onConfirm={() => question.resolve(true)}
          onCancel={() => question.resolve(false)}
        >
          <p>These highlights were deleted in Tourmaline, but notes link to them, and those links will stop working:</p>
          <ul className="link-list">
            {question.q.links.map((l) => (
              <li key={`${l.path}#${l.blockId}`}>
                <code>^{l.blockId}</code> from <code>{l.path}</code>
              </li>
            ))}
          </ul>
          <p className="muted">To keep them, cancel and undo the deletion (Edit › Undo) before exporting.</p>
        </ConfirmDialog>
      )}
      {dialog === "entry" && bibliography && activeTab && (
        <EntryPicker
          bibliography={bibliography}
          current={activeTab.citekey}
          fileName={activeTab.name}
          onPick={(citekey) => {
            linkTab(activeTab, citekey).catch((e) => reportError(`Could not link ${activeTab.name} to ${citekey}`, e));
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "categories" && (
        <CategoriesDialog
          categories={categories}
          onSave={async (list) => setCategories(await saveCategories(list))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "goto" && activePdf && (
        <GoToPageDialog
          pageCount={pageCount}
          current={currentPage}
          labels={activeTab?.labels ?? null}
          onGo={(page) => viewerRef.current?.goToPage(page)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
