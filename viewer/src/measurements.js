import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

import {
  scanSurface,
  findLandmarks,
  computePoms,
  computeSurfacePoms,
  findArmholes,
  findFoldLandmarks,
  measureSection,
  applyLandmarkOverrides,
  pomProvenance,
  inchFraction,
} from "../../scripts/measure_core.mjs";
import { buildGrid } from "../../scripts/surface_path.mjs";

/**
 * Measurement panel for the production viewer.
 *
 * The MATHS is not reimplemented here: this module imports the same
 * scripts/measure_core.mjs that the prototype lane and the Node parity test use,
 * and reads the same registry (copied to viewer/public by npm run sync:registry).
 * Only the DOM and the three.js drawing are local, because the two lanes have
 * different shells. That split is what keeps the two lanes from ever disagreeing
 * about a number.
 *
 * The lanes differ in ROLE, deliberately: the prototype is the authoring lane
 * (pen, hand-placed landmarks, live section), this one is read-only presentation.
 * Corrections belong in one place, and evidence comes from the authority pass.
 */

const REGISTRY_URL = "measurement-registry.json";
const TAPE_COLOR = 0xd93a2b;
const STATUS_MARK = { needs_review: "?", diagnostic: "·" };

const lineMaterials = new Set();

/**
 * Digest of the exact bytes fetched — the same value scripts/test_lane_parity.mjs
 * computes over contracts/measurement-registry.json, so a running session can
 * prove which registry drove it instead of asserting one. SubtleCrypto exists
 * only on a secure origin, and saying it is unavailable beats reporting a hash
 * that was never computed.
 */
async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return "unavailable: no SubtleCrypto on this origin";
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function makeLine(points, { color, width, opacity = 1, depthTest = true, order = 0 }, canvas) {
  const geometry = new LineGeometry();
  const flat = [];
  for (const p of points) flat.push(p.x, p.y, p.z);
  geometry.setPositions(flat);
  const material = new LineMaterial({
    color, linewidth: width, transparent: opacity < 1, opacity, depthTest,
  });
  material.resolution.set(canvas.clientWidth || 1, canvas.clientHeight || 1);
  lineMaterials.add(material);
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  line.renderOrder = order;
  return line;
}

export function resizeMeasurementLines(width, height) {
  lineMaterials.forEach((material) => material.resolution.set(width, height));
}

function collectSurfaceTriangles(root, materialNames) {
  root.updateMatrixWorld(true);
  const wanted = new Set(materialNames);
  const out = [];
  const v = new THREE.Vector3();
  root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some((m) => m && wanted.has(m.name))) return;
    const position = object.geometry.attributes.position;
    const index = object.geometry.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(object.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  });
  return new Float32Array(out);
}

function ringPoints(section) {
  let cx = 0;
  let cz = 0;
  for (const q of section.ring) { cx += q[0]; cz += q[1]; }
  cx /= section.ring.length;
  cz /= section.ring.length;
  const points = section.ring.map(([x, z]) => {
    const dx = x - cx;
    const dz = z - cz;
    const length = Math.hypot(dx, dz) || 1;
    return new THREE.Vector3(x + (dx / length) * 0.0015, section.y, z + (dz / length) * 0.0015);
  });
  points.push(points[0].clone());
  return points;
}

function pathPoints(path) {
  return path.map((a) => {
    const radial = Math.hypot(a[0], a[2]) || 1;
    return new THREE.Vector3(a[0] * (1 + 0.0015 / radial), a[1], a[2] * (1 + 0.0015 / radial));
  });
}

/**
 * Measure the loaded avatar and render the panel. Returns the state the viewer
 * publishes for automated checks.
 */
export async function mountMeasurements({ root, scene, canvas, tableBody, toggle }) {
  let registry;
  let registrySha = null;
  let registryError = null;
  try {
    const response = await fetch(REGISTRY_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    registry = JSON.parse(new TextDecoder().decode(bytes));
    registrySha = await sha256Hex(bytes);
  } catch (error) {
    registryError = String(error?.message || error);
  }
  if (!registry) {
    // No silent fallback: the registry decides what may be measured, so without
    // it this lane reports nothing rather than inventing a default.
    tableBody.innerHTML = '<tr><td colspan="3">Unavailable — the measurement registry could not be '
      + `loaded (${registryError}). Run npm run sync:registry.</td></tr>`;
    // No registry, so no digest: null here means "none loaded", not "unrecorded".
    return { status: "NO_REGISTRY", registry_sha256: null, error: registryError };
  }

  const triangles = collectSurfaceTriangles(root, registry.measurement_surface);
  if (!triangles.length) {
    tableBody.innerHTML = '<tr><td colspan="3">Unavailable — the measurement surface '
      + `${registry.measurement_surface.join(", ")} is not in this asset.</td></tr>`;
    return { status: "NO_SURFACE", registry_sha256: registrySha };
  }

  const started = performance.now();
  const foldRule = (registry.landmarks || []).find((l) => l.id === "UNDERBUST_FOLD") || {};
  const scan = scanSurface(triangles, registry.scan);
  const marks = applyLandmarkOverrides(findLandmarks(scan, foldRule), null);
  const poms = marks ? computePoms(triangles, scan, marks) : {};
  if (marks) {
    // Hand-placed landmarks live in the authoring lane, so none are supplied
    // here; the automatically detected ones are the same on both sides.
    const foldLandmarks = marks.fold ? findFoldLandmarks(triangles, marks.fold.y) : {};
    const armholes = findArmholes(triangles);
    Object.assign(poms, computeSurfacePoms(buildGrid(triangles), triangles, marks,
      { foldLandmarks, armholes }));
  }
  const elapsed = Math.round(performance.now() - started);

  const rows = registry.poms
    .filter((spec) => ["plane_section", "surface_path", "section_arc"].includes(spec.method)
      && (poms[spec.id] || spec.status === "blocked_until_manual"))
    .map((spec) => ({ spec, result: poms[spec.id] || null }));

  const denominator = registry.reporting.inch_denominator;
  const drawables = [];
  tableBody.innerHTML = "";
  rows.forEach(({ spec, result }, index) => {
    const isPath = spec.method !== "plane_section";
    const tr = document.createElement("tr");
    if (!result) {
      tr.className = "muted";
      tr.innerHTML = `<td>${spec.label_short || spec.label_en} ⊘</td><td>—</td><td>—</td>`;
      tr.title = `Waiting on a hand-placed landmark (${(spec.unblocked_by || []).join(", ")}). `
        + `${spec.blocked_reason || ""} Place it in the prototype lane, then rerun the authority pass.`;
      tableBody.appendChild(tr);
      return;
    }
    const provenance = marks?.source ? pomProvenance(spec.id, marks.source) : "auto";
    const mark = STATUS_MARK[spec.status] || "";
    tr.title = (spec.review_reason || spec.comment || spec.label_en || "");
    tr.innerHTML = `<td>${spec.label_short || spec.label_en}${mark ? ` <em>${mark}</em>` : ""}</td>`
      + `<td><b>${(result.value * 100).toFixed(1)}</b></td>`
      + `<td>${inchFraction(result.value, denominator)}</td>`;
    tr.addEventListener("click", () => {
      const already = tr.getAttribute("aria-selected") === "true";
      tableBody.querySelectorAll("tr").forEach((r) => r.setAttribute("aria-selected", "false"));
      tr.setAttribute("aria-selected", String(!already));
      redraw(already ? -1 : index);
    });
    tableBody.appendChild(tr);
    if (isPath && result.points) drawables.push({ index, points: pathPoints(result.points) });
    else {
      const section = measureSection(triangles, result.at_y);
      if (section) drawables.push({ index, points: ringPoints(section) });
    }
    if (provenance !== "auto") tr.classList.add("manual");
  });

  let group = null;
  let visible = true;
  function redraw(selected = -1) {
    if (group) {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { lineMaterials.delete(o.material); o.material.dispose(); }
      });
      scene.remove(group);
      group = null;
    }
    if (!visible && selected < 0) return;
    group = new THREE.Group();
    group.name = "MeasurementTapes";
    for (const item of drawables) {
      const isSelected = item.index === selected;
      if (!visible && !isSelected) continue;
      group.add(makeLine(item.points, {
        color: TAPE_COLOR, width: isSelected ? 3.2 : 2, opacity: isSelected ? 1 : 0.6,
      }, canvas));
    }
    scene.add(group);
  }
  redraw();

  if (toggle) {
    toggle.addEventListener("click", () => {
      visible = !visible;
      toggle.setAttribute("aria-pressed", String(visible));
      redraw();
    });
    toggle.setAttribute("aria-pressed", "true");
  }

  return {
    status: "MEASURED",
    registry_schema_version: registry.schema_version,
    registry_sha256: registrySha,
    measurement_surface: registry.measurement_surface,
    scan: registry.scan,
    elapsed_ms: elapsed,
    measurements: Object.fromEntries(Object.entries(poms).map(([id, r]) => [id, {
      value_mm: Number((r.value * 1000).toFixed(1)),
      at_y: Number(r.at_y.toFixed(4)),
    }])),
    landmarks: marks ? {
      BUST_APEX_L: [marks.apexL.x, marks.apexL.y, marks.apexL.z].map((v) => Number(v.toFixed(4))),
      BUST_APEX_R: [marks.apexR.x, marks.apexR.y, marks.apexR.z].map((v) => Number(v.toFixed(4))),
      BUST_LEVEL: Number(marks.bustLevel.toFixed(4)),
      UNDERBUST_FOLD: marks.fold ? Number(marks.fold.y.toFixed(4)) : null,
      WAIST_LEVEL: marks.waist ? Number(marks.waist.y.toFixed(4)) : null,
    } : null,
  };
}
