/* Dragging a curve's handle, the point it passes through, or a dot on a line.
   The dot is picked in screen space, like the pen's control points; the press
   is claimed before the pen and the camera see it (a capture listener), and
   everywhere else the pointer is theirs. A handle is read in the dragged side's
   frame and bendCurve shapes both sides; a point becomes the offsets that reach
   the dragged place (pointOffsets), measured again on both sides. A dot on a
   line goes to the place on the line nearest the pointer on screen, not to the
   skin under the pointer: the CF line runs down the cleavage, where the skin
   under the pointer is as often a breast as the line. */

import * as THREE from 'three';
import { pointOffsets, measurePoint, linePointOffsets, measureLinePoint, dragHandle, bendCurve } from '../../../features/reference_geometry/index.mjs';
import { placingLandmark } from '../landmarks.mjs';
import { levelContract, torsoTris, measureGrid } from '../measurement.mjs';
import { surfaceHit } from '../picking.mjs';
import { showMovedPoint, updateCurveRows } from './rows.mjs';
import { levelMarks, movePoint, pointMoves, measuredCurves, measuredLines, curveHandles, saveCurveHandles, syncCurveState } from './state.mjs';
import { camera, canvas, controls, setCameraGoal } from '../stage.mjs';
import { measureRowData, selectedTapeIndex, redrawTapes } from '../table.mjs';

let curveDrag=null;
function curveHandleAt(clientX,clientY){
  const row=measureRowData[selectedTapeIndex];
  if(!row?.grabs?.length||!camera)return null;
  const rect=canvas.getBoundingClientRect(),v=new THREE.Vector3();
  let best=null;
  for(const g of row.grabs){
    v.set(g.at[0],g.at[1],g.at[2]).project(camera);
    if(v.z>1)continue;
    const d=Math.hypot(rect.left+(v.x*.5+.5)*rect.width-clientX,rect.top+(-v.y*.5+.5)*rect.height-clientY);
    if(d<=15&&(!best||d<best.d))best={d,...g};
  }
  return best;
}
// The place on a polyline nearest the pointer on screen, back on the polyline
// in 3D: each segment is projected, the nearest place on it found in pixels,
// and taken back to the segment with the perspective divide undone.
function nearestOnScreen(points,clientX,clientY){
  const rect=canvas.getBoundingClientRect(),v=new THREE.Vector3();
  camera.updateMatrixWorld();
  const P=camera.projectionMatrix.elements;
  const screen=points.map(p=>{
    v.set(p[0],p[1],p[2]).applyMatrix4(camera.matrixWorldInverse);
    const w=P[3]*v.x+P[7]*v.y+P[11]*v.z+P[15];   // the clip w: depth for a perspective camera
    v.applyMatrix4(camera.projectionMatrix);
    return {x:rect.left+(v.x*.5+.5)*rect.width,y:rect.top+(-v.y*.5+.5)*rect.height,w};
  });
  let best=null;
  for(let i=1;i<points.length;i++){
    const a=screen[i-1],b=screen[i];
    if(a.w<=0||b.w<=0)continue;                    // behind the camera
    const dx=b.x-a.x,dy=b.y-a.y,ll=dx*dx+dy*dy;
    const s=ll>0?Math.max(0,Math.min(1,((clientX-a.x)*dx+(clientY-a.y)*dy)/ll)):0;
    const d=Math.hypot(a.x+dx*s-clientX,a.y+dy*s-clientY);
    if(!best||d<best.d){
      const t=s*a.w/(s*a.w+(1-s)*b.w);
      best={d,point:points[i-1].map((c,k)=>c+(points[i][k]-c)*t)};
    }
  }
  return best?.point||null;
}

function applyCurveDrag(){
  const drag=curveDrag;
  if(!drag)return;
  drag.frame=null;
  if(drag.kind==='line_point'){
    if(!drag.client)return;
    const def=(levelContract?.points||[]).find(p=>p.id===drag.id);
    const line=measuredLines.find(l=>l.id===def?.line);
    const off=line&&!line.blocked&&linePointOffsets(line,nearestOnScreen(line.points,...drag.client));
    if(!off)return;
    const next=measureLinePoint(def,line,off);
    if(movePoint(next)){showMovedPoint(next);pointMoves[drag.id]=off}
    return;
  }
  if(!drag.point)return;
  if(drag.kind==='point'){
    const def=(levelContract?.points||[]).find(p=>p.id===drag.id);
    const off=def&&pointOffsets(def,drag.side,drag.point,levelMarks,torsoTris);
    if(!off)return;                                // across the middle, or off the walk
    const next=measurePoint(def,levelMarks,torsoTris,off);
    if(movePoint(next)){showMovedPoint(next);pointMoves[drag.id]=off}
    return;
  }
  const i=measuredCurves.findIndex(c=>c.id===drag.curve);
  const curve=measuredCurves[i],run=curve?.runs.find(r=>r.side===drag.side);
  if(!run)return;
  const handle=dragHandle(curve,run,drag.end,drag.point,measureGrid);
  if(!handle)return;
  const next=bendCurve(curve,{...curve.handles,[drag.end]:handle},measureGrid);
  if(next.blocked)return;                          // keep the last shape that lay on the skin
  measuredCurves[i]=next;curveHandles[curve.id]=next.handles;
  updateCurveRows(next);redrawTapes();
}
canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0||placingLandmark)return;
  const grab=curveHandleAt(event.clientX,event.clientY);
  if(!grab)return;
  event.stopImmediatePropagation();event.preventDefault();
  curveDrag={...grab,point:null,client:null,frame:null};
  controls.enabled=false;setCameraGoal(null);
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor='grabbing';
},{capture:true});
canvas.addEventListener('pointermove',event=>{
  if(!curveDrag){
    const over=Boolean(measureRowData[selectedTapeIndex]?.grabs?.length&&curveHandleAt(event.clientX,event.clientY));
    if(over)canvas.style.cursor='grab';
    else if(canvas.style.cursor==='grab')canvas.style.cursor='';
    return;
  }
  event.stopImmediatePropagation();
  // a dot on a line follows the pointer along the line, over the body or not
  if(curveDrag.kind==='line_point')curveDrag.client=[event.clientX,event.clientY];
  else{
    const hit=surfaceHit(event.clientX,event.clientY);
    if(!hit)return;
    curveDrag.point=[hit.point.x,hit.point.y,hit.point.z];
  }
  if(!curveDrag.frame)curveDrag.frame=requestAnimationFrame(applyCurveDrag);
},{capture:true});
for(const type of ['pointerup','pointercancel'])canvas.addEventListener(type,event=>{
  if(!curveDrag)return;
  event.stopImmediatePropagation();
  if(curveDrag.frame){cancelAnimationFrame(curveDrag.frame);applyCurveDrag()}
  curveDrag=null;
  controls.enabled=true;canvas.style.cursor='';
  if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  saveCurveHandles();syncCurveState();
},{capture:true});
