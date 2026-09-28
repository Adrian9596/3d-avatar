/* --- reference levels -----------------------------------------------------------
   The rings of the how-to-measure stack: each level's height from the datum, and
   its girth through the shared section engine (measureSection), never a second
   section model. A level outside the reliable range is resolved and drawn but
   reports no girth, with the reason attached. ------------------------------------- */

import { measureSection, inchFraction } from '../../core/measure_core.mjs';
import { METRES_PER_INCH } from './units.mjs';

/** Validate the contract's `levels`, collecting problems in `errors`. Returns
 *  the valid levels and every id seen. */
export function validateLevels(contract, { errors, groups }) {
  const ids = new Set();
  const offsets = new Set();
  const levels = [];
  for (const level of contract?.levels || []) {
    const problems = [];
    if (!level.id || ids.has(level.id)) problems.push('missing or duplicate id');
    ids.add(level.id);
    if (!Number.isFinite(level.offset_in)) problems.push('offset_in must be a number');
    else if (offsets.has(level.offset_in)) problems.push(`two levels at ${level.offset_in}in`);
    offsets.add(level.offset_in);
    // The sheets print quarter inches; a value off that grid is a typo, not a level.
    if (Number.isFinite(level.offset_in) && Math.abs(level.offset_in * 4 - Math.round(level.offset_in * 4)) > 1e-9) {
      problems.push(`${level.offset_in}in is not a quarter of an inch`);
    }
    if (!groups[level.group]) problems.push(`unknown group ${level.group}`);
    if (level.label_in === undefined) problems.push('label_in must be a string or null (null = the unlabelled datum ring)');
    // a tape level is also drawn as a tape in the measurement table; the datum already is the underbust
    if (level.tape !== undefined && typeof level.tape !== 'boolean') problems.push('tape must be true or false');
    if (level.tape && level.offset_in === 0) problems.push('the 0 ring is the underbust POM\'s own tape');
    if (problems.length) errors.push(`${level.id || '?'}: ${problems.join('; ')}`);
    else levels.push(level);
  }
  // Top to bottom is how the sheets read and how the panel lists them.
  const ordered = levels.every((l, i) => i === 0 || levels[i - 1].offset_in > l.offset_in);
  if (!ordered) errors.push('levels must be ordered top to bottom by offset_in');
  const zeros = levels.filter((l) => l.offset_in === 0);
  if (zeros.length !== 1) errors.push(`expected exactly one level at 0in, found ${zeros.length}`);
  else if (zeros[0].label_in !== null) errors.push('the 0 level is the sheets\' unlabelled ring: label_in must be null');
  return { levels, ids };
}

/**
 * The height of every level from a landmark map, or what is missing.
 * `landmarks` is { ID: [x, y, z] } or { ID: y } — the datum is a height, and the
 * registry records some landmarks as a level and some as a point.
 */
export function resolveLevels(loaded, landmarks) {
  const mark = landmarks?.[loaded.datum];
  const datumY = Array.isArray(mark) ? mark[1] : (typeof mark === 'number' ? mark : null);
  if (!Number.isFinite(datumY)) return { needs: [loaded.datum] };
  return {
    datum: loaded.datum,
    datum_y_m: datumY,
    levels: loaded.levels.map((level) => ({
      ...level,
      y_m: datumY + level.offset_in * METRES_PER_INCH,
    })),
  };
}

/**
 * Reason a level cannot be measured here, or null. Kept separate from the
 * measuring so the viewer can draw a ring it may not report a number for.
 */
export function outOfRange(y, { scan, maxY }) {
  if (Number.isFinite(maxY) && y > maxY) {
    return `above y = ${maxY}m, where the torso is open at the armhole and a section is not a closed body ring`;
  }
  if (scan && (y < scan.from_m || y > scan.to_m)) {
    return `outside the registry scan ${scan.from_m}–${scan.to_m}m`;
  }
  return null;
}

/**
 * Measure every resolved level on this body. Each entry keeps its ring (for
 * drawing, whenever the mesh has one — even a level outside the trustworthy
 * range usually still has geometry there, just not a girth this project will
 * report) and either a girth or the reason there is none — never both, and
 * never a number where the section is not trustworthy. `blocked` and `section`
 * are independent: a level can be blocked (no girth) while still drawable, and
 * is only undrawable when the mesh genuinely has no closed section there.
 */
export function measureLevels(resolved, tri, { scan = null, maxY = null, inchDenominator = 8 } = {}) {
  if (resolved.needs) return resolved;
  return {
    ...resolved,
    levels: resolved.levels.map((level) => {
      const rangeReason = outOfRange(level.y_m, { scan, maxY });
      const section = measureSection(tri, level.y_m);
      const blocked = rangeReason || (section ? null : 'no closed section at this height');
      if (blocked) {
        return { ...level, section, girth_m: null, girth_in: null, blocked };
      }
      return {
        ...level,
        section,
        girth_m: section.girth,
        girth_in: inchFraction(section.girth, inchDenominator),
        blocked: null,
      };
    }),
  };
}

/** What a level says in a list: its printed label, or the datum's own name. */
export function levelLabel(level, groups) {
  return level.label_in || `0" · ${groups?.[level.group]?.label_en || 'datum'}`;
}

/** The record an export carries: the protocol, the datum it hung on, and the limits. */
export function levelsRecord(measured, loaded, provenance = 'auto') {
  if (measured.needs) return { needs: measured.needs, limit: loaded.declared_limit };
  return {
    datum: { landmark: measured.datum, y_m: Number(measured.datum_y_m.toFixed(5)), source: provenance },
    levels: measured.levels.map((l) => ({
      id: l.id,
      offset_in: l.offset_in,
      label: l.label_in,
      tape: Boolean(l.tape),
      y_m: Number(l.y_m.toFixed(5)),
      girth_mm: l.girth_m === null ? null : Number((l.girth_m * 1000).toFixed(1)),
      blocked: l.blocked,
    })),
    limit: loaded.declared_limit,
  };
}
