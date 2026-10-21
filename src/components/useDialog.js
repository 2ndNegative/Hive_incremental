// WHAT A MODAL OWES THE PERSON USING IT.
//
// Every dialog in the game was a `<div class="modal-backdrop">` with a card
// inside it. That looks like a dialog and behaves like a decoration: no role,
// so a screen reader announces nothing; no focus moved into it, so the keyboard
// stays wherever it was; no trap, so Tab walks straight out into the page
// behind; nothing inert behind it, so the page behind is still readable and
// clickable by anything that is not a mouse; and no Escape.
//
// That matters most on the dialog that matters most. The wipe confirmation asks
// you to type DELETE and then destroys the run, and it was reachable by Tab
// from the page behind it — you could be typing into something you could not
// see, and a stray Enter is forever.
//
// ONE IMPLEMENTATION, because there are four of these (confirm, origin chooser,
// offline catch-up, and whatever comes next) and the version of this that gets
// written per-dialog is the version where three of them are subtly wrong.

import { onBeforeUnmount, watch, nextTick } from 'vue';

/**
 * A unique id for the element a dialog is labelled by.
 *
 * `aria-labelledby` needs one, and `<script setup>` has no component instance
 * to borrow `_uid` from. A module counter is enough: ids only have to be
 * unique within the document.
 */
let nextId = 0;
export function dialogId(prefix = 'dialog-title') {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

/** Everything the keyboard can land on, in document order. */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableIn(root) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    // Hidden things are still in the DOM and still match the selector, and
    // sending focus to one is a cursor that has silently gone nowhere.
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Make `cardRef` behave like a dialog for as long as `isOpen()` is true.
 *
 * `onClose` is what Escape and a backdrop click call — the component keeps
 * ownership of what closing MEANS, because for some of these it is "cancel"
 * and for one of them it is "skip the rest of the catch-up".
 */
export function useDialog(cardRef, isOpen, onClose) {
  let returnFocusTo = null;

  const onKey = (event) => {
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key !== 'Tab') return;

    // THE TRAP. Tab off the last control goes to the first, and Shift-Tab off
    // the first goes to the last. Without it the next Tab lands on the page
    // behind — which is still there, just covered.
    const items = focusableIn(cardRef.value);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!cardRef.value?.contains(active)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  watch(isOpen, async (open) => {
    const app = document.getElementById('app');
    if (open) {
      // Remembered BEFORE anything moves, so closing puts the keyboard back
      // where the person left it rather than at the top of the document.
      returnFocusTo = document.activeElement;
      await nextTick();
      const items = focusableIn(cardRef.value);
      // The card itself if it holds nothing focusable, so the reader still
      // lands inside the dialog and reads its title.
      (items[0] ?? cardRef.value)?.focus?.();
      app?.setAttribute('aria-hidden', 'true');
      document.addEventListener('keydown', onKey, true);
    } else {
      app?.removeAttribute('aria-hidden');
      document.removeEventListener('keydown', onKey, true);
      returnFocusTo?.focus?.();
      returnFocusTo = null;
    }
  });

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKey, true);
    document.getElementById('app')?.removeAttribute('aria-hidden');
  });
}
