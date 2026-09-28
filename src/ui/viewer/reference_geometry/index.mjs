/* ---- reference geometry -------------------------------------------------
   The house "how to measure" sheets draw a stack of horizontal rings on a
   reference figure and label each in inches from an unlabelled line at the
   underbust. contracts/measurement-levels.json declares that stack as a
   protocol — which offsets, from which registry landmark — plus the tapes,
   lines, ticks, straps, curves and points drawn on it, and everything here only
   draws what src/features/reference_geometry returns for THIS body.

   What is deliberately not here: any dimension from the sheets. They are a
   different body; a level is a height to look at, not a size, not a POM, and
   not a fit recommendation. A level whose section is not trustworthy shows its
   ring greyed and says why instead of showing a number.

   state.mjs measures and remembers, rows.mjs lists, drag.mjs moves the dots,
   levels.mjs draws the rings; this file is what the rest of the app uses. --- */

import { drawLevels, renderLevelList } from './levels.mjs';
import { measureReferenceGeometry, syncCurveState } from './state.mjs';
import './drag.mjs';

export { levelToggle, positionLevelLabels } from './levels.mjs';
export { listReferenceRows } from './rows.mjs';

// Measure, list and draw the reference geometry on the current landmarks.
export function recomputeLevels(){
  measureReferenceGeometry();
  syncCurveState();
  drawLevels();
  renderLevelList();
}
