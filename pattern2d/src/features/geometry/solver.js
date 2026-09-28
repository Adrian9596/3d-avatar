/* Lớp 3 — Geometry Solver.

   Một chiều, theo thứ tự tôpô: nút nào bẩn thì tính lại nó và mọi nút dưới nó, theo
   đúng thứ tự phụ thuộc, mỗi nút đúng một lần. Không lặp, không dò nghiệm — nên kết
   quả tiên đoán được và một lần giải luôn kết thúc.

   Rule hỏng (hai hình hết cắt nhau, offset làm hình biến mất) không làm chết cả lần
   giải: nút đó thành lỗi, các nút dưới nó bị đánh "chặn", phần còn lại vẫn cập nhật.
   Báo cáo trả về đủ để UI nói cho người dùng chỗ nào gãy. */
import {RULES} from "./rules.js";

export function solve(graph){
  const t0 = Date.now();
  const targets = new Set();
  for(const id of graph.dirty){
    targets.add(id);
    for(const d of graph.descendants(id)) targets.add(d);
  }
  if(!targets.size) return {order: [], updated: [], failed: [], blocked: [], ms: 0};

  /* Kahn trên đúng phần đồ thị cần tính */
  const indeg = new Map();
  for(const id of targets){
    const n = graph.node(id);
    indeg.set(id, n.inputs.filter(i => targets.has(i)).length);
  }
  const queue = [...targets].filter(id => indeg.get(id) === 0).sort();
  const order = [];
  while(queue.length){
    const id = queue.shift();
    order.push(id);
    for(const d of graph.dependents(id)){
      if(!targets.has(d)) continue;
      indeg.set(d, indeg.get(d) - 1);
      if(indeg.get(d) === 0) queue.push(d);
    }
  }

  const updated = [], failed = [], blocked = [];
  if(order.length < targets.size){
    /* graph.wouldCycle chặn từ lúc khai báo; tới đây là hỏng dữ liệu, báo rõ */
    for(const id of targets) if(!order.includes(id)){
      graph.node(id).error = "nằm trong vòng lặp phụ thuộc";
      failed.push({id, error: graph.node(id).error});
    }
  }

  for(const id of order){
    const n = graph.node(id);
    if(!n.rule){ graph.dirty.delete(id); continue; }          // nút nguồn: giá trị đã có
    const rule = RULES[n.rule];
    if(!rule){
      n.error = `không có quan hệ tên "${n.rule}"`;
      n.value = null; failed.push({id, error: n.error}); graph.dirty.delete(id); continue;
    }
    const inputs = n.inputs.map(i => graph.node(i).value);
    if(inputs.some(v => v === null || v === undefined)){
      n.error = "đầu vào chưa tính được";
      n.value = null; blocked.push({id, error: n.error}); graph.dirty.delete(id); continue;
    }
    try{
      const value = rule.compute(inputs, n.params);
      if(value === null || value === undefined) throw new Error("quan hệ không cho ra hình nào");
      n.value = value; n.error = null; updated.push(id);
    }catch(err){
      n.value = null; n.error = err.message;
      failed.push({id, error: err.message});
    }
    graph.dirty.delete(id);
  }
  return {order, updated, failed, blocked, ms: Date.now() - t0};
}

/* Giải lại từ đầu — dùng khi nạp file hoặc sau khi khôi phục undo */
export function solveAll(graph){
  graph.markAllDirty();
  return solve(graph);
}
