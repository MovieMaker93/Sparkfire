import { useEffect, type RefObject } from "react";

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';
// Only the newest open dialog handles Tab, so a confirmation opened inside Settings keeps the focus.
const openTraps: object[] = [];

/** Where Tab should move: -1 lets the browser move focus normally inside the dialog. */
export function wrapFocusIndex(count: number, current: number, backwards: boolean): number {
  if (count === 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  if (backwards && current === 0) return count - 1;
  if (!backwards && current === count - 1) return 0;
  return -1;
}

/** Keeps Tab inside an open dialog and returns focus to the trigger when the dialog closes. */
export function useFocusTrap(container: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement;
    const token = {};
    openTraps.push(token);
    const initial = window.setTimeout(() => {
      if (container.current && !container.current.contains(document.activeElement)) container.current.querySelector<HTMLElement>(focusableSelector)?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || openTraps[openTraps.length - 1] !== token) return;
      const focusable = [...(container.current?.querySelectorAll<HTMLElement>(focusableSelector) || [])].filter((element) => element.getClientRects().length > 0);
      const next = wrapFocusIndex(focusable.length, focusable.indexOf(document.activeElement as HTMLElement), event.shiftKey);
      if (next >= 0) {
        event.preventDefault();
        focusable[next].focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(initial);
      document.removeEventListener("keydown", onKeyDown);
      const index = openTraps.indexOf(token);
      if (index >= 0) openTraps.splice(index, 1);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [active, container]);
}
