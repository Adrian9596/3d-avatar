/* Placing a crowd of on-body labels.

   Two rules, both about not lying by omission. A label whose point is on the
   far side of the body is HIDDEN, not drawn through the torso, because a name
   floating over skin that is not the skin it names is worse than no name. And
   labels that would overlap are pushed apart vertically rather than left to
   cover each other — nothing is dropped, so the count on screen always matches
   the count in the panel. Text width is measured once per string and cached;
   reading offsetWidth every frame would reflow the page 60 times a second. */

import * as THREE from 'three';
import { camera, canvas } from './stage.mjs';

const labelWidths=new Map();
function labelWidth(el,text){
  if(!labelWidths.has(text)){el.textContent=text;labelWidths.set(text,el.offsetWidth||text.length*5.5)}
  return labelWidths.get(text);
}
// A point on a roughly convex torso faces the camera when its outward radial
// direction points towards it. Cheap, and right everywhere the body is round.
function facesCamera(x,y,z){
  const r=Math.hypot(x,z)||1;
  return ((camera.position.x-x)*x+(camera.position.z-z)*z)/r>0;
}
/* `row.at` may be a single point (a landmark: it is that point or nothing) or a
   list of candidates (a curve: label it at the highest place on it the viewer
   can actually see, which changes as the body turns). */
function anchorFor(row){
  if(!Array.isArray(row.at[0]))return facesCamera(...row.at)?row.at:null;
  let best=null;
  for(const p of row.at){if(facesCamera(...p)&&(!best||p[1]>best[1]))best=p}
  return best;
}
export function placeLabels(els,rows,lift){
  els.forEach((el,i)=>{el.hidden=i>=rows.length});
  if(!rows.length||!camera)return;
  const W=canvas.clientWidth,H=canvas.clientHeight;
  const projected=new THREE.Vector3();
  const boxes=[];
  const wanted=rows.map((row,i)=>{
    const at=anchorFor(row);
    if(!at)return null;
    projected.set(at[0],at[1],at[2]).project(camera);
    if(projected.z>1)return null;
    return {i,row,x:(projected.x*0.5+0.5)*W,y:(-projected.y*0.5+0.5)*H-lift};
  }).filter(Boolean).sort((a,b)=>a.y-b.y||a.x-b.x);
  const shown=new Set();
  for(const item of wanted){
    const el=els[item.i];
    const w=labelWidth(el,item.row.label),h=13;
    let y=item.y;
    for(let guard=0;guard<40;guard++){
      const clash=boxes.find(b=>Math.abs(b.x-item.x)<(b.w+w)/2+2&&Math.abs(b.y-y)<h);
      if(!clash)break;
      y=clash.y+h;
    }
    boxes.push({x:item.x,y,w,h});
    el.hidden=false;
    el.textContent=item.row.label;
    el.style.left=item.x+'px';
    el.style.top=Math.min(y,H-8)+'px';
    shown.add(item.i);
  }
  els.forEach((el,i)=>{if(i<rows.length&&!shown.has(i))el.hidden=true});
}
