/* Ba lớp ráp lại thành một thứ dùng được: tài liệu hình học.

   Một doc giữ các hình (nút nguồn), các quan hệ (nút dẫn xuất) và biết tự tính lại.
   Mọi phép sửa — move, scale, trim, extend, sửa đỉnh — đều tác động lên nút NGUỒN,
   rồi solver kéo phần còn lại theo. Đó là lý do trim một đường không làm hỏng notch
   nằm trên nó: notch được tính lại từ đường vừa trim. */
import {point} from "./model.js";
import {move, scale, rotate, trim, extend, measure} from "./ops.js";
import {createGraph} from "./graph.js";
import {RULES} from "./rules.js";
import {solve, solveAll} from "./solver.js";

export function createDoc(){
  const g = createGraph();

  const doc = {
    graph: g,

    /* ── thêm hình và quan hệ ───────────────────────────────────────────── */
    add(shape, meta = {}){ return g.addSource(shape, meta); },
    derive(rule, inputs, params = {}, meta = {}){
      if(!RULES[rule]) throw new Error(`không có quan hệ tên "${rule}"`);
      const r = RULES[rule];
      if(r.arity !== "n" && inputs.length !== r.arity)
        throw new Error(`"${rule}" cần ${r.arity} đầu vào, nhận ${inputs.length}`);
      return g.addDerived(rule, inputs, params, meta);
    },

    /* ── đọc ────────────────────────────────────────────────────────────── */
    get(id){ if(g.dirty.size) solve(g); return g.node(id)?.value ?? null; },
    raw: id => g.node(id)?.value ?? null,
    node: id => g.node(id),
    meta: id => g.node(id)?.meta ?? {},
    error: id => g.node(id)?.error ?? null,
    ids: () => g.ids(),
    isSource: id => g.isSource(id),
    dependents: id => g.dependents(id),
    /* quan hệ dưới dạng đọc được, cho panel bên phải — L(mm, d, label) viết độ dài theo đơn
       vị hiển thị của viewer; không truyền thì kernel viết mm */
    relations: L => g.ids().filter(id => !g.isSource(id)).map(id => {
      const n = g.node(id);
      return {id, rule: n.rule, inputs: n.inputs, params: n.params,
              text: RULES[n.rule]?.describe(n.params, L) ?? n.rule,
              name: n.meta.name || id, error: n.error};
    }),

    /* ── sửa: chỉ nút nguồn, phần còn lại tự theo ───────────────────────── */
    set(id, shape){ g.setValue(id, shape); return doc; },
    /* đổi tham số quan hệ (offset 6 → 10 mm) cũng làm bẩn nhánh dưới nó */
    setParams(id, params){
      const n = g.node(id);
      if(!n || !n.rule) throw new Error(`${id} không phải nút dẫn xuất`);
      n.params = {...n.params, ...params};
      g.markDirty(id);
      for(const d of g.descendants(id)) g.markDirty(d);
      return doc;
    },
    move(id, dx, dy){ return doc.set(id, move(doc.raw(id), dx, dy)); },
    scale(id, k, origin = point(0, 0)){ return doc.set(id, scale(doc.raw(id), k, origin)); },
    rotate(id, ang, origin = point(0, 0)){ return doc.set(id, rotate(doc.raw(id), ang, origin)); },
    /* Trimming the middle out of a line leaves TWO lines. The node keeps the first; the
       second becomes a new source node beside it instead of vanishing — a trim that loses
       half of what it kept is a measurement that silently shrank (measure_engine.md EDIT-04).
       `ids` lists every node now holding a kept piece, the original first. */
    trim(id, cutterIds, at){
      const r = trim(doc.raw(id), cutterIds.map(c => doc.get(c)), at);
      const ids = [];
      if(r.kept.length){ doc.set(id, r.kept[0]); ids.push(id); }
      const meta = doc.meta(id);
      r.kept.slice(1).forEach((k, i) =>
        ids.push(g.addSource(k, {...meta, id: undefined, name: `${meta.name || id} (${i + 2})`})));
      return {...r, ids};
    },
    extend(id, cutterIds, end = "end"){
      return doc.set(id, extend(doc.raw(id), cutterIds.map(c => doc.get(c)), end));
    },
    measure(idA, idB){ return measure(doc.get(idA), doc.get(idB)); },

    /* ── tính lại ───────────────────────────────────────────────────────── */
    solve: () => solve(g),
    solveAll: () => solveAll(g),

    /* ── undo: chỉ cần giá trị của các nút nguồn, phần dẫn xuất tính lại được ── */
    snapshot: () => g.ids().filter(id => g.isSource(id)).map(id => [id, g.node(id).value]),
    restore(snap){
      for(const [id, v] of snap) if(g.has(id)) g.setValue(id, v);
      return solve(g);
    }
  };
  return doc;
}
