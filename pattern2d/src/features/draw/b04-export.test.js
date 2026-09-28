/* B04 / V13: the actual export action must report success and count only live shapes. */
import {test, eq, ok} from "../../../tests/harness.js";
import {withController} from "../../../tests/controller_fixture.js";
import {parseDXF} from "../dxf/parse.js";
import {buildModel} from "../dxf/model.js";

for(const kind of ['attached','free','deleted','restored','new-piece'])
  test(`B04 export button: ${kind} drawing downloads once and reports the exported result`, () => withController('draw', f => {
    const piece=f.ctx.pieces()[0];
    const attached=['attached','deleted','restored'].includes(kind);
    const q=attached ? piece.paths[0].pts[0] : [-100,-100];
    f.mode('rect'); f.input('dw',20); f.input('dh',10); f.pointer(q);
    if(attached) eq(f.tool.shapes(f.ctx)[0].pi,0,'fixture really belongs to the original DXF piece');
    if(kind === 'new-piece') f.act('piece');
    if(kind === 'deleted' || kind === 'restored'){
      f.ctx.model.pieces.splice(0,1); f.piecesChanged();
      if(kind === 'restored'){ f.ctx.model.pieces.unshift(piece); f.piecesChanged(); }
    }
    const before=f.state(); f.act('export');
    eq(f.downloads.length,1); eq(f.downloads[0].name,'BLOCK_36C_edit.dxf');
    ok(f.rows().some(r=>String(r[1]).startsWith('đã xuất BLOCK_36C_edit.dxf')),'actual button reports success, not a post-download error');
    eq(f.state(),before,'export does not edit the drawing');
    const reopened=buildModel(parseDXF(f.tool.exportText(f.ctx).text));
    eq(reopened.pieces.length,kind === 'deleted' ? 4 : kind === 'free' || kind === 'new-piece' ? 6 : 5);
    const expected=kind === 'deleted' || kind === 'new-piece' ? '0 hình vẽ' : '1 hình vẽ';
    ok(f.rows().some(r=>String(r[1]).includes(expected)),'message counts live non-piece drawings');
  }));
