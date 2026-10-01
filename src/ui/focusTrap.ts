// Keeps Tab inside the open modal dialog (aria-modal="true"): from its last
// control Tab goes to its first, Shift+Tab the other way, and focus that
// lands outside it (a click on the overlay) comes back. One listener serves
// every dialog.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function topDialog(doc: Document): HTMLElement | null {
  const dialogs = doc.querySelectorAll<HTMLElement>('[aria-modal="true"]');
  return dialogs[dialogs.length - 1] ?? null;
}

function focusables(dialog: HTMLElement): HTMLElement[] {
  // Not the hidden ones (a collapsed <details>, display: none).
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest("[hidden], [inert]") && (typeof el.checkVisibility !== "function" || el.checkVisibility()),
  );
}

export function trapModalFocus(doc: Document = document): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || e.defaultPrevented) return;
    const dialog = topDialog(doc);
    if (!dialog) return;
    const items = focusables(dialog);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = doc.activeElement as HTMLElement | null;
    const inside = !!active && dialog.contains(active);
    if (!inside) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    }
  };
  const onFocusIn = (e: FocusEvent) => {
    const dialog = topDialog(doc);
    if (!dialog || dialog.contains(e.target as Node)) return;
    // Menus opened from the dialog (a <select>'s list) aren't elements; anything else is outside.
    focusables(dialog)[0]?.focus();
  };
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("focusin", onFocusIn);
  return () => {
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("focusin", onFocusIn);
  };
}
