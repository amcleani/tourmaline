import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { CommandRegistry, isTypingTarget, type CommandContext } from "./commands/registry";
import { appCommands } from "./commands/appCommands";
import { DEFAULT_ZOOM, decodePosition, decodeSession, encodePosition, encodeSession } from "./app/session";
import { nextZoom, type Anchor } from "./pdf/layout";
import { loadPdf } from "./pdf/loader";
import { loadOutline, type OutlineNode, type Target } from "./pdf/outline";
import { PdfViewer, type ViewState, type ViewerHandle, type ZoomSpec } from "./pdf/PdfViewer";
import { useDocumentSearch } from "./pdf/useSearch";
import {
  getState,
  onWindowClose,
  openPdfAtPath,
  pickAndOpenPdf,
  quitApp,
  recentDocuments,
  savePosition,
  setState,
  type DocumentInfo,
  type OpenedDocument,
} from "./platform";
import { installNativeMenu } from "./platform/menu";
import { CommandPalette } from "./ui/CommandPalette";
import { FindBar } from "./ui/FindBar";
import { GoToPageDialog } from "./ui/GoToPageDialog";
import { OutlinePanel } from "./ui/OutlinePanel";
import { RecentDialog } from "./ui/RecentDialog";
import { ShortcutsDialog } from "./ui/ShortcutsDialog";
import { TabBar } from "./ui/TabBar";
import { Toolbar } from "./ui/Toolbar";
import { Welcome } from "./ui/Welcome";

interface Tab {
  /** Stable React key for the tab; not the document id (that can change if the file changes). */
  key: string;
  path: string | null;
  name: string;
  docId: string | null;
  pdf: PDFDocumentProxy | null;
  status: "unloaded" | "loading" | "ready" | "error";
  error?: string;
  zoom: ZoomSpec;
  initialAnchor: Anchor | null;
  labels: string[] | null;
}

type Dialog = "palette" | "shortcuts" | "goto" | "recent" | null;

const SAVE_POSITION_MS = 800;
let tabCounter = 0;
const newTabKey = () => `tab${++tabCounter}`;

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
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

  const ctxRef = useRef<CommandContext>({ hasDocument: false, tabCount: 0, findOpen: false, modalOpen: false });
  const registry = useMemo(() => new CommandRegistry(() => ctxRef.current), []);

  const updateTab = useCallback((key: string, patch: Partial<Tab>) => {
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }, []);

  const reportError = useCallback((what: string, err: unknown) => {
    console.error(what, err);
    setError(`${what}: ${err instanceof Error ? err.message : String(err)}`);
  }, []);

  const refreshRecent = useCallback(() => {
    recentDocuments().then(setRecent).catch((e) => console.error("Could not load recent documents", e));
  }, []);
  useEffect(refreshRecent, [refreshRecent]);

  // ---- Opening and loading documents -------------------------------------

  /** Turns freshly read bytes into a ready tab state. */
  const prepare = useCallback(async (opened: OpenedDocument) => {
    const pdf = await loadPdf(opened.bytes);
    const labels = await pdf.getPageLabels().catch(() => null);
    const saved = decodePosition(opened.info.lastPosition);
    return {
      pdf,
      labels,
      docId: opened.info.id,
      path: opened.info.path,
      name: opened.info.name,
      status: "ready" as const,
      error: undefined,
      zoom: saved?.zoom ?? DEFAULT_ZOOM,
      initialAnchor: saved?.anchor ?? null,
    };
  }, []);

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
      const { id, path } = opened.info;
      const sameContents = tabsRef.current.find((t) => t.docId === id);
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
        const duplicate = tabsRef.current.find((t) => t.docId === id && t.status === "ready");
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
  const persistPosition = useCallback(async (tab: Tab) => {
    const view = views.current.get(tab.key);
    if (!tab.docId || !view) return;
    await savePosition(tab.docId, encodePosition({ anchor: view.anchor, zoom: tab.zoom })).catch((e) =>
      console.error("Could not save the reading position", e),
    );
  }, []);

  // Saves are delayed while scrolling; write any pending ones before the
  // window closes (Ctrl+Q, File > Quit or the close button).
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let disposed = false;
    onWindowClose(async () => {
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
            docId: null,
            pdf: null,
            status: "unloaded",
            zoom: DEFAULT_ZOOM,
            initialAnchor: null,
            labels: null,
          }));
          // Keep anything the user opened while the session was loading.
          const openPaths = new Set(tabsRef.current.map((t) => t.path));
          const added = restored.filter((t) => !openPaths.has(t.path));
          setTabs((prev) => [...added, ...prev]);
          setActiveKey((current) => current ?? restored[session.active]?.key ?? null);
        }
        if (session) setOutlineOpen(session.outlineOpen);
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
    });
    setState("session", json).catch((e) => console.error("Could not save the session", e));
  }, [tabs, activeKey, outlineOpen, sessionLoaded]);

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

  // ---- Commands --------------------------------------------------------------

  useEffect(() => {
    ctxRef.current = {
      hasDocument: activePdf !== null,
      tabCount: tabs.length,
      findOpen: findOpen && activePdf !== null,
      modalOpen: dialog !== null,
    };
    registry.notifyContextChanged();
  }, [activePdf, tabs.length, findOpen, dialog, registry]);

  // Actions read the latest state through a ref, so commands register once.
  const latest = useRef({ activeTab, status, search });
  latest.current = { activeTab, status, search };

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
  }, [registry, openFile, closeTab, updateTab, refreshRecent]);

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
      e.preventDefault();
      registry.execute(command.id, "keyboard");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [registry]);

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
      <div className="workspace">
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
              key={`${activeTab.key}:${activeTab.docId}`}
              doc={activePdf}
              name={activeTab.name}
              zoom={activeTab.zoom}
              initialAnchor={views.current.get(activeTab.key)?.anchor ?? activeTab.initialAnchor}
              highlights={findOpen ? search.highlights : undefined}
              onViewChange={handleViewChange}
              onZoomStep={handleZoomStep}
              handleRef={viewerRef}
            />
          ) : activeTab ? (
            <div className="tab-placeholder" role={activeTab.status === "error" ? "alert" : "status"}>
              {activeTab.status === "error" ? activeTab.error : `Opening ${activeTab.name}…`}
            </div>
          ) : (
            <Welcome recent={recent} onOpen={() => registry.execute("file.open", "other")} onOpenRecent={openRecent} />
          )}
        </main>
      </div>
      {dialog === "palette" && <CommandPalette registry={registry} onClose={() => setDialog(null)} />}
      {dialog === "shortcuts" && <ShortcutsDialog registry={registry} onClose={() => setDialog(null)} />}
      {dialog === "recent" && <RecentDialog recent={recent} onOpen={openRecent} onClose={() => setDialog(null)} />}
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
