/* The least DOM a feature's mount() needs, for the tests of the empty workspace and of the host
   bridge (src/features/dxf/open.md). Elements hold children, listeners and ids; a listener is
   run by emit(). `window` is a stand-in whose parent is either itself (standalone) or a host that
   records what it is sent. Nothing here draws or lays out — the browser checks do that. */

export function withDom(fn, {framed = false, origin = "http://127.0.0.1:8765"} = {}){
  const ids = new Map(), globalListeners = new Map(), posted = [];
  class Element {
    constructor(tag){
      this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.listeners = {};
      this.attrs = new Map(); this.style = {}; this.hidden = false; this.textContent = ""; this.value = "";
      const cls = new Set();
      this.classList = {add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
                        toggle: (c, on = !cls.has(c)) => (on ? cls.add(c) : cls.delete(c), on)};
    }
    set id(v){ this._id = v; ids.set(v, this); } get id(){ return this._id; }
    set innerHTML(html){
      this.children = []; this._html = html;
      for(const m of html.matchAll(/<([a-z]+)\b([^>]*)>/g)){
        const e = new Element(m[1]); e.parent = this;
        for(const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) e.setAttribute(a[1], a[2]);
        this.children.push(e);
      }
      /* a <select> shows its first option until told otherwise */
      if(this.tagName === "SELECT" && this.children.length) this.value = this.children[0].getAttribute("value") ?? "";
    }
    get innerHTML(){ return this._html || ""; }
    setAttribute(k, v){ this.attrs.set(k, String(v)); if(k === "id") this.id = v; if(k === "for") this.htmlFor = String(v); if(k === "class") this.className = String(v); }
    getAttribute(k){ return this.attrs.get(k) ?? null; }
    appendChild(e){ e.parent = this; this.children.push(e); return e; }
    append(...es){ for(const e of es) this.appendChild(typeof e === "string" ? Object.assign(new Element("#text"), {textContent: e}) : e); }
    prepend(...es){ for(const e of es.reverse()){ e.parent = this; this.children.unshift(e); } }
    before(e){ const s = this.parent.children; e.parent = this.parent; s.splice(s.indexOf(this), 0, e); }
    remove(){ if(this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
    addEventListener(k, f){ (this.listeners[k] ||= []).push(f); }
    emit(k, ev = {}){ const e = {target: this, preventDefault(){}, stopPropagation(){}, ...ev}; for(const f of this.listeners[k] || []) f(e); return e; }
    click(){ this.emit("click"); }
    setPointerCapture(){}
    getBoundingClientRect(){ return {left: 0, top: 0, width: 900, height: 600}; }
    all(){ return this.children.flatMap(c => [c, ...c.all()]); }
  }
  const documentElement = new Element("html"), body = new Element("body");
  const doc = {
    documentElement, body,
    createElement: t => new Element(t), createElementNS: (ns, t) => new Element(t),
    getElementById: id => ids.get(id) || null,
    addEventListener(){}
  };
  const self = {location: {origin}, postMessage(){}};
  const host = {postMessage: (data, target) => posted.push({data, target})};
  self.parent = framed ? host : self;

  /* a File whose bytes the stand-in FileReader hands back at once — so a test can follow a file all
     the way to ctx.load without waiting */
  const bytes = new WeakMap();
  const file = (text, name) => { const f = new File([text], name, {type: "application/dxf"});
                                 bytes.set(f, new TextEncoder().encode(text).buffer); return f; };
  class FileReader { readAsArrayBuffer(f){ this.result = bytes.get(f); this.onload(); } }

  const saved = ["document", "window", "addEventListener", "FileReader"].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  const put = (k, value) => Object.defineProperty(globalThis, k, {value, writable: true, configurable: true});
  put("document", doc); put("window", self); put("FileReader", FileReader);
  put("addEventListener", (k, f) => { (globalListeners.get(k) || globalListeners.set(k, []).get(k)).push(f); });
  const ui = {bar: new Element("header"), rail: new Element("aside"), stage: new Element("div"),
              tools: new Element("div"), status: new Element("footer"), svg: new Element("svg")};
  ui.stage.append(ui.tools, ui.svg);
  const api = {
    ui, doc, self, host, posted, file, byId: id => ids.get(id) || null,
    /* a window-level event (message, resize) as the browser would dispatch it */
    fire(kind, ev){ for(const f of globalListeners.get(kind) || []) f(ev); }
  };
  try{ return fn(api); }
  finally{ for(const [k, d] of saved){ if(d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } }
}

/* a ctx with no file open, recording what features ask of it */
export function emptyCtx(){
  const loads = [], hooks = [];
  const ctx = {
    model: null, fileName: "", selection: new Set(), primary: -1, snap: null,
    pieces(){ return ctx.model ? ctx.model.pieces : []; },
    shownUnit: () => null, snapTol: () => null,
    select(){}, draw(){}, refresh(){},
    onLoad: f => hooks.push(f), loads,
    /* what ctx.load does, as far as the importer can tell: a model arrives and every hook runs */
    load(text, fileName, opts){ loads.push({text, fileName, opts}); ctx.fileName = fileName;
                                ctx.model = {pieces: [{}, {}], units: {unit: "mm", source: "AAMA", declared: "METRIC"}, warnings: []};
                                for(const f of hooks) f(ctx); }
  };
  return ctx;
}
