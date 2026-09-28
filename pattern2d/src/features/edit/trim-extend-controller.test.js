/* D14–D20: real dock/controller actions, isolated state for every two-click flow. */
import {test, eq, near, deepEq, ok} from "../../../tests/harness.js";
import {withController} from "../../../tests/controller_fixture.js";
import {lineP, poly} from "../../../tests/edit_fixtures.js";
import {summarize} from "../dxf/model.js";

function setup(f, targetX=60){
  const p=f.ctx.pieces()[0];
  p.paths=[lineP('8',[0,0],[100,0]),lineP('8',[targetX,-20],[targetX,20])]; p.points=[];
  summarize(p); f.ctx.model.pieces=[p]; f.piecesChanged(); f.mode('trimExtend');
  return p;
}
for(const [x,first,want] of [[60,[90,0],[[0,0],[60,0]]],[140,[90,0],[[0,0],[140,0]]],
                           [40,[10,0],[[40,0],[100,0]]],[-40,[10,0],[[-40,0],[100,0]]]])
  test(`D14–17 two clicks adjust only source to x=${x}; single Undo`,()=>withController('edit',f=>{
    const p=setup(f,x), before=f.tool.exportText(f.ctx).text, target=JSON.stringify(p.paths[1]);
    const buttons=f.dock.querySelectorAll('[data-mode]').map(b=>b.dataset.mode);
    ok(buttons.includes('trimExtend')); ok(!buttons.includes('trim')&&!buttons.includes('extend'),'only one combined button');
    f.pointer(first);
    eq(f.tool.exportText(f.ctx).text,before,'click 1 changes no geometry');
    eq(f.dock.querySelector('[data-act=undo]').disabled,true);
    ok(f.rows().some(r=>String(r[1]).includes('đường 2')),'guides the second click');
    f.pointer([x,15]);
    p.paths[0].pts.forEach((q,i)=>q.forEach((v,k)=>near(v,want[i][k],1e-9)));
    eq(JSON.stringify(p.paths[1]),target);
    f.act('undo'); eq(f.tool.exportText(f.ctx).text,before);
    eq(f.dock.querySelector('[data-act=undo]').disabled,true,'one operation = one undo');
  }));

test('D9 each completed pair resets: next first click does not change a path',()=>withController('edit',f=>{
  const p=setup(f,60); f.pointer([90,0]); f.pointer([60,15]);
  const before=f.tool.exportText(f.ctx).text; f.pointer([60,-15]);
  eq(f.tool.exportText(f.ctx).text,before); ok(f.rows().some(r=>String(r[1]).includes('đường 2')));
}));
test('D18–19 parallel/same/empty targets preserve source and allow retry',()=>withController('edit',f=>{
  const p=setup(f,140); p.paths.push(lineP('8',[0,10],[100,10])); summarize(p);
  const before=f.tool.exportText(f.ctx).text;
  f.pointer([90,0]); f.pointer([90,10]); f.pointer([20,0]); f.pointer([300,300]);
  eq(f.tool.exportText(f.ctx).text,before); eq(f.dock.querySelector('[data-act=undo]').disabled,true);
  f.pointer([140,15]); near(p.paths[0].pts[1][0],140);
}));
test('D18 closed cut cannot be source but all its entities can be the target',()=>withController('edit',f=>{
  const p=setup(f,140); p.paths[1]=poly('1',[[120,-20],[160,-20],[160,20],[120,20]],true); summarize(p);
  const before=f.tool.exportText(f.ctx).text; f.pointer([160,10]);
  eq(f.tool.exportText(f.ctx).text,before); ok(f.rows().some(r=>String(r[1]).includes('kín')||String(r[1]).includes('đường cắt')));
  f.pointer([90,0]); f.pointer([160,10]); near(p.paths[0].pts[1][0],120,1e-6,'nearest crossing, not the clicked edge');
}));
test('D9 switching mode cancels first line; entering again starts a fresh pair',()=>withController('edit',f=>{
  setup(f,140); f.pointer([90,0]); f.mode('drag'); f.mode('trimExtend');
  const before=f.tool.exportText(f.ctx).text; f.pointer([140,15]);
  eq(f.tool.exportText(f.ctx).text,before); eq(f.dock.querySelector('[data-act=undo]').disabled,true);
}));
test('D9 piece deletion cancels pending source instead of editing a shifted index',()=>withController('edit',f=>{
  const p=setup(f,140); f.pointer([90,0]); f.ctx.model.pieces=[]; f.piecesChanged();
  f.ctx.model.pieces=[p]; f.piecesChanged(); const before=f.tool.exportText(f.ctx).text;
  f.pointer([140,15]); eq(f.tool.exportText(f.ctx).text,before);
}));

test('D9 Escape cancels a pending pair; Undo cancels the next pending pair too',()=>withController('edit',f=>{
  const p=setup(f,140), before=f.tool.exportText(f.ctx).text;
  f.pointer([90,0]); f.key('Escape'); f.mode('trimExtend'); f.pointer([140,15]);
  eq(f.tool.exportText(f.ctx).text,before);
  f.mode('drag'); f.mode('trimExtend'); f.pointer([90,0]); f.pointer([140,15]);
  f.pointer([50,0]); f.act('undo'); eq(f.tool.exportText(f.ctx).text,before);
  f.pointer([140,15]); eq(f.tool.exportText(f.ctx).text,before,'after undo the next click only selects');
}));

test('D9 Undo cancels pending source even before any completed edit',()=>withController('edit',f=>{
  setup(f,140); const before=f.tool.exportText(f.ctx).text;
  f.pointer([90,0]); f.key('z',{metaKey:true});
  ok(f.rows().some(r=>String(r[1]).includes('1 · Chọn đường cần sửa')),'pending source cleared without history');
  f.pointer([140,15]); eq(f.tool.exportText(f.ctx).text,before,'next click only selects');
}));
