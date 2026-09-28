/* Edit D14–D20: a chosen endpoint meets a finite target; all values are mm.
   Expectations are hand intersections, independent of the implementation. */
import {test, eq, near, deepEq, ok} from "../../../tests/harness.js";
import {point, line, curve, arc, length, pointAt} from "./model.js";
import {trimExtend} from "./ops.js";
const L = (a,b) => line(point(...a),point(...b));
const wall = x => L([x,-20],[x,20]);
const fit = (...args) => trimExtend(...args);

for(const [end,x,kind,a,b] of [
  ['end',60,'trim',[0,0],[60,0]], ['end',140,'extend',[0,0],[140,0]],
  ['start',40,'trim',[40,0],[100,0]], ['start',-40,'extend',[-40,0],[100,0]]
]) test(`D15–17 ${kind} ${end} to x=${x}, fixed end and target unchanged`,()=>{
  const s=L([0,0],[100,0]), target=wall(x), before=JSON.stringify([s,target]);
  const r=fit(s,[target],end); ok(r.ok,r.message); eq(r.action,kind);
  for(const [actual,want] of [[r.shape.a,a],[r.shape.b,b]]){ near(actual.x,want[0],1e-9); near(actual.y,want[1],1e-9); }
  deepEq(end === 'end' ? r.shape.a : r.shape.b,end === 'end' ? s.a : s.b,'fixed endpoint is exact');
  eq(JSON.stringify([s,target]),before,'pure geometry must not mutate source or target');
});

test('D16 closest intersection competes across trim and extension, independent of target order',()=>{
  for(const [xs,want,action] of [[[10,120],120,'extend'],[[70,150],70,'trim'],[[80,120],80,'trim']])
    for(const targets of [xs,xs.slice().reverse()]){
      const r=fit(L([0,0],[100,0]),targets.map(wall),'end'); ok(r.ok,r.message);
      near(r.shape.b.x,want); eq(r.action,action);
    }
});
test('D16 trim is from the selected endpoint, never removes a middle interval',()=>{
  const target=curve([[30,-10],[30,10],[70,10],[70,-10]],false);
  const r=fit(L([0,0],[100,0]),[target],'end'); ok(r.ok,r.message); near(length(r.shape),70);
});
test('D16 target circle: select the nearest crossing of the chosen end',()=>{
  const r=fit(L([0,0],[100,0]),[arc(point(100,0),20,0,2*Math.PI,true)],'end');
  ok(r.ok,r.message); near(r.shape.b.x,80); eq(r.action,'trim');
});
for(const [name,s,targets,end] of [
  ['parallel',L([0,0],[100,0]),[L([0,10],[100,10])],'end'],
  ['collinear',L([0,0],[100,0]),[L([20,0],[150,0])],'end'],
  ['wrong direction',L([0,0],[100,0]),[wall(-40)],'end'],
  ['finite target only',L([0,0],[100,0]),[L([140,5],[140,20])],'end'],
  ['fixed end only',L([0,0],[100,0]),[wall(0)],'end'],
  ['already meets',L([0,0],[100,0]),[wall(100)],'end'],
  ['closed',curve([[0,0],[100,0],[100,20]],true),[wall(60)],'end'],
  ['implicit loop',curve([[0,0],[100,0],[100,20],[0,0]],false),[wall(60)],'end'],
  ['zero length',L([0,0],[0,0]),[wall(60)],'end']
]) test(`D18 refusal: ${name} leaves source unchanged`,()=>{
  const before=JSON.stringify(s), r=fit(s,targets,end);
  eq(r.ok,false); ok(r.message); eq(JSON.stringify(s),before);
});
test('D17 bent polyline trim retains the untouched bends and fixed endpoint',()=>{
  const s=curve([[0,0],[50,0],[50,50]],false), r=fit(s,[L([40,30],[60,30])],'end');
  ok(r.ok,r.message); deepEq(r.shape.pts,[[0,0],[50,0],[50,30]]);
});
test('D17 polyline extension follows its last segment without deforming the existing path',()=>{
  const s=curve([[0,0],[50,0],[50,50]],false), r=fit(s,[L([40,80],[60,80])],'end');
  ok(r.ok,r.message); deepEq(r.shape.pts,[[0,0],[50,0],[50,50],[50,80]]);
});
test('D17 arc trim and extend retain centre and radius',()=>{
  const s=arc(point(0,0),20,0,Math.PI/2,true);
  for(const [target,action,end] of [[wall(10),'trim',[10,Math.sqrt(300)]],[wall(-10),'extend',[-10,Math.sqrt(300)]]]){
    const r=fit(s,[target],'end'); ok(r.ok,r.message); eq(r.action,action);
    deepEq(r.shape.c,s.c); near(r.shape.r,20); near(pointAt(r.shape,1).x,end[0]); near(pointAt(r.shape,1).y,end[1]);
  }
});
