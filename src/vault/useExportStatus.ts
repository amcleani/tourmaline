import { useEffect, useMemo, useState } from "react";
import { exportStatus, renderAnnotation, type ExportRecord, type ExportSettings, type ExportStatus, type SectionInput } from "./export";
import { loadExportRecord } from "./runExport";

/**
 * How the open paper's annotations differ from what was last exported into
 * its note (sidebar marks, toolbar count): reads the paper's ExportRecord
 * when the note changes and again whenever `exports` (a count of exports
 * done) goes up. Null when there's no note to export to, no record yet, or
 * no `input` (annotations not loaded).
 */
export function useExportStatus(
  target: { workId: string; path: string } | null,
  input: SectionInput | null,
  settings: ExportSettings,
  exports: number,
): ExportStatus | null {
  const key = target ? `${target.workId}:${target.path}` : null;
  const [record, setRecord] = useState<{ key: string; record: ExportRecord | null } | null>(null);
  useEffect(() => {
    if (!target || !key) return;
    let stale = false;
    loadExportRecord(target.workId, target.path)
      .then((r) => !stale && setRecord({ key, record: r }))
      .catch((e) => console.error("Could not read what was last exported", e));
    return () => {
      stale = true;
    };
    // `target` changes with `key`.
  }, [key, exports]);

  return useMemo(() => {
    const r = record && record.key === key ? record.record : null;
    if (!r || !input) return null;
    return exportStatus(r, input.annotations, (a) => renderAnnotation(settings, input, a));
  }, [record, key, input, settings]);
}
