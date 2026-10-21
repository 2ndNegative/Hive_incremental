# HiveIdle — The interface

What the screens owe the person reading them — including the half of that which has nothing to do with a mouse.

The front door is [DESIGN.md](DESIGN.md).

In this file: [Reaching it without a mouse, and on a small window](#reaching-it-without-a-mouse-and-on-a-small-window) · [Fitting on the screen it is actually on](#fitting-on-the-screen-it-is-actually-on)

## Reaching it without a mouse, and on a small window

Every assertion in `access-test.mjs` was a bug, and every one of them was invisible to the
other thirty-seven suites — because those drive the game with `page.click`, which is a
mouse. A tab bar with no roles, a dropdown with no name, a dialog that does not take the
keyboard and a card whose buttons sit off the bottom edge all look perfectly fine to a test
that clicks coordinates.

**The tab bar is a tablist.** Which screen you are on was carried entirely by `.is-active`,
which is a colour, and a colour is not a state anything but an eye can read. `role="tab"`
plus `aria-selected` says both which things are alternatives and which one is showing, and
`#tab-panel` in `App.vue` carries the matching `role="tabpanel"`, named by whichever tab
opened it.

The keyboard half comes with it, not after it. A tablist tells the player to use the arrow
keys — that is what the role *means* — so declaring the role without implementing them
would have been worse than leaving eleven loose buttons alone. `TabBar.vue` runs a roving
tabindex: one tab stop for the whole bar, Left/Right between tabs, Home/End to the ends,
wrapping at both. Selection follows focus, because switching tab here is free and
reversible and the alternative makes the common case two keys instead of one. It is also
simply a better keyboard for everyone: eleven tab stops used to sit between the topbar and
the first control on the screen.

**Nothing that takes input is nameless.** The Metabolism tab's fuel rows are two *identical*
dropdowns side by side, repeated once per generator, and the only thing that said which was
which was their order and a paragraph of prose above them — a screen reader got "combobox,
combobox" per row. They now carry an `aria-label` each, and the grid grew the column
headings it never had, which the sighted reader was missing too. The filter and search boxes
relied on `placeholder`, which is not a name: it is a hint that some readers skip and that
every reader loses the moment a character is typed into the box.

**A dialog takes the keyboard, keeps it, and gives it back.** `components/useDialog.js` is
one implementation for all of them, because there are four and the per-dialog version is the
one where three are subtly wrong. It moves focus in, traps Tab, hides `#app` from the
reader, restores focus on close, and closes on Escape — with the component keeping ownership
of what closing *means*, since for the wipe confirmation it is "cancel" and for the offline
catch-up it is "skip the rest". This matters most on the dialog that matters most: the wipe
confirmation asks you to type DELETE and then destroys the run, and it was reachable by Tab
from the page behind it. You could be typing into something you could not see, and a stray
Enter is forever.

**A dialog also has to fit.** `.modal-backdrop` is `position: fixed` and centres its card,
so a card taller than the viewport overflowed equally off the top and the bottom with
nothing able to scroll it — and what went off the bottom was `.modal-foot`, which is where
every button is. The card is a flex column capped at `calc(100vh - 2rem)` with the body as
the only flexible part, so the head and foot stay put and the long list in the middle
scrolls. `min-height: 0` on that body is load-bearing: a flex item's default
`min-height: auto` refuses to shrink below its content, which makes `overflow-y` on it dead
letter.

**The topbar wraps.** It holds the brand, six resource chips and the save state, and on a
narrow window the row was simply wider than the viewport: a horizontal scrollbar on the
whole page with the right-hand readouts off the edge. `flex-wrap: wrap` gives it a second
line, and `tips.js` measures the bar (`topGutter()`) rather than assuming the 48px of one
line — a tooltip slid to a hard 56 on a phone-width window went under a bar three times
that tall, and what it hid was the tooltip's own title.

**Tooltips open for a keyboard and for a finger.** `:focus-within` opens the ones that wrap
a control, which costs nothing and adds no tab stops: it fires on things that were already
tab stops. The ones that wrap plain text deliberately get nothing — making those reachable
means a `tabindex` on each, and the Territory tab alone has about a hundred, so a keyboard
user would need a hundred presses of Tab to cross one screen. That is a worse outcome than
the one being fixed.

Touch has no hover at all, so on a phone every tooltip in the game was not hard to reach but
*unreachable*. A tap now pins, which is the right model anyway: a pinned body is
interactive, so the rows inside it can be tapped in turn, and the existing outside-click
dismissal already closes it. Scoped to the tips that already opt into pinning — the ones
that do not are the fixed-positioned ones inside scrolling panels, which cannot be pinned
for a reason of their own.

**And a hidden tooltip must not widen the page.** `visibility: hidden` keeps a box in the
layout, and dozens of them are parked beside their rows at any moment: on a 420px window the
document's scroll width was 580px and the whole page scrolled sideways with nothing to see at
the far end. `overflow-x: clip` on `.hive-shell` ends that — `clip` rather than `hidden`,
because `hidden` would make the shell a scroll container and force `overflow-y` to `auto`
along with it. Visible tooltips are pulled back inside the window by `fitToWindow` before
the clip can cut one, measuring the tooltip's *own* rectangle rather than its anchor's: five
rules set `left` and only one of them lines the tooltip up with the thing it describes.

## Fitting on the screen it is actually on

Four faults, all found by `layout-test.mjs` walking ten tabs across four widths, and all
invisible until something asked. None of them are exotic; each is one CSS idiom used the
way it is usually used.

**A grid track cannot shrink below its content unless you say so.** `1fr` means
`minmax(auto, 1fr)`, so the track's floor is its content's min-content width — one long
word in a drone's description was enough to stop a row shrinking. `minmax(0, 1fr)` is what
was meant, everywhere this matters.

**A stretched flex item's cross size is at least its own content's.** Below 860px
`.hive-body` becomes a column, so width becomes the cross axis, and `min-width: 0` — which
is about the main axis — stops helping. One un-shrinkable grid track inside any tab
therefore widened the whole main column and pushed every panel on it off the screen: the
Drones tab was 56px wider than a phone, end to end, because `.mold-controls` is a toggle, a
label, a number field and a status word, all `nowrap`, with a floor of about 260px.
`max-width: 100%` on `.main-col` clamps it; below tablet width the controls drop to a line
of their own, where nothing has to shrink at all. The clamp does not excuse the content —
anything that still does not fit now overflows visibly, which the layout suite reports as
an element hanging off the right-hand edge, naming the culprit, rather than as a page that
scrolls sideways.

**Bulma's `.columns` expects a padded parent.** It carries -0.75rem of margin on each side
so its children's padding lines up with whatever contains it. Dropped into a panel with no
padding, the row is simply 24px wider than its parent — which put the Stats tab's
two-column block exactly on the window's right edge, at every width, and gave the document
a horizontal scrollbar. The outer gutter is neutralised and the outer column padding with
it: the gutter *between* columns is what the class is for.

**A table of numbers has a floor.** Four columns of figures with headings cannot be made
narrower than about 440px without becoming unreadable, so on a phone they scroll sideways
inside their panel rather than pushing the page. `:has(> .data-table)` rather than a
wrapper div in seven templates: the rule is "a panel body whose direct child is a data
table", which is exactly what it says, and the eighth table added later needs nothing.
`overflow-x: auto` drags `overflow-y` to `auto` with it — the two axes cannot disagree
about whether they scroll — so the tooltips inside have to come out of the flow, which is
the same pair of bugs `.assign-scroll` had and the same fix.

And one that is not about width at all: **a hidden tooltip keeps its box.**
`visibility: hidden` leaves an element in the layout, and there are dozens of them parked
beside their rows at any moment, so on a 420px window the document's scroll width was
580px and the whole page scrolled sideways with nothing to see at the far end.
`overflow-x: clip` on the shell ends it — `clip` and not `hidden`, because `hidden` would
make the shell a scroll container and force `overflow-y` along with it. Visible tooltips
are pulled back inside the window by `fitToWindow` in `game/tips.js` before the clip can
cut one, measuring the tooltip's *own* rectangle and not its anchor's: five rules set
`left` and only one of them lines a tooltip up with the thing it describes.
