/* --- line drawing ---------------------------------------------------------
   WebGL ignores gl.lineWidth, so plain THREE.Line is always a 1px hairline.
   Line2 draws screen-space-width strips instead, which is what makes a tape
   readable on the body and in a screenshot. Every LineMaterial needs its
   resolution kept in sync with the canvas. ----------------------------------*/

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { onResize, canvas, scene } from './stage.mjs';

export const TAPE_COLOR=0xd93a2b,INK_COLOR=0x2f4f6f,HANDLE_COLOR=0x1f8a70;
const lineMaterials=new Set();
onResize((w,h)=>lineMaterials.forEach(material=>material.resolution.set(w,h)));

export function makeLine(points,{color,width,opacity=1,depthTest=true,order=0,dash=null}){
  const geometry=new LineGeometry();
  const flat=[];
  for(const p of points)flat.push(p.x,p.y,p.z);
  geometry.setPositions(flat);
  // A dashed line reads as a reference rather than a measurement — the source
  // sheets draw their construction grid dotted for the same reason.
  const material=new LineMaterial({color,linewidth:width,transparent:opacity<1,opacity,depthTest,
    dashed:Boolean(dash),...(dash?{dashSize:dash[0],gapSize:dash[1],dashScale:1}:{})});
  material.resolution.set(canvas.clientWidth||1,canvas.clientHeight||1);
  lineMaterials.add(material);
  const line=new Line2(geometry,material);
  line.computeLineDistances();
  line.renderOrder=order;
  return line;
}

export function disposeGroup(group){
  if(!group)return;
  group.traverse(o=>{
    if(o.geometry)o.geometry.dispose();
    if(o.material){lineMaterials.delete(o.material);o.material.dispose()}
  });
  scene.remove(group);
}

// The tape ring, nudged 1.5mm clear of the skin so it does not z-fight.
export function ringPoints(section){
  let cx=0,cz=0;
  for(const q of section.ring){cx+=q[0];cz+=q[1]}
  cx/=section.ring.length;cz/=section.ring.length;
  const pts=section.ring.map(([x,z])=>{
    const dx=x-cx,dz=z-cz,L=Math.hypot(dx,dz)||1;
    return new THREE.Vector3(x+dx/L*0.0015,section.y,z+dz/L*0.0015);
  });
  pts.push(pts[0].clone());
  return pts;
}
