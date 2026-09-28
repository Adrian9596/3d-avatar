/* B03 / Draw W8, Edit P3: all entry paths must validate both move fields.
   Compare actual world-mm geometry and undo, not pixel positions. */
import {test, eq, ok, near} from "../../../tests/harness.js";
import {withController} from "../../../tests/controller_fixture.js";

for(const tool of ['draw','edit']) for(const trigger of ['button','distance','direction']) for(const invalidField of ['distance','direction'])
  test(`B03 ${tool}: ${trigger} rejects invalid ${invalidField}; correction moves exactly 5 mm`, () => withController(tool, f => {
    let at;
    if(tool === 'draw'){
      f.mode('line'); f.pointer([-100,-100]); f.pointer([-60,-100]); f.mode('select');
      at = () => f.tool.shapes(f.ctx)[0].entity.a;
    } else {
      const p = f.ctx.pieces()[0], point = p.points[0];
      f.field('editfilter').value='point'; f.field('editfilter').emit('change');
      f.pointer([point.x,point.y]);
      ok(f.rows().some(r=>String(r[1]).startsWith('Point')),'fixture selects a real DXF point');
      at = () => [p.points[0].x,p.points[0].y];
    }
    const dist = tool === 'draw' ? 'ddist' : 'edist', dir = tool === 'draw' ? 'ddir' : 'edir';
    const apply = () => trigger === 'button' ? f.act('move') : f.enter(trigger === 'distance' ? dist : dir);
    f.input(dist,5); f.input(dir,0); f.input(invalidField === 'distance' ? dist : dir,'abc');
    const undo=f.dock.querySelector('[data-act=undo]'), undoDisabled=undo.disabled;
    const before=f.state(), beforeDXF=f.tool.exportText(f.ctx).text, origin=at().slice(); apply();
    eq(f.state()===before,true,'invalid move changes neither geometry nor history');
    eq(undo.disabled,undoDisabled,'invalid move creates no undo action');
    ok(f.rows().some(r=>String(r[1]).includes('hợp lệ')),'refusal explains the invalid number');
    f.input(invalidField === 'distance' ? dist : dir,invalidField === 'distance' ? 5 : 0); apply();
    near(at()[0],origin[0]+5); near(at()[1],origin[1]);
    /* Edit increments its cache revision on undo; the exported geometry must be exact. */
    f.act('undo'); eq(f.tool.exportText(f.ctx).text===beforeDXF,true,'one undo restores every exported coordinate');
  }));
