/**
 * Test scaffolding for scripts/test_flatten_worker.mjs — not part of the app.
 *
 * Runs src/features/pattern/flatten_worker.mjs, the file the browser really loads
 * as a Web Worker, on a Node worker thread. The two differ only in the shape of the
 * port: a browser worker sees `self` with onmessage / postMessage, a Node one sees
 * `parentPort`. This gives the entry the browser's shape and forwards the messages,
 * so the shipped file is what answers — not a copy of it.
 */

import { parentPort } from 'node:worker_threads';

globalThis.self = { postMessage: (message) => parentPort.postMessage(message), onmessage: null };
await import('../src/features/pattern/flatten_worker.mjs');
parentPort.on('message', (data) => globalThis.self.onmessage({ data }));
