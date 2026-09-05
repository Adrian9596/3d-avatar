/**
 * The patches the flattening engine is tested on, built from
 * scripts/flatten_cases.json so that scripts/flatten.py builds the very same
 * ones. Two analytic surfaces (cylinder, cone) that unroll with no distortion at
 * all, and patches of the avatar around a landmark from the authority pass.
 *
 * Nothing here is part of the engine; it is test scaffolding shared by the
 * accuracy and parity gates.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { trianglesByMaterial } from './glb_reader.mjs';
import { buildGrid, closestOnMesh } from './surface_path.mjs';
import { weld, geodesicDisc, extractPatch, submesh, loopChords } from './flatten_core.mjs';

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** A cylinder patch of `arc_deg` about the Y axis, as a triangle soup. */
export function cylinderSoup(spec) {
  const { radius_m: R, height_m: H, angular_segments: na, vertical_segments: nv } = spec;
  const arc = (spec.arc_deg * Math.PI) / 180;
  const ring = (i, j) => {
    const th = (arc * i) / na;
    return [R * Math.cos(th), (H * j) / nv, R * Math.sin(th)];
  };
  return gridSoup(ring, na, nv);
}

/** A cone frustum patch: radius interpolates bottom -> top with height. */
export function coneSoup(spec) {
  const { radius_bottom_m: rb, radius_top_m: rt, height_m: H, angular_segments: na, vertical_segments: nv } = spec;
  const arc = (spec.arc_deg * Math.PI) / 180;
  const ring = (i, j) => {
    const th = (arc * i) / na;
    const r = rb + ((rt - rb) * j) / nv;
    return [r * Math.cos(th), (H * j) / nv, r * Math.sin(th)];
  };
  return gridSoup(ring, na, nv);
}

function gridSoup(ring, na, nv) {
  const tri = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < na; i++) {
      const p00 = ring(i, j), p10 = ring(i + 1, j), p11 = ring(i + 1, j + 1), p01 = ring(i, j + 1);
      tri.push(...p00, ...p10, ...p11);
      tri.push(...p00, ...p11, ...p01);
    }
  }
  return tri;
}

/** The avatar's measurement surface as one soup plus everything a case needs:
 *  the welded mesh, a closest-point query over the same soup, and the landmarks
 *  of the authority pass — refused if they were measured on a different body. */
export function loadAvatarContext(root) {
  const assetPath = join(root, 'assets', 'export', 'avatar_master.glb');
  const registryPath = join(root, 'contracts', 'measurement-registry.json');
  const evidencePath = join(root, 'qa', 'avatar_master', 'measurements.json');
  for (const p of [assetPath, registryPath, evidencePath]) {
    if (!existsSync(p)) return { error: `missing ${p}` };
  }
  const assetSha = sha256(assetPath);
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  if (evidence.asset?.sha256 !== assetSha) {
    return { error: `landmarks in qa/avatar_master/measurements.json were measured on ${evidence.asset?.sha256?.slice(0, 12)}…, asset on disk is ${assetSha.slice(0, 12)}… — run npm run measure:avatar` };
  }
  const { triangles: byMaterial } = trianglesByMaterial(assetPath);
  const parts = [];
  for (const name of registry.measurement_surface) {
    const t = byMaterial.get(name);
    if (t) parts.push(t);
  }
  const total = parts.reduce((n, t) => n + t.length, 0);
  const tri = new Float32Array(total);
  let at = 0;
  for (const t of parts) { tri.set(t, at); at += t.length; }
  const mesh = weld(tri);
  const grid = buildGrid(tri);
  const closest = (p) => closestOnMesh(grid, p);
  const landmarks = {};
  for (const [id, mark] of Object.entries(evidence.landmarks || {})) if (mark.xyz_m) landmarks[id] = mark.xyz_m;
  return { assetSha, registry, tri, mesh, grid, closest, landmarks, materials: registry.measurement_surface };
}

/** A tangent frame from a normal by one fixed rule, so the Python port lands on
 *  the same points. (u, v, n) is right-handed. */
export function tangentFrame(normal) {
  const [nx, ny, nz] = normal;
  const [ax, ay, az] = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = ny * az - nz * ay, uy = nz * ax - nx * az, uz = nx * ay - ny * ax;
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
  ux /= ul; uy /= ul; uz /= ul;
  return { u: [ux, uy, uz], v: [ny * uz - nz * uy, nz * ux - nx * uz, nx * uy - ny * ux] };
}

/** Closed loop of `count` points on the skin around a seed, at radius r in the
 *  seed's tangent plane, each snapped to the surface. Point k sits at angle
 *  2πk/count from u towards v. */
export function loopAround(closest, seed, radius, count) {
  const { u, v } = tangentFrame(closest(seed).normal);
  const points = [];
  for (let k = 0; k < count; k++) {
    const th = (2 * Math.PI * k) / count;
    const c = Math.cos(th) * radius, s = Math.sin(th) * radius;
    points.push(closest([seed[0] + c * u[0] + s * v[0], seed[1] + c * u[1] + s * v[1], seed[2] + c * u[2] + s * v[2]]).point);
  }
  return points;
}

/** A seam polyline on the skin through `via`: the chords A->via->B resampled at
 *  `spacing` and snapped to the surface. Endpoints excluded — the caller's loop
 *  already holds them — so it can be spliced into two loops as a shared run. */
export function seamThrough(closest, A, via, B, spacing = 0.008) {
  const out = [];
  for (const [S, E] of [[A, via], [via, B]]) {
    const dx = E[0] - S[0], dy = E[1] - S[1], dz = E[2] - S[2];
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy + dz * dz) / spacing));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      out.push(closest([S[0] + dx * t, S[1] + dy * t, S[2] + dz * t]).point);
    }
    if (E === via) out.push(closest(via).point);
  }
  return out;
}

/** Build the patch for one case. Returns {sub, seed?, patch?} or {error}. */
export function resolveCase(spec, ctx) {
  if (spec.type === 'cylinder' || spec.type === 'cone') {
    const soup = spec.type === 'cylinder' ? cylinderSoup(spec) : coneSoup(spec);
    const mesh = weld(soup);
    const all = Array.from({ length: mesh.faces.length / 3 }, (_, i) => i);
    return { sub: submesh(mesh, all) };
  }
  if (!ctx || ctx.error) return { error: ctx?.error || 'avatar context unavailable' };
  const seed = ctx.landmarks[spec.seed_landmark];
  if (!seed) return { error: `landmark ${spec.seed_landmark} is not in the authority pass` };
  if (spec.type === 'avatar_disc') {
    const faces = geodesicDisc(ctx.mesh, seed, spec.radius_m, spec.half || null);
    return { sub: submesh(ctx.mesh, faces), seed };
  }
  if (spec.type === 'avatar_loop') {
    const loop = loopAround(ctx.closest, seed, spec.radius_m, spec.loop_points);
    const patch = extractPatch(ctx.mesh, ctx.closest, loop, seed);
    if (patch.error) return { error: patch.error };
    const sub = submesh(ctx.mesh, patch.faces);
    const chords = loopChords(patch.samples, sub);
    if (chords.error) return { error: chords.error };
    return { sub, seed, patch, chords: chords.chords };
  }
  if (spec.type === 'avatar_panels') {
    // one outer loop, cut through the seed into two panels that share the seam
    const n = spec.loop_points;
    if (n % 2) return { error: 'loop_points must be even' };
    const outer = loopAround(ctx.closest, seed, spec.radius_m, n);
    const seam = seamThrough(ctx.closest, outer[0], seed, outer[n / 2]);
    const loopA = outer.slice(0, n / 2 + 1).concat(seam.slice().reverse());
    const loopB = outer.slice(n / 2).concat([outer[0]], seam);
    const { v } = tangentFrame(ctx.closest(seed).normal);
    const off = 0.5 * spec.radius_m;
    const seedA = ctx.closest([seed[0] + off * v[0], seed[1] + off * v[1], seed[2] + off * v[2]]).point;
    const seedB = ctx.closest([seed[0] - off * v[0], seed[1] - off * v[1], seed[2] - off * v[2]]).point;
    const pieces = [];
    for (const [name, loop, pieceSeed] of [['panel_a', loopA, seedA], ['panel_b', loopB, seedB]]) {
      const patch = extractPatch(ctx.mesh, ctx.closest, loop, pieceSeed);
      if (patch.error) return { error: `${name}: ${patch.error}` };
      const sub = submesh(ctx.mesh, patch.faces);
      const chords = loopChords(patch.samples, sub);
      if (chords.error) return { error: `${name}: ${chords.error}` };
      pieces.push({ name, sub, patch, chords: chords.chords, seed: pieceSeed });
    }
    return { pieces, seed, seam_points: seam.length };
  }
  return { error: `unknown case type ${spec.type}` };
}
