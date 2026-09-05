/**
 * The keyboard map of both viewer lanes, as data. One source: the hosts dispatch
 * through `matchBinding`, the `?` overlay is built from `cheatSheet`, and
 * AUTHORING_UX_PLAN.md §14 is regenerated from `docTables` — the doc is checked
 * against this file by `scripts/test_keymap.mjs`, not trusted.
 *
 * Rules the table follows (the test enforces the checkable ones):
 * - single keys for what is done most; a held modifier only for snaps;
 *   Shift+letter only for actions that produce a file or run a solve; the
 *   platform modifier (⌘ on macOS, Ctrl elsewhere) only for undo/redo;
 * - nothing binds a combination the browser owns (`RESERVED_MOD_LETTERS`);
 * - arrows act on the selection: with a point selected they nudge, otherwise
 *   they turn the camera — `needsSelection` keeps the two disjoint;
 * - contexts are exclusive tools over an `always` layer: a tool may reuse
 *   another tool's key, never shadow an `always` key;
 * - no key fires in a text field (`isTextEntry`).
 *
 * `status: 'planned'` rows are bound to nothing yet: they exist so the map is
 * planned as a whole and stays free of conflicts as phases land. The overlay
 * shows active rows only; the doc shows both and says which is which.
 */

export const CONTEXTS = Object.freeze(['always', 'pen', 'landmarks', 'pattern']);
export const CONTEXT_TITLES = Object.freeze({
  always: 'Always', pen: 'Pen', landmarks: 'Landmarks *(prototype)*', pattern: 'Pattern block *(prototype)*',
});
/** ⌘/Ctrl + one of these is the browser's, never ours. */
export const RESERVED_MOD_LETTERS = Object.freeze(['S', 'P', 'W', 'N', 'T', 'L', 'D', 'F', 'R', 'H', 'J', 'K', 'O', 'U', 'Q', 'E']);

const b = (id, keys, context, label, extra = {}) => Object.freeze({ id, keys, context, label, status: 'active', ...extra });
const planned = (phase, id, keys, context, label, extra = {}) => b(id, keys, context, label, { ...extra, status: 'planned', phase });

export const KEYMAP = Object.freeze([
  // ---- always ---------------------------------------------------------------
  b('pen.toggle', ['P'], 'always', 'Pen on / off'),
  b('landmarks.toggle', ['L'], 'always', 'Landmarks panel on / off', { lane: 'prototype' }),
  b('tapes.toggle', ['T'], 'always', 'Tape lines on / off'),
  b('section.toggle', ['X'], 'always', 'Section tool on / off', { lane: 'prototype' }),
  b('view.front', ['1'], 'always', 'Front view'),
  b('view.three-quarter', ['2'], 'always', 'Three-quarter view'),
  b('view.side', ['3'], 'always', 'Side view'),
  b('view.back', ['4'], 'always', 'Back view'),
  b('view.reset', ['0', 'Home'], 'always', 'Reset view (frame the body)'),
  b('camera.yaw-left', ['ArrowLeft'], 'always', 'Turntable 15° left about the body\'s vertical (Shift: 5°) — nothing selected', { needsSelection: false, shiftOptional: true }),
  b('camera.yaw-right', ['ArrowRight'], 'always', 'Turntable 15° right (Shift: 5°) — nothing selected', { needsSelection: false, shiftOptional: true }),
  b('camera.pitch-up', ['ArrowUp'], 'always', 'Elevation +15° (Shift: 5°) — nothing selected', { needsSelection: false, shiftOptional: true }),
  b('camera.pitch-down', ['ArrowDown'], 'always', 'Elevation −15° (Shift: 5°) — nothing selected', { needsSelection: false, shiftOptional: true }),
  b('camera.face', ['F'], 'always', 'Face the selected point along its surface normal; a selected landmark row → frame its region; nothing selected, the point under the cursor'),
  b('loupe.toggle', ['Z'], 'always', 'Loupe on / off'),
  b('snap.toggle', ['N'], 'always', 'Snapping on / off'),
  b('help.toggle', ['?'], 'always', 'Shortcut sheet'),
  b('escape', ['Escape'], 'always', 'Deselect; nothing selected → leave the current tool; sheet open → close it'),

  // ---- pen ------------------------------------------------------------------
  b('pen.finish', ['Enter'], 'pen', 'Finish the line'),
  b('pen.close', ['C'], 'pen', 'Close the loop and finish (≥ 3 anchors)'),
  b('pen.delete', ['Backspace', 'Delete'], 'pen', 'Delete the selected point; nothing selected → undo the last pinned point'),
  b('pen.undo', ['Z'], 'pen', 'Undo (pin, move, snap, delete, close, rename, mirror)', { mods: { mod: true } }),
  b('pen.redo', ['Z'], 'pen', 'Redo', { mods: { mod: true, shift: true } }),
  b('pen.nudge', ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], 'pen', 'Nudge the selected point 1 px along the skin (Shift: 10 px)', { needsSelection: true, shiftOptional: true }),
  b('pen.snap-level', ['Shift'], 'pen', 'Level snap while pinning: same height as the previous anchor', { hold: true }),
  b('pen.snap-mirror', ['Alt'], 'pen', 'Mirror snap while pinning: mirror of the previous anchor (of the line being drawn, else the selected line)', { hold: true }),
  b('pen.reset-handles', ['R'], 'pen', 'Re-centre the control points of the selected segment (whole line if none)'),
  b('pen.mirror-line', ['M'], 'pen', 'Mirror the selected line to the other side'),
  b('pen.select-previous', ['['], 'pen', 'Select the previous line'),
  b('pen.select-next', [']'], 'pen', 'Select the next line'),
  b('pen.toggle-label', ['I'], 'pen', 'Show / hide the selected line\'s on-body label'),
  b('pen.export', ['E'], 'pen', 'Export draft-lines.json', { mods: { shift: true }, producesFile: true }),

  // ---- landmarks (prototype) ------------------------------------------------
  b('landmarks.place-next', ['Space'], 'landmarks', 'Place next: select the next needed landmark in the guided order and frame it'),
  b('landmarks.previous', ['['], 'landmarks', 'Previous landmark row'),
  b('landmarks.next', [']'], 'landmarks', 'Next landmark row'),
  b('landmarks.nudge', ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], 'landmarks', 'Nudge the selected landmark 1 px along the skin (Shift: 10 px)', { needsSelection: true, shiftOptional: true }),
  b('landmarks.mirror', ['M'], 'landmarks', 'Accept the mirror of the opposite side for the selected row (an offer, recorded manual_mirrored)'),
  b('landmarks.reset-one', ['Backspace'], 'landmarks', 'Return the selected landmark to automatic'),
  b('landmarks.save', ['S'], 'landmarks', 'Save landmarks.manual.json', { mods: { shift: true }, producesFile: true }),

  // ---- pattern block (prototype) --------------------------------------------
  b('pattern.flatten', ['F'], 'pattern', 'Flatten', { mods: { shift: true } }),
  b('pattern.export', ['D'], 'pattern', 'Export DXF', { mods: { shift: true }, producesFile: true }),
  b('pattern.template', ['T'], 'pattern', 'Draft the template chosen in the pattern block (the Template select is the chooser)', { mods: { shift: true } }),
  b('pattern.compare', ['C'], 'pattern', 'Compare every available template: per-panel seam error and shared-seam mismatch, pick one to draft', { mods: { shift: true } }),
]);

/** Keystrokes aimed at a text field are the field's, not ours. */
export function isTextEntry(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function detectPlatform(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const p = `${nav?.platform || ''} ${nav?.userAgent || ''}`;
  return /Mac|iPhone|iPad/.test(p) ? 'mac' : 'other';
}

/** A keydown event reduced to what the map compares: key name and the three modifiers. */
export function normalizeEvent(event, platform = 'other') {
  let key = event.key;
  if (key === ' ' || key === 'Spacebar') key = 'Space';
  if (key === 'Esc') key = 'Escape';
  if (key.length === 1 && /[a-z]/i.test(key)) key = key.toUpperCase();
  const mod = platform === 'mac' ? Boolean(event.metaKey) : Boolean(event.ctrlKey);
  // the other control-ish key is not ours: Ctrl on macOS is a right-click, ⊞ elsewhere is the OS's
  const foreign = platform === 'mac' ? Boolean(event.ctrlKey) : Boolean(event.metaKey);
  return { key, shift: Boolean(event.shiftKey), alt: Boolean(event.altKey), mod, foreign };
}

const wantsShift = (binding) => Boolean(binding.mods?.shift);
const LETTER = /^[A-Z]$/;

function keyMatches(binding, n) {
  if (!binding.keys.includes(n.key)) return false;
  if (Boolean(binding.mods?.mod) !== n.mod) return false;
  if (Boolean(binding.mods?.alt) !== n.alt) return false;
  // Shift is part of the character for '?', so it is only compared on letters
  // and named keys; `shiftOptional` rows (arrows) read it as a step size.
  if (binding.shiftOptional) return true;
  if (LETTER.test(n.key) || n.key.length > 1) return wantsShift(binding) === n.shift;
  return true;
}

/**
 * The binding a keydown means, or null.
 * @param contexts   the active contexts, e.g. ['always', 'pen']
 * @param hasSelection whether a point is selected (arrows act on it)
 * @param lane       'prototype' | 'production' — prototype-only rows are unknown to production
 */
export function matchBinding(event, { contexts, hasSelection = false, lane = 'prototype', platform = 'other', includePlanned = false } = {}) {
  if (isTextEntry(event.target)) return null;
  const n = normalizeEvent(event, platform);
  if (n.foreign) return null;
  const hits = KEYMAP.filter((binding) => !binding.hold
    && (includePlanned || binding.status === 'active')
    && contexts.includes(binding.context)
    && (!binding.lane || binding.lane === lane)
    && keyMatches(binding, n)
    && (binding.needsSelection === undefined || binding.needsSelection === hasSelection));
  if (!hits.length) return null;
  // a tool's row over the always layer, should both ever match (the test forbids it)
  hits.sort((x, y) => (x.context === 'always') - (y.context === 'always'));
  return { ...hits[0], key: n.key, shift: n.shift };
}

const KEY_NAMES = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Space: 'Space' };

/** 'Shift+E', '⌘Z' / 'Ctrl+Z', '←', 'hold Shift' — how a binding is written for people. */
export function keyLabel(binding, platform = 'other') {
  const mods = [];
  if (binding.mods?.mod) mods.push(platform === 'mac' ? '⌘' : 'Ctrl+');
  if (binding.mods?.shift) mods.push('Shift+');
  if (binding.mods?.alt) mods.push('Alt+');
  const keys = binding.keys.map((k) => KEY_NAMES[k] || k);
  const joined = binding.id.endsWith('.nudge') ? '← → ↑ ↓' : keys.join(' / ');
  const body = mods.join('') + joined;
  return binding.hold ? `hold ${body}` : body;
}

/** Rows for the `?` overlay: active bindings of the active contexts in this lane. */
export function cheatSheet({ contexts, lane = 'prototype', platform = 'other' }) {
  return CONTEXTS.filter((c) => contexts.includes(c)).map((context) => ({
    context,
    title: CONTEXT_TITLES[context].replace(/\s*\*\(prototype\)\*/, ''),
    rows: KEYMAP.filter((k) => k.context === context && k.status === 'active' && (!k.lane || k.lane === lane))
      .map((k) => ({ id: k.id, keys: keyLabel(k, platform), label: k.label })),
  })).filter((section) => section.rows.length);
}

/** The §14 tables of AUTHORING_UX_PLAN.md, regenerated. */
export function docTables() {
  const out = [];
  for (const context of CONTEXTS) {
    out.push(`### ${CONTEXT_TITLES[context]}`, '', '| Key | Action |', '|---|---|');
    for (const k of KEYMAP.filter((x) => x.context === context)) {
      const key = keyLabel(k, 'mac').replace('⌘', '⌘/Ctrl+');
      const keyCell = k.hold ? `hold \`${key.replace(/^hold /, '')}\` while pinning` : `\`${key}\``;
      const notes = [];
      if (k.lane === 'prototype' && context === 'always') notes.push('*(prototype)*');
      if (k.status === 'planned') notes.push(`*(planned, Phase ${k.phase})*`);
      out.push(`| ${keyCell} | ${k.label}${notes.length ? ` ${notes.join(' ')}` : ''} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

/** Two bindings collide when the same keystroke could mean both at once. */
export function conflicts() {
  const found = [];
  const live = KEYMAP.filter((k) => !k.hold);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], c = live[j];
      const sameContext = a.context === c.context || a.context === 'always' || c.context === 'always';
      if (!sameContext) continue;
      if (a.lane && c.lane && a.lane !== c.lane) continue;
      if (a.needsSelection !== undefined && c.needsSelection !== undefined && a.needsSelection !== c.needsSelection) continue;
      const sameMods = Boolean(a.mods?.mod) === Boolean(c.mods?.mod) && Boolean(a.mods?.alt) === Boolean(c.mods?.alt)
        && (a.shiftOptional || c.shiftOptional || Boolean(a.mods?.shift) === Boolean(c.mods?.shift));
      if (!sameMods) continue;
      const shared = a.keys.filter((k) => c.keys.includes(k));
      if (shared.length) found.push({ a: a.id, b: c.id, keys: shared });
    }
  }
  return found;
}
