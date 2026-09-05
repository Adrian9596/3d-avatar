import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { AnimationController } from "./animation-controller.js";
import { validateMorphContract } from "./contracts.js";
import { mountMeasurements, resizeMeasurementLines } from "./measurements.js";
import { createPenTool } from "../../scripts/pen_tool.mjs";
import { inchFraction, sectionSegments, segmentPoints } from "../../scripts/measure_core.mjs";
// One keyboard map and one view-geometry module for both lanes
// (AUTHORING_UX_PLAN.md §14, §5): the keys, the grazing guard and the F key mean
// the same thing here as in the authoring lane.
import { matchBinding, cheatSheet, detectPlatform } from "../../scripts/keymap.mjs";
import { framingDistance, turntable, grazingLevel } from "../../scripts/view_geometry.mjs";
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
let pen = null;
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
  pen?.updateResolution(width, height);
}

function roleFor(object) {
  return object.userData?.object_role || object.parent?.userData?.object_role || null;
}

/**
 * The contract check still runs even though the panel that displayed it is gone.
 * It is what stops this lane from implying a capability the asset lacks: the
 * result lands in the published diagnostics, and `npm run validate:viewer-contracts`
 * asserts the engine reports BLOCKED rather than inventing substitute controls.
 * Do not delete the check along with its UI.
 */
function configureContracts(gltf, morphNames) {
  state.morphContract = validateMorphContract([...morphNames]);
  animationController = new AnimationController(gltf.scene, gltf.animations || []);
  state.animationContract = animationController.contract;
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
  const distance = framingDistance({ size_m: modelSize.toArray(), fov_deg: camera.fov, aspect: camera.aspect });
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

    // The pen is the SAME module the prototype lane uses. It draws ad-hoc
    // measured lines and touches no POM and no landmark file, so it does not
    // create a second source of truth — unlike landmark editing, which stays in
    // the authoring lane so there is one place to correct the record.
    pen = createPenTool({
      scene, canvas, camera, controls, root: avatarRoot, onChange: renderPen, onHover: showFootprint,
      // snap targets are the detected apexes the measurement module reports —
      // read-only here; surfaces by material name; the level snap reads the
      // measurement surface the same module collected from the registry
      getSnapTargets: () => {
        const marks = state.measurementLane?.landmarks;
        return marks ? ["BUST_APEX_L", "BUST_APEX_R"].filter((id) => marks[id]).map((id) => ({ name: id, point: marks[id] })) : [];
      },
      surfaceOf: (mesh) => { const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material; return m?.name || null; },
      section: (y) => { const tri = state.measurementLane?.surface?.triangles; return tri ? segmentPoints(sectionSegments(tri, y)) : null; },
    });
    wirePen();
    renderPen();
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
  positionPenLabels();
  if (camera && controls) state.camera = {
    position: camera.position.toArray().map((value) => +value.toFixed(5)),
    target: controls.target.toArray().map((value) => +value.toFixed(5)),
    orbit_enabled: controls.enabled,
  };
  syncDiagnostics();
  renderer?.render(scene, camera);
  renderLoupe();
}

/* ---- pen chrome: buttons, the line list, and on-body labels ---------------
   Only the DOM lives here; the geometry, drawing and interaction are in the
   shared scripts/pen_tool.mjs that the prototype lane also imports. */
const penLabels = document.querySelector("#penLabels");
let penLabelEls = [];

function positionPenLabels() {
  if (!pen || !camera) return;
  const labels = pen.getLabels();
  while (penLabelEls.length < labels.length) {
    const el = document.createElement("div");
    el.className = "mlabel";
    penLabels.appendChild(el);
    penLabelEls.push(el);
  }
  penLabelEls.forEach((el, i) => { el.hidden = i >= labels.length; });
  const projected = new THREE.Vector3();
  labels.forEach((label, i) => {
    const el = penLabelEls[i];
    projected.copy(label.position).project(camera);
    if (projected.z > 1) { el.hidden = true; return; }
    el.textContent = `${(label.length * 100).toFixed(1)}cm · ${inchFraction(label.length)}`
      + (label.approximated ? " ·straight" : "");
    el.style.left = `${(projected.x * 0.5 + 0.5) * canvas.clientWidth}px`;
    el.style.top = `${(-projected.y * 0.5 + 0.5) * canvas.clientHeight - 20}px`;
  });
}

function renderPen() {
  const summary = pen.summary();
  const list = document.querySelector("#penList");
  const hasLines = summary.lines.length > 0;
  document.querySelector("#penFinish").disabled = !(summary.active && summary.active.anchors > 1);
  document.querySelector("#penUndo").disabled = !hasLines && !(summary.active && summary.active.anchors);
  document.querySelector("#penClear").disabled = !hasLines;
  document.querySelector("#penExport").disabled = !hasLines;
  state.penLines = summary.lines.map((l) => ({
    name: l.name, length_mm: Number((l.length * 1000).toFixed(1)), on_surface: !l.approximated,
  }));
  syncDiagnostics();

  list.hidden = !hasLines && !(summary.active && summary.active.anchors);
  list.innerHTML = "";
  summary.lines.forEach((line) => {
    const row = document.createElement("div");
    row.className = "stroke-row";
    row.dataset.selected = String(summary.selected === line.index);
    row.title = line.approximated
      ? "Part of this line could not follow the surface and is measured straight."
      : "Shortest path along the surface through its control points.";
    const geo = pen.lineGeometry(line.index);
    const flag = geo?.origin?.asymmetry_flag ? '<em class="flag" title="Mirrored line: a point had to move more than 5mm to reach the skin — the body is not symmetric here">⚠</em>' : "";
    row.innerHTML = `<i></i><span class="lname">${line.name}</span>${flag}`
      + `<b>${(line.length * 100).toFixed(1)}cm</b>`;
    row.addEventListener("click", (event) => {
      if (event.target.tagName === "BUTTON" || event.target.isContentEditable) return;
      pen.selectLine(line.index);
    });
    const nameEl = row.querySelector(".lname");
    const rename = document.createElement("button");
    rename.textContent = "✎";
    rename.setAttribute("aria-label", "Rename this line");
    rename.addEventListener("click", () => {
      nameEl.contentEditable = "true";
      nameEl.focus();
      const range = document.createRange();
      range.selectNodeContents(nameEl);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    nameEl.addEventListener("blur", () => {
      nameEl.contentEditable = "false";
      pen.renameLine(line.index, nameEl.textContent.trim());
    });
    nameEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); nameEl.blur(); }
      if (event.key === "Escape") { nameEl.textContent = line.name; nameEl.blur(); }
    });
    row.appendChild(rename);
    const label = document.createElement("button");
    label.textContent = line.labelVisible ? "◉" : "◎";
    label.setAttribute("aria-label", "Show or hide this line's measurement on the body");
    label.addEventListener("click", () => pen.toggleLabel(line.index));
    row.appendChild(label);
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Delete this line");
    remove.addEventListener("click", () => pen.deleteLine(line.index));
    row.appendChild(remove);
    list.appendChild(row);
  });
  if (summary.active && summary.active.anchors) {
    const row = document.createElement("div");
    row.className = "stroke-row";
    row.dataset.active = "true";
    row.innerHTML = `<i></i><span>${summary.active.anchors > 1
      ? `${(summary.active.length * 100).toFixed(1)}cm` : "click the body to pin the next point"}</span>`;
    list.appendChild(row);
  }
}

function wirePen() {
  const toggle = document.querySelector("#penToggle");
  toggle.addEventListener("click", () => setPen(!pen.enabled));
  document.querySelector("#penFinish").addEventListener("click", () => pen.finishLine());
  document.querySelector("#penUndo").addEventListener("click", () => pen.undoPoint());
  document.querySelector("#penClear").addEventListener("click", () => pen.clear());
  document.querySelector("#penExport").addEventListener("click", () => {
    const payload = pen.toExport({
      asset: "avatar_master.glb", assetSha: ASSET_SHA, inchFraction,
    });
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    link.download = "draft-lines.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    try { navigator.clipboard.writeText(text); } catch (error) { /* no clipboard permission */ }
    console.log(`draft-lines.json — save into qa/avatar_master/\n${text}`);
  });
}

document.querySelectorAll("#cameraControls button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelector("#resetView").addEventListener("click", () => setView("front"));
document.querySelector("#faceView").addEventListener("click", () => facePoint());

/* ---- keyboard, grazing guard, Face, turntable ------------------------------
   Keys come from scripts/keymap.mjs, the same table the authoring lane
   dispatches; this block maps binding ids to this lane's actions. Landmark and
   pattern rows do not exist here (lane: "production"). The pen hint shows what
   a pixel is worth on the skin under the cursor: amber past 60°, red past 75° —
   colours only; the number is recorded on every anchor as placed_with. */
const PLATFORM = detectPlatform();
const keySheet = document.querySelector("#keySheet");
const penHint = document.querySelector("#penHint");
const hintBase = penHint.textContent;
function showFootprint(hover) {
  if (!hover) { penHint.textContent = hintBase; penHint.className = "notice"; return; }
  const level = grazingLevel(hover.incidence_deg);
  penHint.className = `notice${level === "ok" ? "" : ` ${level}`}`;
  const surfaces = state.measurementLane?.surface?.materials;
  penHint.textContent = `${hover.footprint_mm_px} mm/px at ${hover.incidence_deg}° incidence`
    + (hover.snap ? ` · snap: ${hover.snap.kind}${hover.snap.to ? ` → ${hover.snap.to}` : ""}` : "")
    + (hover.surface && surfaces && !surfaces.includes(hover.surface) ? ` · off the measurement surface (${hover.surface})` : "")
    + (level === "ok" ? "" : " — turn the body to place this precisely (F faces the point)");
}
/* ---- loupe: a 3x inset of the skin under the cursor, rendered into a corner of
   the same canvas each frame while Z is on and the pen is hovering the body. */
let loupeOn = false;
const loupeCamera = new THREE.PerspectiveCamera(28 / 3, 1, 0.01, 100);
const LOUPE_PX = 200;
function renderLoupe() {
  if (!loupeOn || !pen || !renderer) return;
  const at = pen.hoverPoint() || pen.selectedPoint();
  if (!at) return;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  loupeCamera.position.copy(camera.position);
  loupeCamera.lookAt(at.point[0], at.point[1], at.point[2]);
  loupeCamera.updateProjectionMatrix();
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, LOUPE_PX, LOUPE_PX);
  renderer.setScissor(0, 0, LOUPE_PX, LOUPE_PX);
  renderer.render(scene, loupeCamera);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.setScissor(0, 0, w, h);
}
const activeContexts = () => (pen?.enabled ? ["always", "pen"] : ["always"]);
function toggleKeySheet(force) {
  const open = force === undefined ? keySheet.hidden : force;
  if (!open) { keySheet.hidden = true; return; }
  const sections = cheatSheet({ contexts: activeContexts(), lane: "production", platform: PLATFORM });
  keySheet.innerHTML = '<div class="khead">Keyboard <span>? or Esc closes · keys act on the selection; none selected, on the camera</span></div>'
    + sections.map((s) => `<h4>${s.title}</h4>${s.rows.map((r) => `<div class="krow"><kbd>${r.keys}</kbd><span>${r.label}</span></div>`).join("")}`).join("");
  keySheet.hidden = false;
}
const cameraPose = () => (cameraGoal
  ? { position: cameraGoal.position.toArray(), target: cameraGoal.target.toArray() }
  : { position: camera.position.toArray(), target: controls.target.toArray() });
const toGoal = (pose) => ({ position: new THREE.Vector3(...pose.position), target: new THREE.Vector3(...pose.target) });
function turnCamera(yawDeg, pitchDeg) {
  if (!camera) return;
  cameraGoal = toGoal(turntable(cameraPose(), {
    yaw_rad: (yawDeg * Math.PI) / 180, pitch_rad: (pitchDeg * Math.PI) / 180,
    polar_limits: { min_rad: controls.minPolarAngle, max_rad: controls.maxPolarAngle },
  }));
  document.querySelectorAll("#cameraControls button").forEach((button) => button.classList.remove("active"));
}
function facePoint() {
  const pose = pen?.face();
  if (!pose) { penHint.textContent = "Face: select a pin or hover the body first."; return false; }
  cameraGoal = toGoal(pose);
  document.querySelectorAll("#cameraControls button").forEach((button) => button.classList.remove("active"));
  return true;
}
function setPen(on) {
  pen.setEnabled(on);
  document.querySelector("#penToggle").setAttribute("aria-pressed", String(pen.enabled));
}
function escapeKey() {
  if (!keySheet.hidden) { toggleKeySheet(false); return; }
  if (pen?.enabled && !pen.deselect()) setPen(false);
}
const clickIfEnabled = (selector) => { const el = document.querySelector(selector); if (el && !el.disabled) el.click(); };
const KEY_ACTIONS = {
  "pen.toggle": () => pen && setPen(!pen.enabled),
  "tapes.toggle": () => clickIfEnabled("#tapeToggle"),
  "view.front": () => setView("front"), "view.three-quarter": () => setView("three-quarter"),
  "view.side": () => setView("side"), "view.back": () => setView("back"), "view.reset": () => setView("front"),
  "camera.yaw-left": (b) => turnCamera(b.shift ? -5 : -15, 0), "camera.yaw-right": (b) => turnCamera(b.shift ? 5 : 15, 0),
  "camera.pitch-up": (b) => turnCamera(0, b.shift ? 5 : 15), "camera.pitch-down": (b) => turnCamera(0, b.shift ? -5 : -15),
  "camera.face": () => facePoint(),
  "help.toggle": () => toggleKeySheet(),
  "escape": () => escapeKey(),
  "pen.finish": () => pen?.finishLine(), "pen.close": () => pen?.closeLoop(), "pen.delete": () => pen?.deleteSelected(),
  "pen.reset-handles": () => pen?.resetHandles(),
  "pen.select-previous": () => pen?.selectAdjacentLine(-1), "pen.select-next": () => pen?.selectAdjacentLine(1),
  "pen.toggle-label": () => pen?.toggleLabelSelected(), "pen.export": () => clickIfEnabled("#penExport"),
  "snap.toggle": () => { const on = pen?.toggleSnap(); penHint.textContent = `Snapping ${on ? "on" : "off"}.`; },
  "loupe.toggle": () => { loupeOn = !loupeOn; document.querySelector("#loupeFrame").hidden = !loupeOn; penHint.textContent = `Loupe ${loupeOn ? "on" : "off"}.`; },
  "pen.undo": () => pen?.undo(), "pen.redo": () => pen?.redo(),
  "pen.nudge": (b) => { const step = b.shift ? 10 : 1; const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[b.key]; if (d) pen?.nudgeSelected(...d); },
  "pen.mirror-line": () => { const r = pen?.mirrorLine(); if (r && !r.error) penHint.textContent = `Mirrored · max residual ${r.max_residual_mm} mm${r.asymmetry_flag ? " — FLAGGED: the body is not symmetric here" : ""}.`; else if (r?.error) penHint.textContent = r.error; },
};
window.addEventListener("keydown", (event) => {
  const binding = matchBinding(event, { contexts: activeContexts(), hasSelection: Boolean(pen?.hasSelection()), lane: "production", platform: PLATFORM });
  if (!binding || !KEY_ACTIONS[binding.id]) return;
  event.preventDefault();
  KEY_ACTIONS[binding.id](binding);
  state.lastKey = binding.id;
});
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

syncDiagnostics();
try {
  initScene();
  loadAvatar();
  animate();
} catch (error) {
  fail(error?.message || error);
}

