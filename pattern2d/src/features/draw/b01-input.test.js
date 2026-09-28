/* B01: invalid dimensions must stop the actual dock/controller, including Enter
   in a different field. QA_RETEST_2026-09-26.md; V2/V6 and M3. */
import {test, eq, deepEq, ok} from "../../../tests/harness.js";
import {withController} from "../../../tests/controller_fixture.js";
import {PieceTool} from "./pieces.js";

for(const [mode, field, values] of [
  ['rect','dw',{dw:60,dh:30}], ['rect','dh',{dw:60,dh:30}],
  ['circle','dd',{dd:20}], ['polygon','dsize',{dsize:30,dsides:6,dpang:0}],
  ['polygon','dsides',{dsize:30,dsides:6,dpang:0}], ['polygon','dpang',{dsize:30,dsides:6,dpang:0}]
]) test(`B01 ${mode}.${field}: invalid text cannot place a stale shape; correction works`, () => withController('draw', f => {
  f.mode(mode); for(const [id,v] of Object.entries(values)) f.input(id,v);
  f.input(field,'abc'); const before=f.state(); f.hover([-100,-100]); f.pointer([-100,-100]);
  eq(f.state(),before,'invalid click must not create geometry or an undo step');
  ok(f.rows().some(r => String(r[1]).includes('hợp lệ')),'readout explains refusal');
  f.input(field,values[field]); f.pointer([-100,-100]);
  eq(f.tool.shapes(f.ctx).length,1); eq(f.tool.undoCount(),1);
}));

for(const mode of ['line','piece']) test(`B01 ${mode}: Enter in Angle must also validate Length`, () => withController('draw', f => {
  f.mode(mode); f.pointer([-100,-100]); f.input('dlen',40); f.input('dlen','abc'); f.input('dang',0);
  const before=f.state(), pen=JSON.stringify(PieceTool.pen()); f.enter('dang');
  eq(f.state(),before); eq(JSON.stringify(PieceTool.pen()),pen,'invalid Length adds no pen vertex');
  f.input('dlen',40); f.enter('dang');
  if(mode === 'piece') deepEq(PieceTool.pen().pts,[[-100,-100],[-60,-100]]);
  else deepEq(f.tool.shapes(f.ctx)[0].entity.b,[-60,-100]);
}));

test('B01 pointer-defined Line ignores unrelated invalid rectangle dimensions', () => withController('draw', f => {
  f.mode('rect'); f.input('dw','abc'); f.mode('line'); f.pointer([-100,-100]); f.pointer([-60,-100]);
  eq(f.tool.shapes(f.ctx).length,1); eq(f.tool.undoCount(),1);
}));
