import { useId } from "react";
import type { StepUnit } from "../focus/steps";
import { Icon } from "./icons";

export const EYE_HEIGHTS = [
  { value: 0.2, label: "Near the top" },
  { value: 0.35, label: "Upper third" },
  { value: 0.5, label: "Middle" },
] as const;

export const STEP_UNITS: { value: StepUnit; label: string }[] = [
  { value: 1, label: "1 line" },
  { value: 2, label: "2 lines" },
  { value: 3, label: "3 lines" },
  { value: "sentence", label: "Sentence" },
];

interface Props {
  unit: StepUnit;
  eye: number;
  detectColumns: boolean;
  /** "Step 3 of 120", or a message while steps are being found. */
  position: string;
  /** Read out to screen readers as the step changes. */
  announcement: string;
  onUnit: (unit: StepUnit) => void;
  onEye: (eye: number) => void;
  onColumns: (on: boolean) => void;
  onPrevious: () => void;
  onNext: () => void;
  onExit: () => void;
}

// Focus mode's controls, floating over the bottom of the document: the same
// actions as the Focus commands (View menu, palette, keys), for the mouse.
export function FocusBar(p: Props) {
  const id = useId();
  return (
    <div className="focus-bar" role="group" aria-label="Focus mode">
      <button type="button" className="icon-button" onClick={p.onPrevious} aria-label="Previous step" title="Previous step (Up)">
        <Icon name="up" />
      </button>
      <button type="button" className="icon-button" onClick={p.onNext} aria-label="Next step" title="Next step (Down)">
        <Icon name="down" />
      </button>
      <span className="focus-position" aria-hidden="true">
        {p.position}
      </span>
      <label className="focus-field" htmlFor={`${id}-unit`}>
        Step
      </label>
      <select
        id={`${id}-unit`}
        className="select"
        value={String(p.unit)}
        onChange={(e) => p.onUnit(e.target.value === "sentence" ? "sentence" : (Number(e.target.value) as 1 | 2 | 3))}
      >
        {STEP_UNITS.map((u) => (
          <option key={u.value} value={String(u.value)}>
            {u.label}
          </option>
        ))}
      </select>
      <label className="focus-field" htmlFor={`${id}-eye`}>
        Eye line
      </label>
      <select id={`${id}-eye`} className="select" value={String(p.eye)} onChange={(e) => p.onEye(Number(e.target.value))}>
        {EYE_HEIGHTS.map((h) => (
          <option key={h.value} value={String(h.value)}>
            {h.label}
          </option>
        ))}
      </select>
      <label className="checkbox focus-field">
        <input type="checkbox" checked={p.detectColumns} onChange={(e) => p.onColumns(e.target.checked)} />
        Columns
      </label>
      <button type="button" className="button small" onClick={p.onExit}>
        Exit focus
      </button>
      <span className="visually-hidden" aria-live="polite">
        {p.announcement}
      </span>
    </div>
  );
}
