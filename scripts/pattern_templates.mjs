/**
 * Template drafts: a conventional bra cut declared as landmarks in
 * contracts/pattern-templates.json, resolved against the landmarks a session
 * knows into the anchor lists of ordinary pen lines (AUTHORING_UX_PLAN.md §8).
 *
 * PROTOTYPE LANE ONLY (scripts/test_lane_parity.mjs checks the production
 * viewer imports neither this module nor the contract).
 *
 * What a template is not: a decision. It puts a seam where bra construction
 * conventionally puts it and reports what that costs on this body; the person
 * chooses among templates and can move every anchor afterwards. A template
 * whose landmarks are manual_only reads `needs …` until a person places them —
 * the same discipline the POM table's blocked_until_manual uses. The record a
 * drafted piece carries names the template and every landmark's provenance.
 */

import { surfaceRun, pointAtFraction, closestOnMesh } from './surface_path.mjs';

export const TEMPLATE_LIMIT = 'Template seams are conventional cuts, not a fit recommendation.';

/** Validate the contract against the registry; returns { templates, errors }. */
export function loadTemplates(contract, registry) {
  const errors = [];
  const known = new Set((registry?.landmarks || []).map((l) => l.id));
  const ids = new Set();
  const templates = [];
  for (const t of contract?.templates || []) {
    const problems = [];
    if (!t.id || ids.has(t.id)) problems.push('missing or duplicate id');
    ids.add(t.id);
    if (!['L', 'R'].includes(t.side)) problems.push('side must be L or R');
    if (t.status !== 'proposal') problems.push(`status ${t.status} is not a template status`);
    if (!t.outline?.closed || !Array.isArray(t.outline.anchors) || t.outline.anchors.length < 3) problems.push('outline must be closed with at least 3 anchors');
    for (const id of [...(t.outline?.anchors || []), ...(t.seam?.anchors || []), ...(t.requires || [])]) {
      if (known.size && !known.has(id)) problems.push(`unknown landmark ${id}`);
    }
    if (t.seam) {
      if (t.seam.closed) problems.push('a seam is an open line');
      if (!Array.isArray(t.seam.anchors) || t.seam.anchors.length < 2) problems.push('seam needs at least 2 anchors');
      else if (!t.outline.anchors.includes(t.seam.anchors[0]) || !t.outline.anchors.includes(t.seam.anchors[t.seam.anchors.length - 1])) problems.push('seam ends must be outline anchors');
    }
    const used = new Set([...(t.outline?.anchors || []), ...(t.seam?.anchors || [])]);
    for (const id of used) if (!(t.requires || []).includes(id)) problems.push(`${id} is used but not in requires`);
    if (problems.length) errors.push(`${t.id || '?'}: ${problems.join('; ')}`);
    else templates.push(t);
  }
  return { templates, errors, declared_limit: contract?.declared_limit || TEMPLATE_LIMIT };
}

/**
 * The anchors of a template's lines from a landmark map { ID: [x, y, z] }, or
 * what is missing. Anchors are the landmark points themselves; the pen builds
 * the runs between them like any hand-pinned line.
 */
export function resolveTemplate(template, landmarks) {
  const needs = (template.requires || []).filter((id) => !Array.isArray(landmarks?.[id]));
  if (needs.length) return { needs };
  const pts = (ids) => ids.map((id) => landmarks[id].slice());
  return {
    outline: { name: template.id, closed: true, anchors: pts(template.outline.anchors), landmark_ids: template.outline.anchors.slice() },
    seam: template.seam ? { name: `${template.id} SEAM`, closed: false, anchors: pts(template.seam.anchors), landmark_ids: template.seam.anchors.slice() } : null,
  };
}

/** Templates of one side (or both, side null) split into available and blocked. */
export function templatesFor(side, landmarks, templates) {
  const available = [], blocked = [];
  for (const t of templates) {
    if (side && t.side !== side) continue;
    const r = resolveTemplate(t, landmarks);
    if (r.needs) blocked.push({ template: t, needs: r.needs });
    else available.push({ template: t, resolved: r });
  }
  return { available, blocked };
}

/** What a drafted piece records about its template: id, and every landmark's provenance. */
export function templateRecord(template, landmarks, provenance = {}, edited = false) {
  const used = [...new Set([...template.outline.anchors, ...(template.seam?.anchors || [])])];
  return {
    id: template.id, label: template.label_en, side: template.side, status: template.status, edited: Boolean(edited),
    landmarks: Object.fromEntries(used.map((id) => [id, {
      xyz_m: Array.isArray(landmarks?.[id]) ? landmarks[id].map((v) => Number(v.toFixed(5))) : null,
      source: provenance[id] || 'auto',
    }])),
    limit: TEMPLATE_LIMIT,
  };
}

/** One line of layer-15 annotation for the DXF: 7-bit ASCII, which is all the standard admits. */
export function templateAnnotation(record) {
  if (!record) return null;
  const sources = Object.entries(record.landmarks).map(([id, l]) => `${id}=${l.source}`).join(' ');
  return `Template ${record.id}${record.edited ? ' (edited)' : ''}: ${sources}`.replace(/[^\x20-\x7e]/g, '?');
}

/**
 * The polyline a template line becomes when built the way the pen builds one:
 * each leg the shortest surface path, with control points parked at a third and
 * two thirds along it and snapped to the skin. Used by the gate and by Compare,
 * neither of which has the pen; the viewer's Draft goes through the pen itself.
 */
export function templatePolyline(anchors, closed, grid) {
  const snap = (p) => closestOnMesh(grid, p).point;
  const pts = [];
  let length = 0;
  const n = anchors.length;
  const pairs = [];
  for (let i = 0; i + 1 < n; i++) pairs.push([anchors[i], anchors[i + 1]]);
  if (closed && n > 2) pairs.push([anchors[n - 1], anchors[0]]);
  for (const [A, B] of pairs) {
    const run = surfaceRun(grid, A, B);
    const h1 = snap(pointAtFraction(run.points, 1 / 3)), h2 = snap(pointAtFraction(run.points, 2 / 3));
    for (const [S, E] of [[A, h1], [h1, h2], [h2, B]]) {
      const leg = surfaceRun(grid, snap(S), snap(E));
      length += leg.length;
      for (const p of leg.points) {
        const q = pts[pts.length - 1];
        if (!q || Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > 1e-9) pts.push([p[0], p[1], p[2]]);
      }
    }
  }
  if (closed && pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-9) pts.pop();
  }
  return { points: pts, length_m: length };
}
