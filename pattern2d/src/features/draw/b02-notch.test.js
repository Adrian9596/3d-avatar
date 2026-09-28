/* B02 / M15: invalid is not the same state as blank or last-valid distance. */
import {test, eq, ok, near} from "../../../tests/harness.js";
import {withController} from "../../../tests/controller_fixture.js";

for(const invalid of ['-5','abc','Infinity']) test(`B02 notch rejects ${invalid} without geometry/history changes`, () => withController('draw', f => {
  f.mode('rect'); f.input('dw',40); f.input('dh',40); f.pointer([-100,-100]); f.act('piece');
  f.mode('notch'); f.input('dcorner',10); f.pointer([-95,-100]);
  const before=f.state(); f.input('dcorner',invalid); f.hover([-65,-100]); f.pointer([-65,-100]);
  eq(f.state(),before,'invalid distance must not place another notch');
  ok(f.rows().some(r => String(r[1]).includes('hợp lệ') || String(r[1]).includes('âm')),'explains refusal');
  f.input('dcorner',5); f.pointer([-65,-100]);
  const ns=f.tool.shapes(f.ctx).filter(s=>s.role === 'notch');
  eq(ns.length,2); near(ns[1].entity.p[0],-65); near(ns[1].entity.p[1],-100);
}));

test('B02 blank distance still places at pointer foot, not the previous distance', () => withController('draw', f => {
  f.mode('rect'); f.input('dw',40); f.input('dh',40); f.pointer([-100,-100]); f.act('piece');
  f.mode('notch'); f.input('dcorner',10); f.input('dcorner',''); f.pointer([-93,-100]);
  const n=f.tool.shapes(f.ctx).find(s=>s.role === 'notch'); near(n.entity.p[0],-93); near(n.entity.p[1],-100);
}));
