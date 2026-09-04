/**
 * Minimal GLB reader for Node, returning world-space triangles keyed by
 * material name (9 numbers per triangle, matching measure_core.mjs).
 *
 * The browser gets its triangles from three.js and Python has its own reader in
 * scripts/measure_avatar.py. Three independent parsers of the same bytes is not
 * duplication here — it is what makes the parity test meaningful.
 */

import { readFileSync } from 'node:fs';

const COMPONENT = {
  5120: { array: Int8Array, size: 1 },
  5121: { array: Uint8Array, size: 1 },
  5122: { array: Int16Array, size: 2 },
  5123: { array: Uint16Array, size: 2 },
  5125: { array: Uint32Array, size: 4 },
  5126: { array: Float32Array, size: 4 },
};
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(path) {
  const raw = readFileSync(path);
  if (raw.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${path} is not a GLB`);
  let gltf = null;
  let binary = null;
  let offset = 12;
  while (offset < raw.length) {
    const length = raw.readUInt32LE(offset);
    const kind = raw.readUInt32LE(offset + 4);
    const chunk = raw.subarray(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) gltf = JSON.parse(chunk.toString('utf8'));
    else if (kind === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  if (!gltf) throw new Error(`${path} has no JSON chunk`);
  return { gltf, binary };
}

function readAccessor(gltf, binary, index) {
  const accessor = gltf.accessors[index];
  const component = COMPONENT[accessor.componentType];
  const perItem = TYPE_COUNT[accessor.type];
  const itemSize = component.size * perItem;
  const view = gltf.bufferViews[accessor.bufferView];
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride || itemSize;
  const out = [];
  for (let i = 0; i < accessor.count; i++) {
    const start = binary.byteOffset + base + i * stride;
    const slice = new component.array(binary.buffer.slice(start, start + itemSize));
    out.push(Array.from(slice));
  }
  return out;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  if (!('translation' in node) && !('rotation' in node) && !('scale' in node)) return null;
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const r = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw),
    2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw),
    2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy),
  ];
  return [
    r[0] * sx, r[1] * sx, r[2] * sx, 0,
    r[3] * sy, r[4] * sy, r[5] * sy, 0,
    r[6] * sz, r[7] * sz, r[8] * sz, 0,
    tx, ty, tz, 1,
  ];
}

function multiply(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function applyMatrix(m, p) {
  if (!m) return p;
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

export function trianglesByMaterial(path) {
  const { gltf, binary } = readGlb(path);
  const materials = (gltf.materials || []).map((m, i) => m.name || `material_${i}`);
  const buckets = new Map();

  const walk = (nodeIndex, parent) => {
    const node = gltf.nodes[nodeIndex];
    const world = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const name = primitive.material !== undefined ? materials[primitive.material] : 'default';
        const positions = readAccessor(gltf, binary, primitive.attributes.POSITION);
        const order = primitive.indices !== undefined
          ? readAccessor(gltf, binary, primitive.indices).map((i) => i[0])
          : positions.map((_, i) => i);
        if (!buckets.has(name)) buckets.set(name, []);
        const bucket = buckets.get(name);
        for (const i of order) {
          const [x, y, z] = applyMatrix(world, positions[i]);
          bucket.push(x, y, z);
        }
      }
    }
    for (const child of node.children || []) walk(child, world);
  };

  const scene = gltf.scene || 0;
  for (const nodeIndex of gltf.scenes[scene].nodes || []) walk(nodeIndex, null);

  const out = new Map();
  for (const [name, values] of buckets) out.set(name, new Float32Array(values));
  return { triangles: out, gltf };
}
