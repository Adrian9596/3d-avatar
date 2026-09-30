/**
 * Flattening off the main thread.
 *
 * `flattenDraft` is a few thousand relaxation sweeps — from tens of milliseconds
 * on a cup to several seconds on the thin, slowly settling pieces of a full
 * pattern — and it is one synchronous call, so run on the page's own thread it
 * freezes the whole viewer (orbit, pen, panels) for as long as it takes. This
 * module is the two halves that move it into a Web Worker without changing what
 * it computes:
 *
 * - `answerFlatten` is what the worker does with a request: it calls the very
 *   `flattenDraft` the main thread would have, so the result is the same numbers.
 * - `createFlattenRunner` is the main-thread side: one job at a time, the newest
 *   wins, a worker that cannot start is not an outage.
 *
 * No DOM in here, and no `Worker` either — the host hands `spawn` in, so the
 * runner can be tested with a stand-in thread and run in Node.
 *
 * A job in flight cannot be interrupted from outside (it is a tight loop that
 * never yields), so the only way to drop a stale job is to end its worker and
 * start a fresh one for the next. That is cheap next to the flatten itself and
 * is what keeps a landmark drag — which asks for a new flatten every 150 ms —
 * from queuing seconds of work nobody will look at.
 */

import { flattenDraft } from './pattern_draft.mjs';

/** A job that was dropped because a newer one (or a cancel) came first. Not a
 *  failure: the caller just does nothing with it. */
export class FlattenSuperseded extends Error {
  constructor(why = 'superseded by a newer flatten') {
    super(why);
    this.name = 'FlattenSuperseded';
    this.superseded = true;
  }
}
export const isSuperseded = (error) => Boolean(error && error.superseded === true);

/**
 * The worker's half. Never throws: a failure travels back as data, so a bad
 * request cannot leave the page waiting for a reply that will never come.
 * @param request { id, pieces, solver? } — pieces as draftPieces returns them
 * @returns { id, ok: true, result } or { id, ok: false, error }
 */
export function answerFlatten(request) {
  const id = request && request.id;
  try {
    return { id, ok: true, result: flattenDraft(request.pieces, request.solver) };
  } catch (error) {
    return { id, ok: false, error: String((error && error.message) || error) };
  }
}

/**
 * The main thread's half.
 * @param spawn  () => worker — anything with postMessage, terminate and the
 *               onmessage / onerror / onmessageerror properties. Absent or
 *               throwing means "no worker here": every job then runs inline.
 * @param inline the flatten to run on this thread when there is no worker
 * @param defer  how to yield before an inline job starts, so the page can paint
 *               its "flattening" state first
 * @param timeoutMs  how long a worker may go without answering before the job is
 *               taken back and finished here. A worker that fails outright fires
 *               `error`, but one that loads and then never answers (a handler that
 *               does not match, a thread killed under it) would leave the page on
 *               "flattening" for ever. A flatten is bounded by its sweep limit — a
 *               few seconds at most — so a minute is long past any real job.
 */
export function createFlattenRunner({ spawn = null, inline = flattenDraft, defer = (fn) => setTimeout(fn, 0), timeoutMs = 60000 } = {}) {
  let worker = null;                 // the live worker, if there is one
  let job = null;                    // the one job in flight: { id, pieces, solver, resolve, reject }
  let mode = spawn ? 'worker' : 'inline';
  let reason = spawn ? null : 'no worker available';
  let ids = 0, spawned = 0;

  function stop() {
    if (!worker) return;
    const gone = worker;
    worker = null;
    gone.onmessage = gone.onerror = gone.onmessageerror = null;   // a reply from a worker we ended is nobody's
    try { gone.terminate(); } catch { /* already gone */ }
  }

  const stopClock = (j) => { if (j.timer) { clearTimeout(j.timer); j.timer = null; } };

  /** Give up on the job in flight (if any) and end the worker running it. */
  function retire(error) {
    if (!job) return;
    const dropped = job;
    job = null;
    stopClock(dropped);
    stop();
    dropped.reject(error);
  }

  /** From now on run on this thread — the worker could not start or died. */
  function fallBack(why) {
    mode = 'inline';
    reason = why;
    stop();
  }

  function runInline(j) {
    stopClock(j);
    defer(() => {
      if (job !== j) return;         // dropped before it got its turn
      job = null;
      try { j.resolve(inline(j.pieces, j.solver)); } catch (error) { j.reject(error); }
    });
  }

  function onMessage(event) {
    const data = event && event.data;
    if (!job || !data || data.id !== job.id) return;   // a reply to a job that is no longer wanted
    const done = job;
    job = null;
    stopClock(done);
    if (data.ok) done.resolve(data.result); else done.reject(new Error(data.error));
  }

  function onSilence(j) {
    if (job !== j) return;
    fallBack(`worker did not answer within ${timeoutMs / 1000}s`);
    runInline(j);
  }

  function onError(event) {
    // the script did not load, or the thread died: this job and every later one
    // finish here, on the main thread, as they did before there was a worker
    fallBack(`worker failed: ${(event && event.message) || 'unknown error'}`);
    if (job) runInline(job);
  }

  return {
    /** Flatten `pieces` (as draftPieces returns them). Resolves with what
     *  flattenDraft returns; rejects with FlattenSuperseded if a newer run or a
     *  cancel got there first. Never resolves before the caller has returned. */
    run(pieces, solver) {
      retire(new FlattenSuperseded());
      const id = ++ids;
      return new Promise((resolve, reject) => {
        const j = { id, pieces, solver, resolve, reject };
        job = j;
        if (mode !== 'worker') { runInline(j); return; }
        try {
          if (!worker) {
            worker = spawn();
            spawned++;
            worker.onmessage = onMessage;
            worker.onerror = onError;
            worker.onmessageerror = onError;
          }
          worker.postMessage({ id, pieces, solver });
          j.timer = setTimeout(() => onSilence(j), timeoutMs);
        } catch (error) {
          fallBack(`worker unavailable: ${(error && error.message) || error}`);
          runInline(j);
        }
      });
    },
    /** Drop the job in flight, if any. */
    cancel() { retire(new FlattenSuperseded('cancelled')); },
    /** Drop the job in flight and end the worker too. */
    dispose() { retire(new FlattenSuperseded('disposed')); stop(); },
    /** Where jobs run, and why not in a worker when they do not. */
    info() { return { mode, reason, spawned, busy: job !== null }; },
  };
}
