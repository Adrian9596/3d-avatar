/* --- reference tapes from another height -------------------------------------
   A tape `offset_in` from a registry height that is not the datum (the
   largest-girth level, say). Below the reliability ceiling it is an ordinary
   level: the shared engine's section, its girth, its hull ring. Above it the
   torso is open at the armholes, so there is no girth to report; the tape is
   drawn as the pieces of the section that lie on the skin (front and back),
   each with its own length, and the reason is attached. ---------------------- */

import { measureSection, sectionSegments, inchFraction } from '../../core/measure_core.mjs';
import { outOfRange } from './levels.mjs';
import { polylineLength } from './contour.mjs';
import { METRES_PER_INCH } from './units.mjs';

/** Validate the contract's `reference_tapes`. Returns the valid tapes. */
export function validateTapes(contract, { errors, ids, shapeIds, known, planePoms }) {
  // Reference tapes hang on a registry height other than the datum -- a
  // plane-section POM's own level, such as the largest girth. Same inch grid.
  const tapes = [];
  for (const tape of contract?.reference_tapes || []) {
    const problems = [];
    if (!tape.id || ids.has(tape.id) || shapeIds.has(tape.id) || tapes.some((t) => t.id === tape.id)) problems.push('missing or duplicate id');
    if (!(known.has(tape.from) || planePoms.has(tape.from))) problems.push(`from ${tape.from} is not a registry landmark or plane-section POM`);
    if (!Number.isFinite(tape.offset_in) || tape.offset_in === 0) problems.push('offset_in must be a non-zero number');
    else if (Math.abs(tape.offset_in * 4 - Math.round(tape.offset_in * 4)) > 1e-9) problems.push(`${tape.offset_in}in is not a quarter of an inch`);
    if (typeof tape.label !== 'string' || !tape.label) problems.push('label must be a string');
    if (problems.length) errors.push(`${tape.id || '?'}: ${problems.join('; ')}`);
    else tapes.push(tape);
  }
  return tapes;
}

// The section at `y` as ordered [x, y, z] polylines: one closed loop, or the
// open pieces between the holes.
export function sectionChains(tri, y) {
  const key = (p) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;
  const nodes = new Map();
  const node = (p) => {
    const k = key(p);
    if (!nodes.has(k)) nodes.set(k, { p, next: [] });
    return nodes.get(k);
  };
  for (const [a, b] of sectionSegments(tri, y)) {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= 0) continue;
    const na = node(a), nb = node(b);
    na.next.push(nb);
    nb.next.push(na);
  }
  const seen = new Set();
  const walk = (start) => {
    const out = [start];
    seen.add(start);
    let current = start;
    for (;;) {
      const next = current.next.find((n) => !seen.has(n));
      if (!next) break;
      out.push(next);
      seen.add(next);
      current = next;
    }
    if (out.length > 2 && current.next.includes(start)) out.push(start);
    return out.map((n) => [n.p[0], y, n.p[1]]);
  };
  const chains = [];
  // open pieces first, from their ends, so none is started in its middle
  for (const n of nodes.values()) if (n.next.length === 1 && !seen.has(n)) chains.push(walk(n));
  for (const n of nodes.values()) if (!seen.has(n)) chains.push(walk(n));
  // stray slivers (a triangle's worth) are not a tape
  return chains.filter((c) => polylineLength(c) > 0.01);
}

/** Every reference tape on this body. `heights` maps a registry id to its y. */
export function measureReferenceTapes(loaded, heights, tri, { scan = null, maxY = null, inchDenominator = 8 } = {}) {
  return (loaded.tapes || []).map((tape) => {
    const from = heights?.[tape.from];
    if (!Number.isFinite(from)) return { ...tape, y_m: null, chains: [], girth_m: null, blocked: `needs ${tape.from}` };
    const y = from + tape.offset_in * METRES_PER_INCH;
    const rangeReason = outOfRange(y, { scan, maxY });
    const section = measureSection(tri, y);
    const chains = sectionChains(tri, y);
    if (rangeReason || !section) {
      return {
        ...tape, y_m: y, from_y_m: from, section: null, chains, girth_m: null, girth_in: null,
        pieces_m: chains.map(polylineLength),
        blocked: rangeReason || 'no closed section at this height',
      };
    }
    return {
      ...tape, y_m: y, from_y_m: from, section, chains, girth_m: section.girth,
      girth_in: inchFraction(section.girth, inchDenominator), blocked: null,
    };
  });
}
