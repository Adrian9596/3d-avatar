import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { AnimationController } from "./animation-controller.js";
import { validateMorphContract } from "./contracts.js";
import { mountMeasurements, resizeMeasurementLines } from "./measurements.js";
import "./styles.css";

const ASSET_URL = new URL("../../assets/export/avatar_master.glb", import.meta.url).href;
const FALLBACK_URL = new URL("../../assets/export/avatar_master_reference_render.png", import.meta.url).href;
const ASSET_VERSION = "0.2.0-clo3d-textured.1";
const ASSET_SHA = "0caa604bab3510e6c40ed699185832b55d68b87668336a53d385a5345ddd71a4";

const canvas = document.querySelector("#avatarCanvas");
const loading = document.querySelector("#loading");
const loadingDetail = document.querySelector("#loadingDetail");
const fallbackImage = document.querySelector("#fallbackImage");
const errorCard = document.querySelector("#errorCard");
const errorMessage = document.querySelector("#errorMessage");
const assetTag = document.querySelector("#assetTag");
const diagnosticOutput = document.querySelector("#viewerDiagnostics");
const motionNotice = document.querySelector("#motionNotice");
const morphNotice = document.querySelector("#morphNotice");
fallbackImage.src = FALLBACK_URL;

const loadStartedAt = performance.now();
const state = {
  status: "LOADING",
  assetUrl: ASSET_URL,
  version: ASSET_VERSION,
  sha256: ASSET_SHA,
  roleCounts: { BODY: 0, BIKINI_TOP: 0, BIKINI_BRIEF: 0 },
  roleVisibility: { BODY: true, BIKINI_TOP: true, BIKINI_BRIEF: true },
  wireframe: false,
  meshCount: 0,
  morphContract: null,
  animationContract: null,
  armaturePresent: false,
  loadMs: null,
  camera: null,
  error: null,
};
window.__avatarPlatform = state;

let renderer;
let scene;
let camera;
let controls;
let avatarRoot;
let animationController;
let cameraGoal = null;
let modelCenter = new THREE.Vector3(0, 0.85, 0);
let modelSize = new THREE.Vector3(1, 1.7, 0.5);
let modelRadius = 1.05;
const clock = new THREE.Clock();
const roleMeshes = { BODY: [], BIKINI_TOP: [], BIKINI_BRIEF: [] };

function syncDiagnostics() {
  diagnosticOutput.textContent = JSON.stringify(state);
  document.documentElement.dataset.viewerStatus = state.status;
}

function fail(message) {
  state.status = "ERROR";
  state.error = String(message);
  state.loadMs = Math.round(performance.now() - loadStartedAt);
  loading.hidden = true;
  canvas.hidden = true;
  fallbackImage.hidden = false;
  errorCard.hidden = false;
  errorMessage.textContent = `${message} A static draft view is shown instead.`;
  assetTag.textContent = "avatar_master.glb · fallback image";
  syncDiagnostics();
}

function initScene() {
  if (!window.WebGLRenderingContext) throw new Error("WebGL is unavailable.");
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // PBR Neutral keeps skin tone accurate; ACES desaturates warm midtones toward white.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = Math.PI - 0.35;
  controls.minDistance = 0.9;
  controls.maxDistance = 7;

  // Image-based studio lighting carries the skin shading; the directionals only
  // shape it, so the body is not blown out to a flat off-white.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;
  const key = new THREE.DirectionalLight(0xfff4e8, 1.5);
  key.position.set(2.6, 4.1, 3.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdbe5ef, 0.45);
  fill.position.set(-3, 2, 2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffe7d2, 0.7);
  rim.position.set(1.5, 2, -3);
  scene.add(rim);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(2.2, 64), new THREE.ShadowMaterial({ color: 0x554a42, opacity: 0.16 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.002;
  ground.receiveShadow = true;
  scene.add(ground);
  window.addEventListener("resize", resize);
  resize();
}

function resize() {
  if (!renderer || !camera) return;
  const width = canvas.clientWidth || 1;
  const height = canvas.clientHeight || 1;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  resizeMeasurementLines(width, height);
}

function roleFor(object) {
  return object.userData?.object_role || object.parent?.userData?.object_role || null;
}

function configureContracts(gltf, morphNames) {
  state.morphContract = validateMorphContract([...morphNames]);
  animationController = new AnimationController(gltf.scene, gltf.animations || []);
  state.animationContract = animationController.contract;

  const morphPass = state.morphContract.status === "PASS";
  morphNotice.classList.toggle("pass", morphPass);
  morphNotice.textContent = morphPass
    ? "Six semantic morphs mapped exactly once."
    : `Blocked: missing ${state.morphContract.missing.join(", ") || "none"}. No substitute controls are generated.`;

  const motionPass = state.animationContract.status === "PASS";
  motionNotice.classList.toggle("pass", motionPass);
  motionNotice.textContent = motionPass
    ? "Required arm pose and sweep clips are available."
    : `Blocked: ${state.animationContract.missing.length} required clips are absent. Final rig authoring waits for the TD-fitted master.`;
  document.querySelectorAll("#motionControls button").forEach((button) => {
    button.disabled = !state.animationContract.actual.includes(button.dataset.clip);
  });
}

function prepareModel(gltf) {
  Object.values(roleMeshes).forEach((list) => { list.length = 0; });
  state.meshCount = 0;
  const morphs = new Set();
  let bones = 0;
  gltf.scene.traverse((object) => {
    if (object.isBone) bones += 1;
    if (!object.isMesh) return;
    state.meshCount += 1;
    object.castShadow = true;
    object.receiveShadow = true;
    const role = roleFor(object);
    if (roleMeshes[role]) roleMeshes[role].push(object);
    if (object.morphTargetDictionary) Object.keys(object.morphTargetDictionary).forEach((name) => morphs.add(name));
    if (object.morphTargetInfluences) object.morphTargetInfluences.fill(0);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => {
      material.side = role === "BODY" ? THREE.FrontSide : THREE.DoubleSide;
      material.needsUpdate = true;
    });
  });
  state.armaturePresent = bones > 0;
  state.roleCounts = Object.fromEntries(Object.entries(roleMeshes).map(([role, meshes]) => [role, meshes.length]));
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  modelCenter = sphere.center.clone();
  modelSize = box.getSize(new THREE.Vector3());
  modelRadius = Math.max(sphere.radius, 0.6);
  controls.target.copy(modelCenter);
  controls.minDistance = modelRadius * 0.85;
  controls.maxDistance = modelRadius * 5;
  configureContracts(gltf, morphs);
  setView("front", false);
}

function directionFor(view) {
  if (view === "three-quarter") return new THREE.Vector3(1, 0, 1).normalize();
  if (view === "side") return new THREE.Vector3(1, 0, 0);
  if (view === "back") return new THREE.Vector3(0, 0, -1);
  return new THREE.Vector3(0, 0, 1);
}

function setView(view, animate = true) {
  if (!camera || !controls) return;
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const fitHeight = modelSize.y / (2 * Math.tan(verticalFov / 2));
  const fitWidth = Math.max(modelSize.x, modelSize.z) / (2 * Math.tan(verticalFov / 2) * camera.aspect);
  const distance = Math.max(fitHeight, fitWidth) * 1.3;
  const target = modelCenter.clone();
  const destination = target.clone().addScaledVector(directionFor(view), distance);
  destination.y += modelRadius * 0.03;
  if (animate) cameraGoal = { position: destination, target };
  else {
    camera.position.copy(destination);
    controls.target.copy(target);
    camera.lookAt(target);
    controls.update();
  }
  document.querySelectorAll("#cameraControls button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
}

function loadAvatar() {
  new GLTFLoader().load(ASSET_URL, (gltf) => {
    avatarRoot = gltf.scene;
    scene.add(avatarRoot);
    prepareModel(gltf);
    state.status = "READY_WITH_BLOCKED_FEATURES";
    state.loadMs = Math.round(performance.now() - loadStartedAt);
    loading.hidden = true;
    assetTag.textContent = `avatar_master.glb · ${ASSET_VERSION} · ${state.meshCount} meshes`;
    syncDiagnostics();
    // Same engine and same registry as the prototype lane and the Node parity
    // test; only the shell differs, so the two lanes cannot disagree on a number.
    mountMeasurements({
      root: avatarRoot,
      scene,
      canvas,
      tableBody: document.querySelector("#measureRows"),
      toggle: document.querySelector("#tapeToggle"),
    }).then((result) => {
      state.measurementLane = result;
      syncDiagnostics();
    }).catch((error) => {
      state.measurementLane = { status: "ERROR", error: String(error?.message || error) };
      syncDiagnostics();
    });
  }, (event) => {
    loadingDetail.textContent = event.total
      ? `${Math.min(100, Math.round(event.loaded / event.total * 100))}% · ${(event.loaded / 1048576).toFixed(1)} MB`
      : `${(event.loaded / 1048576).toFixed(1)} MB received`;
  }, (error) => fail(error?.message || "The GLB request failed."));
}

function animate() {
  requestAnimationFrame(animate);
  if (cameraGoal) {
    camera.position.lerp(cameraGoal.position, 0.11);
    controls.target.lerp(cameraGoal.target, 0.11);
    if (camera.position.distanceTo(cameraGoal.position) < 0.003) cameraGoal = null;
  }
  const delta = Math.min(clock.getDelta(), 0.05);
  animationController?.update(delta);
  controls?.update();
  if (camera && controls) state.camera = {
    position: camera.position.toArray().map((value) => +value.toFixed(5)),
    target: controls.target.toArray().map((value) => +value.toFixed(5)),
  };
  syncDiagnostics();
  renderer?.render(scene, camera);
}

document.querySelectorAll("#cameraControls button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelector("#resetView").addEventListener("click", () => setView("front"));
canvas.addEventListener("pointerdown", () => { cameraGoal = null; });
document.querySelectorAll(".toggle-list button").forEach((button) => button.addEventListener("click", () => {
  const role = button.dataset.role;
  const enabled = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(enabled));
  button.querySelector("span").textContent = enabled ? "On" : "Off";
  if (role === "WIREFRAME") {
    avatarRoot?.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => { material.wireframe = enabled; material.needsUpdate = true; });
    });
    state.wireframe = enabled;
  } else {
    roleMeshes[role]?.forEach((object) => { object.visible = enabled; });
    state.roleVisibility[role] = enabled;
  }
  syncDiagnostics();
}));
document.querySelectorAll("#motionControls button").forEach((button) => button.addEventListener("click", () => {
  const played = animationController?.play(button.dataset.clip);
  if (played) {
    document.querySelectorAll("#motionControls button").forEach((item) => item.classList.toggle("active", item === button));
  }
}));

syncDiagnostics();
try {
  initScene();
  loadAvatar();
  animate();
} catch (error) {
  fail(error?.message || error);
}

