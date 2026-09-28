/* Deleting pieces of the open file, for good — and putting them back with ⌘Z (spec: pieces/remove.md). Pure: the model in,
   the model changed, a record of what went out; nothing here knows a tool, a selection or an undo stack.

   "For good" (TD 2026-09-24: "nếu xóa thì sẽ xóa hẳn"): the piece leaves model.pieces, so nothing draws, picks, snaps to or
   writes it — there is no hidden list to show it again. What keeps a piece afterwards keeps the piece itself, never its place
   in the list (R5), so a record put back restores every piece to where it was and everything that held it holds it again. */
import {pieceLabel} from "./pieces.js";

/* take pieces out of the model: indices in the list as it is now — any order, repeats and bad ones left out. A drawing
   without blocks is one piece sharing its paths and points with the loose entities write.js writes (dxf/model.js); taking
   it out takes those out too, the header lines stay (R6). → {removed: [{index, piece, label}], loose} for restorePieces */
export function removePieces(model, indices){
  const n = model.pieces.length;
  const ks = [...new Set(indices)].filter(i => Number.isInteger(i) && i >= 0 && i < n).sort((a, b) => a - b);
  const removed = ks.map(index => ({index, piece: model.pieces[index], label: pieceLabel(model.pieces[index], index)}));
  let loose = null;
  const whole = removed.find(r => !r.piece.blockName && model.loose);           // a piece with no block: the whole drawing
  if(whole){
    loose = {paths: model.loose.paths, points: model.loose.points};
    model.loose = {...model.loose, paths: [], points: []};
  }
  for(let j = removed.length - 1; j >= 0; j--) model.pieces.splice(removed[j].index, 1);
  return {removed, loose};
}

/* put a record back: each piece at the place it had — in ascending order, so every index is the one it had then */
export function restorePieces(model, rec){
  for(const r of rec.removed) model.pieces.splice(Math.min(r.index, model.pieces.length), 0, r.piece);
  if(rec.loose) model.loose = {...model.loose, paths: rec.loose.paths, points: rec.loose.points};
}

/* what a delete says (R7) */
export function removedText(rec){
  const rs = rec.removed || [];
  if(!rs.length) return "không có mảnh nào để xoá";
  return `đã xoá ${rs.length} mảnh: ${rs.map(r => r.label).join(", ")} — ⌘Z hoàn tác`;
}
