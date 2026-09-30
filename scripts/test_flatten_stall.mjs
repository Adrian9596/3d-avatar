#!/usr/bin/env node
/**
 * Gate for the stall guard of the flattening solver
 * (src/core/flatten/flatten_stall.mjs, used by relaxPieces).
 *
 * The solver stops on one condition: no vertex moved more than `convergence_m`
 * in a sweep. A run that cannot meet it used to burn the whole `max_iterations`
 * budget and then report "did not converge". The guard stops such a run early —
 * but ONLY a run that is really stuck: it must never stop one that would have
 * converged, and never one that is merely slow and still improving (the avatar's
 * thin straps and wing tabs are slow, not stuck: their sweep move falls the whole
 * way to the limit). That is what this gate holds it to, three ways:
 *
 * 1. THE RULE, on move sequences. The expected answer for each sequence comes
 *    from a plain loop written here over the whole sequence at once (window
 *    minima first, then a scan) — not from the streaming code under test. The very
 *    same sequences are then given to the Python port (scripts/flatten_stall.py),
 *    which must stop at the same sweep on every one.
 * 2. THE ENGINE. On every patch of scripts/flatten_cases.json the guard changes
 *    nothing: same sweeps, same layout to the last bit, never `stalled`. On the
 *    patches of scripts/flatten_stall_cases.json the guard has something to
 *    decide — a run that cannot converge is stopped early; a slow steady run that
 *    will get there is spared even when its windows count as no progress; the same
 *    run with too small a budget is stopped ahead of the limit.
 * 3. THE PORT. scripts/flatten.py (the independent Python engine) ends each of
 *    those runs the same way, at the same sweep, with the same layout.
 *
 * Exit codes: 0 the guard holds, 1 a check failed, 2 an input is missing/stale.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStallWatch, flattenPatch, flattenPieces, DEFAULT_SOLVER } from '../src/core/flatten/flatten_core.mjs';
import { loadAvatarContext, resolveCase } from './flatten_fixtures.mjs';
import { createGate, sha256File as sha256, mm as mmOf } from './gate_report.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASES_PATH = join(ROOT, 'scripts', 'flatten_cases.json');
const STALL_CASES_PATH = join(ROOT, 'scripts', 'flatten_stall_cases.json');
const PYTHON = join(ROOT, 'scripts', 'flatten.py');
const PYTHON_RULE = join(ROOT, 'scripts', 'flatten_stall.py');
const REPORT_PATH = join(ROOT, 'qa', 'avatar_master', 'flatten-stall.json');
const TOLERANCE_MM = 0.001;   // the parity gate's budget between the two engines

const { record, finish, blocked } = createGate();
const mm = (v) => mmOf(v, 6);

// ---------------------------------------------------------------- 1. the rule

// Small numbers so a sequence stays short: a window of 100 sweeps, two idle
// windows make a stall, a window has to beat the last by 2 %.
const RULE = { stall_window: 100, stall_min_gain: 0.02, stall_windows: 2 };
const FLOOR = 1e-9;
const CAP = 5000;

/**
 * The sweep at which the streaming watch first says "stalled", or null. The
 * caller's own order (relaxPieces): the convergence test first — a move under the
 * floor ends the run — then the watch; a restart (`restarts`: the sweeps after
 * which the count starts over) numbers the sweeps from 1 again.
 */
function streamed(seq) {
  const watch = createStallWatch(seq.cfg);
  const restarts = new Set(seq.restarts || []);
  let sweep = 0;
  for (let n = 1; n <= seq.sweeps; n++) {
    sweep++;
    const move = seq.move(n);
    if (move < seq.floor) return null;
    if (watch.step(move, sweep, seq.cap - n, seq.floor)) return n;
    if (restarts.has(n)) sweep = 0;
  }
  return null;
}

/**
 * The same rule stated over the whole sequence: close every window and keep its
 * smallest move; a window "progressed" if it beat the one before by min_gain; a
 * stall is the first window close that ends a run of `windows` windows that did
 * not progress AND from which the pace of the last window, kept up for every
 * window the budget still has, would not reach the floor. (One run, no restart.)
 */
function expected(seq, { reach = true } = {}) {
  const { stall_window: W, stall_min_gain: gain, stall_windows: K } = seq.cfg;
  let converged = Infinity;   // the first sweep whose move is under the floor ends the run
  for (let i = 1; i <= seq.sweeps && converged === Infinity; i++) if (seq.move(i) < seq.floor) converged = i;
  const mins = [];
  for (let n = W; n <= seq.sweeps && n < converged; n += W) {
    let low = Infinity;
    for (let i = n - W + 1; i <= n; i++) low = Math.min(low, seq.move(i));
    mins.push(low);
    if (mins.length < 2) continue;
    let idle = 0;
    for (let j = mins.length - 1; j >= 1 && !(mins[j] < mins[j - 1] * (1 - gain)); j--) idle++;
    if (idle < K) continue;
    const last = mins[mins.length - 2], closed = mins[mins.length - 1];
    const pace = last > 0 ? Math.min(closed / last, 1) : 1;
    const left = Math.ceil((seq.cap - n) / W);
    if (!reach || !(closed * Math.pow(pace, left) < seq.floor)) return n;
  }
  return null;
}

const decay = (from, per100) => (n) => from * Math.pow(per100, n / 100);
const base = { cfg: RULE, floor: FLOOR, cap: CAP, sweeps: CAP };
const sequences = [
  { id: 'off_absent', name: 'rule off when stall_window is absent (an explicit solver without the keys behaves exactly as before)', ...base, cfg: {}, move: () => 1e-6, want: () => null },
  { id: 'off_zero', name: 'rule off when stall_window is 0', ...base, cfg: { stall_window: 0, stall_min_gain: 0.02, stall_windows: 2 }, move: () => 1e-6, want: () => null },
  { id: 'steady_9pct', name: 'a steady 9.5 % fall per window is never a stall', ...base, move: decay(1e-3, 0.905) },
  { id: 'slow_3pct', name: 'a slow 3 % fall per window (above the 2 % bar) is never a stall', ...base, move: decay(1e-3, 0.97) },
  { id: 'slow_1pct', name: 'a 1 % fall per window is a stall after two idle windows', ...base, move: decay(1e-3, 0.99) },
  // falls for 250 sweeps, then stops falling: the plateau of a run that is stuck
  { id: 'plateau', name: 'a plateau after a fall stalls two windows after it flattens', ...base, move: (n) => 1e-3 * Math.pow(0.99, Math.min(n, 250)) },
  // a slow rise, the creep of a piece drifting along a direction nothing holds
  { id: 'creep', name: 'a creeping (slowly rising) move stalls', ...base, move: (n) => 1e-7 * (1 + n / 50000) },
  // spikes on top of an envelope that falls 3 % a window (constant inside a window): the window's MINIMUM falls
  { id: 'spiky', name: 'spikes do not matter: the window minimum is what falls', ...base, move: (n) => decay(1e-4, 0.97)(Math.ceil(n / 100) * 100) * (n % 7 === 0 ? 50 : 1) },
  { id: 'zero', name: 'a move of exactly 0 against a floor of 0 stalls (no 0/0)', ...base, floor: 0, move: () => 0 },
  // 1 % a window, a hair above the floor: it gets there if the budget lasts
  { id: 'near_floor', name: 'a run that will still reach the floor within the budget is left alone', ...base, move: decay(1.05e-9, 0.99) },
  { id: 'near_floor_short', name: 'the same run with no budget left is stopped', ...base, cap: 400, move: decay(1.05e-9, 0.99) },
  // 150 sweeps left is one and a half windows: the half counts (the budget is rounded UP to whole windows), so the pace still gets there
  { id: 'near_floor_partial', name: 'a budget that ends part-way through a window still counts that window', ...base, cap: 450, move: decay(1.05e-9, 0.99) },
  // 250 idle sweeps, a restart, then the same again. A watch that carried its windows over the restart
  // would have two idle windows by sweep 350; started over it takes: one window to open, two idle -> 250 + 300.
  { id: 'restart', name: 'a restart (the sweep count starts over) is a new run: its windows are counted from the restart', ...base, sweeps: 1000, restarts: [250], move: () => 1e-6, want: () => 550, note: 'stops at 250 + 300, not at 350' },
];
for (const s of sequences) s.want = s.want || (() => expected(s));

const python = {};
{
  const realized = sequences.map((s) => ({ id: s.id, solver: s.cfg, floor: s.floor, cap: s.cap, restarts: s.restarts || [], moves: Array.from({ length: s.sweeps }, (_, i) => s.move(i + 1)) }));
  try {
    for (const r of JSON.parse(execFileSync('python3', [PYTHON_RULE], { input: JSON.stringify(realized), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 }))) python[r.id] = r.stops_at;
  } catch (error) {
    blocked(`scripts/flatten_stall.py did not run — ${error.message}`);
  }
}
const ruleRows = [];
for (const s of sequences) {
  const got = streamed(s), want = s.want(), port = python[s.id];
  record(`rule: ${s.name}`, got === want && port === want,
    `stops at sweep ${got ?? 'never'} (expected ${want ?? 'never'}) · python ${port ?? 'never'}${s.note ? ` · ${s.note}` : ''}`);
  ruleRows.push({ id: s.id, stops_at: got });
}
{
  // the fact the reach test rests on, so it cannot pass by accident: with the reach
  // test off the same sequence WOULD stop
  const near = sequences.find((s) => s.id === 'near_floor');
  const without = expected(near, { reach: false });
  record('rule: the reach test is what spares the near-floor run', without !== null && streamed(near) === null, `without it: stops at sweep ${without}`);
}

// -------------------------------------------------------------- 2. the engine

const ctx = loadAvatarContext(ROOT);
if (ctx.error) blocked(ctx.error);
const cases = JSON.parse(readFileSync(CASES_PATH, 'utf8'));
record('the accuracy and parity cases run with the guard ON', cases.solver.stall_window > 0
  && cases.solver.stall_min_gain > 0 && cases.solver.stall_windows > 0
  && DEFAULT_SOLVER.stall_window === cases.solver.stall_window
  && DEFAULT_SOLVER.stall_min_gain === cases.solver.stall_min_gain
  && DEFAULT_SOLVER.stall_windows === cases.solver.stall_windows,
  `window ${cases.solver.stall_window} · gain ${cases.solver.stall_min_gain} · windows ${cases.solver.stall_windows}, the same as DEFAULT_SOLVER`);

const off = { ...cases.solver, stall_window: 0 };
const runOf = (built, solver) => (built.pieces
  ? flattenPieces(built.pieces, solver)
  : flattenPatch(built.sub, solver, built.chords || null));
const layoutOf = (run) => (run.pieces ? run.pieces.map((p) => p.uv) : [run.uv]);
const sameBits = (a, b) => a.length === b.length && a.every((u, i) => u.length === b[i].length && u.every((v, k) => v === b[i][k]));

const unchanged = [];
for (const spec of cases.cases) {
  const built = resolveCase(spec, ctx);
  if (built.error) { record(`engine: ${spec.id} builds`, false, built.error); continue; }
  const on = runOf(built, cases.solver), without = runOf(built, off);
  const ok = on.iterations === without.iterations && on.converged === without.converged && on.stalled === false
    && sameBits(layoutOf(on), layoutOf(without));
  record(`engine: ${spec.id} is unchanged by the guard`, ok,
    `${on.iterations} sweeps either way · converged ${on.converged} · stalled ${on.stalled}`);
  unchanged.push({ id: spec.id, sweeps: on.iterations, converged: on.converged });
}
{
  // slow but steady: plain Jacobi (no acceleration) needs thousands of sweeps on the
  // same patch and must be allowed to take them, at the default bar
  const spec = cases.cases.find((c) => c.id === 'apex_disc_80mm');
  const built = spec && resolveCase(spec, ctx);
  if (!built || built.error) record('engine: a slow, steady run is not stopped', false, built?.error || 'apex_disc_80mm missing');
  else {
    const slow = { ...cases.solver, chebyshev_rho: 0 };
    const on = runOf(built, slow), without = runOf(built, { ...slow, stall_window: 0 });
    record('engine: a slow, steady run (no acceleration, several windows long) is not stopped',
      on.iterations === without.iterations && on.iterations > 3 * cases.solver.stall_window && on.converged && !on.stalled && sameBits(layoutOf(on), layoutOf(without)),
      `${on.iterations} sweeps = ${(on.iterations / cases.solver.stall_window).toFixed(1)} windows, converged, same layout to the last bit`);
  }
}

const stallCases = JSON.parse(readFileSync(STALL_CASES_PATH, 'utf8'));
const stallRows = [];
for (const spec of stallCases.cases) {
  const solver = { ...stallCases.solver, ...(spec.solver || {}) };     // a case may override the file's settings
  const built = resolveCase(spec, ctx);
  if (built.error) { record(`stall: ${spec.id} builds`, false, built.error); continue; }
  const on = runOf(built, solver);
  const without = runOf(built, { ...solver, stall_window: 0 });
  const budget = solver.max_iterations;
  const more = () => runOf(built, { ...solver, stall_window: 0, max_iterations: 4 * budget });   // no guard, four times the budget
  if (spec.expect === 'stalls') {
    // a real stall, not a slow run the guard cut off: given four times the budget it still does not converge
    const long = more();
    record(`stall: ${spec.id} cannot converge, and the guard stops it early, flagged`,
      on.stalled === true && on.converged === false && on.diverged === false && on.iterations < budget
      && without.iterations === budget && without.stalled === false && long.converged === false,
      `stopped at sweep ${on.iterations} of ${budget}; without the guard ${without.iterations}, and ${long.iterations} with four times the budget it still has not converged`);
  } else if (spec.expect === 'spared') {
    // idle windows by the bar it is given, yet the pace it has reaches the floor: left alone, to the last bit
    record(`stall: ${spec.id} has windows that made no progress by its bar, and is spared because it will get there`,
      on.converged === true && on.stalled === false && on.iterations === without.iterations
      && on.iterations > solver.stall_windows * solver.stall_window && sameBits(layoutOf(on), layoutOf(without)),
      `converged at sweep ${on.iterations}, the same as with no guard, same layout to the last bit`);
  } else if (spec.expect === 'ends_short') {
    // the projection: the same steady run, too little budget to finish. It would converge with more.
    const long = more();
    record(`stall: ${spec.id} cannot finish in its budget at its pace, and is stopped ahead of the limit`,
      on.stalled === true && on.converged === false && on.iterations < budget
      && without.iterations === budget && without.converged === false && long.converged === true,
      `stopped at sweep ${on.iterations} of ${budget}; without the guard ${without.iterations} and unfinished; given four times the budget it converges at ${long.iterations}`);
  } else {
    record(`stall: ${spec.id} says what it expects`, false, `expect ${JSON.stringify(spec.expect)}`);
    continue;
  }
  stallRows.push({ id: spec.id, expect: spec.expect, js: { iterations: on.iterations, stalled: on.stalled, converged: on.converged, restarts: on.restarts }, uv: layoutOf(on) });
}

// ---------------------------------------------------------------- 3. the port

let pythonRun;
try {
  pythonRun = JSON.parse(execFileSync('python3', [PYTHON, '--cases', STALL_CASES_PATH], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 }));
} catch (error) {
  blocked(`scripts/flatten.py did not run — ${error.message}`);
}
const byId = Object.fromEntries((pythonRun.results || []).map((r) => [r.id, r]));
const portRows = [];
for (const row of stallRows) {
  const py = byId[row.id];
  if (!py || py.error) { record(`port: ${row.id} produced a result`, false, py?.error || 'missing'); continue; }
  const pyLayout = py.pieces ? py.pieces.map((p) => p.uv) : [py.uv];
  let delta = Infinity;
  if (pyLayout.length === row.uv.length && row.uv.every((u, i) => u.length === pyLayout[i].length)) {
    delta = 0;
    row.uv.forEach((u, i) => u.forEach((v, k) => { delta = Math.max(delta, Math.abs(v - pyLayout[i][k])); }));
  }
  const same = py.iterations === row.js.iterations && py.stalled === row.js.stalled && py.converged === row.js.converged && py.restarts === row.js.restarts;
  record(`port: ${row.id} ends the same way, at the same sweep, with the same layout`, same && delta * 1000 <= TOLERANCE_MM,
    `sweeps js ${row.js.iterations} / python ${py.iterations} · stalled js ${row.js.stalled} / python ${py.stalled} · converged js ${row.js.converged} / python ${py.converged} · max vertex Δ ${mm(delta)}mm`);
  portRows.push({ id: row.id, expect: row.expect, sweeps: { js: row.js.iterations, python: py.iterations }, max_vertex_delta_mm: mm(delta) });
}

finish({ reportPath: REPORT_PATH, relativeTo: ROOT, okDecision: 'STALL_GUARD_HOLDS', body: {
  purpose: 'The solver stops a run that is stuck, and only that: a run that would converge, or that is slow and still improving, is untouched — same sweeps, same layout to the last bit — in both engines.',
  rule: { stall_window: DEFAULT_SOLVER.stall_window, stall_min_gain: DEFAULT_SOLVER.stall_min_gain, stall_windows: DEFAULT_SOLVER.stall_windows },
  engines: { javascript: 'src/core/flatten/flatten_stall.mjs', python: 'scripts/flatten_stall.py' },
  sequences: ruleRows,
  cases: {
    unchanged: { file: relative(ROOT, CASES_PATH), sha256: sha256(CASES_PATH), results: unchanged },
    stall: { file: relative(ROOT, STALL_CASES_PATH), sha256: sha256(STALL_CASES_PATH), results: portRows },
  },
  tolerance_mm: TOLERANCE_MM,
} });
