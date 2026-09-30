/**
 * The worker the viewer's Flatten button hands its pieces to (see flatten_job.mjs,
 * which explains why). A module worker: it imports the same modules the page does,
 * relatively — and only those. An importmap does not reach into a worker, so this
 * file's whole import graph must stay free of bare specifiers such as `three`, and
 * of anything that touches the DOM; scripts/test_flatten_worker.mjs checks both.
 */

import { answerFlatten } from './flatten_job.mjs';

self.onmessage = (event) => { self.postMessage(answerFlatten(event.data)); };
