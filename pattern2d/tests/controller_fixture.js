/* A minimal event/element host for the REAL dock and controller. No geometry, input
   validation or tool actions are mocked. Canvas drawing is omitted; pointer input
   is already in world mm. Browser checks cover native focus, layout and downloads. */
import {block36Text} from "./data.js";
import {Canvas} from "../src/features/canvas/canvas.js";
import {Readout} from "../src/features/readout/readout.js";
import {Draw} from "../src/features/draw/draw.js";
import {Edit} from "../src/features/edit/edit.js";
import {parseDXF} from "../src/features/dxf/parse.js";
import {buildModel} from "../src/features/dxf/model.js";
import {lengthFormatter} from "../src/shared/units.js";

export function controllerFixture(which = "draw", opts = {}){
  /* read the data first: a NeedsData thrown after the replace() calls below would leave the fake document in place for every later test.
     opts.model: a model built by hand (tests/edit_fixtures.js) — then no data is read at all */
  const text36 = opts.model ? null : block36Text();
  const saved = new Map();
  const replace = (obj, key, value) => { const descriptor = Object.getOwnPropertyDescriptor(obj, key); saved.set([obj, key], descriptor); Object.defineProperty(obj, key, {value, writable: true, configurable: true}); };
  const ids = new Map(), downloads = [], keys = new Map(), loads = [], after = [], providers = [], tools = new Map(), exports = [], changed = [], layers = [];
  let active = which, tick = 0;
  class Element {
    constructor(tag){ this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.dataset = {}; this.children = []; this.listeners = {}; this.value = ""; this.title = ""; this.disabled = false; this.classList = {toggle(){}, add(){}, remove(){}}; }
    set id(v){ this._id = v; ids.set(v, this); } get id(){ return this._id; }
    setAttribute(k, v){ this.attrs.set(k, String(v)); if(k === 'id') this.id = v; else if(k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); else if(k === 'title' || k === 'value') this[k] = String(v); }
    getAttribute(k){ return this.attrs.get(k) ?? null; }
    hasAttribute(k){ return this.attrs.has(k); }
    removeAttribute(k){ this.attrs.delete(k); }
    set innerHTML(html){
      this.children = [];
      for(const match of html.matchAll(/<([a-z]+)\b([^>]*)>/g)){
        const e = new Element(match[1]); e.parent = this;
        for(const a of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) e.setAttribute(a[1], a[2]);
        this.children.push(e);
      }
    }
    appendChild(e){ this.children.push(e); e.parent = this; return e; }
    append(...es){ es.forEach(e => this.appendChild(e)); }
    remove(){}
    matches(selector){ return selector.split(',').some(s => {
      s = s.trim(); if(s.startsWith('#')) return this.id === s.slice(1);
      const m = /^\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]$/.exec(s);
      return m ? this.hasAttribute(m[1]) && (m[2] === undefined || this.getAttribute(m[1]) === m[2]) : this.tagName.toLowerCase() === s;
    }); }
    closest(s){ return this.matches(s) ? this : this.parent?.closest(s) || null; }
    querySelectorAll(s){ return this.children.flatMap(e => [e, ...e.querySelectorAll('*')]).filter(e => s === '*' || e.matches(s)); }
    querySelector(s){ return this.querySelectorAll(s)[0] || null; }
    addEventListener(k, fn){ (this.listeners[k] ||= []).push(fn); }
    emit(k, extra = {}){ const ev = {target:this, key:'', preventDefault(){}, stopImmediatePropagation(){}, ...extra}; for(const fn of this.listeners[k] || []) fn(ev); if(k === 'click' && this.parent) for(const fn of this.parent.listeners[k] || []) fn(ev); }
    click(){ if(this.tagName === 'A') downloads.push({name:this.download, href:this.href}); else if(!this.disabled) this.emit('click'); }
    focus(){ document.activeElement = this; }
    blur(){ document.activeElement = null; }
    select(){ this.focus(); }
  }
  const doc = {createElement: tag => new Element(tag), createElementNS: (ns, tag) => new Element(tag), getElementById: id => ids.get(id), activeElement:null, body:new Element('body')};
  replace(globalThis, 'document', doc);
  replace(globalThis, 'addEventListener', (k, fn) => { (keys.get(k) || keys.set(k, []).get(k)).push(fn); });
  replace(globalThis, 'setTimeout', () => 0);
  replace(URL, 'createObjectURL', () => 'blob:controller-test'); replace(URL, 'revokeObjectURL', () => {});
  const ui = {stage:new Element('div'), tools:new Element('div')};
  for(const [key, fn] of Object.entries({
    toolButton: () => new Element('button'), tool:(n, h) => tools.set(n, h), layer:fn => layers.push(fn), pxPerMM:() => 8,
    afterDraw:fn => after.push(fn), status(){}, activeTool:() => active, pickMM:() => 1,
    dragged:(a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]) > .1,
    setTool:(name, c) => { tools.get(active)?.onExit?.(); active=name; c.draw(); }
  })) replace(Canvas, key, fn);
  replace(Readout, 'section', fn => providers.push(fn));
  const model = opts.model || buildModel(parseDXF(text36));
  const ctx = {
    model, fileName:'BLOCK_36C.dxf', primary:-1, selection:new Set(), layersOn:{'1':true,'2':true,'3':true,'4':true,'5':true,'7':true,'8':true},
    pieces:() => ctx.model.pieces, shownUnit:() => 'mm', len:lengthFormatter('mm'), snapTol:() => .5,
    onLoad:fn => loads.push(fn), onUnit(){}, onPieces:fn => changed.push(fn), onEdit(){}, key(){}, edited(){},
    draw(){ after.forEach(fn => fn(ctx)); }, refresh(){ ctx.draw(); },
    select(indices, primary){ ctx.selection = new Set(indices); ctx.primary=primary; },
    onExport:fn => exports.push(fn), exportModel:() => exports.reduce((m,fn) => fn(m),ctx.model)
  };
  const tool = which === 'draw' ? Draw : Edit;
  tool.mount(ctx, ui); loads.forEach(fn => fn(ctx));
  const dock = ids.get(which === 'draw' ? 'drawdock' : 'editdock');
  const api = {
    ctx, tool, downloads, dock,
    input(id, value){ const e = ids.get(id); e.focus(); e.value=String(value); e.emit('input'); return e; },
    enter(id){ const e=ids.get(id); e.focus(); e.emit('keydown',{key:'Enter'}); },
    mode(name){ dock.querySelector(`[data-mode=${name}]`).click(); },
    act(name){ dock.querySelector(`[data-act=${name}]`).click(); },
    pointer(w){ tick += 1000; tools.get(which).onDown({button:0,timeStamp:tick,clientX:w[0],clientY:w[1]},w,ctx); tools.get(which).onUp?.({},ctx); },
    hover(w){ tools.get(which).onMove({shiftKey:false},w,ctx); },
    /* a press at a, the pointer to b, released — pxPerMM is 8 here, as pickMM (1 mm = 8 px) says */
    drag(a, b){ tick += 1000; const t = tools.get(which); t.onDown({button:0,timeStamp:tick,clientX:a[0],clientY:a[1]},a,ctx); t.onMove({shiftKey:false},b,ctx); t.onUp?.({},ctx); },
    /* the tool's draw layers into a group of the fake elements: its children are what a frame would paint */
    paint(){ const root = new Element('g'); layers.forEach(fn => fn(root, 8, ctx)); return root; },
    key(key, extra={}){ for(const fn of keys.get('keydown') || []) fn({key,target:doc.body,preventDefault(){},stopImmediatePropagation(){},...extra}); },
    /* the Bút needs a press, the pointer moved and a release apart — each with the keys held, the press with its time
       (a double-click, a ⇧ drag); clientX/Y are the mm themselves, as everywhere in this fixture */
    press(w, extra={}){ tick += 1000; tools.get(which).onDown({button:0,timeStamp:tick,clientX:w[0],clientY:w[1],shiftKey:false,...extra},w,ctx); },
    move(w, extra={}){ tools.get(which).onMove({shiftKey:false,...extra},w,ctx); },
    release(extra={}){ tools.get(which).onUp?.({...extra},ctx); },
    field:id => ids.get(id),
    rows:() => providers.flatMap(fn => fn(ctx)?.rows || []),
    state:() => JSON.stringify(which === 'draw' ? {shapes:Draw.shapes(ctx),undo:Draw.undoCount()} : ctx.model),
    piecesChanged:() => changed.forEach(fn => fn(ctx)),
    close(){ for(const [[obj,key],descriptor] of [...saved].reverse()){ if(descriptor) Object.defineProperty(obj,key,descriptor); else delete obj[key]; } }
  };
  api.mode(which === 'draw' ? 'select' : 'drag'); ctx.draw();
  return api;
}

export function withController(which, fn, opts){ const f=controllerFixture(which, opts); try{ fn(f); }finally{ f.close(); } }
