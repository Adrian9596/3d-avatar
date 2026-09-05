import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

import { buildGrid, surfaceRun, pointAtFraction } from "./surface_path.mjs";
import { placement, poseFacing } from "./view_geometry.mjs";

/**
 * The pen: drafting measured lines on a body, the way a pattern is drafted on a
 * form. Click to pin an anchor, drag an anchor to correct it, drag either of a
 * segment's two control points to shape the run, right-click a control point to
 * re-centre it or an anchor to delete it. Dragging empty skin ORBITS — the pen
 * claims the pointer only when it lands on a pin, so the body is turned without
 * leaving the tool (AUTHORING_UX_PLAN.md §5.1); a touch long-press is the
 * right-click. Keys are the host's: it dispatches scripts/keymap.mjs bindings to
 * the actions exposed below, so both lanes read the same map.
 *
 * Every anchor records how well it was placed — camera distance, incidence
 * angle, what one pixel was worth on the skin there (`placed_with`, via
 * scripts/view_geometry.mjs) — because a point pinned at 80° from 1.6 m is a
 * different kind of number from one pinned facing at 0.35 m, and the evidence
 * should be able to tell them apart.
 *
 * This module is SHARED BY BOTH VIEWER LANES on purpose. Copying it into the
 * second lane would give the project two implementations of the same
 * measurement, which is exactly what scripts/test_lane_parity.mjs exists to
 * prevent. The geometry, the three.js objects and the pointer handling live
 * here; each lane supplies only its own DOM chrome (buttons, the line list, the
 * on-body labels) through `onChange` and `getLabels()`.
 *
 * Every run between two points is the shortest path along the surface
 * (scripts/surface_path.mjs) and nothing else — the one path model, chosen
 * because a sub-path of a shortest path is itself a shortest path, which is what
 * stops a reading from jumping when a segment gains control points.
 */

const ANCHOR_LIFT = 0.0018;
const ANCHOR_RADIUS = 0.0055;
const HANDLE_RADIUS = 0.0038;
const INK_COLOR = 0x2f4f6f;
const HANDLE_COLOR = 0x1f8a70;
const SELECTED_COLOR = 0xf0a02a;
// Pins and control points are picked in SCREEN space within a pixel radius, not
// by raycasting their spheres: a 3.8mm control point is under 6px across at
// normal viewing distance, so ray picking demanded pixel-perfect aim and the
// drag fell through to the camera instead.
const PICK_RADIUS_PX = 15;
// A press that travels less than this is a click; more, and it was an orbit.
const CLICK_SLOP_PX = 5;
// A touch held this long without moving is the right-click.
const LONG_PRESS_MS = 500;

const toArr = (v) => [v.x, v.y, v.z];
const toVec = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export function createPenTool({ scene, canvas, camera, controls, root, onChange, onHover }) {
  const raycaster = new THREE.Raycaster();
  const lineMaterials = new Set();

  let triangles = null;
  let grid = null;
  let enabled = false;
  let suspended = false;
  let lines = [];
  let activeLine = null;
  let selectedLine = -1;
  let selectedAnchor = null;
  let dragging = null;
  let pointerDownAt = null;
  let hoverHit = null;          // the skin under the cursor, refreshed once per frame
  let hoverPending = null;
  let lineGroup = null;
  let anchorGroup = null;

  function collectTriangles() {
    root.updateMatrixWorld(true);
    const out = [];
    const v = new THREE.Vector3();
    root.traverse((object) => {
      if (!object.isMesh) return;
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

  function makeLine(points, { color, width, opacity = 1, depthTest = true, order = 0 }) {
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

  function disposeGroup(group) {
    if (!group) return;
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { lineMaterials.delete(o.material); o.material.dispose(); }
    });
    scene.remove(group);
  }

  function surfaceHit(clientX, clientY) {
    if (!root) return null;
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hits = raycaster.intersectObject(root, true);
    if (!hits.length) return null;
    const hit = hits[0];
    const normal = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : new THREE.Vector3(0, 0, 1);
    return { point: hit.point.clone(), normal };
  }

  const surfaceAnchor = (arr) => {
    const run = surfaceRun(grid, arr, arr);
    const point = run.points[0];
    return { point: toVec(point), normal: new THREE.Vector3(point[0], 0, point[2]).normalize(), placed_with: { method: "script" } };
  };

  /** How a point was placed: the camera it was seen from and what a pixel was worth. */
  function placedWith(hit, method) {
    return placement({
      point: toArr(hit.point), normal: toArr(hit.normal), cameraPosition: toArr(camera.position),
      fov_deg: camera.fov, pixel_height: canvas.clientHeight || 1, method,
    });
  }

  // path points already lie on the skin, so nudge them radially clear of it
  function liftPath(points) {
    return points.map((a) => {
      const radial = Math.hypot(a[0], a[2]);
      if (radial < 1e-6) return toVec(a);
      return new THREE.Vector3(a[0] * (1 + ANCHOR_LIFT / radial), a[1], a[2] * (1 + ANCHOR_LIFT / radial));
    });
  }

  function nearestIndex(points, q) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = (points[i][0] - q[0]) ** 2 + (points[i][1] - q[1]) ** 2 + (points[i][2] - q[2]) ** 2;
      if (d < bestDistance) { bestDistance = d; best = i; }
    }
    return best;
  }

  /* Split the A->B run at the two control points and hand each piece to its leg
     as a seed, so the legs relax from where the parent already was. */
  function splitThree(points, h1, h2) {
    const i1 = Math.max(1, Math.min(points.length - 3, nearestIndex(points, h1)));
    const i2 = Math.max(i1 + 1, Math.min(points.length - 2, nearestIndex(points, h2)));
    return [points.slice(0, i1 + 1), points.slice(i1, i2 + 1), points.slice(i2)];
  }

  const runBetween = (from, to, seed) => surfaceRun(grid, toArr(from.point), toArr(to.point), {
    normalA: toArr(from.normal), normalB: toArr(to.normal),
    seed: seed && seed.length > 1 ? seed : undefined,
  });

  /* Park the control points at a third and two thirds of arc length ALONG the
     run, which is what makes A->h1->h2->B measure the same as A->B. */
  function initHandles(seg) {
    const run = runBetween(seg.a, seg.b);
    const h1 = pointAtFraction(run.points, 1 / 3);
    const h2 = pointAtFraction(run.points, 2 / 3);
    seg.handles = [surfaceAnchor(h1), surfaceAnchor(h2)];
    seg.seeds = splitThree(run.points, h1, h2);
  }

  function computeSegment(seg) {
    if (!seg.handles) initHandles(seg);
    const nodes = [seg.a, seg.handles[0], seg.handles[1], seg.b];
    const legs = [];
    seg.length = 0;
    seg.approximated = false;
    for (let i = 1; i < nodes.length; i++) {
      const run = runBetween(nodes[i - 1], nodes[i], seg.seeds && seg.seeds[i - 1]);
      legs.push(run.points);
      seg.length += run.length;
      if (!run.onSurface) seg.approximated = true;
    }
    seg.seeds = legs;
    const joined = legs[0].slice();
    for (let i = 1; i < legs.length; i++) joined.push(...legs[i].slice(1));
    seg.drawPoints = liftPath(joined);
  }

  function resetSegment(seg) {
    seg.handles = null;
    seg.seeds = null;
    computeSegment(seg);
  }

  function segmentPairs(line) {
    const pairs = [];
    for (let i = 1; i < line.anchors.length; i++) pairs.push([line.anchors[i - 1], line.anchors[i]]);
    if (line.closed && line.anchors.length > 2) {
      pairs.push([line.anchors[line.anchors.length - 1], line.anchors[0]]);
    }
    return pairs;
  }

  function rebuildLine(line, only) {
    if (!line.segmentMap) line.segmentMap = new Map();
    line.runs = [];
    line.length = 0;
    line.approximated = false;
    line.segments = [];
    for (const [a, b] of segmentPairs(line)) {
      // keyed by the anchor OBJECT, so control-point edits survive inserting or
      // deleting other points
      let seg = line.segmentMap.get(a);
      if (!seg) { seg = { handles: null, seeds: null }; line.segmentMap.set(a, seg); }
      const moved = seg.a !== a || seg.b !== b;
      seg.a = a; seg.b = b; seg.line = line;
      if (moved) seg.handles = null;
      if (!only || seg === only || !seg.drawPoints) computeSegment(seg);
      line.segments.push(seg);
      line.runs.push(seg.drawPoints);
      line.length += seg.length;
      if (seg.approximated) line.approximated = true;
    }
    return line;
  }

  function chordSpan(line) {
    if (line.closed || line.anchors.length < 2) return 0;
    return line.anchors[0].point.distanceTo(line.anchors[line.anchors.length - 1].point);
  }

  function redraw() {
    disposeGroup(lineGroup);
    disposeGroup(anchorGroup);
    lineGroup = new THREE.Group();
    lineGroup.name = "PenLines";
    anchorGroup = new THREE.Group();
    anchorGroup.name = "PenAnchors";
    const all = activeLine ? lines.concat([activeLine]) : lines;
    all.forEach((line) => {
      const isActive = line === activeLine;
      const isSelected = lines.indexOf(line) === selectedLine;
      for (const run of line.runs || []) {
        if (!run || run.length < 2) continue;
        lineGroup.add(makeLine(run, { color: INK_COLOR, width: isActive || isSelected ? 2.8 : 2 }));
        lineGroup.add(makeLine(run, {
          color: INK_COLOR, width: 1.4, opacity: 0.2, depthTest: false, order: 3,
        }));
      }
      if (!(isActive || isSelected)) return;
      line.anchors.forEach((anchor) => {
        const picked = anchor === selectedAnchor;
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(picked ? ANCHOR_RADIUS * 1.35 : ANCHOR_RADIUS, 14, 10),
          new THREE.MeshBasicMaterial({ color: picked ? SELECTED_COLOR : INK_COLOR }));
        dot.position.copy(anchor.point).addScaledVector(anchor.normal, ANCHOR_LIFT);
        dot.userData = { anchor, line };
        anchorGroup.add(dot);
      });
      (line.segments || []).forEach((seg) => {
        if (!seg.handles) return;
        seg.handles.forEach((handle, slot) => {
          const picked = handle === selectedAnchor;
          const dot = new THREE.Mesh(
            new THREE.SphereGeometry(picked ? HANDLE_RADIUS * 1.35 : HANDLE_RADIUS, 12, 9),
            new THREE.MeshBasicMaterial({ color: picked ? SELECTED_COLOR : HANDLE_COLOR }));
          dot.position.copy(handle.point).addScaledVector(handle.normal, ANCHOR_LIFT * 1.6);
          dot.userData = { handle, seg, line };
          anchorGroup.add(dot);
          const anchorEnd = slot === 0 ? seg.a : seg.b;
          lineGroup.add(makeLine([
            anchorEnd.point.clone().addScaledVector(anchorEnd.normal, ANCHOR_LIFT),
            handle.point.clone().addScaledVector(handle.normal, ANCHOR_LIFT * 1.6),
          ], { color: HANDLE_COLOR, width: 1.2, opacity: 0.5, depthTest: false, order: 2 }));
        });
      });
    });
    scene.add(lineGroup);
    scene.add(anchorGroup);
  }

  function pickAt(clientX, clientY) {
    if (!anchorGroup || !anchorGroup.children.length) return null;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const projected = new THREE.Vector3();
    let best = null;
    let bestDistance = PICK_RADIUS_PX;
    for (const dot of anchorGroup.children) {
      projected.copy(dot.position).project(camera);
      if (projected.z > 1) continue;
      const sx = (projected.x * 0.5 + 0.5) * rect.width;
      const sy = (-projected.y * 0.5 + 0.5) * rect.height;
      const distance = Math.hypot(sx - px, sy - py);
      // a tie goes to the control point: it is the smaller target
      if (distance < bestDistance || (distance === bestDistance && dot.userData.handle)) {
        bestDistance = distance;
        best = dot.userData;
      }
    }
    return best;
  }

  function newLine() {
    activeLine = {
      anchors: [], runs: [], length: 0, closed: false, labelVisible: true,
      approximated: false, name: `Line ${lines.length + 1}`,
    };
  }

  function finishLine() {
    if (!activeLine || activeLine.anchors.length < 2) return;
    lines.push(activeLine);
    selectedLine = lines.length - 1;
    newLine();
    redraw();
    onChange?.();
  }

  function deleteAnchor(line, anchor) {
    const index = line.anchors.indexOf(anchor);
    if (index < 0) return;
    line.segmentMap?.delete(anchor);
    line.anchors.splice(index, 1);
    if (line.anchors.length < 2) {
      line.closed = false;
      if (line !== activeLine) {
        const at = lines.indexOf(line);
        if (at >= 0) lines.splice(at, 1);
        selectedLine = -1;
      }
    }
    if (line.anchors.length) rebuildLine(line);
    else { line.runs = []; line.length = 0; }
    selectedAnchor = null;
    redraw();
    onChange?.();
  }

  function onPointerDown(event) {
    if (!enabled || suspended) return;
    if (event.button !== 0 && event.pointerType !== "touch") return;   // right/middle are the camera's
    const picked = pickAt(event.clientX, event.clientY);
    if (picked) {
      dragging = picked;
      selectedAnchor = picked.anchor || picked.handle;
      if (picked.line !== activeLine) selectedLine = lines.indexOf(picked.line);
      // the one moment the pen owns the pointer: OrbitControls saw this
      // pointerdown too, and stays parked until the pin is released
      controls.enabled = false;
      canvas.setPointerCapture(event.pointerId);
      redraw();
      return;
    }
    pointerDownAt = { x: event.clientX, y: event.clientY, time: performance.now(), touch: event.pointerType === "touch" };
  }

  // Hovering asks the skin what a pixel is worth there, once per frame at most:
  // the host shows it in its tip (the grazing guard) and `face()` uses it.
  function scheduleHover(clientX, clientY) {
    if (hoverPending) { hoverPending.clientX = clientX; hoverPending.clientY = clientY; return; }
    hoverPending = { clientX, clientY };
    hoverPending.frame = requestAnimationFrame(() => {
      const at = hoverPending;
      hoverPending = null;
      if (!enabled || suspended || dragging) return;
      const hit = surfaceHit(at.clientX, at.clientY);
      hoverHit = hit;
      onHover?.(hit ? { ...placedWith(hit, "hover"), point: toArr(hit.point) } : null);
    });
  }

  function onPointerMove(event) {
    if (!dragging) {
      if (enabled && !suspended && onHover) scheduleHover(event.clientX, event.clientY);
      return;
    }
    const hit = surfaceHit(event.clientX, event.clientY);
    if (!hit) return;
    if (dragging.handle) {
      // only the dragged segment is recomputed, which is what keeps it real-time
      dragging.handle.point.copy(hit.point);
      dragging.handle.normal.copy(hit.normal);
      rebuildLine(dragging.line, dragging.seg);
    } else {
      dragging.anchor.point.copy(hit.point);
      dragging.anchor.normal.copy(hit.normal);
      dragging.anchor.placed_with = placedWith(hit, "drag");
      rebuildLine(dragging.line);
    }
    redraw();
    onChange?.();
  }

  function onPointerLeave() {
    if (hoverHit) { hoverHit = null; onHover?.(null); }
  }

  function onPointerUp(event) {
    if (suspended) { pointerDownAt = null; return; }
    if (dragging) {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      dragging = null;
      controls.enabled = true;
      onChange?.();
      return;
    }
    if (!pointerDownAt) return;
    const press = pointerDownAt;
    pointerDownAt = null;
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (moved > CLICK_SLOP_PX || !enabled) return;         // that was an orbit, not a click
    if (press.touch && performance.now() - press.time > LONG_PRESS_MS) {
      contextActionAt(event.clientX, event.clientY);       // a long press is the right-click
      return;
    }
    const hit = surfaceHit(event.clientX, event.clientY);
    if (!hit) return;
    // clicking the first anchor again closes the loop
    if (activeLine.anchors.length > 2) {
      const first = activeLine.anchors[0];
      const rect = canvas.getBoundingClientRect();
      const projected = first.point.clone().project(camera);
      const sx = (projected.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-projected.y * 0.5 + 0.5) * rect.height + rect.top;
      if (Math.hypot(sx - event.clientX, sy - event.clientY) < PICK_RADIUS_PX) {
        activeLine.closed = true;
        rebuildLine(activeLine);
        finishLine();
        return;
      }
    }
    activeLine.anchors.push({ point: hit.point.clone(), normal: hit.normal.clone(), placed_with: placedWith(hit, press.touch ? "tap" : "click") });
    if (activeLine.anchors.length > 1) rebuildLine(activeLine);
    redraw();
    onChange?.();
  }

  /** Right-click (or a touch long-press) on a pin: a control point is re-centred,
   *  an anchor deleted. Returns whether anything was under the pointer. */
  function contextActionAt(clientX, clientY) {
    const picked = pickAt(clientX, clientY);
    if (!picked) return false;
    if (picked.handle) {
      resetSegment(picked.seg);
      rebuildLine(picked.line, picked.seg);
      selectedAnchor = null;
      redraw();
      onChange?.();
      return true;
    }
    deleteAnchor(picked.line, picked.anchor);
    return true;
  }

  function onContextMenu(event) {
    if (!enabled || suspended) return;
    if (contextActionAt(event.clientX, event.clientY)) event.preventDefault();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("contextmenu", onContextMenu);

  /** The unlifted 3D polyline of a finished line: its segments' legs joined,
   *  closing segment included, no repeated points. What the 2D pattern draft
   *  flattens — the drawn seam itself, not the lifted drawing copy. */
  function linePolyline(line) {
    const pts = [];
    const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9;
    for (const seg of line.segments || []) for (const leg of seg.seeds || []) for (const p of leg) {
      const q = [p[0], p[1], p[2]];
      if (!pts.length || !same(pts[pts.length - 1], q)) pts.push(q);
    }
    if (line.closed && pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts.pop();
    return pts;
  }

  const api = {
    get enabled() { return enabled; },
    /** A finished line as plain arrays: for the pattern draft and for evidence. */
    lineGeometry(index) {
      const line = lines[index];
      if (!line) return null;
      return {
        index, name: line.name || `Line ${index + 1}`, closed: line.closed, length: line.length,
        approximated: line.approximated,
        points: linePolyline(line),
        anchors: line.anchors.map((a) => toArr(a.point)),
        placed_with: line.anchors.map((a) => a.placed_with || null),
        control_points: (line.segments || []).flatMap((seg) => (seg.handles || []).map((h) => toArr(h.point))),
      };
    },
    /** A finished line from 3D points, the way clicks would have made it.
     *  Instrumentation for automated checks; the UI never calls it. */
    addLine(points, closed, name) {
      if (!triangles) { triangles = collectTriangles(); grid = buildGrid(triangles); }
      const line = {
        anchors: points.map((p) => surfaceAnchor(p)), runs: [], length: 0, closed: Boolean(closed),
        labelVisible: true, approximated: false, name: name || `Line ${lines.length + 1}`,
      };
      rebuildLine(line);
      lines.push(line);
      selectedLine = lines.length - 1;
      redraw();
      onChange?.();
      return selectedLine;
    },
    /** Hand the canvas to another tool (landmark placement) without losing the
     *  lines already drawn. */
    setSuspended(on) { suspended = on; if (on) { dragging = null; controls.enabled = true; } },
    setEnabled(on) {
      enabled = on;
      if (on) {
        if (!triangles) { triangles = collectTriangles(); grid = buildGrid(triangles); }
        if (!activeLine) newLine();
      } else {
        selectedAnchor = null;
        dragging = null;
        if (hoverHit) { hoverHit = null; onHover?.(null); }
      }
      // the camera is never parked for the mode — dragging empty skin orbits
      controls.enabled = true;
      canvas.classList.toggle("pen", on);
      redraw();
      onChange?.();
    },
    finishLine,
    /** `C`: close the line being drawn (three anchors or more) and finish it. */
    closeLoop() {
      if (!activeLine || activeLine.anchors.length < 3) return false;
      activeLine.closed = true;
      rebuildLine(activeLine);
      finishLine();
      return true;
    },
    hasSelection() { return Boolean(selectedAnchor); },
    /** The selected pin as plain arrays, or null. */
    selectedPoint() {
      return selectedAnchor ? { point: toArr(selectedAnchor.point), normal: toArr(selectedAnchor.normal) } : null;
    },
    /** The skin under the cursor as of the last frame, or null. */
    hoverPoint() { return hoverHit ? { point: toArr(hoverHit.point), normal: toArr(hoverHit.normal) } : null; },
    /** `F`: where the camera should stand to look at the selected (else hovered)
     *  pin along its normal, keeping its present distance. Null if neither. */
    face() {
      const at = selectedAnchor
        ? { point: toArr(selectedAnchor.point), normal: toArr(selectedAnchor.normal) }
        : (hoverHit ? { point: toArr(hoverHit.point), normal: toArr(hoverHit.normal) } : null);
      if (!at) return null;
      const distance_m = Math.hypot(camera.position.x - at.point[0], camera.position.y - at.point[1], camera.position.z - at.point[2]);
      return poseFacing({ point: at.point, normal: at.normal, distance_m });
    },
    /** `Esc`: drop the pin selection, else the line selection. Returns whether
     *  anything was selected, so the host knows whether to leave the tool. */
    deselect() {
      if (selectedAnchor) { selectedAnchor = null; redraw(); onChange?.(); return true; }
      if (selectedLine >= 0) { selectedLine = -1; redraw(); onChange?.(); return true; }
      return false;
    },
    /** `Backspace`: delete the selected anchor (a selected control point is
     *  re-centred instead); nothing selected, undo the last pinned point. */
    deleteSelected() {
      if (!selectedAnchor) { api.undoPoint(); return; }
      const owner = (activeLine && activeLine.anchors.includes(selectedAnchor) && activeLine)
        || lines.find((l) => l.anchors.includes(selectedAnchor));
      if (owner) { deleteAnchor(owner, selectedAnchor); return; }
      const seg = [activeLine, ...lines].filter(Boolean).flatMap((l) => l.segments || []).find((x) => x.handles && x.handles.includes(selectedAnchor));
      if (seg) { resetSegment(seg); rebuildLine(seg.line, seg); selectedAnchor = null; redraw(); onChange?.(); }
    },
    /** `R`: re-centre the control points of the selected control point's
     *  segment; with an anchor or a line selected, of the whole line. */
    resetHandles() {
      const all = [activeLine, ...lines].filter(Boolean);
      const seg = selectedAnchor && all.flatMap((l) => l.segments || []).find((x) => x.handles && x.handles.includes(selectedAnchor));
      if (seg) { resetSegment(seg); rebuildLine(seg.line, seg); selectedAnchor = null; redraw(); onChange?.(); return true; }
      const line = (selectedAnchor && all.find((l) => l.anchors.includes(selectedAnchor))) || lines[selectedLine];
      if (!line) return false;
      for (const x of line.segments || []) resetSegment(x);
      rebuildLine(line);
      redraw();
      onChange?.();
      return true;
    },
    /** `[` / `]`: step the line selection. */
    selectAdjacentLine(step) {
      if (!lines.length) return;
      selectedAnchor = null;
      selectedLine = selectedLine < 0 ? (step > 0 ? 0 : lines.length - 1) : (selectedLine + step + lines.length) % lines.length;
      redraw();
      onChange?.();
    },
    /** `I`: the selected line's on-body label. */
    toggleLabelSelected() { if (lines[selectedLine]) api.toggleLabel(selectedLine); },
    undoPoint() {
      if (activeLine && activeLine.anchors.length) {
        deleteAnchor(activeLine, activeLine.anchors[activeLine.anchors.length - 1]);
      } else if (lines.length) {
        lines.pop();
        selectedLine = -1;
        redraw();
        onChange?.();
      }
    },
    clear() {
      lines = [];
      selectedLine = -1;
      selectedAnchor = null;
      newLine();
      redraw();
      onChange?.();
    },
    selectLine(index) {
      selectedLine = selectedLine === index ? -1 : index;
      redraw();
      onChange?.();
    },
    deleteLine(index) {
      lines.splice(index, 1);
      selectedLine = -1;
      redraw();
      onChange?.();
    },
    renameLine(index, name) {
      if (lines[index] && name) { lines[index].name = name; onChange?.(); }
    },
    toggleLabel(index) {
      if (lines[index]) { lines[index].labelVisible = !lines[index].labelVisible; onChange?.(); }
    },
    updateResolution(width, height) {
      lineMaterials.forEach((material) => material.resolution.set(width, height));
    },
    /** World-space label anchors the host can project and position each frame. */
    getLabels() {
      const out = [];
      const all = activeLine ? lines.concat([activeLine]) : lines;
      all.forEach((line, index) => {
        if (!line.labelVisible || !line.runs.length) return;
        const run = line.runs[Math.floor(line.runs.length / 2)];
        if (!run || !run.length) return;
        out.push({
          index,
          isActive: line === activeLine,
          position: run[Math.floor(run.length / 2)].clone(),
          length: line.length,
          approximated: line.approximated,
        });
      });
      return out;
    },
    summary() {
      return {
        enabled,
        hasSelection: Boolean(selectedAnchor),
        active: activeLine
          ? { anchors: activeLine.anchors.length, length: activeLine.length }
          : null,
        selected: selectedLine,
        lines: lines.map((line, index) => ({
          index,
          name: line.name || `Line ${index + 1}`,
          length: line.length,
          closed: line.closed,
          approximated: line.approximated,
          labelVisible: line.labelVisible,
          span: chordSpan(line),
          segments: (line.segments || []).length,
        })),
      };
    },
    /** The export payload, pinned to the asset by the caller. */
    toExport({ asset, assetSha, inchDenominator = 8, inchFraction }) {
      return {
        schema_version: 2,
        asset,
        asset_sha256: assetSha,
        recorded_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        path_model: "shortest_surface_path",
        unit: "meter",
        declared_limits: [
          "Drafted by hand in the viewer. Not a registry POM and not an approved measurement record.",
          "Loose-tape surface length: no soft-tissue compression allowance.",
          "placed_with records how each anchor was pinned (camera distance, incidence, mm per pixel); it is context, not a correction.",
        ],
        lines: lines.map((line, index) => ({
          name: line.name || `Line ${index + 1}`,
          closed: line.closed,
          length_mm: Number((line.length * 1000).toFixed(1)),
          length_in: inchFraction ? inchFraction(line.length, inchDenominator) : undefined,
          on_surface: !line.approximated,
          anchors: line.anchors.map((a) => [
            Number(a.point.x.toFixed(5)), Number(a.point.y.toFixed(5)), Number(a.point.z.toFixed(5)),
          ]),
          placed_with: line.anchors.map((a) => a.placed_with || null),
          control_points: (line.segments || []).flatMap((seg) => (seg.handles || []).map((h) => [
            Number(h.point.x.toFixed(5)), Number(h.point.y.toFixed(5)), Number(h.point.z.toFixed(5)),
          ])),
          segments: (line.segments || []).map((seg) => ({
            length_mm: Number((seg.length * 1000).toFixed(1)),
          })),
        })),
      };
    },
    dispose() {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("contextmenu", onContextMenu);
      if (hoverPending?.frame) cancelAnimationFrame(hoverPending.frame);
      disposeGroup(lineGroup);
      disposeGroup(anchorGroup);
    },
  };
  return api;
}
