#!/usr/bin/env python3
"""The stall guard of the relaxation — port of src/core/flatten/flatten_stall.mjs.

Tells relax_pieces when a run that has not converged is not going to, so it can
stop instead of spending its whole budget: the smallest sweep move of each window
of `stall_window` sweeps must beat the last window's by `stall_min_gain`, and
`stall_windows` windows in a row that do not make a stall — unless the pace of the
last window, kept up for every window the budget still has, would reach the floor.
A run that restarts from the unfolding numbers its sweeps from 1 again, which the
watch takes as the start of a new run. Off unless `stall_window` is set. Only
comparison and multiplication of doubles, so the two engines decide at the same
sweep.

Run as a script it answers scripts/test_flatten_stall.mjs: move sequences in on
stdin, the sweep each one stops at (or null) out on stdout."""

from __future__ import annotations

import json
import math
import sys


class StallWatch:
    def __init__(self, solver: dict):
        self.span = solver.get("stall_window", 0)
        self.min_gain = solver.get("stall_min_gain", 0.0)
        self.needed = solver.get("stall_windows", 1)
        self._start()

    def _start(self) -> None:
        self.low = math.inf
        self.last = None
        self.idle = 0
        self.last_sweep = 0

    def step(self, move: float, sweep: int, budget: int, floor: float) -> bool:
        """Feed the largest vertex move of the sweep just done; True = stuck, stop."""
        if self.span <= 0:
            return False
        if sweep <= self.last_sweep:
            self._start()
        self.last_sweep = sweep
        if move < self.low:
            self.low = move
        if sweep % self.span != 0:
            return False
        closed = self.low
        self.low = math.inf
        if self.last is None:
            self.last = closed
            return False
        progressed = closed < self.last * (1 - self.min_gain)
        pace = closed / self.last if (self.last > 0 and closed < self.last) else 1.0
        self.last = closed
        self.idle = 0 if progressed else self.idle + 1
        if self.idle < self.needed:
            return False
        projected = closed
        windows = math.ceil(budget / self.span)
        while windows > 0 and not (projected < floor):
            projected *= pace
            windows -= 1
        return not (projected < floor)


def stop_sweep(seq: dict):
    """The absolute sweep at which the watch stops one recorded run, or None. The
    caller's own order: the convergence test first, then the watch; a restart
    (`restarts`: the sweeps after which the count starts over) numbers from 1 again."""
    watch = StallWatch(seq["solver"])
    restarts = set(seq.get("restarts", []))
    sweep = 0
    for i, move in enumerate(seq["moves"], start=1):
        sweep += 1
        if move < seq["floor"]:
            return None
        if watch.step(move, sweep, seq["cap"] - i, seq["floor"]):
            return i
        if i in restarts:
            sweep = 0
    return None


if __name__ == "__main__":
    print(json.dumps([{"id": s["id"], "stops_at": stop_sweep(s)} for s in json.load(sys.stdin)]))
