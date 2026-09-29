import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { CommandRegistry, isTypingTarget, type CommandContext } from "./commands/registry";
import { appCommands, nextZoom } from "./commands/appCommands";
import { loadPdf } from "./pdf/loader";
import { PdfViewer } from "./pdf/PdfViewer";
import {
  openPdfAtPath,
  pickAndOpenPdf,
  quitApp,
  recentDocuments,
  type DocumentInfo,
  type OpenedDocument,
} from "./platform";
import { installNativeMenu } from "./platform/menu";
import { CommandPalette } from "./ui/CommandPalette";
import { ShortcutsDialog } from "./ui/ShortcutsDialog";
import { Toolbar } from "./ui/Toolbar";
import { Welcome } from "./ui/Welcome";

interface OpenDoc {
  info: DocumentInfo;
  pdf: PDFDocumentProxy;
}

export function App() {
  const [current, setCurrent] = useState<OpenDoc | null>(null);
  const [zoom, setZoom] = useState(1);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [recent, setRecent] = useState<DocumentInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<CommandContext>({ hasDocument: false });
  const registry = useMemo(() => new CommandRegistry(() => ctxRef.current), []);

  const refreshRecent = useCallback(() => {
    recentDocuments().then(setRecent).catch((e) => console.error("Could not load recent documents", e));
  }, []);

  const showDocument = useCallback(
    async (opened: OpenedDocument) => {
      const pdf = await loadPdf(opened.bytes);
      setCurrent({ info: opened.info, pdf });
      setError(null);
      refreshRecent();
    },
    [refreshRecent],
  );

  const reportError = useCallback((what: string, err: unknown) => {
    console.error(what, err);
    setError(`${what}: ${err instanceof Error ? err.message : String(err)}`);
  }, []);

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

  // Keep the command context in sync with app state.
  useEffect(() => {
    ctxRef.current = { hasDocument: current !== null };
    registry.notifyContextChanged();
  }, [current, registry]);

  useEffect(refreshRecent, [refreshRecent]);

  // Free the pdf.js document (and its worker memory) once it is replaced or closed.
  useEffect(() => {
    if (!current) return;
    return () => void current.pdf.loadingTask.destroy();
  }, [current]);

  // Register commands once. Actions read state through setState callbacks, so
  // they never go stale.
  useEffect(() => {
    const unregister = appCommands({
      openFile,
      closeDocument: () => setCurrent(null),
      quit: quitApp,
      zoomIn: () => setZoom((z) => nextZoom(z, 1)),
      zoomOut: () => setZoom((z) => nextZoom(z, -1)),
      zoomReset: () => setZoom(1),
      showPalette: () => {
        setShortcutsOpen(false);
        setPaletteOpen(true);
      },
      showShortcuts: () => {
        setPaletteOpen(false);
        setShortcutsOpen(true);
      },
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
  }, [registry, openFile]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // In text fields, only shortcuts with Ctrl/Alt/Meta count.
      if (isTypingTarget(e.target) && !(e.ctrlKey || e.altKey || e.metaKey)) return;
      const command = registry.commandForEvent(e);
      if (!command) return;
      e.preventDefault();
      registry.execute(command.id, "keyboard");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [registry]);

  return (
    <div className="app">
      <Toolbar registry={registry}>
        {current && (
          <span className="toolbar-status" aria-live="polite">
            {current.info.name} · {current.pdf.numPages} pages · {Math.round(zoom * 100)}%
          </span>
        )}
      </Toolbar>
      {error && (
        <div className="error" role="alert">
          {error}
          <button type="button" className="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {current ? (
        <PdfViewer key={current.info.id} doc={current.pdf} name={current.info.name} zoom={zoom} />
      ) : (
        <Welcome recent={recent} onOpen={() => registry.execute("file.open", "other")} onOpenRecent={openRecent} />
      )}
      {paletteOpen && <CommandPalette registry={registry} onClose={() => setPaletteOpen(false)} />}
      {shortcutsOpen && <ShortcutsDialog registry={registry} onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
