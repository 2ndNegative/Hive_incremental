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
 * ONE HANDLER OBJECT PER KEY, FOR THE LIFE OF THE PAGE.
 *
 * `v-on="pinHandlers(key)"` is evaluated on every render of the element it is
 * on, and the game ticks at 100 ms, so every mounted `.tip` re-ran this ten
 * times a second. Fresh closures every time are fresh *function identities*,
 * which is the expensive part: Vue compares the old and new handler, finds them
 * unequal, and removes and re-adds the DOM listener. The Territory tab alone
 * puts this on about a hundred elements, so it was two hundred closures and a
 * hundred listener swaps a second to produce behaviour that had not changed.
 *
 * Memoising is safe because a handler captures NOTHING but the string `key` —
 * `togglePin` reads the shared ref rather than anything from the call site — so
 * the object for a given key is correct forever and the identity is stable,
 * which is what lets Vue skip the patch entirely.
 *
 * The map is never pruned. Keys are derived from ids in the definitions, so the
 * set is bounded by the size of the database rather than by anything the player
 * can grow; an LRU here would be machinery guarding against nothing.
 */
const HANDLERS = new Map();

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
  let handlers = HANDLERS.get(key);
  if (handlers === undefined) {
    handlers = {
      mousedown: (event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        togglePin(key);
      },
      auxclick: (event) => {
        if (event.button === 1) event.preventDefault();
      },
    };
    HANDLERS.set(key, handlers);
  }
  return handlers;
}

/**
 * KEEP A TOOLTIP ON THE SCREEN. One delegated listener, installed once.
 *
 * `.tip-body` opens downward, which is right nearly always and wrong at the
 * bottom of the window: the nutrient sidebar is twenty rows long, so hovering
 * anything in its lower half opened a panel that ran off the bottom edge and
 * was simply unreadable. The same happens to the storage rows and the territory
 * offer chips.
 *
 * Measured on the way in rather than guessed from a row's index, because what
 * matters is the window, and the window is whatever size the player made it.
 *
 * DELEGATED, not bound per element. Every `.tip` in the game is covered by this
 * one listener whether or not it uses pinHandlers, and nothing has to remember
 * to opt in — which is the failure mode a per-component fix would have had, in
 * a codebase with eight tabs that each grew their own tooltips.
 *
 * `mouseover` rather than `mouseenter`: mouseenter does not bubble, so it
 * cannot be delegated at all.
 */
function flipIfClipped(el) {
  const body = el.querySelector(':scope > .tip-body');
  if (!body) return;
  // Measure with the class off, so a tooltip that has already been flipped is
  // re-judged from its natural position rather than from where the last
  // decision put it.
  el.classList.remove('tip-above');
  const anchor = el.getBoundingClientRect();
  const height = body.offsetHeight;
  const roomBelow = window.innerHeight - anchor.bottom;
  // Only flip when there is genuinely more room the other way. A tooltip taller
  // than the whole window fits nowhere, and flipping it would move the part the
  // player can read from the top to the bottom for no gain.
  if (height + 8 > roomBelow && anchor.top > roomBelow) el.classList.add('tip-above');
}

export function installTipFlip() {
  if (typeof window === 'undefined') return;
  document.addEventListener('mouseover', (event) => {
    const el = event.target.closest?.('.tip');
    if (el) flipIfClipped(el);
  }, { passive: true });
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
