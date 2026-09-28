/* ---- body grid -------------------------------------------------------------
   The vertical half of the reference frame, declared in contracts/body-grid.json
   and sampled by src/features/body_grid: centre, side and apex curves plus the
   four lines this mesh is cut on. Every rule in it is an extreme or an exact
   feature, never a threshold, and a curve is drawn but never measured — so the
   grid can carry no tolerance and cannot disagree with a POM. The levels give a
   height; these give the other coordinate, so a point on the skin can be named
   by both — which is what the dotted grid on the source sheets is for.

   Drawn dashed, and deliberately quiet: a curve here is where this body's own
   geometry falls, not where a seam should go. The boundary loops are the four
   places the mesh is cut (neck, both armholes, waist) — hard limits on where
   anything can sit, and not garment edges. ------------------------------- */

import * as THREE from 'three';
import { sampleCurves, sampleBoundaries } from '../../features/body_grid/body_grid.mjs';
import { disposeGroup, makeLine } from './draw.mjs';
import { landmarkValue } from './landmark_values.mjs';
import { gridContract, torsoTris, registry } from './measurement.mjs';
import { scene } from './stage.mjs';

let gridVisible=false,gridGroup=null,gridCurves=null,gridBounds=null;
try{gridVisible=localStorage.getItem('gridVisible')==='1'}catch(error){/* private mode */}

const GRID_DASH=[0.006,0.006];
const GRID_COLOUR=g=>Number.parseInt((gridContract?.groups?.[g]?.colour||'#5f5851').slice(1),16);

export function recomputeGrid(){
  gridCurves=null;gridBounds=null;
  if(gridContract&&torsoTris){
    const landmarks={};
    for(const id of ['BUST_APEX_L','BUST_APEX_R']){
      const value=landmarkValue(id);
      if(value&&Number.isFinite(value.x))landmarks[id]=[value.x,value.y,value.z];
    }
    gridCurves=sampleCurves(gridContract,torsoTris,landmarks,{scan:registry.scan});
    gridBounds=sampleBoundaries(gridContract,torsoTris);
  }
  drawGrid();
}

function drawGrid(){
  disposeGroup(gridGroup);gridGroup=null;
  if(!gridVisible||!gridCurves)return;
  gridGroup=new THREE.Group();gridGroup.name='BodyGrid';
  const lift=p=>{const r=Math.hypot(p[0],p[2])||1;return new THREE.Vector3(p[0]*(1+0.0015/r),p[1],p[2]*(1+0.0015/r))};
  for(const {curve,needs,points} of gridCurves){
    if(needs||points.length<2)continue;
    const pts=points.map(lift);
    gridGroup.add(makeLine(pts,{color:GRID_COLOUR(curve.group),width:1.4,opacity:.85,dash:GRID_DASH}));
  }
  for(const {boundary,points,blocked} of gridBounds||[]){
    if(blocked||points.length<3)continue;
    const pts=points.map(lift);pts.push(pts[0].clone());
    gridGroup.add(makeLine(pts,{color:GRID_COLOUR(boundary.group),width:1.4,opacity:.85,dash:GRID_DASH}));
  }
  scene.add(gridGroup);
}

export const gridToggle=document.getElementById('gridToggle');
gridToggle.setAttribute('aria-pressed',String(gridVisible));
gridToggle.addEventListener('click',()=>{
  gridVisible=!gridVisible;
  gridToggle.setAttribute('aria-pressed',String(gridVisible));
  try{localStorage.setItem('gridVisible',gridVisible?'1':'0')}catch(error){/* private mode */}
  drawGrid();
});
