/**
 * Reference levels: the house "how to measure" stack, declared in
 * contracts/measurement-levels.json as inch offsets from a registry landmark and
 * resolved here into horizontal rings on THIS body.
 *
 * A level is a HEIGHT TO LOOK AT, not a POM. It carries no tolerance, no house
 * code, no row in the POM sheet and no entry in measurements.json. The girth it
 * reports is the ordinary section girth this project measures everywhere else —
 * `measureSection` from the shared engine, convex hull, not a second model.
 * Nothing here re-derives a section; if it did, the levels and the POMs could
 * disagree about the same slice of the same body, which is the failure the
 * parity gate exists to make impossible.
 *
 * What does NOT transfer from the sheets: the reference figure's dimensions. The
 * sheets are a different body. Only the protocol — which offsets, from which
 * landmark — crosses over, and the contract says so in its declared limits.
 *
 * Honest failure: without the datum landmark this returns `needs [...]` and no
 * geometry, the same discipline the POM table's blocked_until_manual uses. A
 * level whose height lands where sections are unreliable (above the armhole,
 * outside the registry's scan) is resolved and drawn but reports no girth, with
 * the reason attached — visible absence beats a plausible number.
 *
 * One module per kind (levels, shapes, tapes, lines, ticks, straps, curves,
 * points), each with its own contract validation next to its measuring;
 * contract.mjs runs the validators in order and contour.mjs holds the plane
 * cuts they share. This file is the feature's public API.
 *
 * scripts/test_single_engine.mjs checks the app draws levels through this
 * feature and cannot redefine the section maths, so a level and a POM can never
 * disagree about the same slice of the same body.
 */

export { METRES_PER_INCH } from './units.mjs';
export { LEVELS_LIMIT, loadLevels } from './contract.mjs';
export { resolveLevels, outOfRange, measureLevels, levelLabel, levelsRecord } from './levels.mjs';
export { measureShape, measureShapes } from './shapes.mjs';
export { sectionChains, measureReferenceTapes } from './tapes.mjs';
export { measureLine, measureLines } from './lines.mjs';
export { measureTick, measureTicks } from './ticks.mjs';
export { measureStrap, measureStraps } from './straps.mjs';
export { handleTip, handleFromPoint, bendCurve, measureCurve, measureCurves } from './curves.mjs';
export { measurePoint, pointOffsets, measurePoints } from './points.mjs';
