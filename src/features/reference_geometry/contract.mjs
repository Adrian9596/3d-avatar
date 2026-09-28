/* --- the contract -----------------------------------------------------------------
   contracts/measurement-levels.json checked against the registry. Each kind
   validates its own entries in its own module, in this order, because each may
   hang on the ones before it: shapes on levels, lines and ticks on levels and
   tapes, straps on ticks, curves on straps, lines and points. An entry that does
   not validate drops out, with its reason in `errors`, instead of drawing
   something nobody declared. -------------------------------------------------------- */

import { METRES_PER_INCH } from './units.mjs';
import { validateLevels } from './levels.mjs';
import { validateShapes } from './shapes.mjs';
import { validateTapes } from './tapes.mjs';
import { validateLines } from './lines.mjs';
import { validateTicks } from './ticks.mjs';
import { validateStraps } from './straps.mjs';
import { validatePoints } from './points.mjs';
import { validateCurves } from './curves.mjs';

export const LEVELS_LIMIT = 'Reference levels are heights from the underbust line, not a fit recommendation and not a size.';

/**
 * Validate the contract against the registry. Returns { levels, groups, datum,
 * errors, declared_limit }; `levels` holds only the entries that validated, so a
 * broken row drops out instead of drawing a ring nobody declared.
 */
export function loadLevels(contract, registry) {
  const errors = [];
  const known = new Set((registry?.landmarks || []).map((l) => l.id));
  const groups = contract?.groups || {};
  const datum = contract?.datum?.landmark || null;

  if (!datum) errors.push('no datum landmark declared');
  else if (known.size && !known.has(datum)) errors.push(`datum ${datum} is not a registry landmark`);

  const metresPerInch = contract?.unit?.metres_per_inch;
  if (metresPerInch !== METRES_PER_INCH) errors.push(`unit.metres_per_inch must be ${METRES_PER_INCH}`);

  const { levels, ids } = validateLevels(contract, { errors, groups });
  const { shapes, shapeIds } = validateShapes(contract, { errors, ids, levels });
  // a reference tape or a line may hang on a plane-section POM's own height
  const planePoms = new Set((registry?.poms || []).filter((p) => p.method === 'plane_section').map((p) => p.id));
  const tapes = validateTapes(contract, { errors, ids, shapeIds, known, planePoms });
  const heightIds = new Set([...levels.map((l) => l.id), ...tapes.map((t) => t.id)]);
  const lines = validateLines(contract, { errors, heightIds, shapeIds, planePoms });
  const ticks = validateTicks(contract, { errors, heightIds, shapeIds, lines });
  const straps = validateStraps(contract, { errors, heightIds, shapeIds, lines, ticks });
  const points = validatePoints(contract, { errors, heightIds, shapeIds, lines, ticks, straps, known });
  const curves = validateCurves(contract, { errors, heightIds, shapeIds, lines, ticks, straps, points, known });

  return {
    levels,
    shapes,
    tapes,
    lines,
    ticks,
    straps,
    curves,
    points,
    groups,
    datum,
    errors,
    declared_limit: contract?.declared_limit || LEVELS_LIMIT,
    max_y_m: contract?.reliability?.max_y_m ?? null,
  };
}
