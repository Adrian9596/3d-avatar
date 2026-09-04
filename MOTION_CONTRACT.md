# Rig and Motion Contract — 3D Avatar Platform

**Status:** harness ready; final asset blocked by TD master-fit gate  
**Applies to:** final canonical GLB, not the current helper-free prototype GLB

## Stable runtime names

Minimum bilateral body chain uses ASCII, side-qualified names:

- `pelvis`, `spine_01`, `spine_02`, `chest`, `neck`, `head`;
- `clavicle_L/R`, `upper_arm_L/R`, `lower_arm_L/R`, `hand_L/R`;
- `thigh_L/R`, `lower_leg_L/R`, `foot_L/R`.

Required animation clips are exact names:

| Clip | Required state |
|---|---|
| `arms_down` | arms resting down |
| `arms_45` | bilateral lateral 45° |
| `arms_90_lateral` | bilateral lateral 90° |
| `arms_120` | bilateral lateral 120° |
| `arms_overhead` | bilateral overhead 150–160° |
| `arms_forward_90` | bilateral forward 90° |
| `arms_sweep` | continuous down → overhead → down and return to neutral |

The modular viewer enumerates these exact names. Missing or duplicated clips remain `BLOCKED`; the viewer never synthesizes a substitute movement.

## Authoring gate

Final armature creation and skin weighting start only after the TD-approved measurements are populated and the fitted master body/topology hash is frozen. A draft harness may validate names and UI behavior, but it cannot establish deformation quality.

## Pose QA matrix

For every named pose and the sampled sweep:

1. record shoulder, axilla, breast-root, IMF and apex landmark deltas;
2. check left/right symmetry and return to neutral;
3. render Front, 45°, Side and Back views;
4. inspect body self-intersection and body/top/brief penetration;
5. confirm sensitive-area coverage and absence of z-fighting;
6. repeat at min/default/max for the six approved semantic morphs;
7. re-import the GLB into a clean Blender scene and repeat the inventory.

Required machine evidence is the rig inventory, named action inventory, sweep sample report, landmark-follow report, collision/coverage report, combined pose/morph matrix and final round-trip report. Human TD/3D review remains mandatory.

