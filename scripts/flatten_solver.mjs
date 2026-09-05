/**
 * The flattening solver: hinge-unfolding start, then the seam-exact Jacobi
 * relaxation with fold-over guard, rigid-drift removal and Chebyshev
 * acceleration. One start, one objective — scripts/flatten_core.mjs explains
 * why. Port: scripts/flatten_solver.py; the parity gate compares the two to a
 * micrometre, so every arithmetic step here is mirrored there in the same order.
 */

import { edgeList, edgeLengths, edgeFaceMap } from './flatten_mesh.mjs';

export const DEFAULT_SOLVER = Object.freeze({
  interior_weight: 0.25,   // interior edges, and the scaffold boundary of a loop-cut patch
  seam_weight: 1.0,        // mesh boundary of a face-set patch; loop chords of a loop-cut patch
  couple_weight: 4.0,      // extra pull of a shared chord towards its mean length across pieces
  max_iterations: 10000,
  convergence_m: 5e-9,     // stop when no vertex moved more than this in a sweep
  // Chebyshev semi-iteration over the Jacobi sweep (Wang 2015): same fixed point,
  // 10-20x fewer sweeps. rho is the assumed spectral radius; too high diverges,
  // which the guard below catches by dropping the momentum for that sweep.
  chebyshev_rho: 0.999,
  chebyshev_gamma: 0.75,
  chebyshev_delay: 10,
  rho_fallback: [0.99, 0.9, 0],   // on divergence: restart from the unfolding with the next rho
  // a face whose flat signed area drops below this fraction of its 3D area is
  // about to fold over and is pushed back; sound faces sit far above it, so the
  // constraint is inactive on them and does not move the fixed point
  fold_min_area_fraction: 0.25,
});

/**
 * Starting layout by hinge unfolding. The face nearest the patch centroid is laid
 * flat; every other face is hinged out rigidly across the edge it shares with an
 * already-placed face, breadth-first; a vertex reached along several paths takes
 * the mean of its copies. On a developable surface the copies coincide, so this
 * IS the exact unrolling and the relaxation has nothing left to do; on a dome the
 * copies disagree by the curvature between neighbouring paths, which is small,
 * so nothing starts folded over — a plane projection of a 150° cone did.
 *
 * Every face is placed with positive orientation from its own winding, so with a
 * consistently wound mesh neighbours land on opposite sides of a shared edge and
 * no triangle is ever placed inverted.
 */
export function hingeUnfold(sub) {
  const P = sub.positions, F = sub.faces;
  const nf = F.length / 3, nv = P.length / 3;
  const d3 = (i, j) => {
    const dx = P[i * 3] - P[j * 3], dy = P[i * 3 + 1] - P[j * 3 + 1], dz = P[i * 3 + 2] - P[j * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  // seed: face whose centroid is nearest the patch centroid (lowest index on a tie)
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < P.length; i += 3) { cx += P[i]; cy += P[i + 1]; cz += P[i + 2]; }
  cx /= nv; cy /= nv; cz /= nv;
  let seed = 0, seedSq = Infinity;
  for (let f = 0; f < nf; f++) {
    const i = F[f * 3] * 3, j = F[f * 3 + 1] * 3, k = F[f * 3 + 2] * 3;
    const gx = (P[i] + P[j] + P[k]) / 3 - cx, gy = (P[i + 1] + P[j + 1] + P[k + 1]) / 3 - cy, gz = (P[i + 2] + P[j + 2] + P[k + 2]) / 3 - cz;
    const sq = gx * gx + gy * gy + gz * gz;
    if (sq < seedSq) { seedSq = sq; seed = f; }
  }
  const edgeFaces = edgeFaceMap(F);
  // per-face 2D corners, in the face's own vertex order
  const corner = new Array(nf * 6).fill(NaN);
  const placed = new Uint8Array(nf);
  // third corner C to the left of A->B, at 3D distances |AC|, |BC|
  const third = (ax, ay, bx, by, a, b) => {
    const ex = bx - ax, ey = by - ay;
    const c = Math.sqrt(ex * ex + ey * ey);
    const ux = ex / c, uy = ey / c;
    const x = (a * a - b * b + c * c) / (2 * c);
    const y = Math.sqrt(Math.max(0, a * a - x * x));
    return [ax + x * ux - y * uy, ay + x * uy + y * ux];
  };
  {
    const i = F[seed * 3], j = F[seed * 3 + 1], k = F[seed * 3 + 2];
    const c = d3(i, j);
    const [tx, ty] = third(0, 0, c, 0, d3(i, k), d3(j, k));
    corner[seed * 6] = 0; corner[seed * 6 + 1] = 0; corner[seed * 6 + 2] = c; corner[seed * 6 + 3] = 0;
    corner[seed * 6 + 4] = tx; corner[seed * 6 + 5] = ty;
    placed[seed] = 1;
  }
  const queue = [seed];
  for (let q = 0; q < queue.length; q++) {
    const f = queue[q];
    for (let k = 0; k < 3; k++) {
      const i = F[f * 3 + k], j = F[f * 3 + ((k + 1) % 3)];
      const key = (i < j ? i : j) * 16777216 + (i < j ? j : i);
      for (const g of edgeFaces.get(key)) {
        if (g === f || placed[g]) continue;
        // rotate g's winding so its shared edge comes first, as (B, A) since a
        // consistently wound neighbour traverses the edge the other way
        let r = 0;
        while (r < 3 && !(F[g * 3 + r] === j && F[g * 3 + ((r + 1) % 3)] === i)) r++;
        if (r === 3) { r = 0; while (r < 3 && !(F[g * 3 + r] === i && F[g * 3 + ((r + 1) % 3)] === j)) r++; }
        if (r === 3) continue;
        const A = F[g * 3 + r], B = F[g * 3 + ((r + 1) % 3)], C = F[g * 3 + ((r + 2) % 3)];
        const slotA = A === i ? k : (k + 1) % 3, slotB = B === i ? k : (k + 1) % 3;
        const ax = corner[f * 6 + slotA * 2], ay = corner[f * 6 + slotA * 2 + 1];
        const bx = corner[f * 6 + slotB * 2], by = corner[f * 6 + slotB * 2 + 1];
        const [tx, ty] = third(ax, ay, bx, by, d3(A, C), d3(B, C));
        corner[g * 6 + r * 2] = ax; corner[g * 6 + r * 2 + 1] = ay;
        corner[g * 6 + ((r + 1) % 3) * 2] = bx; corner[g * 6 + ((r + 1) % 3) * 2 + 1] = by;
        corner[g * 6 + ((r + 2) % 3) * 2] = tx; corner[g * 6 + ((r + 2) % 3) * 2 + 1] = ty;
        placed[g] = 1; queue.push(g);
      }
    }
  }
  const uv = new Array(nv * 2).fill(0), count = new Array(nv).fill(0);
  for (let f = 0; f < nf; f++) {
    if (!placed[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = F[f * 3 + k];
      uv[v * 2] += corner[f * 6 + k * 2]; uv[v * 2 + 1] += corner[f * 6 + k * 2 + 1]; count[v]++;
    }
  }
  for (let v = 0; v < nv; v++) if (count[v]) { uv[v * 2] /= count[v]; uv[v * 2 + 1] /= count[v]; }
  return uv;
}

/**
 * Seam-exact relaxation of one or more pieces at once.
 *
 * Every mesh edge is a distance constraint to its 3D length: the boundary at
 * `seam_weight` when the piece is a face set, or at `interior_weight` when the
 * piece was cut by a loop (its mesh boundary is then scaffolding); interior
 * edges at `interior_weight`. Every loop chord is a distance constraint between
 * two barycentric points at `seam_weight`, spread over the vertices of the two
 * faces by their barycentric weights. A chord that appears in more than one
 * piece is additionally pulled, with `couple_weight`, towards the mean of its
 * current lengths across those pieces.
 *
 * Three things keep the iteration honest:
 * - Corrections are accumulated over a whole sweep and applied together
 *   (Jacobi, not Gauss-Seidel), so the result does not depend on constraint
 *   order and the Python port can match it.
 * - A mirrored triangle has exactly the edge lengths of the right one, so
 *   distance constraints cannot see a fold-over. A one-sided signed-area
 *   constraint catches it: only a face whose flat area falls below a fraction of
 *   its 3D area is touched, and its gradient is linear in the positions — a
 *   reflection-based push was impulsive and made the acceleration diverge.
 * - No constraint can see a rigid motion of a piece, and per-vertex weighting
 *   does not conserve momentum, so the mean translation and rotation of each
 *   sweep are removed — otherwise a piece whose shape has settled keeps drifting
 *   and the convergence test never fires.
 * The sweep is then Chebyshev-accelerated (see DEFAULT_SOLVER). A sweep that
 * blows up (non-finite or metre-scale moves) restarts every piece from its
 * unfolding with the next rho of `rho_fallback`, so a fixed rho can never turn
 * a sound patch into garbage; the result says how many restarts it took.
 *
 * Returns per-piece uv plus the shared-chord groups.
 */
export function relaxPieces(pieces, solver = DEFAULT_SOLVER) {
  const states = pieces.map((piece) => pieceState(piece, solver));
  const shared = sharedChordGroups(states);
  const targets = states.map((st) => st.chords.map((c) => c.rest));
  const weights = states.map((st) => new Array(st.chords.length).fill(solver.seam_weight));
  for (const { members } of shared) for (const [p, ci] of members) weights[p][ci] = solver.seam_weight + solver.couple_weight;

  let rho = solver.chebyshev_rho ?? 0;
  const gamma = solver.chebyshev_gamma ?? 1, delay = solver.chebyshev_delay ?? 0;
  const ladder = (solver.rho_fallback ?? []).filter((r) => r < rho);
  let restarts = 0, sweepBase = 0;
  let iterations = 0, converged = false;
  while (iterations < solver.max_iterations) {
    coupleSharedChords(states, shared, targets, solver);
    let maxMove = 0;
    for (let p = 0; p < states.length; p++) {
      const st = states[p];
      const { acc, cw } = sweepConstraints(st, targets[p], weights[p], solver);
      const move = jacobiMove(st, acc, cw);
      removeRigidDrift(st, move);
      const pieceMove = chebyshevStep(st, move, { rho, gamma, delay, sweep: iterations - sweepBase });
      if (!Number.isFinite(pieceMove) || pieceMove > 0.05) st.diverged = true;
      if (pieceMove > maxMove) maxMove = pieceMove;
    }
    iterations++;
    if (states.some((st) => st.diverged)) {
      if (!ladder.length) break;
      rho = ladder.shift(); restarts++; sweepBase = iterations;
      for (const st of states) restartPiece(st);
      continue;
    }
    if (maxMove < solver.convergence_m) { converged = true; break; }
  }
  return {
    diverged: states.some((st) => st.diverged), restarts, rho_used: rho,
    pieces: states.map((st) => ({ uv: st.U })),
    shared: shared.map(({ pair, members }) => ({ pair, members })),
    iterations, converged,
  };
}

/** Per-piece working state: constraint data that never changes during the
 *  solve, plus the current and previous layouts. */
function pieceState({ sub, uv, chords }, solver) {
  const edges = edgeList(sub.faces);
  const rest = edgeLengths(sub.positions, edges);
  const hasLoop = chords && chords.length > 0;
  const w = edges.count.map((c) => (c === 1 && !hasLoop ? solver.seam_weight : solver.interior_weight));
  const n = uv.length / 2;
  const P = sub.positions, F = sub.faces, area3 = [];
  for (let f = 0; f < F.length; f += 3) {
    const i = F[f] * 3, j = F[f + 1] * 3, k = F[f + 2] * 3;
    const ax = P[j] - P[i], ay = P[j + 1] - P[i + 1], az = P[j + 2] - P[i + 2];
    const bx = P[k] - P[i], by = P[k + 1] - P[i + 1], bz = P[k + 2] - P[i + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    area3.push(0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz));
  }
  return { sub, start: uv, U: uv.slice(), prev: uv.slice(), edges, rest, w, chords: chords || [], n, omega: 1, area3, diverged: false };
}

function restartPiece(st) {
  st.U = st.start.slice(); st.prev = st.start.slice(); st.omega = 1; st.diverged = false;
}

/** Chords with the same pair key in different pieces: one seam, sewn together. */
function sharedChordGroups(states) {
  const groups = new Map();
  states.forEach((st, p) => st.chords.forEach((c, ci) => {
    let g = groups.get(c.pair);
    if (!g) { g = []; groups.set(c.pair, g); }
    g.push([p, ci]);
  }));
  return [...groups.entries()]
    .filter(([, members]) => new Set(members.map((m) => m[0])).size > 1)
    .map(([pair, members]) => ({ pair, members }));
}

/** Flat position of a barycentric point of face f in piece st. */
function chordPoint(st, f, b, out) {
  const F = st.sub.faces, U = st.U;
  const i = F[f * 3], j = F[f * 3 + 1], k = F[f * 3 + 2];
  out[0] = b[0] * U[i * 2] + b[1] * U[j * 2] + b[2] * U[k * 2];
  out[1] = b[0] * U[i * 2 + 1] + b[1] * U[j * 2 + 1] + b[2] * U[k * 2 + 1];
}

const pa = [0, 0], pb = [0, 0];

/** Each shared chord is pulled towards rest at seam_weight and towards the mean
 *  of its current lengths at couple_weight; the two add up to one constraint
 *  towards their blend, which is what the target becomes. */
function coupleSharedChords(states, shared, targets, solver) {
  if (!shared.length) return;
  const lengths = states.map((st) => st.chords.map((c) => {
    chordPoint(st, c.fa, c.ba, pa); chordPoint(st, c.fb, c.bb, pb);
    const dx = pa[0] - pb[0], dy = pa[1] - pb[1];
    return Math.sqrt(dx * dx + dy * dy);
  }));
  for (const { members } of shared) {
    let mean = 0;
    for (const [p, ci] of members) mean += lengths[p][ci];
    mean /= members.length;
    for (const [p, ci] of members) {
      targets[p][ci] = (solver.seam_weight * states[p].chords[ci].rest + solver.couple_weight * mean)
        / (solver.seam_weight + solver.couple_weight);
    }
  }
}

/** One Jacobi sweep's accumulated corrections: edges, chords, fold guard. */
function sweepConstraints(st, targets, weights, solver) {
  const { U, edges, rest, w, n } = st;
  const F = st.sub.faces;
  const acc = new Array(n * 2).fill(0), cw = new Array(n).fill(0);
  for (let e = 0; e < edges.a.length; e++) {
    const i = edges.a[e], j = edges.b[e];
    const dx = U[i * 2] - U[j * 2], dy = U[i * 2 + 1] - U[j * 2 + 1];
    let len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-12) len = 1e-12;
    const s = w[e] * (len - rest[e]) / len * 0.5;
    const cx = s * dx, cy = s * dy;
    acc[i * 2] -= cx; acc[i * 2 + 1] -= cy;
    acc[j * 2] += cx; acc[j * 2 + 1] += cy;
    cw[i] += w[e]; cw[j] += w[e];
  }
  for (let ci = 0; ci < st.chords.length; ci++) {
    const c = st.chords[ci];
    chordPoint(st, c.fa, c.ba, pa); chordPoint(st, c.fb, c.bb, pb);
    const dx = pa[0] - pb[0], dy = pa[1] - pb[1];
    let len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-12) len = 1e-12;
    const gap = len - targets[ci];
    const denom = c.ba[0] * c.ba[0] + c.ba[1] * c.ba[1] + c.ba[2] * c.ba[2]
      + c.bb[0] * c.bb[0] + c.bb[1] * c.bb[1] + c.bb[2] * c.bb[2];
    const s = gap / denom / len;
    const wc = weights[ci];
    for (let k = 0; k < 3; k++) {
      const v = F[c.fa * 3 + k], b = c.ba[k];
      acc[v * 2] -= wc * b * b * s * dx; acc[v * 2 + 1] -= wc * b * b * s * dy; cw[v] += wc * b;
    }
    for (let k = 0; k < 3; k++) {
      const v = F[c.fb * 3 + k], b = c.bb[k];
      acc[v * 2] += wc * b * b * s * dx; acc[v * 2 + 1] += wc * b * b * s * dy; cw[v] += wc * b;
    }
  }
  // orientation: a face whose flat signed area has fallen below a fraction of
  // its 3D area is folding; push it back along the (linear) area gradient
  const foldFraction = solver.fold_min_area_fraction ?? 0;
  for (let f = 0; f < F.length; f += 3) {
    const a = F[f], b = F[f + 1], c = F[f + 2];
    const ax = U[a * 2], ay = U[a * 2 + 1], bx = U[b * 2], by = U[b * 2 + 1], cx = U[c * 2], cy = U[c * 2 + 1];
    const area2 = 0.5 * ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
    const floor = foldFraction * st.area3[f / 3];
    if (area2 >= floor) continue;
    const gap = area2 - floor;
    const gax = 0.5 * (by - cy), gay = 0.5 * (cx - bx);
    const gbx = 0.5 * (cy - ay), gby = 0.5 * (ax - cx);
    const gcx = 0.5 * (ay - by), gcy = 0.5 * (bx - ax);
    const gg = gax * gax + gay * gay + gbx * gbx + gby * gby + gcx * gcx + gcy * gcy;
    if (gg < 1e-30) continue;
    const lam = gap / gg, wa = solver.seam_weight;
    acc[a * 2] -= wa * lam * gax; acc[a * 2 + 1] -= wa * lam * gay; cw[a] += wa;
    acc[b * 2] -= wa * lam * gbx; acc[b * 2 + 1] -= wa * lam * gby; cw[b] += wa;
    acc[c * 2] -= wa * lam * gcx; acc[c * 2 + 1] -= wa * lam * gcy; cw[c] += wa;
  }
  return { acc, cw };
}

/** Weighted-average move per vertex (the Jacobi step proper). */
function jacobiMove(st, acc, cw) {
  const n = st.n, move = new Array(n * 2).fill(0);
  for (let i = 0; i < n; i++) {
    if (cw[i] <= 0) continue;
    move[i * 2] = acc[i * 2] / cw[i]; move[i * 2 + 1] = acc[i * 2 + 1] / cw[i];
  }
  return move;
}

/** Remove the sweep's mean translation and mean rotation about the centroid. */
function removeRigidDrift(st, move) {
  const { U, n } = st;
  let mx = 0, my = 0, gx = 0, gy = 0;
  for (let i = 0; i < n; i++) { mx += move[i * 2]; my += move[i * 2 + 1]; gx += U[i * 2]; gy += U[i * 2 + 1]; }
  mx /= n; my /= n; gx /= n; gy /= n;
  let cross = 0, rr = 0;
  for (let i = 0; i < n; i++) {
    const rx = U[i * 2] - gx, ry = U[i * 2 + 1] - gy;
    cross += rx * (move[i * 2 + 1] - my) - ry * (move[i * 2] - mx);
    rr += rx * rx + ry * ry;
  }
  const omegaRot = rr > 0 ? cross / rr : 0;
  for (let i = 0; i < n; i++) {
    const rx = U[i * 2] - gx, ry = U[i * 2 + 1] - gy;
    move[i * 2] -= mx - omegaRot * ry; move[i * 2 + 1] -= my + omegaRot * rx;
  }
}

/** Chebyshev semi-iteration: x_new = omega * (gamma * move + x - x_prev) + x_prev.
 *  Returns the largest vertex displacement of the step. */
function chebyshevStep(st, move, { rho, gamma, delay, sweep }) {
  const { U, prev, n } = st;
  let omega;
  if (rho <= 0 || sweep < delay) omega = 1;
  else if (sweep === delay) omega = 2 / (2 - rho * rho);
  else omega = 4 / (4 - rho * rho * st.omega);
  for (let i = 0; i < n * 2; i++) {
    const xk = U[i];
    const xnew = omega * (gamma * move[i] + xk - prev[i]) + prev[i];
    prev[i] = xk; U[i] = xnew;
  }
  let pieceMove = 0;
  for (let i = 0; i < n; i++) {
    const dx = U[i * 2] - prev[i * 2], dy = U[i * 2 + 1] - prev[i * 2 + 1];
    const mv = Math.sqrt(dx * dx + dy * dy);
    if (mv > pieceMove) pieceMove = mv;
  }
  st.omega = omega;
  return pieceMove;
}

/** Hinge unfolding followed by seam-exact relaxation: the one flattening of a
 *  single piece. `chords` (from `loopChords`) makes a drawn loop the seam. */
export function flattenPatch(sub, solver = DEFAULT_SOLVER, chords = null) {
  const out = relaxPieces([{ sub, uv: hingeUnfold(sub), chords }], solver);
  return { uv: out.pieces[0].uv, iterations: out.iterations, converged: out.converged, diverged: out.diverged, restarts: out.restarts };
}

/** Several pieces solved together so the chords they share agree in length. */
export function flattenPieces(pieces, solver = DEFAULT_SOLVER) {
  return relaxPieces(pieces.map(({ sub, chords }) => ({ sub, uv: hingeUnfold(sub), chords })), solver);
}

// ----------------------------------------------------------------- reporting
