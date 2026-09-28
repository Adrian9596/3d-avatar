/* Lớp 2a — đồ thị phụ thuộc. Chỉ là cấu trúc dữ liệu: nút, cạnh, cờ bẩn, phát hiện
   vòng lặp. Không biết gì về hình học — nhờ vậy test được riêng và solver thay được.

   Hai loại nút:
     • nguồn   — có value, người dùng sửa trực tiếp
     • dẫn xuất — value do rule(inputs, params) tính ra; sửa tay là vô nghĩa

   Sửa một nút nguồn thì mọi nút phía dưới nó bị đánh bẩn, chờ solver tính lại. */

let seq = 0;

export function createGraph(){
  const nodes = new Map();            // id -> {id, value, rule, inputs, params, meta, error}
  const out = new Map();              // id -> Set(id phụ thuộc vào nó)
  const dirty = new Set();

  const g = {
    addSource(value, meta = {}){
      const id = meta.id || `n${++seq}`;
      nodes.set(id, {id, value, rule: null, inputs: [], params: {}, meta, error: null});
      out.set(id, new Set());
      return id;
    },
    addDerived(rule, inputs, params = {}, meta = {}){
      for(const i of inputs) if(!nodes.has(i)) throw new Error(`đầu vào không tồn tại: ${i}`);
      const id = meta.id || `n${++seq}`;
      if(g.wouldCycle(id, inputs)) throw new Error("quan hệ này tạo vòng lặp");
      nodes.set(id, {id, value: null, rule, inputs: inputs.slice(), params, meta, error: null});
      out.set(id, new Set());
      for(const i of inputs) out.get(i).add(id);
      dirty.add(id);
      return id;
    },

    node: id => nodes.get(id),
    has: id => nodes.has(id),
    ids: () => [...nodes.keys()],
    isSource: id => !nodes.get(id).rule,
    dependents: id => [...(out.get(id) || [])],

    /* mọi nút chịu ảnh hưởng, kể cả gián tiếp */
    descendants(id){
      const seen = new Set(), stack = [...(out.get(id) || [])];
      while(stack.length){
        const n = stack.pop();
        if(seen.has(n)) continue;
        seen.add(n);
        stack.push(...(out.get(n) || []));
      }
      return [...seen];
    },

    setValue(id, value){
      const n = nodes.get(id);
      if(!n) throw new Error(`không có nút ${id}`);
      if(n.rule) throw new Error(`${id} là nút dẫn xuất — sửa nút nguồn của nó, đừng sửa nó`);
      n.value = value;
      n.error = null;
      for(const d of g.descendants(id)) dirty.add(d);
      return id;
    },

    /* thêm cạnh inputs -> id có tạo vòng không */
    wouldCycle(id, inputs){
      const stack = [...inputs];
      const seen = new Set();
      while(stack.length){
        const n = stack.pop();
        if(n === id) return true;
        if(seen.has(n)) continue;
        seen.add(n);
        const node = nodes.get(n);
        if(node) stack.push(...node.inputs);
      }
      return false;
    },

    remove(id){
      const deps = g.dependents(id);
      if(deps.length) throw new Error(`${id} đang được ${deps.join(", ")} dùng`);
      for(const i of (nodes.get(id)?.inputs || [])) out.get(i)?.delete(id);
      nodes.delete(id); out.delete(id); dirty.delete(id);
    },

    dirty,
    markDirty: id => dirty.add(id),
    markAllDirty(){ for(const [id, n] of nodes) if(n.rule) dirty.add(id); },
  };
  return g;
}
