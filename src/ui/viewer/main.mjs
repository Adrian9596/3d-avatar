/* The app: loads the avatar, starts the frame loop, and wires the views to
   each other — what follows a measurement, the rows hung under a POM, what
   follows the pen's lines. The one module that may import every other; nothing
   imports it. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { segmentPoints, sectionSegments } from '../../core/measure_core.mjs';
import { AnimationController } from '../../features/avatar/animation_controller.mjs';
import { validateMorphContract } from '../../features/avatar/avatar_contracts.mjs';
import { createPenTool } from '../../features/pen/pen_tool.mjs';
import { ASSET_URL, ASSET_SHA, ASSET_VERSION } from './asset.mjs';
import { prototypeState, syncDiagnostics } from './diagnostics.mjs';
import { recomputeGrid } from './grid.mjs';
import { LANDMARK_ROWS, landmarkValue } from './landmark_values.mjs';
import { positionLandmarkLabels, renderLandmarkList, redrawLandmarks } from './landmarks.mjs';
import { renderLoupe } from './loupe.mjs';
import { torsoTris, runMeasurements, setMeasurementViews, marks, poms } from './measurement.mjs';
import { renderTemplateChooser, refreshTemplateLines, renderPatternControls } from './pattern_panel.mjs';
import { setPen, renderDraftList, pen, positionDraftLabels, onDraftChange } from './pen_host.mjs';
import { positionLevelLabels, recomputeLevels, listReferenceRows } from './reference_geometry/index.mjs';
import { fitSectionSlider } from './section.mjs';
import { canvas, setAvatarRoot, avatarRoot, scene, prepareModel, camera, controls, cameraGoal, setCameraGoal, renderer, initScene } from './stage.mjs';
import { renderMeasurements, setRowsAfterPom } from './table.mjs';
import { showFootprint } from './tip.mjs';
import { onTabChange } from '../tabs.mjs';
import './display.mjs';
import './keyboard.mjs';

const loading=document.getElementById('loading');
const loadingDetail=document.getElementById('loadingDetail');
const errorCard=document.getElementById('errorCard');
const errorMessage=document.getElementById('errorMessage');
const fallbackImage=document.getElementById('fallbackImage');
const assetTag=document.getElementById('assetTag');

const loadStartedAt=performance.now();
let animationController=null;
const animationClock=new THREE.Clock();

function fail(message){
  prototypeState.status='ERROR';prototypeState.error=String(message);
  prototypeState.loadMs=Math.round(performance.now()-loadStartedAt);syncDiagnostics();
  loading.hidden=true;canvas.hidden=true;fallbackImage.hidden=false;errorCard.hidden=false;
  errorMessage.textContent=String(message)+' A static draft view is shown instead.';
  assetTag.textContent='avatar_master.glb · fallback image';
}

function setBusyDetail(text){loadingDetail.textContent=text}

function loadAvatar(){
  const loader=new GLTFLoader();
  // Cache-buster tied to the declared SHA: a new asset release changes
  // ASSET_SHA, forcing the browser past its heuristic GLB cache.
  loader.load(ASSET_URL+'?sha='+ASSET_SHA,gltf=>{
    setAvatarRoot(gltf.scene);avatarRoot.name='avatar_master';scene.add(avatarRoot);prepareModel(avatarRoot);
    // The contracts, run on what actually arrived. Both come back BLOCKED on
    // this asset — it has no semantic morphs and no clips — and that is the
    // point: the app says so instead of offering controls with nothing behind
    // them. The controller is constructed even with no clips, because it is the
    // only thing that would play one and it reports the clip contract.
    animationController=new AnimationController(avatarRoot,gltf.animations||[]);
    prototypeState.clipNames=(gltf.animations||[]).map(clip=>clip.name);
    prototypeState.contracts={
      morphs:validateMorphContract(prototypeState.morphNames),
      animations:animationController.contract,
      armature_present:prototypeState.armaturePresent,
    };
    setPen(createPenTool({scene,canvas,camera,controls,root:avatarRoot,onChange:renderDraftList,onHover:showFootprint,
      // snap targets: every landmark that is a point and has a value; surfaces by
      // material name, judged against the registry's measurement surface by the
      // pattern block; the level snap reads the torso section contour
      getSnapTargets:()=>LANDMARK_ROWS.filter(r=>r.kind==='point').map(r=>{const v=landmarkValue(r.id);return v&&Number.isFinite(v.x)?{name:r.id,point:[v.x,v.y,v.z]}:null}).filter(Boolean),
      surfaceOf:mesh=>{const m=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;return m?.name||null},
      section:y=>torsoTris?segmentPoints(sectionSegments(torsoTris,y)):null}));
    window.__pen=pen;   // instrumentation for automated checks (pen.addLine, pen.lineGeometry)
    renderDraftList();runMeasurements(avatarRoot);
    prototypeState.status='READY';prototypeState.loadMs=Math.round(performance.now()-loadStartedAt);syncDiagnostics();loading.hidden=true;
    assetTag.textContent=`avatar_master.glb · ${ASSET_VERSION} · ${prototypeState.meshCount} meshes`;
  },event=>{
    if(event.total){const p=Math.min(100,Math.round(event.loaded/event.total*100));setBusyDetail(`${p}% · ${(event.loaded/1048576).toFixed(1)} MB`)}else setBusyDetail(`${(event.loaded/1048576).toFixed(1)} MB received`);
  },error=>fail(error?.message||'The GLB request failed.'));
}

let frameId=0;
function animate(){
  frameId=requestAnimationFrame(animate);
  if(cameraGoal){
    camera.position.lerp(cameraGoal.position,.11);controls.target.lerp(cameraGoal.target,.11);
    if(camera.position.distanceTo(cameraGoal.position)<.003){camera.position.copy(cameraGoal.position);controls.target.copy(cameraGoal.target);setCameraGoal(null)}
  }
  controls?.update();
  animationController?.update(animationClock.getDelta());
  positionDraftLabels();
  positionLevelLabels();
  positionLandmarkLabels();
  if(camera&&controls)prototypeState.camera={position:camera.position.toArray().map(value=>+value.toFixed(5)),target:controls.target.toArray().map(value=>+value.toFixed(5)),distance:+camera.position.distanceTo(controls.target).toFixed(5),orbit_enabled:controls.enabled};
  syncDiagnostics();
  renderer?.render(scene,camera);
  renderLoupe();
}
// The loop runs while the 3D shows. Under the 2D tab the view is covered, so it
// stops; resuming drops the paused time, so the animation clock does not jump.
function startLoop(){if(frameId)return;animationClock.getDelta();animate()}
function stopLoop(){cancelAnimationFrame(frameId);frameId=0}

// The views that follow a measurement, the rows hung under a POM and what
// follows the pen's lines, in the order they have always run.
setMeasurementViews({
  unavailable:()=>renderMeasurements(null,null,0),
  scanned:()=>fitSectionSlider(),
  refresh:elapsed=>{
    recomputeLevels();          // before the table: it lists the levels drawn as tapes
    renderMeasurements(marks,poms,elapsed);
    renderLandmarkList();
    redrawLandmarks();
    renderTemplateChooser();
    refreshTemplateLines();
    recomputeGrid();
  },
});
setRowsAfterPom(listReferenceRows);
onDraftChange(renderPatternControls);

try{initScene();loadAvatar();onTabChange(tab=>tab==='3d'?startLoop():stopLoop())}catch(error){fail(error?.message||error)}
