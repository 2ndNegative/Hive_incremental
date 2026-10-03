// Pinned tooltips.
//
// A tooltip normally disappears the moment the pointer leaves the thing it
// describes, which makes it impossible to look at anything *inside* it. Middle-
// clicking pins one: it stays put and becomes interactive, so the rows in it can
// be hovered for tooltips of their own. That is how a question like "protein is
// coming from beef, but where is the beef coming from" gets answered in one
// chain without leaving the panel.
//
// Only one tooltip is pinned at a time. Pinning a second releases the first,
// which keeps the screen readable and means there is never a stack to dismiss.

import { ref } from 'vue';

const pinned = ref(null);

export function isPinned(key) {
  return pinned.value === key;
}

export function togglePin(key) {
  pinned.value = pinned.value === key ? null : key;
}

export function unpinAll() {
  pinned.value = null;
}

export { pinned };

/**
 * Handlers to bind onto a `.tip` element with `v-on="pinHandlers(key)"`.
 * Middle-click pins; the auxclick guard stops the browser from opening its
 * autoscroll cursor or pasting the X11 selection.
 *
 * The keys are plain DOM event names, not `onMousedown` — Vue's object form of
 * `v-on` takes them unprefixed, and the camelCase spelling silently registers a
 * listener for an event called "onMousedown" that nothing ever fires.
 */
export function pinHandlers(key) {
  return {
    mousedown: (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      togglePin(key);
    },
    auxclick: (event) => {
      if (event.button === 1) event.preventDefault();
    },
  };
}

/**
 * Release a pinned tooltip on Escape, or on a click that lands outside one.
 * Called once, from the app root.
 */
export function installTipDismiss() {
  if (typeof window === 'undefined') return;
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') unpinAll();
  });
  window.addEventListener('mousedown', (event) => {
    if (pinned.value === null) return;
    if (event.button === 1) return; // the pin itself
    if (event.target.closest?.('.tip.is-pinned')) return; // working inside it
    unpinAll();
  });
}
