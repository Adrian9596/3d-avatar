/* ---- landmarks: the catalogue and where each one is ------------------------
   Every landmark the app lists, grouped as the panel shows them, and its value
   on this body: the hand-placed override if there is one, else what the engine
   detected. Everything that needs a landmark's place reads it here. ---------- */

import * as THREE from 'three';
import { sectionPointNearX, measureSection } from '../../core/measure_core.mjs';
import { overrides } from './landmark_store.mjs';
import { marks, torsoTris, foldMarks, wingMarks, armholes } from './measurement.mjs';

export const LANDMARK_GROUPS=[
  {group:'Bust',rows:[
    {id:'BUST_APEX_L',label:'Bust apex L',kind:'point'},
    {id:'BUST_APEX_R',label:'Bust apex R',kind:'point'},
    {id:'ROOT_BOTTOM_L',label:'Root bottom L',kind:'point'},
    {id:'ROOT_BOTTOM_R',label:'Root bottom R',kind:'point'},
    {id:'BUST_LEVEL',label:'Bust level',kind:'level'},
    {id:'UNDERBUST_FOLD',label:'Underbust fold',kind:'level'},
    {id:'WAIST_LEVEL',label:'Waist level',kind:'level'},
  ]},
  {group:'Band and wing',rows:[
    {id:'CF_UNDERBUST',label:'Centre front (gore)',kind:'point'},
    {id:'CB_UNDERBUST',label:'Centre back',kind:'point'},
    {id:'SIDE_UNDERBUST_L',label:'Side point L',kind:'point'},
    {id:'SIDE_UNDERBUST_R',label:'Side point R',kind:'point'},
    {id:'SIDE_WING_LOW_L',label:'Wing low L',kind:'point'},
    {id:'SIDE_WING_LOW_R',label:'Wing low R',kind:'point'},
    {id:'SIDE_WING_HIGH_L',label:'Wing top L',kind:'point'},
    {id:'SIDE_WING_HIGH_R',label:'Wing top R',kind:'point'},
    {id:'UNDERARM_L',label:'Underarm L',kind:'point'},
    {id:'UNDERARM_R',label:'Underarm R',kind:'point'},
  ]},
  {group:'Place by hand',rows:[
    {id:'HPS_L',label:'HPS L',kind:'point',manualOnly:true},
    {id:'HPS_R',label:'HPS R',kind:'point',manualOnly:true},
    {id:'ROOT_INNER_L',label:'Root inner L',kind:'point',manualOnly:true},
    {id:'ROOT_OUTER_L',label:'Root outer L',kind:'point',manualOnly:true},
    {id:'ROOT_TOP_L',label:'Root top L',kind:'point',manualOnly:true},
    {id:'ROOT_INNER_R',label:'Root inner R',kind:'point',manualOnly:true},
    {id:'ROOT_OUTER_R',label:'Root outer R',kind:'point',manualOnly:true},
    {id:'ROOT_TOP_R',label:'Root top R',kind:'point',manualOnly:true},
  ]},
];
export const LANDMARK_ROWS=LANDMARK_GROUPS.flatMap(g=>g.rows);

export function landmarkValue(id){
  const manual=(overrides.landmarks||{})[id];
  if(manual&&Array.isArray(manual.xyz_m))
    return {x:manual.xyz_m[0],y:manual.xyz_m[1],z:manual.xyz_m[2]};
  if(manual&&Number.isFinite(manual.y_m))return {y:manual.y_m};
  if(!marks)return null;
  if(id==='BUST_APEX_L')return marks.apexL;
  if(id==='BUST_APEX_R')return marks.apexR;
  // derived: the fold section point directly below the apex, the same one cup depth starts from
  if(id==='ROOT_BOTTOM_L'||id==='ROOT_BOTTOM_R'){const apex=id.endsWith('L')?marks.apexL:marks.apexR;return marks.fold&&apex&&torsoTris?sectionPointNearX(torsoTris,marks.fold.y,apex.x):null}
  if(id==='BUST_LEVEL')return {y:marks.bustLevel};
  if(id==='UNDERBUST_FOLD')return marks.fold;
  if(id==='WAIST_LEVEL')return marks.waist;
  if(id==='CF_UNDERBUST')return foldMarks.cfUnderbust;
  if(id==='CB_UNDERBUST')return foldMarks.cbUnderbust;
  if(id==='SIDE_UNDERBUST_L')return foldMarks.sideL;
  if(id==='SIDE_UNDERBUST_R')return foldMarks.sideR;
  if(id==='SIDE_WING_LOW_L')return wingMarks.lowL;
  if(id==='SIDE_WING_LOW_R')return wingMarks.lowR;
  if(id==='SIDE_WING_HIGH_L')return wingMarks.highL;
  if(id==='SIDE_WING_HIGH_R')return wingMarks.highR;
  if(id==='UNDERARM_L')return armholes.armholeL;
  if(id==='UNDERARM_R')return armholes.armholeR;
  return null;
}

// A level landmark is a height, not a point, so it is marked where a fitter
// would read it: the front-most place on that section.
export function landmarkPosition(id){
  const value=landmarkValue(id);
  if(!value)return null;
  if(Number.isFinite(value.x))return new THREE.Vector3(value.x,value.y,value.z);
  const section=measureSection(torsoTris,value.y);
  if(!section)return null;
  let front=null;
  for(const q of section.ring)if(!front||q[1]>front[1])front=q;
  return front?new THREE.Vector3(front[0],value.y,front[1]):null;
}
