/* The AAMA/ASTM layer vocabulary — what each numbered layer means, how it is
   labelled in the legend, which colour token draws it and which kind of mark it is.
   This is DXF domain knowledge, so it lives with the importer, not in shared/. */

export const AAMA = {                     // AAMA layer -> name, chip label, colour, mark drawn
  "0":  ["Block frame",      "Frame",  "--l-other", "line"],
  "1":  ["Cut line",         "Cut",    "--l-cut",   "line"],
  "2":  ["Turn point",       "Turn",   "--l-turn",  "point"],
  "3":  ["Curve point",      "Curve",  "--l-curve", "point"],
  "4":  ["Notch",            "Notch",  "--l-notch", "point"],
  "5":  ["Grade reference",  "Grade",  "--l-ref",   "line"],
  "6":  ["Mirror line",      "Mirror", "--l-ref",   "line"],
  "7":  ["Grainline",        "Grain",  "--l-grain", "line"],
  "8":  ["Sewing line",      "Sew",    "--l-sew",   "dash"],
  "9":  ["Stripe reference", "Stripe", "--l-other", "line"],
  "11": ["Drill hole",       "Drill",  "--l-notch", "point"],
  "13": ["Annotation",       "Note",   "--l-text",  "text"],
  "14": ["Piece name",       "Name",   "--l-text",  "text"],
  "15": ["Annotation",       "Note",   "--l-text",  "text"]
};

/* Layer 14 is the piece name's in the Richpeace files (3380 writes the name there as TEXT) and the SEW LINE of ASTM D6673 —
   the Bianca, SofyLift, strike-cost files, 3087 (CLAUDE.md §8). {lines: true} — the layer holds lines, or the thing asked
   about is a line — reads it as the sewing line it then is: legend, colour, dash (2026-09-24: the legend said "Name", a
   text glyph, over the line Edges measured as "đường may") */
const SEW_14 = ["Sewing line (ASTM D6673)", "Sew 14", "--l-sew", "dash"];
export const layerMeta = (id, {lines = false} = {}) => {
  const [name, short, tok, kind] = (lines && id === "14" ? SEW_14 : AAMA[id]) || [`Layer ${id}`, `L${id}`, "--l-other", "line"];
  return {name, short, tok, kind};
};
