/* The tip line under the top bar, and what a pixel is worth on the skin under
   the cursor (src/core/view_geometry.mjs): amber past 60°, red past 75°. Those
   colours change no value — the number is recorded on every anchor as
   placed_with, and the person decides. */

import { grazingLevel } from '../../core/view_geometry.mjs';
import { registry } from './measurement.mjs';

export const tipEl=document.getElementById('tip');
export let tipBase=tipEl.textContent;
export function setTip(text){tipBase=text;tipEl.textContent=text;tipEl.className='tip'}
export function showFootprint(hover){
  if(!hover){tipEl.textContent=tipBase;tipEl.className='tip';return}
  const level=grazingLevel(hover.incidence_deg);
  tipEl.className='tip'+(level==='ok'?'':' '+level);
  tipEl.textContent=`${hover.footprint_mm_px} mm/px at ${hover.incidence_deg}°`
    +(hover.snap?` · snap: ${hover.snap.kind}${hover.snap.to?' → '+hover.snap.to:''}`:'')
    +(hover.surface&&registry&&!registry.measurement_surface.includes(hover.surface)?` · off the measurement surface (${hover.surface})`:'')
    +(level==='ok'?'':' · turn the body to place this precisely — press F')+' · '+tipBase;
}
