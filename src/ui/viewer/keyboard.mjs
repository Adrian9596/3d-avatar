/* ---- keyboard, Face, turntable ---------------------------------------------
   Keys come from src/ui/keymap.mjs — the one table the gates check and the ?
   sheet is built from (AUTHORING_UX_PLAN.md §14, §5); this block only maps
   binding ids to actions. ------------------------------------------------------ */

import * as THREE from 'three';
import { turntable } from '../../core/view_geometry.mjs';
import { detectPlatform, cheatSheet, matchBinding } from '../keymap.mjs';
import { prototypeState } from './diagnostics.mjs';
import { gridToggle } from './grid.mjs';
import { landmarksVisible, placingLandmark, setPlacingLandmark, renderLandmarkList, redrawLandmarks, landmarkToggle, frameLandmark, placeNext, stepLandmarkRow, nudgeLandmark, acceptMirror, clearLandmark } from './landmarks.mjs';
import { toggleLoupe } from './loupe.mjs';
import { patternPanel } from './pattern_panel.mjs';
import { penEnabled, pen, setPenMode } from './pen_host.mjs';
import { levelToggle } from './reference_geometry/index.mjs';
import { sectionToggle } from './section.mjs';
import { cameraGoal, camera, controls, setCameraGoal, setView } from './stage.mjs';
import { tapeToggle } from './table.mjs';
import { tipEl, tipBase } from './tip.mjs';
import { activeTab } from '../tabs.mjs';

const PLATFORM=detectPlatform();
const keySheet=document.getElementById('keySheet');
// Tools are exclusive: landmarks hold the canvas while a row is selected or the
// pen is off; otherwise the pen does. The pattern block is a layer over either.
function activeContexts(){
  const contexts=['always'];
  if(landmarksVisible&&(placingLandmark||!penEnabled()))contexts.push('landmarks');
  else if(penEnabled())contexts.push('pen');
  if(!patternPanel.hidden)contexts.push('pattern');
  return contexts;
}
function toggleKeySheet(force){
  const open=force===undefined?keySheet.hidden:force;
  if(!open){keySheet.hidden=true;return}
  const sections=cheatSheet({contexts:activeContexts(),platform:PLATFORM});
  keySheet.innerHTML='<div class="khead">Keyboard <span>? or Esc closes · keys act on the selection; none selected, on the camera</span></div>'
    +sections.map(s=>`<h4>${s.title}</h4>`+s.rows.map(r=>`<div class="krow"><kbd>${r.keys}</kbd><span>${r.label}</span></div>`).join('')).join('');
  keySheet.hidden=false;
}
const cameraPose=()=>cameraGoal
  ?{position:cameraGoal.position.toArray(),target:cameraGoal.target.toArray()}
  :{position:camera.position.toArray(),target:controls.target.toArray()};
const toGoal=pose=>({position:new THREE.Vector3(...pose.position),target:new THREE.Vector3(...pose.target)});
function turnCamera(yawDeg,pitchDeg){
  if(!camera)return;
  setCameraGoal(toGoal(turntable(cameraPose(),{yaw_rad:yawDeg*Math.PI/180,pitch_rad:pitchDeg*Math.PI/180,
    polar_limits:{min_rad:controls.minPolarAngle,max_rad:controls.maxPolarAngle}})));
  document.querySelectorAll('.bottom-nav button').forEach(button=>button.classList.remove('active'));
}
function facePoint(){
  const pose=pen?.face();
  if(!pose){tipEl.textContent='Face: select a pin or hover the body first · '+tipBase;return false}
  setCameraGoal(toGoal(pose));
  document.querySelectorAll('.bottom-nav button').forEach(button=>button.classList.remove('active'));
  return true;
}
function escapeKey(){
  if(!keySheet.hidden){toggleKeySheet(false);return}
  if(placingLandmark){setPlacingLandmark(null);renderLandmarkList();redrawLandmarks();return}
  if(penEnabled()){if(!pen.deselect())setPenMode(false);return}
  if(landmarksVisible)landmarkToggle.click();
}
const clickIfEnabled=id=>{const el=document.getElementById(id);if(el&&!el.disabled)el.click()};
const KEY_ACTIONS={
  'pen.toggle':()=>setPenMode(!penEnabled()),
  'landmarks.toggle':()=>landmarkToggle.click(),
  'tapes.toggle':()=>tapeToggle.click(),
  'section.toggle':()=>sectionToggle.click(),
  'levels.toggle':()=>levelToggle.click(),
  'grid.toggle':()=>gridToggle.click(),
  'view.front':()=>setView('front'),'view.three-quarter':()=>setView('three-quarter'),
  'view.side':()=>setView('side'),'view.back':()=>setView('back'),'view.reset':()=>setView('reset'),
  'camera.yaw-left':b=>turnCamera(b.shift?-5:-15,0),'camera.yaw-right':b=>turnCamera(b.shift?5:15,0),
  'camera.pitch-up':b=>turnCamera(0,b.shift?5:15),'camera.pitch-down':b=>turnCamera(0,b.shift?-5:-15),
  'camera.face':()=>{if(placingLandmark&&activeContexts().includes('landmarks'))frameLandmark(placingLandmark);else facePoint()},
  'help.toggle':()=>toggleKeySheet(),
  'escape':()=>escapeKey(),
  'pen.finish':()=>pen?.finishLine(),'pen.close':()=>pen?.closeLoop(),'pen.delete':()=>pen?.deleteSelected(),
  'pen.reset-handles':()=>pen?.resetHandles(),
  'pen.select-previous':()=>pen?.selectAdjacentLine(-1),'pen.select-next':()=>pen?.selectAdjacentLine(1),
  'pen.toggle-label':()=>pen?.toggleLabelSelected(),'pen.export':()=>clickIfEnabled('penExport'),
  'snap.toggle':()=>{const on=pen?.toggleSnap();tipEl.textContent=`Snapping ${on?'on':'off'} · `+tipBase},
  'loupe.toggle':()=>{const on=toggleLoupe();tipEl.textContent=`Loupe ${on?'on':'off'} · `+tipBase},
  'pen.undo':()=>pen?.undo(),'pen.redo':()=>pen?.redo(),
  'pen.nudge':b=>{const step=b.shift?10:1;const d={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[b.key];if(d)pen?.nudgeSelected(...d)},
  'pen.mirror-line':()=>{const r=pen?.mirrorLine();if(r&&!r.error)tipEl.textContent=`Mirrored · max residual ${r.max_residual_mm} mm${r.asymmetry_flag?' — FLAGGED: the body is not symmetric here':''} · `+tipBase;else if(r?.error)tipEl.textContent=r.error},
  'landmarks.save':()=>clickIfEnabled('landmarkSave'),
  'landmarks.place-next':()=>placeNext(),
  'landmarks.previous':()=>stepLandmarkRow(-1),'landmarks.next':()=>stepLandmarkRow(1),
  'landmarks.nudge':b=>{const step=b.shift?10:1;const d={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[b.key];if(d&&placingLandmark)nudgeLandmark(placingLandmark,...d)},
  'landmarks.mirror':()=>{if(placingLandmark&&!acceptMirror(placingLandmark))tipEl.textContent='Mirror: the other side is not hand-placed · '+tipBase},
  'landmarks.reset-one':()=>{if(placingLandmark)clearLandmark(placingLandmark)},
  'pattern.flatten':()=>clickIfEnabled('patternFlatten'),'pattern.export':()=>clickIfEnabled('patternExport'),
  'pattern.template':()=>clickIfEnabled('patternDraft'),'pattern.compare':()=>clickIfEnabled('patternCompare'),
};
window.addEventListener('keydown',event=>{
  if(activeTab()!=='3d')return;   // 2D covers the view: its keys are its own, in its frame
  const contexts=activeContexts();
  const hasSelection=contexts.includes('landmarks')?Boolean(placingLandmark):Boolean(pen?.hasSelection());
  const binding=matchBinding(event,{contexts,hasSelection,platform:PLATFORM});
  if(!binding||!KEY_ACTIONS[binding.id])return;
  event.preventDefault();
  KEY_ACTIONS[binding.id](binding);
  prototypeState.lastKey=binding.id;
});
document.querySelector('.bottom-nav button[data-action="face"]').addEventListener('click',()=>facePoint());
// instrumentation for automated checks: the live camera, the controls and the goal the keys set
window.__keys={contexts:activeContexts,sheet:()=>cheatSheet({contexts:activeContexts(),platform:PLATFORM})};
window.__view={camera:()=>camera,controls:()=>controls,goal:()=>cameraGoal};
