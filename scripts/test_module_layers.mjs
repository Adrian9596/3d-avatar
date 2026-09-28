#!/usr/bin/env node
/**
 * Keeps the app's modules in their layers, so a dependency only ever points
 * one way: ui -> features -> core.
 *
 *   src/core/      the shared engine (sections, surface paths, flattening, view
 *                  geometry, snapping). Imports nothing but other core modules.
 *   src/features/  one folder per feature (pen, pattern, landmarks, body grid,
 *                  reference geometry, avatar contracts). Imports core, its own
 *                  folder and three.js — never another feature, never the ui.
 *   src/ui/        the viewer (src/ui/viewer) and the keymap. May import
 *                  anything below it.
 *
 * Also: every relative import resolves, nothing under src/ imports from
 * scripts/ (the gates and tools), and the modules under src/ import each other
 * without a cycle. The layers and the one-way rule are the point; a cycle or a
 * feature reaching into another is how "move this and that breaks" starts.
 *
 * Exit codes: 0 the layers hold, 1 a check failed, 2 an input is missing.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGate } from './gate_report.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const REPORT = join(ROOT, 'qa', 'avatar_master', 'module-layers.json');
const gate = createGate();
if (!existsSync(SRC)) gate.blocked('src/ is missing');

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : name.endsWith('.mjs') ? [path] : [];
});
const files = walk(SRC).map((f) => relative(ROOT, f).split('\\').join('/')).sort();

// import specifiers, comments stripped first so a path in prose is not an import
const specifiers = (text) => {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const out = [];
  for (const re of [/\bimport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    for (const m of code.matchAll(re)) out.push(m[1]);
  }
  return [...new Set(out)];
};
const layerOf = (f) => {
  if (f.startsWith('src/core/')) return { layer: 'core' };
  if (f.startsWith('src/features/')) return { layer: 'features', feature: f.split('/')[2] };
  if (f.startsWith('src/ui/')) return { layer: 'ui' };
  return { layer: 'other' };
};
const THREE = (s) => s === 'three' || s.startsWith('three/');

const graph = new Map();
const edges = [];
const problems = { unresolved: [], scripts: [], layer: [] };
for (const f of files) {
  const from = layerOf(f);
  const deps = new Set();
  for (const s of specifiers(readFileSync(join(ROOT, f), 'utf8'))) {
    if (!s.startsWith('.')) {
      // bare: only three.js, and only outside core
      if (!THREE(s)) problems.layer.push(`${f} imports the package ${s}`);
      else if (from.layer === 'core') problems.layer.push(`${f} (core) imports ${s}`);
      continue;
    }
    const target = posix.normalize(posix.join(posix.dirname(f), s));
    if (!existsSync(join(ROOT, target))) { problems.unresolved.push(`${f} -> ${s}`); continue; }
    if (!target.startsWith('src/')) { problems.scripts.push(`${f} -> ${target}`); continue; }
    deps.add(target);
    const to = layerOf(target);
    edges.push({ from: f, to: target });
    const allowed = from.layer === 'ui'
      || (from.layer === 'features' && (to.layer === 'core' || (to.layer === 'features' && to.feature === from.feature)))
      || (from.layer === 'core' && to.layer === 'core');
    if (!allowed) problems.layer.push(`${f} (${from.feature ? `feature ${from.feature}` : from.layer}) imports ${target} (${to.feature ? `feature ${to.feature}` : to.layer})`);
  }
  graph.set(f, deps);
}

// cycles, by depth-first search
const cycles = [];
const state = new Map();
const stack = [];
const visit = (f) => {
  state.set(f, 1); stack.push(f);
  for (const g of graph.get(f) || []) {
    if (state.get(g) === 1) cycles.push([...stack.slice(stack.indexOf(g)), g].join(' -> '));
    else if (!state.get(g)) visit(g);
  }
  stack.pop(); state.set(f, 2);
};
for (const f of files) if (!state.get(f)) visit(f);

const count = (layer) => files.filter((f) => layerOf(f).layer === layer).length;
const features = [...new Set(files.filter((f) => f.startsWith('src/features/')).map((f) => f.split('/')[2]))].sort();
gate.record('every module under src/ is in a layer: core, a feature, or the ui',
  files.every((f) => layerOf(f).layer !== 'other') && files.length > 0,
  `${count('core')} core, ${count('features')} in ${features.length} features (${features.join(', ')}), ${count('ui')} ui`);
gate.record('every relative import resolves', problems.unresolved.length === 0, problems.unresolved.join('; ') || `${edges.length} imports between modules`);
gate.record('nothing under src/ imports the gates or tools in scripts/', problems.scripts.length === 0, problems.scripts.join('; ') || 'src/ stands alone');
gate.record('dependencies point one way: ui -> features -> core, and no feature imports another',
  problems.layer.length === 0, problems.layer.join('; ') || 'core imports only core; each feature only core, itself and three.js');
gate.record('the modules under src/ import each other without a cycle', cycles.length === 0, cycles.slice(0, 3).join('; ') || 'acyclic');

gate.finish({
  reportPath: REPORT,
  body: {
    purpose: 'Static guard that the app\'s modules stay in their layers (ui -> features -> core) with no cycle.',
    layers: {
      core: files.filter((f) => layerOf(f).layer === 'core'),
      features: Object.fromEntries(features.map((name) => [name, files.filter((f) => layerOf(f).feature === name)])),
      ui: files.filter((f) => layerOf(f).layer === 'ui'),
    },
    imports: edges.length,
  },
  okDecision: 'LAYERS_HOLD',
  relativeTo: ROOT,
});
