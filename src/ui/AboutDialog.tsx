import { useEffect, useRef, useState } from "react";
import type { UpdateStatus } from "../app/useUpdates";
import { appVersion } from "../platform";

interface Props {
  status: UpdateStatus;
  onCheck: () => void;
  onInstall: () => void;
  auto: boolean;
  onAutoChange: (on: boolean) => void;
  onClose: () => void;
}

function describe(status: UpdateStatus): string {
  switch (status.kind) {
    case "idle":
      return "";
    case "checking":
      return "Checking for updates…";
    case "current":
      return "Tourmaline is up to date.";
    case "available":
      return `Tourmaline ${status.update.version} is available.`;
    case "installing":
      return status.progress === null
        ? `Getting Tourmaline ${status.version}…`
        : `Getting Tourmaline ${status.version}: ${Math.round(status.progress * 100)}%`;
    case "failed":
      return `Couldn't check for updates: ${status.message}`;
  }
}

// Help › About Tourmaline (and Check for updates): the version, updates and
// whether to look for them when Tourmaline starts.
export function AboutDialog({ status, onCheck, onInstall, auto, onAutoChange, onClose }: Props) {
  const [version, setVersion] = useState<string | null>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    appVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    firstRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const installing = status.kind === "installing";
  return (
    <div className="overlay" onMouseDown={() => !installing && onClose()}>
      <div
        className="dialog small"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        aria-describedby="about-version"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !installing) {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="dialog-header">
          <h2 id="about-title">About Tourmaline</h2>
        </div>
        <div className="dialog-body">
          <p id="about-version">
            Version {version ?? "…"}. A PDF reader for academic research, with notes in Obsidian.
          </p>
          <p role="status" className="update-status">
            {describe(status)}
          </p>
          {status.kind === "available" && status.update.notes && (
            <details className="update-notes">
              <summary>What's new</summary>
              <p>{status.update.notes}</p>
            </details>
          )}
          {status.kind === "available" && (
            <p className="muted small">Tourmaline will save your work, close, install the update and start again.</p>
          )}
          <label className="checkbox-label">
            <input type="checkbox" checked={auto} onChange={(e) => onAutoChange(e.target.checked)} disabled={installing} />
            Check for updates when Tourmaline starts
          </label>
          <div className="dialog-actions">
            {status.kind === "available" ? (
              <button ref={firstRef} type="button" className="button primary" onClick={onInstall}>
                Install and restart
              </button>
            ) : (
              // aria-disabled, not disabled: the button keeps focus while it checks.
              <button
                ref={firstRef}
                type="button"
                className="button"
                aria-disabled={status.kind === "checking" || installing}
                onClick={() => status.kind !== "checking" && !installing && onCheck()}
              >
                Check for updates
              </button>
            )}
            <button type="button" className="button" onClick={onClose} disabled={installing}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
