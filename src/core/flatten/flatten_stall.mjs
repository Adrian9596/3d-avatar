/**
 * The stall guard of the relaxation: tells `relaxPieces` when a run that has not
 * converged is not going to, so it can stop instead of spending its whole budget.
 *
 * The solver ends a run on one condition — no vertex moved more than
 * `convergence_m` in a sweep. Two kinds of run miss it, and they must not be
 * confused:
 *
 * - SLOW. The sweep move keeps falling, only gently (a thin strap or a tab has a
 *   layout mode that settles over tens of thousands of sweeps). It is still
 *   improving at the limit and the limit is what ends it. Stopping it early would
 *   hand back a less settled layout for nothing, so the guard leaves it alone.
 * - STUCK. The sweep move stopped falling — a plateau, or a creep at a steady
 *   speed along a direction nothing holds. More sweeps buy nothing.
 *
 * So the guard looks at progress, not at the move: the smallest move of each
 * window of `stall_window` sweeps is compared with the smallest of the window
 * before. A window that does not beat it by `stall_min_gain` made no progress;
 * `stall_windows` such windows in a row is a stall — unless the pace of the last
 * window, kept up for every window the budget still has, would reach the floor
 * (then the run is left to finish, as it always was). Comparing window minima
 * ignores the spikes an accelerated sweep has; the comparison is by
 * multiplication, so a move of exactly 0 is "no progress", never a 0/0.
 *
 * A run that restarts from the unfolding (the solver does when a sweep blows up)
 * numbers its sweeps from 1 again. The watch takes that as the start of a new
 * run and forgets the old one's windows — there is nothing for the caller to
 * remember to call.
 *
 * Off unless `stall_window` is set, so a solver settings object without the
 * keys behaves exactly as it did before the guard existed. Everything here is
 * comparison and multiplication of doubles — no libm — so the Python port
 * (scripts/flatten_stall.py) reaches the same decision at the same sweep.
 */

export function createStallWatch(solver) {
  const span = solver.stall_window ?? 0;         // sweeps per window; 0 = off
  const minGain = solver.stall_min_gain ?? 0;    // fraction a window must gain on the last to count as progress
  const needed = solver.stall_windows ?? 1;      // windows without progress in a row that make a stall
  let low, last, idle, lastSweep;
  const start = () => { low = Infinity; last = null; idle = 0; lastSweep = 0; };
  start();

  /**
   * Feed the largest vertex move of the sweep just done.
   * @param move   that move, metres
   * @param sweep  sweeps done since the run (re)started, counting this one
   * @param budget sweeps the run may still do after this one
   * @param floor  the convergence threshold (`convergence_m`)
   * @returns true when the run is stuck and should stop
   */
  function step(move, sweep, budget, floor) {
    if (span <= 0) return false;
    if (sweep <= lastSweep) start();             // the count went back to the beginning: a new run
    lastSweep = sweep;
    if (move < low) low = move;
    if (sweep % span !== 0) return false;
    const closed = low;
    low = Infinity;
    if (last === null) { last = closed; return false; }
    const progressed = closed < last * (1 - minGain);
    const pace = last > 0 && closed < last ? closed / last : 1;
    last = closed;
    idle = progressed ? 0 : idle + 1;
    if (idle < needed) return false;
    let projected = closed;
    for (let windows = Math.ceil(budget / span); windows > 0 && !(projected < floor); windows--) projected *= pace;
    return !(projected < floor);
  }

  return { step };
}
