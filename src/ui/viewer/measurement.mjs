/* ---------------------------------------------------------------------------
   Measurement — runs live on the loaded torso geometry, through the shared
   engine (src/core/measure_core.mjs): the Node parity test imports that same
   file, so "the viewer agrees with the test" holds by construction.

   Girth is the perimeter of the CONVEX HULL of a horizontal cross-section, not
   the perimeter of the raw contour. A tape measure bridges concavities (the
   cleavage gap, the spinal groove) instead of sinking into them; on this body
   the raw contour over-reports the full bust by ~18mm. Calibrated against a
   cylinder of known girth: 628.21mm measured vs 628.32mm true (-0.11mm).

   Arms must be excluded: a horizontal plane at bust height also cuts both arms.
   They are a separate glTF primitive, so filtering by material name is exact.

   Axes: the GLB is Y-up, the body faces +Z, so a section is taken at constant Y
   and its 2D coordinates are (x, z). Front-most = maximum z.

   This module holds the session — the registry, the contracts, the scan, the
   landmarks and POMs — and re-measures when a landmark moves. What is shown of
   it is the views' business (setMeasurementViews), so it never reaches up. */

import * as THREE from 'three';
import { DEFAULT_SCAN, scanSurface, findLandmarks, findArmholes, applyLandmarkOverrides, findFoldLandmarks, computePoms, findWingLandmarks, computeSurfacePoms } from '../../core/measure_core.mjs';
import { buildGrid, closestOnMesh } from '../../core/surface_path.mjs';
import { loadGrid } from '../../features/body_grid/body_grid.mjs';
import { loadTemplates } from '../../features/pattern/pattern_templates.mjs';
import { loadLevels } from '../../features/reference_geometry/index.mjs';
import { prototypeState, syncDiagnostics } from './diagnostics.mjs';
import { overrides } from './landmark_store.mjs';

const REGISTRY_URL='contracts/measurement-registry.json';
// What the app shows of a measurement: set by the app once, so the measuring
// never reaches up into the views it feeds.
let measurementViews={unavailable(){},scanned(){},refresh(){}};
export function setMeasurementViews(views){measurementViews=views}
export let registry=null,registrySha=null,torsoTris=null,measureScan=[],templates=[];
export let autoMarks=null,marks=null,poms=null,measureGrid=null,hps=null,autoHps=null;
export let levelContract=null;
export let gridContract=null;
export let torsoMeshes=[];
export let foldMarks={},armholes={},wingMarks={};

function collectSurfaceTriangles(root,materialNames){
  root.updateMatrixWorld(true);
  const wanted=new Set(materialNames);
  const out=[],v=new THREE.Vector3();
  root.traverse(object=>{
    if(!object.isMesh)return;
    const mats=Array.isArray(object.material)?object.material:[object.material];
    if(!mats.some(m=>m&&wanted.has(m.name)))return;
    const pos=object.geometry.attributes.position,idx=object.geometry.index;
    const count=idx?idx.count:pos.count;
    for(let i=0;i<count;i++){
      v.fromBufferAttribute(pos,idx?idx.getX(i):i).applyMatrix4(object.matrixWorld);
      out.push(v.x,v.y,v.z);
    }
  });
  return new Float32Array(out);
}

// Provenance for a running session: the digest is taken over the exact bytes
// fetched, the same way scripts/test_single_engine.mjs hashes contracts/ on disk,
// so a session can prove which registry drove it rather than asserting one.
async function sha256Hex(bytes){
  const subtle=globalThis.crypto&&globalThis.crypto.subtle;
  // SubtleCrypto only exists on a secure origin; over file:// there is none, and
  // saying so beats reporting a hash we did not compute.
  if(!subtle)return 'unavailable: no SubtleCrypto on this origin';
  const digest=await subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

// Returns {registry, sha}; sha is null only when these are the fallback defaults
// below, so a null in diagnostics means "no registry", never "unrecorded".
async function loadRegistry(){
  try{
    const response=await fetch(REGISTRY_URL,{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const bytes=await response.arrayBuffer();
    return {registry:JSON.parse(new TextDecoder().decode(bytes)),sha:await sha256Hex(bytes)};
  }catch(error){
    // Degrade to the engine defaults rather than showing nothing, and say so.
    return {sha:null,registry:{
      fallback:String(error&&error.message||error),
      measurement_surface:['Mara:body3'],
      scan:DEFAULT_SCAN,
      reporting:{inch_denominator:8},
      landmarks:[],
      poms:[
        {id:'BODY_WAIST_GIRTH',label_short:'Waist',method:'plane_section',status:'auto'},
        {id:'BODY_UNDERBUST_GIRTH',label_short:'Underbust (fold)',method:'plane_section',status:'auto'},
        {id:'BODY_BUST_GIRTH',label_short:'Bust (apex level)',method:'plane_section',status:'needs_review'},
        {id:'DIAG_MAX_TORSO_GIRTH',label_short:'Max girth',method:'plane_section',status:'diagnostic'},
        {id:'BODY_APEX_TO_APEX',label_short:'Apex to apex',method:'euclidean',status:'auto'},
      ],
    }};
  }
}

export async function runMeasurements(root){
  const started=performance.now();
  ({registry,sha:registrySha}=await loadRegistry());
  torsoTris=collectSurfaceTriangles(root,registry.measurement_surface);
  try{const r=await fetch('contracts/pattern-templates.json');const loaded=loadTemplates(await r.json(),registry);templates=loaded.templates;if(loaded.errors.length)console.warn('pattern-templates.json:',loaded.errors)}catch(error){templates=[];console.warn('pattern-templates.json not loaded',error)}
  // The levels contract is a runtime asset like the registry and the templates.
  // Without it there are no levels — never a default stack at guessed heights.
  try{const r=await fetch('contracts/measurement-levels.json');const loaded=loadLevels(await r.json(),registry);levelContract=loaded.errors.length?null:loaded;if(loaded.errors.length)console.warn('measurement-levels.json:',loaded.errors)}catch(error){levelContract=null;console.warn('measurement-levels.json not loaded',error)}
  try{const r=await fetch('contracts/body-grid.json');const loaded=loadGrid(await r.json(),registry);gridContract=loaded.errors.length?null:loaded;if(loaded.errors.length)console.warn('body-grid.json:',loaded.errors)}catch(error){gridContract=null;console.warn('body-grid.json not loaded',error)}
  // landmarks are placed on the measurement surface only — a point on the arm is never right
  torsoMeshes=[];root.traverse(o=>{if(!o.isMesh)return;const mats=Array.isArray(o.material)?o.material:[o.material];if(mats.some(m=>m&&registry.measurement_surface.includes(m.name)))torsoMeshes.push(o)});
  if(!torsoTris.length){measurementViews.unavailable();return}
  measureScan=scanSurface(torsoTris,registry.scan);
  const foldRule=(registry.landmarks||[]).find(l=>l.id==='UNDERBUST_FOLD')||{};
  autoMarks=findLandmarks(measureScan,foldRule);
  // surface-path POMs need the nearest-surface grid over the measurement surface
  measureGrid=buildGrid(torsoTris);
  autoHps={};   // HPS is manual-only on this asset; see the registry entry
  armholes=findArmholes(torsoTris);
  measurementViews.scanned();
  recomputeMeasurements(Math.round(performance.now()-started));
}

// Landmarks change far more often than geometry, so the scan is reused and only
// the landmark-dependent work re-runs. That is what keeps a correction instant.
export function recomputeMeasurements(elapsedMs){
  const started=performance.now();
  marks=applyLandmarkOverrides(autoMarks,overrides);
  hps={...autoHps};
  const manualPoints={};
  for(const [id,spec] of Object.entries(overrides.landmarks||{})){
    if(Array.isArray(spec.xyz_m)&&spec.xyz_m.length===3){
      manualPoints[id]={x:spec.xyz_m[0],y:spec.xyz_m[1],z:spec.xyz_m[2]};
      if(id==='HPS_L')hps.hpsL=manualPoints[id];
      if(id==='HPS_R')hps.hpsR=manualPoints[id];
    }
  }
  foldMarks=marks&&marks.fold?findFoldLandmarks(torsoTris,marks.fold.y):{};
  poms=marks?computePoms(torsoTris,measureScan,marks):null;
  // the wing runs up from its registry point below the fold (moved forward along that section) to the max-girth side point
  const wingRule=(registry.landmarks||[]).find(l=>l.id==='SIDE_WING_LOW_L')||{};
  wingMarks=marks?findWingLandmarks(torsoTris,marks,wingRule.offset_in,wingRule.forward_in):{};
  if(poms&&measureGrid)Object.assign(poms,computeSurfacePoms(
    measureGrid,torsoTris,marks,{hps,manualPoints,foldLandmarks:foldMarks,wing:wingMarks}));
  const elapsed=elapsedMs??Math.round(performance.now()-started);
  measurementViews.refresh(elapsed);
  prototypeState.registrySha=registrySha;
  prototypeState.measurements=poms
    ? Object.fromEntries(Object.entries(poms).map(([id,r])=>[id,{
        value_mm:+(r.value*1000).toFixed(1),at_y:+r.at_y.toFixed(4),
      }]))
    : null;
  prototypeState.landmarks=marks
    ? {
        BUST_APEX_L:[+marks.apexL.x.toFixed(4),+marks.apexL.y.toFixed(4),+marks.apexL.z.toFixed(4)],
        BUST_APEX_R:[+marks.apexR.x.toFixed(4),+marks.apexR.y.toFixed(4),+marks.apexR.z.toFixed(4)],
        BUST_LEVEL:+marks.bustLevel.toFixed(4),
        UNDERBUST_FOLD:marks.fold?+marks.fold.y.toFixed(4):null,
        WAIST_LEVEL:marks.waist?+marks.waist.y.toFixed(4):null,
      }
    : null;
  prototypeState.landmarkSource=marks?marks.source:null;
  prototypeState.measureMs=elapsed;
  syncDiagnostics();
}
// the closest point on the measurement surface (arms excluded)
export const closestOnSurface=p=>closestOnMesh(measureGrid,p);
