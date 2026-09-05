/**
 * From a flattened piece to the record scripts/dxf_writer.mjs serializes:
 * the outline, which vertices are corners, a default grain line, and the
 * annotation that keeps the piece honest about what it is.
 *
 * The outline of a loop-cut piece is the drawn loop's image (never the mesh
 * scaffold); of a face-set piece, its ordered boundary loop. Coordinates leave
 * here in millimetres.
 */

import { boundaryLoops, mapLoopToFlat } from './flatten_core.mjs';

export const TURN_ANGLE_DEG = 30;   // a vertex turning more than this is a corner (layer 2)

/** Indices of outline vertices whose turning angle exceeds the threshold. */
export function turnPointIndices(ring, thresholdDeg = TURN_ANGLE_DEG) {
  const n = ring.length, out = [];
  const cos = Math.cos((thresholdDeg * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n], q = ring[i], r = ring[(i + 1) % n];
    const ax = q[0] - p[0], ay = q[1] - p[1], bx = r[0] - q[0], by = r[1] - q[1];
    const la = Math.sqrt(ax * ax + ay * ay), lb = Math.sqrt(bx * bx + by * by);
    if (la < 1e-12 || lb < 1e-12) continue;
    if ((ax * bx + ay * by) / (la * lb) < cos) out.push(i);
  }
  return out;
}

/** The flat image of a 3D direction (default the body's +Y, "up") through the
 *  affine map of the face nearest the piece centroid. A DEFAULT grain — the
 *  pattern maker sets the real one — but a geometric one, not a guess. */
export function flatDirectionOfBodyAxis(sub, uv, axis = [0, 1, 0]) {
  const P = sub.positions, F = sub.faces;
  const nv = P.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < P.length; i += 3) { cx += P[i]; cy += P[i + 1]; cz += P[i + 2]; }
  cx /= nv; cy /= nv; cz /= nv;
  let best = 0, bestSq = Infinity;
  for (let f = 0; f < F.length; f += 3) {
    const i = F[f] * 3, j = F[f + 1] * 3, k = F[f + 2] * 3;
    const gx = (P[i] + P[j] + P[k]) / 3 - cx, gy = (P[i + 1] + P[j + 1] + P[k + 1]) / 3 - cy, gz = (P[i + 2] + P[j + 2] + P[k + 2]) / 3 - cz;
    const sq = gx * gx + gy * gy + gz * gz;
    if (sq < bestSq) { bestSq = sq; best = f / 3; }
  }
  const a = F[best * 3], b = F[best * 3 + 1], c = F[best * 3 + 2];
  const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
  const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
  // least-squares coefficients of the axis in the face plane: solve the 2x2 Gram system
  const g11 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2], g12 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2];
  const g22 = e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2];
  const r1 = e1[0] * axis[0] + e1[1] * axis[1] + e1[2] * axis[2], r2 = e2[0] * axis[0] + e2[1] * axis[1] + e2[2] * axis[2];
  const det = g11 * g22 - g12 * g12;
  const alpha = (r1 * g22 - r2 * g12) / det, beta = (g11 * r2 - g12 * r1) / det;
  const dx = alpha * (uv[b * 2] - uv[a * 2]) + beta * (uv[c * 2] - uv[a * 2]);
  const dy = alpha * (uv[b * 2 + 1] - uv[a * 2 + 1]) + beta * (uv[c * 2 + 1] - uv[a * 2 + 1]);
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  return [dx / l, dy / l];
}

function centroid(ring) {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

/**
 * Build one DXF piece record.
 * @param piece   { name, sub, uv, samples? (loop-cut), chords? }
 * @param context { assetSha, seamErrorMm, sharedSeam?: {with, mismatchMm} }
 */
export function dxfPiece(piece, context) {
  let ring;
  if (piece.samples) {
    const m = mapLoopToFlat(piece.samples, piece.sub, piece.uv);
    if (m.error) throw new Error(m.error);
    ring = m.points;
  } else {
    const loops = boundaryLoops(piece.sub);
    if (loops.length !== 1) throw new Error(`${piece.name}: expected one boundary loop, got ${loops.length}`);
    ring = loops[0].map((v) => [piece.uv[v * 2], piece.uv[v * 2 + 1]]);
  }
  // millimetres, and a consistent (counter-clockwise) winding
  let ringMm = ring.map(([x, y]) => [x * 1000, y * 1000]);
  let area = 0;
  for (let i = 0; i < ringMm.length; i++) { const p = ringMm[i], q = ringMm[(i + 1) % ringMm.length]; area += p[0] * q[1] - q[0] * p[1]; }
  if (area < 0) ringMm = ringMm.reverse();
  const c = centroid(ringMm);
  const g = flatDirectionOfBodyAxis(piece.sub, piece.uv);
  let ext = 0;
  for (const p of ringMm) { const d = Math.abs((p[0] - c[0]) * g[0] + (p[1] - c[1]) * g[1]); if (d > ext) ext = d; }
  const half = ext * 0.6;
  const annotation = [
    'SHELL 1:1 OF THE BODY SURFACE - NOT A PATTERN',
    'No ease, no seam allowance, no grading',
    `Seam vs body: ${context.seamErrorMm >= 0 ? '+' : ''}${context.seamErrorMm.toFixed(2)} mm (curvature, not error)`,
    'Grain: default = body vertical, set by pattern maker',
    'Quantity 1,1 is a default, confirm',
    `Asset avatar_master.glb ${context.assetSha.slice(0, 12)}`,
  ];
  if (context.sharedSeam) annotation.push(`Shares seam with ${context.sharedSeam.with}: mismatch ${context.sharedSeam.mismatchMm.toFixed(2)} mm`);
  if (context.template) annotation.push(context.template, 'Template seams are conventional cuts, not a fit recommendation');
  return {
    name: piece.name,
    outline_mm: ringMm,
    turn_point_indices: turnPointIndices(ringMm),
    grain_mm: [[c[0] - g[0] * half, c[1] - g[1] * half], [c[0] + g[0] * half, c[1] + g[1] * half]],
    quantity: '1,1',
    annotation,
  };
}
