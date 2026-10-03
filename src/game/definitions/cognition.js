// Cognition — the hive's bandwidth.
//
// Measured in COGITS (Cg), auto-prefixed like everything else: 800 Cg, 4.2 kCg,
// 1.1 MCg.
//
// A cogit is NOT a stock. Nothing accumulates, nothing is spent, and there is
// no such thing as "saving up" cogits. It is a width: the hivemind can hold so
// much thinking in flight at once, and everything that thinks occupies part of
// that width for as long as it exists. Drones take some simply by being awake.
// Some structures take some to run. Some actions hold a block of it while they
// are under way and give it back when they finish.
//
//     used = Σ everything currently thinking
//     free = capacity - used
//
// This is what makes insight possible rather than being insight itself. Insight
// is the research currency and still accumulates in the usual way; cognition is
// the width of the pipe that generates it. A hive with no bandwidth produces no
// insight however much it eats.
//
// HOW THINGS DECLARE THEMSELVES
//   a structure  `cogitCapacity`  cogits of bandwidth added per unit
//                `cogitDraw`      cogits occupied per unit while it stands
//   a caste      `cogitPerDrone`  cogits occupied per assigned drone
//   every drone  COGIT_PER_DRONE  paid whether it works or not
//   an action    a reservation in `state.cognition.reservations`, held by key
//                until released (see reserveCogits / releaseCogits in actions)
//
// The numbers below are deliberately zero. The building and drone rebuild sets
// them; the wiring is live now so that it has somewhere to plug into, and so
// that the top bar reads 0 / 0 Cg honestly rather than hiding until it is fed.

/** Unit symbol. Prefixes as kCg, MCg, GCg. */
export const COGIT = 'Cg';

/**
 * What the hive can think with before it has grown anything to think with.
 *
 * Zero on purpose: a landed hive is not yet a mind. The first Cognition
 * building is what makes it one, which is a better opening beat than starting
 * with a mysterious free allowance.
 */
export const BASE_COGIT_CAPACITY = 0;

/**
 * Bandwidth every drone occupies just by being awake, assigned or not — the
 * cost of keeping one coherent inside the hivemind at all.
 *
 * Zero until the drone rebuild sets it. When it is non-zero it becomes the
 * real population ceiling: drones will be limited by what the hive can think
 * with, not by how much protein it can find.
 */
export const COGIT_PER_DRONE = 0;
