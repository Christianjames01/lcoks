import { flushSync } from 'react-dom';

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Run a React state update as a View Transition when the platform supports it. */
export function transition(update: () => void, hooks: { before?: () => void; after?: () => void; done?: () => void } = {}): void {
  const doc = document as ViewTransitionDoc;
  if (!doc.startViewTransition || reduced.matches) {
    update();
    return;
  }
  hooks.before?.();
  try {
    const t = doc.startViewTransition(() => {
      flushSync(update);
      hooks.after?.();
    });
    void t.finished.catch(() => undefined).finally(() => hooks.done?.());
  } catch {
    update();
    hooks.done?.();
  }
}

// Shared-element morph between a list row and the item's detail header (phone).
// Rows mark their parts with data-vt="icon" / data-vt="title"; the detail header
// gets the same transition names from CSS while it is shown.
function tag(root: Element | null | undefined, on: boolean): void {
  if (!root) return;
  for (const part of ['icon', 'title']) {
    const el = root.querySelector<HTMLElement>(`[data-vt="${part}"]`);
    if (el) el.style.viewTransitionName = on ? `vt-${part}` : '';
  }
}

/** Row → detail: the row's icon and title grow into the detail header. */
export function morphOpen(row: Element | null | undefined, update: () => void): void {
  transition(update, { before: () => tag(row, true), after: () => tag(row, false) });
}

/** Detail → list: the header shrinks back into the item's row (found after the update). */
export function morphClose(findRow: () => Element | null, update: () => void): void {
  let row: Element | null = null;
  transition(update, {
    after: () => {
      row = findRow();
      tag(row, true);
    },
    done: () => tag(row, false)
  });
}
