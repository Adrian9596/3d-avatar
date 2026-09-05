/**
 * Flattening a patch of the avatar's skin to 2D — the engine behind a 2D pattern
 * draft. PATTERN_2D_DXF_PLAN.md records the numbers this design rests on.
 *
 * One objective, on purpose. A pattern piece is judged at its SEAM, not in its
 * middle: two pieces that meet must have equal seam length or they cannot be
 * sewn. So the solver holds the seam hard to its 3D length and lets only the
 * interior absorb the curvature — which is what fabric does. Measured on a
 * one-cup patch of this body it halves the seam error of a conformal (LSCM) or
 * as-rigid-as-possible layout, and neither of those needs to run first: from a
 * hinge unfolding this relaxation converges to the same minimum to 0.01mm.
 *
 * What "the seam" is. For a patch handed in as a set of faces it is the mesh
 * boundary. For a patch cut out by a drawn loop it is the LOOP: each loop sample
 * is a point inside a face (barycentric), and the chord between consecutive
 * samples is a distance constraint on that face's vertices — so the drawn line is
 * held to length without remeshing, and the ring of faces the loop passes through
 * is scaffolding the exported outline never includes. When several pieces share
 * a seam, the shared chords are additionally pulled to a common length in every
 * piece, because two pieces that disagree on their shared seam cannot be sewn.
 *
 * What it cannot do, and says so: a doubly curved patch has curvature that no
 * flattening removes (Gauss). The residual seam error is reported per piece so
 * the reason a cup is cut into panels stays visible in the evidence; it is
 * never hidden by rescaling.
 *
 * Numerics are written out longhand (no hypot, no reductions whose order the
 * runtime chooses) because scripts/flatten.py is an independent port and the
 * parity gate compares the two to a micrometre.
 *
 * Coordinates are metres. Meshes are flat arrays: positions [x,y,z,...],
 * faces [i,j,k,...]. The output `uv` is a flat [u,v,...] array in metres.
 */

// The engine is split by responsibility; this module is the one import the
// viewer lanes and the gates use, so `validate:lane-parity` can grep for it.
export * from './flatten_mesh.mjs';
export * from './flatten_patch.mjs';
export * from './flatten_solver.mjs';
export * from './flatten_report.mjs';
