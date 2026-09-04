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

