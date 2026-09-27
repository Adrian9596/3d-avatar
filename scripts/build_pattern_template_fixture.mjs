#!/usr/bin/env node
/**
 * Rewrites scripts/pattern_template_fixture_landmarks.json for the asset on disk.
 *
 * The fixture is pinned to the asset sha256, so every re-export needs a new one.
 * It holds the authority pass's automatic landmarks as they are, plus SYNTHETIC
 * stand-ins for the manual-only breast-root points, made up around the detected
 * left apex exactly the way scripts/spike_authoring_ux.mjs makes them
 * (AUTHORING_UX_PLAN.md section 4.3), and mirrored through x -> -x for the right
 * side. The mirror is only exact on a mirrored body, so it is checked against
 * the surface and refused past 0.01 mm. The viewer never reads this file; on the
 * real body a person places the roots.
 *
 * Run `npm run measure:avatar` first: the automatic landmarks come from
 * qa/avatar_master/measurements.json.
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAvatarContext } from './flatten_fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'scripts', 'pattern_template_fixture_landmarks.json');
const AUTO = ['BUST_APEX_L', 'BUST_APEX_R', 'CF_UNDERBUST', 'CB_UNDERBUST',
  'SIDE_UNDERBUST_L', 'SIDE_UNDERBUST_R', 'UNDERARM_L', 'UNDERARM_R'];
const MIRROR_LIMIT_M = 1e-5;

const ctx = loadAvatarContext(ROOT);
if (ctx.error) { console.error(`BLOCKED: ${ctx.error}`); process.exit(2); }
const { closest, landmarks } = ctx;
for (const id of AUTO) if (!landmarks[id]) { console.error(`BLOCKED: ${id} is not in the authority pass`); process.exit(2); }

const round = (p) => p.map((v) => Number(v.toFixed(5)));
const snap = (p) => closest(p).point;
// the spike's construction, number for number
const apex = landmarks.BUST_APEX_L, fold = landmarks.CF_UNDERBUST[1];
const left = {
  ROOT_TOP_L: snap([apex[0], apex[1] + 0.065, apex[2] - 0.02]),
  ROOT_BOTTOM_L: snap([apex[0], fold, apex[2]]),
  ROOT_INNER_L: snap([apex[0] * 0.3, apex[1] - 0.005, apex[2] - 0.01]),
  ROOT_OUTER_L: snap([apex[0] * 1.75, apex[1] - 0.005, apex[2] - 0.045]),
};

const out = Object.fromEntries(AUTO.map((id) => [id, round(landmarks[id])]));
const provenance = Object.fromEntries(AUTO.map((id) => [id, 'auto']));
for (const [id, p] of Object.entries(left)) {
  const mirrorId = id.replace(/_L$/, '_R');
  const mirrored = [-p[0], p[1], p[2]];
  const hit = closest(mirrored).point;
  const residual = Math.hypot(hit[0] - mirrored[0], hit[1] - mirrored[1], hit[2] - mirrored[2]);
  if (residual > MIRROR_LIMIT_M) {
    console.error(`BLOCKED: the mirror of ${id} is ${(residual * 1000).toFixed(3)}mm off the surface; this body is not a mirror`);
    process.exit(2);
  }
  out[id] = round(p);
  out[mirrorId] = round(mirrored);
  // the root bottom is derived from automatic landmarks alone; the other three are made up
  provenance[id] = provenance[mirrorId] = id.startsWith('ROOT_BOTTOM') ? 'auto' : 'fixture';
}
const order = [...AUTO.slice(0, 8), 'ROOT_TOP_L', 'ROOT_TOP_R', 'ROOT_BOTTOM_L', 'ROOT_BOTTOM_R',
  'ROOT_INNER_L', 'ROOT_INNER_R', 'ROOT_OUTER_L', 'ROOT_OUTER_R'];
const fixture = {
  schema_version: 1,
  fixture: true,
  note: 'SYNTHETIC test landmarks for validate:pattern-templates. The three manual-only root points per side are made up around the detected apex (the same construction AUTHORING_UX_PLAN.md section 4.3 used); the viewer never reads this file. On the real body a person places them. Regenerate with node scripts/build_pattern_template_fixture.mjs after any re-export.',
  asset: { file: 'assets/export/avatar_master.glb', sha256: ctx.assetSha },
  landmarks: Object.fromEntries(order.map((id) => [id, out[id]])),
  provenance: Object.fromEntries(order.map((id) => [id, provenance[id]])),
};
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`WROTE ${OUT.slice(ROOT.length + 1)} for ${ctx.assetSha.slice(0, 12)}…`);
