/* ---- landmarks: markers, hand placement, and a saved override file --------
   Detected landmarks can be corrected and manual-only ones placed, through the
   placement logic in src/features/landmarks (guided order, framing, the mirror
   offer, the record a placed point carries). The file Save writes is the same
   one scripts/measure_avatar.py reads, so a correction here becomes corrected
   evidence rather than a viewer-local illusion. ------------------------------ */

import * as THREE from 'three';
import { measureSection } from '../../core/measure_core.mjs';
import { mirrorOffer, nextNeeded, placementRecord, landmarkRecord, poseFor, framingFor, placementNotes } from '../../features/landmarks/landmark_placement.mjs';
import { ASSET_URL, ASSET_SHA } from './asset.mjs';
import { disposeGroup, makeLine } from './draw.mjs';
import { placeLabels } from './labels.mjs';
import { overrides, persistOverrides, resetOverrides } from './landmark_store.mjs';
import { LANDMARK_ROWS, landmarkPosition, LANDMARK_GROUPS, landmarkValue } from './landmark_values.mjs';
import { marks, measureGrid, closestOnSurface, recomputeMeasurements, torsoTris } from './measurement.mjs';
import { pen } from './pen_host.mjs';
import { surfaceHit } from './picking.mjs';
import { scene, camera, canvas, controls, setCameraGoal } from './stage.mjs';

let lmLabelEls=[];
export let landmarksVisible=false,placingLandmark=null,landmarkGroup=null,levelPreviewGroup=null;
let savedLandmarksJson='{}';   // what the last Save (or load) wrote, to mark unsaved changes
// Landmark placement borrows the canvas, so the pen must stay suspended for
// exactly as long as a landmark is selected. Assigning placingLandmark
// directly is how that pairing gets forgotten -- go through here.
export function setPlacingLandmark(id){placingLandmark=id||null;pen?.setSuspended(Boolean(placingLandmark));}
savedLandmarksJson=JSON.stringify(overrides.landmarks||{});
const LANDMARK_COLOR=0xf0a02a;

export function redrawLandmarks(){
  disposeGroup(landmarkGroup);landmarkGroup=null;
  if(!landmarksVisible||!marks)return;
  landmarkGroup=new THREE.Group();landmarkGroup.name='Landmarks';
  for(const row of LANDMARK_ROWS){
    const position=landmarkPosition(row.id);
    if(!position)continue;
    const picked=placingLandmark===row.id;
    const manual=Boolean((overrides.landmarks||{})[row.id]);
    const dot=new THREE.Mesh(
      new THREE.SphereGeometry(picked?0.008:0.0055,14,10),
      new THREE.MeshBasicMaterial({color:picked?0xd93a2b:manual?0xf0a02a:0xc9922f}));
    const outward=new THREE.Vector3(position.x,0,position.z);
    if(outward.lengthSq()>1e-9)position.addScaledVector(outward.normalize(),0.003);
    dot.position.copy(position);
    landmarkGroup.add(dot);
  }
  scene.add(landmarkGroup);
}

export function renderLandmarkList(){
  const list=document.getElementById('landmarkList');
  const anyManual=Object.keys(overrides.landmarks||{}).length>0;
  document.getElementById('landmarkSave').disabled=!anyManual;
  document.getElementById('landmarkReset').disabled=!anyManual;
  if(!landmarksVisible||!marks){list.hidden=true;list.innerHTML='';return}
  list.hidden=false;
  list.innerHTML='';
  for(const {group,rows} of LANDMARK_GROUPS){
    const heading=document.createElement('p');
    heading.className='lm-group';heading.textContent=group;
    list.appendChild(heading);
    for(const row of rows){
      const value=landmarkValue(row.id);
      const manual=Boolean((overrides.landmarks||{})[row.id]);
      const element=document.createElement('div');
      element.className='lm-row';
      element.setAttribute('aria-selected',String(placingLandmark===row.id));
      const source=manual?(overrides.landmarks[row.id].source||'manual'):null;
      const badge=manual?(source==='manual_mirrored'?'mirrored':'manual'):row.manualOnly?'needed':'auto';
      const text=value
        ? (Number.isFinite(value.x)
            ? `${(value.y*100).toFixed(1)} · x ${(value.x*100).toFixed(1)}`
            : `${(value.y*100).toFixed(1)}`)
        : 'not placed';
      const pw=manual?overrides.landmarks[row.id].placed_with:null;
      element.title=pw?`Placed by ${pw.method}${pw.footprint_mm_px!==undefined?` at ${pw.footprint_mm_px} mm/px, ${pw.incidence_deg}° incidence, ${pw.distance_m} m`:''}${pw.from?` — mirror of ${pw.from}, residual ${pw.residual_mm} mm`:''}`:'';
      element.innerHTML=`<span>${row.label}</span>`
        +`<span class="badge ${badge==='auto'?'':badge}">${badge}</span><b>${text}</b>`;
      element.addEventListener('click',event=>{
        if(event.target.tagName==='BUTTON')return;
        setPlacingLandmark(placingLandmark===row.id?null:row.id);
        renderLandmarkList();redrawLandmarks();
      });
      // the mirror of the other side is OFFERED when that side was hand-placed
      const offer=row.kind==='point'&&measureGrid?mirrorOffer(row.id,overrides,closestOnSurface):null;
      if(offer){
        const mirror=document.createElement('button');
        mirror.textContent='⇄';mirror.className='lm-mirror';
        mirror.title=`Use the mirror of ${offer.from} (residual ${offer.residual_mm} mm${offer.flagged?' — FLAGGED: the body is not symmetric here':''}); recorded as manual_mirrored`;
        mirror.setAttribute('aria-label',`Accept the mirror of ${offer.from}`);
        mirror.addEventListener('click',()=>acceptMirror(row.id));
        element.appendChild(mirror);
      }
      if(manual){
        const clear=document.createElement('button');
        clear.textContent='×';clear.setAttribute('aria-label','Return this landmark to automatic');
        clear.addEventListener('click',()=>clearLandmark(row.id));
        element.appendChild(clear);
      }
      list.appendChild(element);
    }
  }
  const hint=document.createElement('p');
  hint.className='lm-hint';hint.id='landmarkHint';
  const row=LANDMARK_ROWS.find(r=>r.id===placingLandmark);
  const next=nextNeeded(overrides,placingLandmark);
  hint.textContent=row
    ? (row.kind==='point'
        ? `Click or drag on the body to place ${row.label} (measurements follow the drag) · arrows nudge · F frames · M mirrors · Esc cancels.`
        : `Drag on the body to set the height of ${row.label}; the ring follows, only the height is kept.`)
    : (next
        ? `Space places the next needed landmark (${next}). ${anyManual?'Save writes qa/avatar_master/landmarks.manual.json — the file the authority pass reads.':'Values in cm. Click a row, then click or drag the body.'}`
        : (anyManual?'All manual-only landmarks are placed. Save writes qa/avatar_master/landmarks.manual.json — the file the authority pass reads.':'Values in cm. Click a row, then click or drag the body.'));
  list.appendChild(hint);
  const saveBtn=document.getElementById('landmarkSave');
  saveBtn.textContent=JSON.stringify(overrides.landmarks||{})!==savedLandmarksJson&&anyManual?'Save •':'Save';
}

/* A placement writes the override entry: the value, its source, and how it was
   placed (camera distance, incidence, what a pixel was worth) — the last is
   context for the record, never a correction to the value. */
function applyPlacement(id,entry,{persist=true,deselect=true}={}){
  overrides.landmarks=overrides.landmarks||{};
  overrides.landmarks[id]=entry;
  if(persist)persistOverrides();
  if(deselect)setPlacingLandmark(null);
  recomputeMeasurements();
}
function placeLandmark(id,hit,method,options={}){
  const row=LANDMARK_ROWS.find(r=>r.id===id);
  if(!row||!hit)return;
  const p=[hit.point.x,hit.point.y,hit.point.z];
  const placed_with=placementRecord({point:p,normal:[hit.normal.x,hit.normal.y,hit.normal.z],
    cameraPosition:camera.position.toArray(),fov_deg:camera.fov,pixel_height:canvas.clientHeight||1,method});
  applyPlacement(id,landmarkRecord({kind:row.kind,point:p,y:hit.point.y,placed_with}),options);
}
export function acceptMirror(id){
  const row=LANDMARK_ROWS.find(r=>r.id===id);
  const offer=row&&measureGrid?mirrorOffer(id,overrides,closestOnSurface):null;
  if(!offer)return false;
  const placed_with={method:'mirror',from:offer.from,residual_mm:offer.residual_mm,...(offer.flagged?{flagged:true}:{})};
  applyPlacement(id,landmarkRecord({kind:row.kind,point:offer.xyz_m,y:offer.y_m,placed_with,source:'manual_mirrored'}));
  return true;
}
export function clearLandmark(id){
  if(!overrides.landmarks||!overrides.landmarks[id])return false;
  delete overrides.landmarks[id];persistOverrides();recomputeMeasurements();return true;
}
/** Arrow keys with a landmark row selected: move it one pixel along the skin. */
export function nudgeLandmark(id,dx,dy){
  const position=landmarkPosition(id);
  if(!position)return false;
  const rect=canvas.getBoundingClientRect();
  const v=position.clone().project(camera);
  const hit=surfaceHit(rect.left+(v.x*0.5+0.5)*rect.width+dx,rect.top+(-v.y*0.5+0.5)*rect.height+dy);
  if(!hit)return false;
  placeLandmark(id,hit,'nudge',{deselect:false});
  return true;
}
/** Where the camera should stand to place `id`: the region it belongs to, framed. */
export function frameLandmark(id){
  const map={};
  for(const row of LANDMARK_ROWS){const v=landmarkValue(row.id);if(!v)continue;map[row.id]=Number.isFinite(v.x)?[v.x,v.y,v.z]:v.y}
  const pose=poseFor(framingFor(id,map),{min_rad:controls.minPolarAngle,max_rad:controls.maxPolarAngle});
  if(!pose)return false;
  setCameraGoal({position:new THREE.Vector3(...pose.position),target:new THREE.Vector3(...pose.target)});
  document.querySelectorAll('.bottom-nav button').forEach(button=>button.classList.remove('active'));
  return true;
}
/** Space: select the next manual-only landmark not yet placed, and frame it. */
export function placeNext(){
  const id=nextNeeded(overrides,placingLandmark);
  if(!landmarksVisible){landmarksVisible=true;landmarkToggle.setAttribute('aria-pressed','true')}
  if(!id){setPlacingLandmark(null);renderLandmarkList();redrawLandmarks();return false}
  setPlacingLandmark(id);renderLandmarkList();redrawLandmarks();frameLandmark(id);
  return true;
}
export function stepLandmarkRow(step){
  const ids=LANDMARK_ROWS.map(r=>r.id);
  const at=ids.indexOf(placingLandmark);
  const next=at<0?(step>0?0:ids.length-1):(at+step+ids.length)%ids.length;
  setPlacingLandmark(ids[next]);renderLandmarkList();redrawLandmarks();
}
// a level landmark is a height: while it is dragged the section ring follows
function drawLevelPreview(y){
  disposeGroup(levelPreviewGroup);levelPreviewGroup=null;
  if(!Number.isFinite(y)||!torsoTris)return;
  const section=measureSection(torsoTris,y);
  if(!section)return;
  const points=section.ring.map(([x,z])=>new THREE.Vector3(x,y,z));points.push(points[0].clone());
  levelPreviewGroup=new THREE.Group();levelPreviewGroup.name='LevelPreview';
  levelPreviewGroup.add(makeLine(points,{color:0xf0a02a,width:2.4}));
  levelPreviewGroup.add(makeLine(points,{color:0xf0a02a,width:1.2,opacity:.3,depthTest:false,order:3}));
  scene.add(levelPreviewGroup);
}

function saveLandmarks(){
  const payload={
    schema_version:1,
    asset:ASSET_URL.replace(/^.*\//,''),
    asset_sha256:ASSET_SHA,
    recorded_at:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),
    author:'placed in the viewer',
    landmarks:overrides.landmarks,
    placement_notes:placementNotes(overrides),
  };
  savedLandmarksJson=JSON.stringify(overrides.landmarks||{});
  const text=JSON.stringify(payload,null,2)+'\n';
  const blob=new Blob([text],{type:'application/json'});
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download='landmarks.manual.json';
  document.body.appendChild(link);link.click();link.remove();
  try{navigator.clipboard.writeText(text)}catch(error){/* no clipboard permission */}
  console.log('landmarks.manual.json — save into qa/avatar_master/\n'+text);
  const hint=document.getElementById('landmarkHint');
  if(hint)hint.textContent='Saved and copied. Put it in qa/avatar_master/, then run npm run validate:measurements.';
}

// The grid carries no labels: its curves are quiet reference lines, and a name
// parked on each one crowded the body with text that told a reader nothing the
// Grid button's own title does not.

// The landmark dots, unlike the curves, are only useful if you can tell which
// is which — so those keep their names.
export function positionLandmarkLabels(){
  const host=document.getElementById('landmarkLabels');
  const rows=landmarksVisible&&marks
    ? LANDMARK_ROWS.map(row=>{
        const position=landmarkPosition(row.id);
        return position?{label:row.label,at:[position.x,position.y,position.z]}:null;
      }).filter(Boolean)
    : [];
  while(lmLabelEls.length<rows.length){
    const el=document.createElement('div');el.className='lmlabel';
    host.appendChild(el);lmLabelEls.push(el);
  }
  placeLabels(lmLabelEls,rows,12);
}
// Landmark placement borrows the canvas from the pen rather than racing it.
// With a row selected, a press on the body places: a click places at once, a
// drag moves the marker with the dependent measurements following, and the
// release commits. OrbitControls saw the press too and is parked until release
// (as the pen does for a pin); the arrow keys still turn the camera.
let placeDownAt=null,placePreview=null;
function previewLandmark(id,hit){
  placePreview={id,hit};
  if(placePreview.frame)return;
  placePreview.frame=requestAnimationFrame(()=>{
    const at=placePreview;if(!at)return;at.frame=null;
    const row=LANDMARK_ROWS.find(r=>r.id===id);
    if(row?.kind==='level')drawLevelPreview(at.hit.point.y);
    placeLandmark(id,at.hit,'drag',{persist:false,deselect:false});
  });
}
canvas.addEventListener('pointerdown',event=>{
  if(!placingLandmark||event.button!==0)return;
  const hit=surfaceHit(event.clientX,event.clientY);
  if(!hit)return;                                   // off the body: the camera's
  placeDownAt={x:event.clientX,y:event.clientY,moved:false,hit};
  controls.enabled=false;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove',event=>{
  if(!placingLandmark||!placeDownAt)return;
  if(!placeDownAt.moved&&Math.hypot(event.clientX-placeDownAt.x,event.clientY-placeDownAt.y)<=5)return;
  placeDownAt.moved=true;
  const hit=surfaceHit(event.clientX,event.clientY);
  if(hit)previewLandmark(placingLandmark,hit);
});
canvas.addEventListener('pointerup',event=>{
  if(!placingLandmark||!placeDownAt)return;
  const press=placeDownAt;placeDownAt=null;
  controls.enabled=true;
  if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  if(placePreview?.frame)cancelAnimationFrame(placePreview.frame);
  const last=placePreview;placePreview=null;
  disposeGroup(levelPreviewGroup);levelPreviewGroup=null;
  const hit=surfaceHit(event.clientX,event.clientY)||(press.moved?last?.hit:press.hit);
  if(hit)placeLandmark(placingLandmark,hit,press.moved?'drag':'click');
});

export const landmarkToggle=document.getElementById('landmarkToggle');
landmarkToggle.addEventListener('click',()=>{
  landmarksVisible=!landmarksVisible;
  landmarkToggle.setAttribute('aria-pressed',String(landmarksVisible));
  if(!landmarksVisible)setPlacingLandmark(null);
  renderLandmarkList();redrawLandmarks();
});
document.getElementById('landmarkSave').addEventListener('click',saveLandmarks);
document.getElementById('landmarkReset').addEventListener('click',()=>{
  resetOverrides();persistOverrides();setPlacingLandmark(null);recomputeMeasurements();
});
