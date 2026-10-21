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
/**
 * WHICH KIND OF POINTER IS DOING THIS, remembered from the last pointerdown.
 *
 * `click` is the only event that reliably means "a deliberate tap": pointerdown
 * fires at the start of a scroll gesture too, and acting on it would open a
 * tooltip every time somebody flicked the nutrient list. But `click` does not
 * say what pressed it, and a mouse click must NOT pin — left-click already
 * means something everywhere these sit, and hover already shows the tooltip.
 * So the pointer type is captured on the way down and read on the way up.
 *
 * One module variable rather than one per element: there is only ever one
 * pointer mid-gesture, and the pair always arrives in order.
 */
let lastPointerType = 'mouse';

/** Things that own their own taps, so a tap on them must not also pin. */
const CONTROLS = 'button, a[href], input, select, textarea, label, [role="button"]';

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
      pointerdown: (event) => {
        lastPointerType = event.pointerType || 'mouse';
      },
      /*
       * TOUCH HAS NO HOVER, so on a phone or a tablet every tooltip in the game
       * was unreachable — not hard to reach, unreachable, because the only way
       * to open one was to hover it and the only way to keep one open was to
       * middle-click it. The sidebar's nutrient rows are the whole explanation
       * of where a nutrient is coming from, and on touch they were blank.
       *
       * A tap pins, which is the right model anyway: the body becomes
       * interactive, so the rows inside it can be tapped in turn, and
       * installTipDismiss already closes it on a tap outside. Tapping it again
       * closes it.
       *
       * Scoped to the tips that ALREADY opt into pinning. The ones that do not
       * are the fixed-positioned ones inside scrolling panels, which cannot be
       * pinned for a reason of their own (they do not follow their row when the
       * panel scrolls) — giving those a tap-to-open would hand touch users the
       * one broken version of this.
       */
      click: (event) => {
        if (lastPointerType === 'mouse') return;
        if (event.target.closest?.(CONTROLS)) return;
        togglePin(key);
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
/**
 * Room to leave above a tooltip that has been slid upwards, when there is no
 * topbar to measure. A single-line bar is 48px.
 *
 * The topbar is sticky and sits in a HIGHER stacking context than the
 * sidebar (30 against 20), so anything slid under it is painted over rather
 * than merely close to it — and what gets hidden is the tooltip's own title,
 * which is the one line naming the thing being described. Eight more for the
 * usual breathing room.
 */
const TOP_GUTTER = 56;

/**
 * The lowest a tooltip may be slid, in window coordinates.
 *
 * MEASURED, because the topbar is `flex-wrap: wrap` and a narrow window gives
 * it two lines or three. A hard 56 was right for one line and wrong for the
 * rest: a tooltip slid to 56 on a phone-width window went under a bar that was
 * 96px tall, and the line it hid was the tooltip's own title.
 *
 * The bar is `position: sticky; top: 0`, so its bottom edge in window
 * coordinates IS its height, whatever the page has scrolled to. Falls back to
 * the constant when there is no bar — the tests mount panels on their own.
 */
function topGutter() {
  const bar = document.querySelector('.topbar');
  const bottom = bar?.getBoundingClientRect().bottom ?? 0;
  return bottom > 0 ? bottom + EDGE : TOP_GUTTER;
}

/** Clearance from the window's own edges, and from the thing being described. */
const EDGE = 8;
const GAP = 4;

/*
 * A TOOLTIP INSIDE A SCROLLING PANEL IS PLACED AGAINST THE WINDOW.
 *
 * `overflow-x: auto` computes `overflow-y` to `auto` as well — the two axes
 * cannot disagree about whether they scroll — so the moment a panel is allowed
 * to scroll sideways it also clips. That cost the assignment grid two bugs at
 * once: every tooltip in its lower rows was cropped by the panel's bottom edge
 * (fifty-five pixels of it, while sitting a hundred and ninety clear of the
 * window), and the panel grew a vertical scrollbar nobody asked for, because
 * two dozen hidden tooltips were parked below their rows adding to its scroll
 * height.
 *
 * Fixed positioning answers both. A fixed box is laid out against the window,
 * so no ancestor's overflow can clip it and it contributes nothing to anyone's
 * scrollable area. The price is that the stylesheet can no longer place it —
 * `top: 100%` means the bottom of the WINDOW once the containing block is the
 * viewport — so the coordinates are worked out here instead. The stylesheet
 * opts a panel in; see `.assign-scroll .tip > .tip-body`.
 *
 * `right` and `bottom` are cleared explicitly. The rules that set them are for
 * absolute positioning and would otherwise survive alongside the `left` set
 * here, which over-constrains the box and stretches it to the window's edge.
 *
 * A fixed tooltip does not follow its row if the page scrolls underneath it,
 * so nothing opted in here offers pinning: an unpinned tooltip closes the
 * moment the pointer leaves, which is long before that can be noticed.
 */
function placeAgainstWindow(body, anchor) {
  body.style.right = 'auto';
  body.style.bottom = 'auto';

  const { offsetWidth: width, offsetHeight: height } = body;

  // Below unless below does not fit and above does — the same judgement
  // `.tip-above` encodes, made in numbers because the class cannot be.
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - height;
  const fitsBelow = below + height + EDGE <= window.innerHeight;
  const ceiling = topGutter();
  const top = !fitsBelow && above >= ceiling
    ? above
    // Taller than the room either way: sit it as low as it can go and let the
    // body's own `overflow-y` carry the rest, rather than hanging off an edge.
    : Math.max(ceiling, Math.min(below, window.innerHeight - EDGE - height));

  // Left-aligned with what it describes, pulled back when that would run it off
  // the right-hand edge — which is what the trailing columns used to need a
  // rule of their own for, and this clamps against the window rather than the
  // panel, so it is right in cases that rule got wrong.
  const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - EDGE - width));

  body.style.left = `${left}px`;
  body.style.top = `${top}px`;
}

/*
 * KEEP AN ABSOLUTELY POSITIONED TOOLTIP INSIDE THE WINDOW SIDEWAYS, and no
 * taller than the room there is above and below it.
 *
 * Neither of these could be done in the stylesheet, for the same reason the
 * vertical flip could not: they depend on where the element landed in a window
 * the player can resize.
 *
 * TRANSFORM rather than `left`, because `left` is already set by five rules
 * that each mean something — 0, -0.6rem, `calc(100% + 10px)`, `auto` — and
 * overwriting it inline would flatten the distinction. A transform moves the
 * painted box without touching the layout, which is exactly the scope wanted:
 * the layout overflow is dealt with by `overflow-x: clip` on the shell, since
 * a hidden tooltip has to stop widening the page whether or not anything is
 * hovering it.
 *
 * The height cap replaces the stylesheet's `calc(100vh - 64px)` when the
 * topbar has wrapped onto two or three lines and that figure is no longer the
 * room available. Skipped for a PINNED tooltip, which deliberately has no cap
 * — its nested tooltips open outside it, and `overflow` clips both axes.
 */
function fitToWindow(el, body) {
  body.style.removeProperty('transform');
  // THE BODY'S OWN RECTANGLE, not its anchor's. Five rules set `left` and only
  // one of them lines the tooltip up with the element it describes — the
  // sidebar's open ten pixels to the SIDE of it, and below 980px they open at
  // -0.6rem to cover the row's padding. Measuring the anchor instead shifted
  // every sidebar tooltip four pixels left of where it belonged, which
  // uncovered the right-hand end of the rows behind it: the exact bleed the
  // side placement exists to prevent.
  const box = body.getBoundingClientRect();
  const overhang = box.right + EDGE - window.innerWidth;
  // Never pushed off the LEFT edge chasing the right one: a tooltip wider than
  // the window is left where it is and read from its start.
  const shift = Math.min(Math.max(overhang, 0), Math.max(box.left - EDGE, 0));
  if (shift > 0) body.style.transform = `translateX(${-shift}px)`;

  if (el.classList.contains('is-pinned')) {
    body.style.removeProperty('max-height');
    return;
  }
  body.style.maxHeight = `${Math.max(120, window.innerHeight - topGutter() - EDGE)}px`;
}

function flipIfClipped(el) {
  const body = el.querySelector(':scope > .tip-body');
  if (!body) return;
  // Measure with the class off and the slide cleared, so a tooltip that has
  // already been moved is re-judged from its natural position rather than from
  // where the last decision put it.
  el.classList.remove('tip-above');
  body.style.removeProperty('top');
  const anchor = el.getBoundingClientRect();

  // A tooltip the stylesheet has taken out of the flow is placed from here
  // instead — see placeAgainstWindow. Checked before anything else, because
  // neither the flip nor the slide below means anything once the containing
  // block is the window rather than the row.
  if (getComputedStyle(body).position === 'fixed') {
    placeAgainstWindow(body, anchor);
    return;
  }

  fitToWindow(el, body);
  const height = body.offsetHeight;

  /*
   * A SIDE TOOLTIP SLIDES. IT DOES NOT FLIP.
   *
   * The sidebar's tooltips open BESIDE their row rather than below it, so there
   * is no "other way" to flip to — and flipping them anyway was actively
   * destructive. `.tip-above` sets `bottom`, `.tip-side` sets `top: 0`, they
   * have identical specificity and `.tip-side` comes later in the stylesheet,
   * so BOTH ended up applied: an absolutely positioned box with `top` and
   * `bottom` both set and `height: auto` is stretched between them. Measured on
   * the Magnesium row: a 16px-tall box holding 651px of content, which spilled
   * out over the whole page with no background behind it and read exactly like
   * the renderer had given up.
   *
   * So a side tooltip that would hang off the bottom is pulled UP by however
   * much hangs off, and no further than the top of the window. It stays beside
   * its row, which is the entire point of opening to the side.
   */
  if (el.classList.contains('tip-side')) {
    /*
     * CLAMPED BOTH WAYS, against where the stylesheet actually put it.
     *
     * This used to pull up by the overflow below and nothing else, measured
     * from `anchor.top` — which is the tooltip's own top only on a wide window,
     * where `.tip-side` sets `top: 0`. Below 980px the same tooltip opens
     * DOWNWARD at `top: calc(100% + 4px)`, so the figure being corrected was
     * not the figure being placed.
     *
     * And nothing corrected the other direction at all. A row scrolled up
     * under the sticky topbar opened its tooltip under the topbar — the bar
     * wins the paint order, so what vanished was the tooltip's title. That is
     * reachable without a mouse ever leaving the window: scroll the sidebar
     * list, then tab into a row.
     *
     * So: read where it is going to land, and clamp it into the room there is.
     */
    const natural = anchor.top + (parseFloat(getComputedStyle(body).top) || 0);
    const ceiling = topGutter();
    const floor = Math.max(ceiling, window.innerHeight - EDGE - height);
    const want = Math.min(Math.max(natural, ceiling), floor);
    if (Math.abs(want - natural) > 0.5) body.style.top = `${want - anchor.top}px`;
    return;
  }

  const roomBelow = window.innerHeight - anchor.bottom;
  // Only flip when there is genuinely more room the other way. A tooltip taller
  // than the whole window fits nowhere, and flipping it would move the part the
  // player can read from the top to the bottom for no gain.
  //
  // AND ONLY WHEN IT CLEARS THE TOPBAR. `.tip-above` sets `bottom`, which puts
  // the tooltip's TOP at `anchor.top - 4 - height` and gives the measurer no
  // say in it — so a tall tooltip on a row near the bottom of the screen
  // flipped straight up into the sticky bar, which paints over it. What
  // disappears is the top of the tooltip, which is its title. One line of
  // condition rather than a second placement path: a tooltip that cannot flip
  // clear stays below, which is the case the comment above already argues for.
  const fitsAbove = anchor.top - GAP - height >= topGutter();
  if (height + 8 > roomBelow && anchor.top > roomBelow && fitsAbove) el.classList.add('tip-above');
}

export function installTipFlip() {
  if (typeof window === 'undefined') return;
  const measure = (event) => {
    const el = event.target.closest?.('.tip');
    if (el) flipIfClipped(el);
  };
  document.addEventListener('mouseover', measure, { passive: true });
  /*
   * AND THE SAME WHEN IT WAS NOT THE POINTER THAT OPENED IT.
   *
   * `.tip:focus-within` reveals a tooltip when the keyboard reaches a control
   * inside it, and a tap pins one — both of which produce a tooltip that has
   * never been measured, so the lower half of any long list opened one that ran
   * straight off the bottom of the window. The placement is not a hover
   * behaviour, it is a "this thing is now visible" behaviour, and it was only
   * ever bound to hover because hover was the only way to open one.
   *
   * `focusin` rather than `focus`: focus does not bubble, so it cannot be
   * delegated. `click` rather than `pointerdown`, for the same reason the pin
   * uses click — see pinHandlers.
   */
  document.addEventListener('focusin', measure, { passive: true });
  document.addEventListener('click', measure, { passive: true });
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
