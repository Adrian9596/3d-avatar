/**
 * The morph and animation contracts the avatar is checked against.
 *
 * This asset has neither: avatar_master.glb carries no semantic morph targets
 * and no animation clips, so both checks come back BLOCKED. The panels that
 * displayed those notices were removed — they were permanently blocked and told
 * a reader nothing — but THE CHECK ITSELF STILL RUNS, into
 * `window.__avatarPlatform`, and scripts/test_viewer_contracts.mjs asserts it
 * reports BLOCKED rather than inventing substitute controls.
 *
 * It lived in the production viewer lane until that lane was merged away; it is
 * shared code now, so do not delete the check along with its UI, and do not add
 * shape or motion controls back without morphs and clips to drive them.
 */

export const REQUIRED_MORPHS = Object.freeze([
  "Underbust",
  "Projection",
  "RootWidth",
  "Spacing",
  "UpperFullness",
  "Ptosis",
]);

export const REQUIRED_CLIPS = Object.freeze([
  "arms_down",
  "arms_45",
  "arms_90_lateral",
  "arms_120",
  "arms_overhead",
  "arms_forward_90",
  "arms_sweep",
]);

export function validateNamedContract(actualNames, requiredNames) {
  const names = actualNames.map(String);
  const counts = new Map();
  names.forEach((name) => counts.set(name, (counts.get(name) || 0) + 1));
  const missing = requiredNames.filter((name) => !counts.has(name));
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  const unexpected = names.filter((name) => !requiredNames.includes(name));
  return {
    status: missing.length || duplicates.length ? "BLOCKED" : "PASS",
    required: [...requiredNames],
    actual: names,
    missing,
    duplicates,
    unexpected,
  };
}

export const validateMorphContract = (names) => validateNamedContract(names, REQUIRED_MORPHS);
export const validateAnimationContract = (names) => validateNamedContract(names, REQUIRED_CLIPS);

