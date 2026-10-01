import { trapModalFocus } from "../src/ui/focusTrap";

describe("modal focus trap", () => {
  let stop: () => void;
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="outside">Outside</button>
      <div role="dialog" aria-modal="true">
        <input id="first" />
        <button id="disabled" disabled>No</button>
        <button id="last">Close</button>
      </div>`;
    stop = trapModalFocus(document);
  });
  afterEach(() => stop());

  const tab = (shiftKey = false) => {
    const e = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(e);
    return e.defaultPrevented;
  };
  const byId = (id: string) => document.getElementById(id)!;

  it("wraps Tab and Shift+Tab around the dialog's controls", () => {
    byId("last").focus();
    expect(tab()).toBe(true);
    expect(document.activeElement).toBe(byId("first"));
    expect(tab(true)).toBe(true);
    expect(document.activeElement).toBe(byId("last"));
    // In between, Tab does its usual thing.
    byId("first").focus();
    expect(tab()).toBe(false);
  });

  it("brings focus that leaves the dialog back into it", () => {
    byId("outside").focus();
    expect(document.activeElement).toBe(byId("first"));
  });

  it("does nothing without a dialog", () => {
    document.querySelector("[role=dialog]")!.remove();
    byId("outside").focus();
    expect(document.activeElement).toBe(byId("outside"));
    expect(tab()).toBe(false);
  });
});
