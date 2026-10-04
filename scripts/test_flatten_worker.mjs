#!/usr/bin/env node
/**
 * Gate for moving the flatten off the page's thread (src/features/pattern/
 * flatten_job.mjs, flatten_worker.mjs; wired in src/ui/viewer/pattern_panel.mjs).
 *
 * A flatten is a tight loop of thousands of sweeps. Run on the page's own thread
 * it freezes the viewer for as long as it takes — a second or several on a full
 * pattern. Moving it into a Web Worker must change WHERE it runs and nothing
 * else, and must never leave the person without a result. Held four ways:
 *
 * 1. SAME NUMBERS. What the worker answers, and what the runner hands back, is
 *    exactly what `flattenDraft` returns on the page's thread — deep-equal,
 *    down to the last bit — on the real two-panel cut of the avatar.
 * 2. REALLY OFF THE THREAD. The shipped worker file runs on a Node worker thread
 *    (scripts/flatten_worker_shim.mjs only gives it the browser's `self`). While
 *    it works, the main thread keeps running; the same job run on it does not.
 * 3. THE RUNNER'S RULES, against a stand-in thread that can be told exactly what
 *    to do: one job at a time, the newest wins and a stale reply is nobody's, an
 *    error reply is an error and not a hang, a worker that cannot start (no
 *    Worker, script fails to load, message that cannot be cloned) means the job
 *    finishes inline and stays there.
 * 4. WHAT A WORKER CAN LOAD. A worker gets no importmap and no DOM: the entry's
 *    whole import graph has to be relative modules that never touch either, and
 *    the page has to create it in the one form the bundler recognises.
 *
 * Exit codes: 0 all checks pass, 1 a check failed, 2 an input is missing.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';
import { deepStrictEqual } from 'node:assert';

import { createFlattenRunner, answerFlatten, isSuperseded, FlattenSuperseded } from '../src/features/pattern/flatten_job.mjs';
import { flattenDraft } from '../src/features/pattern/pattern_draft.mjs';
import { DEFAULT_SOLVER } from '../src/core/flatten/flatten_core.mjs';
import { loadAvatarContext, resolveCase } from './flatten_fixtures.mjs';
import { createGate } from './gate_report.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = join(ROOT, 'qa', 'avatar_master', 'flatten-worker-test.json');
const ENTRY = 'src/features/pattern/flatten_worker.mjs';
const PANEL = 'src/ui/viewer/pattern_panel.mjs';

const { record, finish, blocked } = createGate();
const lines = [];   // timings: printed, never written to the evidence (they differ on every run)

const tick = () => new Promise((resolve) => setImmediate(resolve));
/** A promise's state, readable after a tick, without awaiting it. */
function watch(promise) {
  const state = { state: 'pending' };
  promise.then((value) => { state.state = 'resolved'; state.value = value; }, (error) => { state.state = 'rejected'; state.error = error; });
  return state;
}
const equal = (a, b) => { try { deepStrictEqual(a, b); return true; } catch { return false; } };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** A check that throws is a failed check with a name, not a stack trace. */
async function attempt(name, body) {
  try { await body(); } catch (error) { record(name, false, String((error && error.message) || error)); }
}
/** A real thread that never answers must fail the gate, not hang it. The deadline is dropped
 *  as soon as there is an answer: a timer left pending would keep this process alive for it. */
function within(promise, ms, what) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: no answer within ${ms / 1000}s`)), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// ------------------------------------------------------------- the real pieces

const ctx = loadAvatarContext(ROOT);
if (ctx.error) blocked(ctx.error);
const cases = JSON.parse(readFileSync(join(ROOT, 'scripts', 'flatten_cases.json'), 'utf8'));
const built = resolveCase(cases.cases.find((c) => c.id === 'apex_panels_75mm'), ctx);
if (built.error || !built.pieces || built.pieces.some((p) => p.error)) blocked(built.error || 'apex_panels_75mm did not build');
const pieces = built.pieces;
const expected = flattenDraft(pieces);

// ------------------------------------------------------------ 1. the same numbers

{
  const answer = answerFlatten({ id: 7, pieces });
  record('answerFlatten returns exactly what flattenDraft returns', answer.id === 7 && answer.ok === true && equal(answer.result, expected),
    `${pieces.length} pieces, ${expected.run.iterations} sweeps, sound ${expected.sound}`);
  const short = { ...DEFAULT_SOLVER, max_iterations: 5 };
  const forwarded = answerFlatten({ id: 8, pieces, solver: short });
  record('the solver settings in the request are the ones used', forwarded.ok && forwarded.result.run.iterations === 5 && equal(forwarded.result, flattenDraft(pieces, short)),
    'a request naming max_iterations 5 stops at sweep 5');
  const failed = answerFlatten({ id: 9, pieces: null });
  record('a bad request is answered with an error, not thrown', failed.id === 9 && failed.ok === false && typeof failed.error === 'string' && failed.error.length > 0, `error: ${failed.error}`);
}

// ------------------------------------------------- 2. really off the page's thread

/** A Node worker thread wearing the browser Worker's shape. */
function nodeThread() {
  const thread = new NodeWorker(new URL('./flatten_worker_shim.mjs', import.meta.url));
  const port = { onmessage: null, onerror: null, onmessageerror: null,
    postMessage: (data) => thread.postMessage(data), terminate: () => thread.terminate() };
  thread.on('message', (data) => port.onmessage?.({ data }));
  thread.on('error', (error) => port.onerror?.({ message: String(error?.message || error) }));
  return port;
}

// a job long enough to see: the same cut, run past convergence with the guards off
const heavySolver = { ...DEFAULT_SOLVER, chebyshev_rho: 0, convergence_m: 0, stall_window: 0, max_iterations: 60000 };

await attempt('the shipped worker file answers on a real thread', async () => {
  const runner = createFlattenRunner({ spawn: nodeThread });
  try {
    const got = await within(runner.run(pieces), 30000, 'first job');
    record('the shipped worker file, on a real thread, returns exactly what the main thread computes', equal(got, expected),
      `${expected.run.iterations} sweeps, ${expected.reports.length} reports, deep-equal`);
    const info1 = runner.info();
    const again = await within(runner.run(pieces), 30000, 'second job');
    record('the same worker serves the next job', equal(again, expected) && runner.info().spawned === 1 && info1.mode === 'worker',
      `one worker spawned for two jobs, mode ${info1.mode}`);

    // responsiveness: a timer that ticks every 5 ms, while a long job runs
    let last = performance.now(), worst = 0;
    const beat = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; }, 5);
    const t0 = performance.now();
    const heavy = await within(runner.run(pieces, heavySolver), 60000, 'heavy job');
    const workerMs = performance.now() - t0;
    clearInterval(beat);

    // the control: the same job on this thread — a timer set before it cannot fire until it is over
    let late = 0;
    const armed = performance.now();
    const timer = new Promise((resolve) => setTimeout(() => { late = performance.now() - armed; resolve(); }, 1));
    const inlineHeavy = flattenDraft(pieces, heavySolver);
    await timer;

    lines.push(`TIMING worker job ${Math.round(workerMs)}ms, longest gap between 5ms ticks on the main thread ${Math.round(worst)}ms; same job inline blocked the main thread ${Math.round(late)}ms`);
    record('the same heavy job on the worker and on the main thread agree', equal(heavy, inlineHeavy), `${heavy.run.iterations} sweeps`);
    record('while the worker runs a long job the main thread keeps running', workerMs > 200 && worst < 100 && late > 200 && late > 3 * worst,
      'ticks kept coming during the job; the same job inline held every timer until it was over');
  } finally { runner.dispose(); }
});
await attempt('a newer job drops the long one on a real thread', async () => {
  // newest wins, with real threads: the long job is dropped, its thread ended
  const runner = createFlattenRunner({ spawn: nodeThread });
  try {
    const slow = watch(runner.run(pieces, heavySolver));
    const fast = await within(runner.run(pieces), 30000, 'job after a dropped one');
    await tick();
    record('a newer job drops the long one running on a real thread and is answered', slow.state === 'rejected' && isSuperseded(slow.error) && equal(fast, expected) && runner.info().spawned === 2,
      'the first job rejected as superseded, the second answered, two workers spawned (the busy one ended)');
  } finally { runner.dispose(); }
});

// ------------------------------------------------------- 3. the runner's rules

class FakeWorker {
  constructor() { this.sent = []; this.terminated = false; this.onmessage = this.onerror = this.onmessageerror = null; this.throwOnPost = null; this.failOnPost = null; }
  postMessage(message) {
    if (this.throwOnPost) throw this.throwOnPost;
    this.sent.push(message);
    if (this.failOnPost) queueMicrotask(() => this.onerror?.({ message: this.failOnPost }));
  }
  terminate() { this.terminated = true; }
  reply(data) { this.onmessage?.({ data }); }
}
function standIn(options = {}) {
  const workers = [];
  const spawn = () => { const w = new FakeWorker(); Object.assign(w, options.each || {}); workers.push(w); return w; };
  return { workers, spawn };
}
const noInline = () => { throw new Error('the inline flatten must not run'); };

await attempt('runner rules, block 1', async () => {
  const { workers, spawn } = standIn();
  const runner = createFlattenRunner({ spawn, inline: noInline });
  const job = watch(runner.run(['P'], { s: 1 }));
  await tick();
  const sent = workers[0]?.sent[0];
  const before = job.state === 'pending' && runner.info().busy && workers.length === 1 && workers[0].sent.length === 1 && equal(sent, { id: 1, pieces: ['P'], solver: { s: 1 } });
  workers[0].reply({ id: 1, ok: true, result: 'R' });
  await tick();
  record('a job is posted once, stays pending until the worker answers, then resolves', before && job.state === 'resolved' && job.value === 'R' && !runner.info().busy,
    'request {id, pieces, solver} posted; nothing resolved before the reply');
});
await attempt('runner rules, block 2', async () => {
  const { workers, spawn } = standIn();
  const runner = createFlattenRunner({ spawn, inline: noInline });
  const first = watch(runner.run(['A']));
  await tick();
  const second = watch(runner.run(['B']));
  await tick();
  workers[0].reply({ id: 1, ok: true, result: 'stale' });          // the ended worker's reply, if it ever arrived
  await tick();
  const dropped = first.state === 'rejected' && isSuperseded(first.error) && first.error instanceof FlattenSuperseded && second.state === 'pending' && workers[0].terminated && workers.length === 2;
  workers[1].reply({ id: 2, ok: true, result: 'fresh' });
  await tick();
  record('newest wins: the old job is dropped and its worker ended, a late reply to it is ignored', dropped && second.state === 'resolved' && second.value === 'fresh',
    'first rejected as superseded, first worker terminated, second worker answered');
});
await attempt('runner rules, block 3', async () => {
  const { workers, spawn } = standIn();
  const runner = createFlattenRunner({ spawn, inline: noInline });
  const job = watch(runner.run(['A']));
  await tick();
  runner.cancel();
  await tick();
  workers[0].reply({ id: 1, ok: true, result: 'late' });
  await tick();
  record('cancel drops the job and ends the worker', job.state === 'rejected' && isSuperseded(job.error) && workers[0].terminated && !runner.info().busy, 'rejected as superseded, worker terminated');
});
await attempt('runner rules, block 4', async () => {
  const { workers, spawn } = standIn();
  const runner = createFlattenRunner({ spawn, inline: noInline });
  const bad = watch(runner.run(['A']));
  await tick();
  workers[0].reply({ id: 1, ok: false, error: 'boom' });
  await tick();
  const rejected = bad.state === 'rejected' && !isSuperseded(bad.error) && bad.error.message === 'boom' && !workers[0].terminated;
  const next = watch(runner.run(['B']));
  await tick();
  workers[0].reply({ id: 2, ok: true, result: 'fine' });
  await tick();
  record('an error reply rejects that job only; the worker is kept and serves the next', rejected && next.state === 'resolved' && workers.length === 1 && runner.info().mode === 'worker',
    'rejected with the worker\'s message, one worker for both jobs');
});
await attempt('runner rules, block 5', async () => {
  // a reply carrying an old job's id, through a worker that is still alive: not the answer to this job
  const { workers, spawn } = standIn();
  const runner = createFlattenRunner({ spawn, inline: noInline });
  const first = watch(runner.run(['A']));
  await tick();
  workers[0].reply({ id: 1, ok: false, error: 'first failed' });
  await tick();
  const second = watch(runner.run(['B']));
  await tick();
  workers[0].reply({ id: 1, ok: true, result: 'ghost of the first job' });      // same worker, old id
  await tick();
  const ignored = second.state === 'pending' && first.state === 'rejected';
  workers[0].reply({ id: 2, ok: true, result: 'answer to the second' });
  await tick();
  record('a reply that carries another job\'s id is ignored', ignored && second.state === 'resolved' && second.value === 'answer to the second' && workers.length === 1,
    'the ghost of job 1 left job 2 pending; job 2 resolved with its own answer');
});
await attempt('runner rules, block 6', async () => {
  const { workers, spawn } = standIn({ each: { failOnPost: 'script did not load' } });
  const seen = [];
  const runner = createFlattenRunner({ spawn, inline: (p, s) => { seen.push(p); return { ran: 'inline', p }; }, defer: queueMicrotask });
  const job = watch(runner.run(['A']));
  await tick();
  const first = job.state === 'resolved' && equal(job.value, { ran: 'inline', p: ['A'] }) && workers[0].terminated;
  const info = runner.info();
  const next = watch(runner.run(['B']));
  await tick();
  record('a worker that fails to start: the job finishes inline, and so do all later ones', first && info.mode === 'inline' && /script did not load/.test(info.reason)
    && next.state === 'resolved' && workers.length === 1 && seen.length === 2,
    'resolved by the inline flatten, worker ended, no second worker, reason recorded');
});
await attempt('runner rules, block 7', async () => {
  let asked = 0;
  const runner = createFlattenRunner({ spawn: () => { asked++; throw new ReferenceError('Worker is not defined'); }, inline: (p) => ({ ran: 'inline', p }), defer: queueMicrotask });
  const job = watch(runner.run(['A']));
  await tick();
  const next = watch(runner.run(['B']));
  await tick();
  record('no Worker in this environment: every job runs inline', job.state === 'resolved' && next.state === 'resolved' && asked === 1 && runner.info().mode === 'inline' && /Worker is not defined/.test(runner.info().reason),
    'the spawn was tried once, then never again');
});
await attempt('runner rules, block 8', async () => {
  const { workers, spawn } = standIn({ each: { throwOnPost: new DOMException('could not be cloned', 'DataCloneError') } });
  const runner = createFlattenRunner({ spawn, inline: (p) => ({ ran: 'inline', p }), defer: queueMicrotask });
  const job = watch(runner.run(['A']));
  await tick();
  record('a request that cannot be posted (not cloneable) finishes inline', job.state === 'resolved' && job.value.ran === 'inline' && runner.info().mode === 'inline' && workers[0].terminated,
    'postMessage threw DataCloneError, the job ran inline');
});
await attempt('runner rules, block 9', async () => {
  // a worker that loads but never answers (a handler that does not match, a thread killed out from under it)
  const { workers, spawn } = standIn();
  const ran = [];
  const runner = createFlattenRunner({ spawn, inline: (p) => { ran.push(p[0]); return { ran: 'inline', p }; }, defer: queueMicrotask, timeoutMs: 40 });
  const job = watch(runner.run(['A']));
  await pause(120);
  const info = runner.info();
  const next = watch(runner.run(['B']));
  await pause(30);
  record('a worker that never answers: after the deadline the job finishes inline, and the runner stays inline', job.state === 'resolved' && job.value.ran === 'inline' && workers[0].terminated
    && info.mode === 'inline' && /did not answer/.test(info.reason) && next.state === 'resolved' && workers.length === 1 && equal(ran, ['A', 'B']),
    'resolved by the inline flatten, worker ended, reason recorded, the next job never went to a worker');
});
await attempt('runner rules, block 10', async () => {
  // ... and a worker that DOES answer in time is not held to a deadline afterwards
  const { workers, spawn } = standIn();
  const runner = createFlattenRunner({ spawn, inline: noInline, defer: queueMicrotask, timeoutMs: 60 });
  const job = watch(runner.run(['A']));
  await pause(10);
  workers[0].reply({ id: 1, ok: true, result: 'in time' });
  await pause(150);
  record('an answer in time cancels the deadline', job.state === 'resolved' && job.value === 'in time' && runner.info().mode === 'worker' && !workers[0].terminated,
    'still a worker after the deadline would have passed');
});
await attempt('runner rules, block 11', async () => {
  // a dropped job's deadline must not fire against the job that replaced it
  const { workers, spawn } = standIn();
  const runner = createFlattenRunner({ spawn, inline: noInline, defer: queueMicrotask, timeoutMs: 60 });
  const dropped = watch(runner.run(['A']));
  await pause(10);
  const second = watch(runner.run(['B']));
  await pause(10);
  workers[1].reply({ id: 2, ok: true, result: 'B answered' });
  await pause(150);
  record('a dropped job\'s deadline does not fire on the job that replaced it', dropped.state === 'rejected' && isSuperseded(dropped.error) && second.state === 'resolved' && second.value === 'B answered' && runner.info().mode === 'worker',
    'the second job resolved by its worker, no fall back to inline');
});
await attempt('runner rules, block 12', async () => {
  const queue = [];
  const ran = [];
  const runner = createFlattenRunner({ spawn: null, inline: (p) => { ran.push(p[0]); return p[0]; }, defer: (fn) => queue.push(fn) });
  const a = watch(runner.run(['A']));
  const b = watch(runner.run(['B']));
  const syncNow = a.state === 'pending' && b.state === 'pending' && ran.length === 0;   // nothing resolves inside run()
  queue.splice(0).forEach((fn) => fn());
  await tick();
  record('inline: it yields first, and a job dropped before its turn never runs', syncNow && a.state === 'rejected' && isSuperseded(a.error) && b.state === 'resolved' && b.value === 'B' && equal(ran, ['B']),
    'A superseded before it started, only B ran');
});
await attempt('runner rules, block 13', async () => {
  const runner = createFlattenRunner({ spawn: null, inline: () => { throw new Error('the flatten itself failed'); }, defer: queueMicrotask });
  const job = watch(runner.run(['A']));
  await tick();
  record('inline: a failure of the flatten itself rejects the job with that error', job.state === 'rejected' && !isSuperseded(job.error) && /flatten itself failed/.test(job.error.message), 'rejected, not superseded');
});

// -------------------------------------------------------- 4. what a worker can load

const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const specifiers = (code) => {
  const out = [];
  for (const re of [/\bimport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    for (const m of code.matchAll(re)) out.push(m[1]);
  }
  return [...new Set(out)];
};
const WINDOWED = ['document', 'window', 'localStorage', 'sessionStorage', 'navigator', 'requestAnimationFrame', 'HTMLElement'];
const reached = new Set();
const problems = [];
(function visit(file) {
  if (reached.has(file)) return;
  reached.add(file);
  const code = strip(readFileSync(join(ROOT, file), 'utf8'));
  for (const spec of specifiers(code)) {
    if (!spec.startsWith('.')) problems.push(`${file} imports the package ${spec}`);
    else visit(posix.normalize(posix.join(posix.dirname(file), spec)));
  }
  for (const word of WINDOWED) if (new RegExp(`\\b${word}\\b`).test(code)) problems.push(`${file} mentions ${word}`);
})(ENTRY);
record('the worker\'s import graph is relative modules only, and none touches the DOM', problems.length === 0,
  problems.join('; ') || `${reached.size} modules: ${[...reached].map((f) => f.replace(/^src\//, '')).sort().join(', ')}`);

{
  const panel = readFileSync(join(ROOT, PANEL), 'utf8');
  const form = /new Worker\(\s*new URL\(\s*'([^']+)'\s*,\s*import\.meta\.url\s*\)\s*,\s*\{\s*type:\s*'module'\s*\}\s*\)/.exec(panel);
  const target = form && posix.normalize(posix.join(posix.dirname(PANEL), form[1]));
  record('the page creates the worker in the one form the bundler recognises, and it points at the entry', Boolean(form) && target === ENTRY,
    form ? `new Worker(new URL('${form[1]}', import.meta.url), { type: 'module' }) → ${target}` : `no \`new Worker(new URL('…', import.meta.url), { type: 'module' })\` in ${PANEL}`);
  const entry = readFileSync(join(ROOT, ENTRY), 'utf8');
  record('the entry answers every message through answerFlatten', /self\.onmessage\s*=/.test(entry) && /self\.postMessage\(\s*answerFlatten\(\s*event\.data\s*\)\s*\)/.test(entry), 'self.onmessage → self.postMessage(answerFlatten(event.data))');
}

finish({ reportPath: REPORT_PATH, relativeTo: ROOT, okDecision: 'FLATTEN_OFF_THREAD', lines, body: {
  purpose: 'The flatten runs in a Web Worker and returns exactly what it returns on the page\'s thread; one job at a time, the newest wins, and a worker that cannot start is not an outage.',
  entry: ENTRY,
  worker_modules: [...reached].sort(),
  case: { id: 'apex_panels_75mm', pieces: pieces.map((p) => p.name), sweeps: expected.run.iterations },
} });
