#!/usr/bin/env node
/**
 * Gate for scripts/keymap.mjs — the one keyboard map both lanes dispatch through.
 *
 * What it proves: no two bindings can mean the same keystroke at once (within a
 * tool, or between a tool and the always layer, unless disjoint by selection);
 * every binding has an id and a label; nothing takes a combination the browser
 * owns; the dispatcher resolves a set of representative keystrokes the way §14
 * says; and the §14 tables of AUTHORING_UX_PLAN.md are what `docTables()`
 * generates — the doc is checked, not trusted. `--write` regenerates them.
 *
 * Exit codes: 0 pass, 1 a check failed.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGate, sha256File, sha256Bytes } from './gate_report.mjs';
import { KEYMAP, CONTEXTS, RESERVED_MOD_LETTERS, conflicts, matchBinding, docTables, cheatSheet } from './keymap.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(ROOT, 'AUTHORING_UX_PLAN.md');
const REPORT = join(ROOT, 'qa', 'avatar_master', 'keymap-test.json');
const write = process.argv.includes('--write');
const gate = createGate();

// ---- the table is well formed ----------------------------------------------
const ids = KEYMAP.map((k) => k.id);
gate.record('every binding has a unique id', new Set(ids).size === ids.length, `${ids.length} bindings`);
gate.record('every binding has a label and at least one key', KEYMAP.every((k) => k.label && k.keys.length), 'labels present');
gate.record('every binding names a known context', KEYMAP.every((k) => CONTEXTS.includes(k.context)), CONTEXTS.join(', '));
gate.record('planned rows name their phase', KEYMAP.filter((k) => k.status === 'planned').every((k) => /^[BCD]$/.test(k.phase)), `${KEYMAP.filter((k) => k.status === 'planned').length} planned, ${KEYMAP.filter((k) => k.status === 'active').length} active`);

// ---- no two bindings collide -----------------------------------------------
const clashes = conflicts();
gate.record('no keystroke can mean two things at once', clashes.length === 0, clashes.length ? clashes.map((c) => `${c.a} × ${c.b} on ${c.keys.join('/')}`).join('; ') : 'within a tool, and between each tool and the always layer');

// ---- nothing the browser owns ---------------------------------------------
const reserved = KEYMAP.filter((k) => k.mods?.mod && k.keys.some((key) => RESERVED_MOD_LETTERS.includes(key)));
gate.record('no binding takes a browser-owned ⌘/Ctrl combination', reserved.length === 0, reserved.length ? reserved.map((k) => k.id).join(', ') : `⌘/Ctrl + ${RESERVED_MOD_LETTERS.join(' ')} left to the browser`);
gate.record('the platform modifier is used only for undo/redo', KEYMAP.filter((k) => k.mods?.mod).every((k) => /undo|redo/.test(k.id)), 'as §14 says');
gate.record('Shift+letter only produces a file or runs a solve', KEYMAP.filter((k) => k.mods?.shift && !k.mods?.mod && /^[A-Z]$/.test(k.keys[0])).every((k) => k.producesFile || /flatten|template|compare/.test(k.id)), 'exports, flatten, template, compare');

// ---- the dispatcher reads representative keystrokes as §14 says ------------
const ev = (key, extra = {}) => ({ key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, target: null, ...extra });
const cases = [
  { name: 'P toggles the pen', event: ev('p'), opts: { contexts: ['always'] }, expect: 'pen.toggle' },
  { name: 'Enter finishes a line in the pen', event: ev('Enter'), opts: { contexts: ['always', 'pen'] }, expect: 'pen.finish' },
  { name: 'Enter outside the pen does nothing', event: ev('Enter'), opts: { contexts: ['always'] }, expect: null },
  { name: 'arrow with nothing selected turns the camera', event: ev('ArrowLeft'), opts: { contexts: ['always', 'pen'], hasSelection: false }, expect: 'camera.yaw-left' },
  { name: 'Shift+arrow still turns the camera (5° step)', event: ev('ArrowLeft', { shiftKey: true }), opts: { contexts: ['always', 'pen'], hasSelection: false }, expect: 'camera.yaw-left' },
  { name: 'arrow with a point selected is not the camera', event: ev('ArrowLeft'), opts: { contexts: ['always', 'pen'], hasSelection: true }, expect: null },
  { name: 'arrow with a point selected nudges once Phase B lands', event: ev('ArrowLeft'), opts: { contexts: ['always', 'pen'], hasSelection: true, includePlanned: true }, expect: 'pen.nudge' },
  { name: '? opens the sheet regardless of Shift', event: ev('?', { shiftKey: true }), opts: { contexts: ['always'] }, expect: 'help.toggle' },
  { name: 'Shift+E exports pen lines', event: ev('E', { shiftKey: true }), opts: { contexts: ['always', 'pen'] }, expect: 'pen.export' },
  { name: 'plain E is nothing', event: ev('e'), opts: { contexts: ['always', 'pen'] }, expect: null },
  { name: 'Shift+F flattens when the pattern block is up', event: ev('F', { shiftKey: true }), opts: { contexts: ['always', 'pen', 'pattern'] }, expect: 'pattern.flatten' },
  { name: 'plain F faces the point', event: ev('f'), opts: { contexts: ['always', 'pen', 'pattern'] }, expect: 'camera.face' },
  { name: '⌘Z on macOS is undo once Phase B lands', event: ev('z', { metaKey: true }), opts: { contexts: ['always', 'pen'], platform: 'mac', includePlanned: true }, expect: 'pen.undo' },
  { name: 'Ctrl+Z on macOS is not ours (Ctrl+click is a right-click there)', event: ev('z', { ctrlKey: true }), opts: { contexts: ['always', 'pen'], platform: 'mac', includePlanned: true }, expect: null },
  { name: 'Ctrl+Z elsewhere is undo once Phase B lands', event: ev('z', { ctrlKey: true }), opts: { contexts: ['always', 'pen'], platform: 'other', includePlanned: true }, expect: 'pen.undo' },
  { name: 'a keystroke in a text field is the field\'s', event: ev('Enter', { target: { nodeType: 1, tagName: 'INPUT' } }), opts: { contexts: ['always', 'pen'] }, expect: null },
  { name: 'L is unknown to the production lane', event: ev('l'), opts: { contexts: ['always'], lane: 'production' }, expect: null },
  { name: 'L opens landmarks in the prototype', event: ev('l'), opts: { contexts: ['always'], lane: 'prototype' }, expect: 'landmarks.toggle' },
  { name: 'Home resets the view', event: ev('Home'), opts: { contexts: ['always'] }, expect: 'view.reset' },
  { name: 'Space is nothing until Phase C', event: ev(' '), opts: { contexts: ['always', 'landmarks'] }, expect: null },
];
const outcomes = cases.map((c) => {
  const got = matchBinding(c.event, c.opts)?.id ?? null;
  return { name: c.name, expect: c.expect, got, ok: got === c.expect };
});
gate.record('the dispatcher resolves the representative keystrokes', outcomes.every((o) => o.ok), outcomes.filter((o) => !o.ok).map((o) => `${o.name}: got ${o.got}`).join('; ') || `${outcomes.length} keystrokes`);

// ---- the overlay shows active rows only, per lane --------------------------
const sheet = cheatSheet({ contexts: ['always', 'pen'], lane: 'production', platform: 'mac' });
const shown = sheet.flatMap((s) => s.rows.map((r) => r.id));
gate.record('the sheet lists active rows of the active contexts for the lane',
  shown.includes('pen.finish') && !shown.includes('landmarks.toggle') && !shown.includes('pen.undo') && !shown.includes('pattern.flatten'),
  `${shown.length} rows for production always+pen`);

// ---- the doc is what the code generates ------------------------------------
const doc = readFileSync(DOC, 'utf8');
const startMark = '### Always';
const endMark = 'Known platform caveats';
const s = doc.indexOf(startMark), e = doc.indexOf(endMark);
let docOk = false;
if (s >= 0 && e > s) {
  const generated = docTables();
  const current = doc.slice(s, e);
  docOk = current === generated;
  if (!docOk && write) {
    writeFileSync(DOC, doc.slice(0, s) + generated + doc.slice(e), 'utf8');
    docOk = true;
  }
}
gate.record('AUTHORING_UX_PLAN.md §14 tables are generated from KEYMAP', docOk, docOk ? (write ? 'rewritten from the code' : 'byte-identical') : 'differs — run `node scripts/test_keymap.mjs --write`');

gate.finish({
  reportPath: REPORT, relativeTo: ROOT, okDecision: 'KEYMAP_CONSISTENT',
  body: {
    purpose: 'One keyboard map for both lanes: conflict-free, browser-safe, and the doc regenerated from it.',
    module: { file: 'scripts/keymap.mjs', sha256: sha256File(join(ROOT, 'scripts', 'keymap.mjs')) },
    keymap_sha256: sha256Bytes(JSON.stringify(KEYMAP)),
    bindings: { total: KEYMAP.length, active: KEYMAP.filter((k) => k.status === 'active').length, planned: KEYMAP.filter((k) => k.status === 'planned').length },
    keystrokes: outcomes,
  },
});
