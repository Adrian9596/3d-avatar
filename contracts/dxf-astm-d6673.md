# Pattern DXF contract — ASTM D6673-10 in Gerber AccuMark's dialect

Status: **structure sourced and gated; import into AccuMark not yet verified.**
Target CAD decided 2026-09-05: **Gerber AccuMark**. `qa/avatar_master/dxf-roundtrip.json`
carries `import_verified: false` until someone opens `qa/avatar_master/flatten-draft.dxf`
in AccuMark and records the version that accepted it.

This contract is what `scripts/dxf_writer.mjs` writes and `scripts/test_dxf_roundtrip.mjs`
checks with an independent parser. It exists so the layer numbers and text syntax below are
looked up, not remembered.

## Sources

- ASTM D6673-10, *Standard Practice for Sewn Products Pattern Data Interchange — Data Format*
  (withdrawn 2019, still the interchange every apparel CAD reads). Layer table, block
  structure and system-text syntax as summarised in DH Patterns and Fit, *ePattern ASTM
  Standard* (2011/2012), which also records the Gerber 20-character name limit.
- ezdxf's `gerber_D6673` add-on and its discussion #789: what Gerber Technology's parser
  rejects — files with `$MODEL_SPACE` / `$PAPER_SPACE` layout blocks, a populated HEADER,
  or a TABLES section — and that only DXF R12 is safe.

## File shape

| Part | Requirement | Why |
|---|---|---|
| Encoding | ASCII, 7-bit characters only | the standard admits nothing else |
| Version | DXF R12 (AC1009 tags; no version variable is written) | Gerber accepts R12; ASTM is specified against R13 but R12 files are valid |
| HEADER | present and **empty** | Gerber's parser |
| TABLES | **absent** — so no linetypes, text styles or layer table | Gerber's parser |
| BLOCKS | one BLOCK per pattern piece, no `$MODEL_SPACE`/`$PAPER_SPACE` | ASTM groups a piece as a block; Gerber rejects the layout blocks |
| ENTITIES | Style System Text + one INSERT per block | ASTM |
| Units | millimetres, two decimals | "Units: METRIC" means mm to 2 decimals |
| Block names | `[A-Z0-9_]`, from the piece name | some parsers reject spaces |

## Layers used (numbers, not names — ASTM layers are numbered)

| Layer | Content | Entity |
|---|---|---|
| 1 | Piece System Text (in the block) and Style System Text (in ENTITIES); piece **boundary without seam allowance** — the net sew line as boundary is explicitly allowed | TEXT, closed POLYLINE |
| 2 | turn points: outline vertices turning more than 30° | POINT |
| 3 | curve points: every other outline vertex | POINT |
| 7 | grain line (mandatory in the ASTM "minimum requirements" file) | LINE |
| 15 | annotation | TEXT |
| 84 | boundary quality-validation curve: an exact copy of the layer-1 polyline (mandatory in ASTM) | closed POLYLINE |

Reserved for later phases, not written today: 8 internal lines, 11 internal cutouts, 14 sew
lines (once a boundary *with* allowance is drawn, the net line moves here), 4/80–83 notches,
5/6 grade reference and mirror lines, 13 drill holes.

## System text syntax (case-sensitive, one TEXT entity per line)

Style System Text, layer 1, at the origin of ENTITIES:

```
Style Name: <string, 1-20 chars>
Creation Date: dd-mm-yyyy
Creation Time: hh:mm
Author: <vendor>;<application>;<release>
Sample Size: <string>
Grade Rule Table: <string>
Units: METRIC
ASTM/D13 Proposal 1 Version: D6673-10
Curve Tolerance: <float, mm>
```

Piece System Text, layer 1, inside each block:

```
Piece Name: <string, 1-20 chars>
Quantity: <R,L>
```

`Rotation`, `Flip`, `Tilt`, `Fold`, `Material` are optional and not written.

## What the writer refuses

A name over 20 characters, any non-ASCII character, an outline that repeats its first
point or has fewer than three, a piece without a grain line, two pieces mapping to the same
block name. Refusing beats Gerber truncating silently.

## What the file says about itself

Every piece carries layer-15 annotation stating that it is a 1:1 shell of the body
surface and not a pattern (no ease, no seam allowance, no grading), its seam error against
the body, that the grain line and `Quantity: 1,1` are defaults for the pattern maker to set,
the asset SHA prefix, and — for pieces solved together — the shared-seam mismatch. The
evidence file repeats the same limits, so a reader of either knows what they hold.
