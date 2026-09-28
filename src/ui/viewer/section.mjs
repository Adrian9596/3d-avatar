/* ---- live section: measure any height, not only the named landmarks ------- */

import * as THREE from 'three';
import { measureSection, inchFraction } from '../../core/measure_core.mjs';
import { prototypeState, syncDiagnostics } from './diagnostics.mjs';
import { disposeGroup, makeLine } from './draw.mjs';
import { registry, autoMarks, torsoTris } from './measurement.mjs';
import { scene } from './stage.mjs';

let sectionOpen=false,sectionGroup=null;

// the slider spans the registry's scan and starts at the bust level
export function fitSectionSlider(){
  const slider=document.getElementById('sectionSlider');
  slider.min=Math.round(registry.scan.from_m*1000);
  slider.max=Math.round(registry.scan.to_m*1000);
  if(autoMarks)slider.value=Math.round(autoMarks.bustLevel*1000);
}
function drawSection(y){
  disposeGroup(sectionGroup);sectionGroup=null;
  const readout=document.getElementById('sectionReadout');
  if(!sectionOpen||!torsoTris){readout.classList.remove('open');return}
  const section=measureSection(torsoTris,y);
  if(!section){readout.classList.remove('open');return}
  let cx=0,cz=0;
  for(const q of section.ring){cx+=q[0];cz+=q[1]}
  cx/=section.ring.length;cz/=section.ring.length;
  const points=section.ring.map(([x,z])=>{
    const dx=x-cx,dz=z-cz,L=Math.hypot(dx,dz)||1;
    return new THREE.Vector3(x+dx/L*0.002,y,z+dz/L*0.002);
  });
  points.push(points[0].clone());
  sectionGroup=new THREE.Group();sectionGroup.name='LiveSection';
  sectionGroup.add(makeLine(points,{color:0xa8760f,width:2.6}));
  sectionGroup.add(makeLine(points,{color:0xa8760f,width:1.4,opacity:.25,depthTest:false,order:3}));
  scene.add(sectionGroup);
  const denom=registry.reporting.inch_denominator;
  readout.classList.add('open');
  readout.innerHTML=`<b>${(section.girth*100).toFixed(1)}cm</b> ${inchFraction(section.girth,denom)}`
    +`<br>y = ${y.toFixed(3)}m`
    +`<br>hull vs contour ${((section.contour-section.girth)*1000).toFixed(1)}mm`;
  prototypeState.liveSection={y:+y.toFixed(4),girth_mm:+(section.girth*1000).toFixed(1)};
  syncDiagnostics();
}

export const sectionToggle=document.getElementById('sectionToggle');
const sectionSlider=document.getElementById('sectionSlider');
sectionToggle.addEventListener('click',()=>{
  sectionOpen=!sectionOpen;
  sectionToggle.setAttribute('aria-pressed',String(sectionOpen));
  document.getElementById('sectionTool').classList.toggle('open',sectionOpen);
  drawSection(Number(sectionSlider.value)/1000);
});
sectionSlider.addEventListener('input',()=>drawSection(Number(sectionSlider.value)/1000));
