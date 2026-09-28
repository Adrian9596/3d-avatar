/* The 3D stage: renderer, scene, camera, orbit controls and lights; the
   loaded avatar's framing; the view presets and where the camera is heading.
   Everything drawn on the body is added to this scene. */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { framingDistance } from '../../core/view_geometry.mjs';
import { prototypeState } from './diagnostics.mjs';

export const canvas=document.getElementById('canvas');

export let renderer,scene,camera,controls,avatarRoot,modelCenter=new THREE.Vector3(0,.85,0),modelSize=new THREE.Vector3(1,1.7,.5),modelRadius=1.05,cameraGoal=null;
// Where the camera is heading (a view preset, a framed landmark, a key turn); the frame loop moves it there.
export function setCameraGoal(goal){cameraGoal=goal}
export function setAvatarRoot(root){avatarRoot=root}
// what else follows the canvas size (line widths, the pen), each registering itself
const resizeListeners=[];
export function onResize(listener){resizeListeners.push(listener)}
export const roleMeshes={BODY:[],BIKINI_TOP:[],BIKINI_BRIEF:[]};

export function initScene(){
  if(!window.WebGLRenderingContext)throw new Error('WebGL is not available in this browser.');
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  // PBR Neutral keeps skin tone accurate; ACES desaturates warm midtones toward white.
  renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1.0;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(28,1,.01,100);
  controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.07;controls.minPolarAngle=.35;controls.maxPolarAngle=Math.PI-.35;controls.minDistance=.06;controls.maxDistance=7;
  // Image-based studio lighting carries the skin shading; the directionals only
  // shape it, so the body is not blown out to a flat off-white.
  const pmrem=new THREE.PMREMGenerator(renderer);
  scene.environment=pmrem.fromScene(new RoomEnvironment(),0.04).texture;
  scene.environmentIntensity=0.85;
  const key=new THREE.DirectionalLight(0xfff4e8,1.5);key.position.set(2.6,4.1,3.4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.bias=-0.0005;scene.add(key);
  const fill=new THREE.DirectionalLight(0xdbe5ef,0.45);fill.position.set(-3,2,2);scene.add(fill);
  const rim=new THREE.DirectionalLight(0xffe7d2,0.7);rim.position.set(1.5,2,-3);scene.add(rim);
  const ground=new THREE.Mesh(new THREE.CircleGeometry(2.2,64),new THREE.ShadowMaterial({color:0x554a42,opacity:.16}));ground.rotation.x=-Math.PI/2;ground.position.y=-.002;ground.receiveShadow=true;ground.name='PrototypeGround';scene.add(ground);
  window.addEventListener('resize',resize);resize();
}

function resize(){
  if(!renderer||!camera)return;const w=canvas.clientWidth||1,h=canvas.clientHeight||1;
  renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  for(const listener of resizeListeners)listener(w,h);
}

function roleFor(object){return object.userData?.object_role||object.parent?.userData?.object_role||null}

export function prepareModel(root){
  Object.values(roleMeshes).forEach(list=>list.length=0);
  const morphs=new Set();let armatures=0;
  root.traverse(object=>{
    if(object.isBone)armatures++;
    if(!object.isMesh)return;
    prototypeState.meshCount++;
    object.castShadow=true;object.receiveShadow=true;
    const role=roleFor(object);if(role&&roleMeshes[role])roleMeshes[role].push(object);
    if(object.morphTargetDictionary)Object.keys(object.morphTargetDictionary).forEach(name=>morphs.add(name));
    if(object.morphTargetInfluences)object.morphTargetInfluences.fill(0);
    const mats=Array.isArray(object.material)?object.material:[object.material];
    // Flat cards (lashes/brows) and open garment shells must render both
    // faces; forcing FrontSide hides half the hair cards.
    mats.filter(Boolean).forEach(mat=>{mat.side=role==='BODY'||role==='EYE_L'||role==='EYE_R'?THREE.FrontSide:THREE.DoubleSide;mat.needsUpdate=true});
  });
  prototypeState.morphNames=[...morphs];prototypeState.armaturePresent=armatures>0;
  prototypeState.roleCounts=Object.fromEntries(Object.entries(roleMeshes).map(([role,meshes])=>[role,meshes.length]));
  const box=new THREE.Box3().setFromObject(root),sphere=new THREE.Sphere();box.getBoundingSphere(sphere);
  modelCenter.copy(sphere.center);box.getSize(modelSize);modelRadius=Math.max(sphere.radius,.6);
  // Allow close-up inspection (lashes/brows) instead of clamping at body scale.
  controls.target.copy(modelCenter);controls.minDistance=.06;controls.maxDistance=modelRadius*5;
  setView('front',false);
}

function directionFor(view){
  if(view==='three-quarter')return new THREE.Vector3(1,0,1).normalize();
  if(view==='side')return new THREE.Vector3(1,0,0);
  if(view==='back')return new THREE.Vector3(0,0,-1);
  return new THREE.Vector3(0,0,1);
}

export function setView(view,animate=true){
  if(!camera||!controls)return;
  const distance=framingDistance({size_m:modelSize.toArray(),fov_deg:camera.fov,aspect:camera.aspect}),dir=directionFor(view==='reset'?'front':view);
  const target=modelCenter.clone();const destination=target.clone().addScaledVector(dir,distance);destination.y+=modelRadius*.03;
  if(animate)cameraGoal={position:destination,target};else{camera.position.copy(destination);controls.target.copy(target);camera.lookAt(target);controls.update()}
  document.querySelectorAll('.bottom-nav button').forEach(button=>button.classList.toggle('active',button.dataset.view===(view==='reset'?'front':view)));
}

document.querySelectorAll('.bottom-nav button[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
canvas.addEventListener('pointerdown',()=>{cameraGoal=null;document.querySelectorAll('.bottom-nav button').forEach(button=>button.classList.remove('active'))});
