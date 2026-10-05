import { useCallback, useEffect, useRef, useState } from "react";
import { checkForUpdate, getState, setState, type AvailableUpdate } from "../platform";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "installing"; progress: number | null; version: string }
  | { kind: "failed"; message: string };

/** Automatic checks happen when the app starts, at most this often. */
const AUTO_INTERVAL_MS = 20 * 60 * 60 * 1000;

/** Whether an automatic check is due, from the time of the last one (app state `updates.lastCheck`). */
export function checkDue(lastCheck: string | null, now: number): boolean {
  const last = lastCheck ? Date.parse(lastCheck) : NaN;
  return !Number.isFinite(last) || now - last >= AUTO_INTERVAL_MS || last > now;
}

// Updates (Help › Check for updates): an automatic check when the app starts
// (unless turned off; app state `updates.auto`), silent unless it finds one,
// and checks on request. Installing saves everything first.
export function useUpdates(saveEverything: () => Promise<void>) {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const [auto, setAutoState] = useState(true);
  const busy = useRef(false);
  /** Someone asked during the check under way, so its result is shown. */
  const asked = useRef(false);

  const check = useCallback(async (manual: boolean) => {
    if (manual) {
      asked.current = true;
      setStatus({ kind: "checking" });
    }
    // A request during the automatic check waits for that check's answer.
    if (busy.current) return;
    busy.current = true;
    try {
      const update = await checkForUpdate();
      void setState("updates.lastCheck", new Date().toISOString()).catch(() => {});
      if (update) setStatus({ kind: "available", update });
      else if (asked.current) setStatus({ kind: "current" });
    } catch (e) {
      // An automatic check that fails (offline) says nothing.
      if (asked.current) setStatus({ kind: "failed", message: String((e as Error)?.message ?? e) });
    } finally {
      busy.current = false;
      asked.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getState("updates.auto"), getState("updates.lastCheck")])
      .then(([on, last]) => {
        if (cancelled) return;
        const enabled = on !== "off";
        setAutoState(enabled);
        if (enabled && checkDue(last, Date.now())) void check(false);
      })
      .catch((e) => console.error("Could not read the update settings", e));
    return () => {
      cancelled = true;
    };
  }, [check]);

  const setAuto = useCallback((on: boolean) => {
    setAutoState(on);
    void setState("updates.auto", on ? "on" : "off").catch((e) => console.error("Could not save the update setting", e));
  }, []);

  const install = useCallback(async () => {
    if (status.kind !== "available") return;
    const { update } = status;
    setStatus({ kind: "installing", progress: null, version: update.version });
    try {
      await saveEverything();
      await update.install((progress) => setStatus({ kind: "installing", progress, version: update.version }));
    } catch (e) {
      setStatus({ kind: "failed", message: String((e as Error)?.message ?? e) });
    }
  }, [status, saveEverything]);

  return { status, check, install, auto, setAuto };
}
