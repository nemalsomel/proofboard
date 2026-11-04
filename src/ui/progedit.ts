/**
 * Csomópontos programszerkesztő (Vezérlés nézet). Önálló komponens: a gazdától (EditorHost) kapja a programot,
 * a választható lábakat és a futás közbeni értékeket, a változásokat neki adja vissza. Így ugyanaz a szerkesztő
 * kerülhet fülre, osztott nézetbe vagy teljes képernyőre.
 *
 * Kezelés: csomópont a „+ Csomópont” menüből; él kimenetről bemenetre húzással, vagy érintéssel (kimenet, majd
 * bemenet); csomópont húzása a fejlécénél; üres helyen húzva a vászon mozog, görgővel nagyít.
 */
import { icon } from './icons';
import { NODE_DEFS, type NodeDef, type PEdge, type PNode, type Program, type Val } from '../engine/program';

export interface PinChoice { ref: string; part: string; name: string; gpio: string | null }
export interface ProgLive { running: boolean; vals: Record<string, Val>; errors: Record<string, string> }
export interface ProgHost {
  get(): Program | null;
  /** Új program (visszavonható lépés). `layoutOnly`: csak a csomópontok helye változott. */
  set(p: Program, layoutOnly: boolean): void;
  pins(): PinChoice[];
  live(): ProgLive | null;
  running(): boolean;
  sim(on: boolean): void;
  /** Láb kiemelése a panelon (vagy null). */
  highlight(ref: string | null): void;
  /** A kijelölt csomópont változott (pl. a kód fül kiemeléséhez). */
  onSelect?(id: string | null): void;
}
export interface ProgEditor { refresh(): void; live(): void; select(id: string | null): void; fit(): void }

const W = 184, HEAD = 26, ROW = 22, SUM = 16;
const CATS: NodeDef['cat'][] = ['Bemenet', 'Logika', 'Idő', 'Kimenet'];
const CAT_COL: Record<string, string> = { Bemenet: '#1c7ed6', Logika: '#7048e8', Idő: '#2f9e44', Kimenet: '#e8590c' };
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
const fmt = (v: Val | undefined): string => (v === undefined ? '–' : typeof v === 'boolean' ? (v ? '1' : '0') : String(Math.round(v * 100) / 100));

export function mountProgEditor(root: HTMLElement, host: ProgHost): ProgEditor {
  root.classList.add('pg');
  root.innerHTML = `
    <div class="pg-bar" role="toolbar" aria-label="Program">
      <div class="pg-add"><button class="btn" data-pg="add" aria-haspopup="true" aria-expanded="false">+ Csomópont</button><div class="pg-menu" hidden></div></div>
      <button class="btn" data-pg="del" disabled title="A kijelölt csomópont vagy él törlése (Delete)">Törlés</button>
      <span class="pg-sp"></span>
      <button class="btn" data-pg="zout" aria-label="Kicsinyítés">−</button><button class="btn" data-pg="zin" aria-label="Nagyítás">+</button>
      <button class="btn" data-pg="fit" title="Az egész program látszódjon">Mind</button>
      <button class="btn" data-pg="run"></button>
    </div>
    <div class="pg-canvas" tabindex="0" aria-label="Programvászon">
      <div class="pg-layer"><svg class="pg-edges" width="1" height="1"></svg><div class="pg-nodes"></div></div>
      <p class="pg-empty" hidden>Még nincs program. A <b>+ Csomópont</b> menüből rakj le egy bemenetet (pl. gomb) és egy kimenetet (pl. LED), majd húzz élt a kimeneti pontjától a bemeneti pontig.</p>
    </div>
    <aside class="pg-props" hidden></aside>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const canvas = $<HTMLDivElement>('.pg-canvas'), layer = $<HTMLDivElement>('.pg-layer'), nodesEl = $<HTMLDivElement>('.pg-nodes');
  const svg = root.querySelector('.pg-edges') as SVGSVGElement, props = $<HTMLElement>('.pg-props'), menu = $<HTMLDivElement>('.pg-menu');
  let prog: Program = { nodes: [], edges: [] };
  let view = { x: 20, y: 20, z: 1 }, fitted = false;
  let sel: { kind: 'node' | 'edge'; id: string } | null = null;
  let pending: string | null = null; // érintéses kötés: a kiválasztott kimenet
  let drag: null | { kind: 'move'; id: string; x0: number; y0: number; nx: number; ny: number; moved: boolean }
    | { kind: 'pan'; x0: number; y0: number; vx: number; vy: number }
    | { kind: 'wire'; from: string; x0: number; y0: number; moved: boolean } = null;
  let tmp: { x: number; y: number } | null = null;
  let pinCache: PinChoice[] = [], liveKey = '', selfEdit = false, sig = '';

  const node = (id: string) => prog.nodes.find(n => n.id === id);
  const rows = (d: NodeDef) => Math.max(d.ins.length, d.outs.length, 1);
  const portPos = (n: PNode, side: 'in' | 'out', port: string): [number, number] => {
    const d = NODE_DEFS[n.type], list = side === 'in' ? d.ins : d.outs, i = Math.max(0, list.findIndex(p => p.id === port));
    return [n.x + (side === 'in' ? 0 : W), n.y + HEAD + 4 + i * ROW + ROW / 2];
  };
  const toWorld = (cx: number, cy: number): [number, number] => { const r = canvas.getBoundingClientRect(); return [(cx - r.left - view.x) / view.z, (cy - r.top - view.y) / view.z]; };
  const nextId = (pre: string, list: Array<{ id: string }>) => { let i = 1; while (list.some(x => x.id === pre + i)) i++; return pre + i; };
  const save = (layoutOnly = false) => { selfEdit = !layoutOnly; host.set(JSON.parse(JSON.stringify(prog)), layoutOnly); };
  const pinLabel = (ref: unknown) => {
    if (typeof ref !== 'string' || !ref) return 'nincs láb kiválasztva';
    const c = pinCache.find(p => p.ref === ref);
    return c ? `${c.part}.${c.name}${c.gpio ? ' → ' + c.gpio : ' (nincs GPIO-n)'}` : 'ismeretlen láb';
  };
  const summary = (n: PNode): string[] => {
    const d = NODE_DEFS[n.type], out: string[] = [];
    for (const pr of d.params) {
      const v = n.props[pr.key];
      if (pr.type === 'pin') out.push(pinLabel(v));
      else if (pr.type === 'select') out.push(`${pr.label}: ${(pr.options || []).find(o => o[0] === v)?.[1] ?? v}`);
      else out.push(`${pr.label}: ${v}${pr.unit ? ' ' + pr.unit : ''}`);
    }
    return out;
  };

  function applyView() { layer.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`; }

  function renderMenu() {
    menu.innerHTML = CATS.map(c => `<div class="pg-mcat" style="--c:${CAT_COL[c]}">${c}</div>` + Object.entries(NODE_DEFS).filter(([, d]) => d.cat === c)
      .map(([k, d]) => `<button class="pg-mitem" data-add="${k}" title="${esc(d.help)}">${esc(d.label)}</button>`).join('')).join('');
  }

  function renderEdges() {
    const live = host.live(), on = !!live && live.running;
    let h = '';
    for (const e of prog.edges) {
      const [fn, fp] = [e.from.slice(0, e.from.lastIndexOf('.')), e.from.slice(e.from.lastIndexOf('.') + 1)];
      const [tn, tp] = [e.to.slice(0, e.to.lastIndexOf('.')), e.to.slice(e.to.lastIndexOf('.') + 1)];
      const a = node(fn), b = node(tn);
      if (!a || !b) continue;
      const [x1, y1] = portPos(a, 'out', fp), [x2, y2] = portPos(b, 'in', tp), dx = Math.max(40, Math.abs(x2 - x1) / 2);
      const d = `M${x1} ${y1} C${x1 + dx} ${y1},${x2 - dx} ${y2},${x2} ${y2}`;
      const v = on ? live!.vals[e.from] : undefined, hot = on && (v === true || (typeof v === 'number' && v > 0.5));
      const s = sel && sel.kind === 'edge' && sel.id === e.id;
      h += `<path class="pg-hit" d="${d}" data-edge="${e.id}"/><path class="pg-edge${hot ? ' hot' : ''}${s ? ' sel' : ''}" data-ev="${e.id}" d="${d}"/>`;
      if (on) h += `<text class="pg-eval" data-et="${e.id}" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 5}">${fmt(v)}</text>`;
    }
    if (drag && drag.kind === 'wire' && tmp) {
      const [fn, fp] = [drag.from.slice(0, drag.from.lastIndexOf('.')), drag.from.slice(drag.from.lastIndexOf('.') + 1)], a = node(fn);
      if (a) { const [x1, y1] = portPos(a, 'out', fp), dx = Math.max(40, Math.abs(tmp.x - x1) / 2); h += `<path class="pg-edge tmp" d="M${x1} ${y1} C${x1 + dx} ${y1},${tmp.x - dx} ${tmp.y},${tmp.x} ${tmp.y}"/>`; }
    }
    svg.innerHTML = h;
  }

  function renderNodes() {
    const live = host.live(), on = !!live && live.running;
    nodesEl.innerHTML = prog.nodes.map(n => {
      const d = NODE_DEFS[n.type], err = live && live.errors[n.id], s = sel && sel.kind === 'node' && sel.id === n.id;
      const R = rows(d), sm = summary(n);
      const ports = Array.from({ length: R }, (_, i) => {
        const pi = d.ins[i], po = d.outs[i];
        const vin = pi && on ? live!.vals[prog.edges.find(e => e.to === n.id + '.' + pi.id)?.from || ''] : undefined;
        const vout = po && on ? live!.vals[n.id + '.' + po.id] : undefined;
        return `<div class="pg-row">${pi ? `<span class="pg-port in ${pi.kind}${pending ? ' can' : ''}" data-port="${n.id}.${pi.id}" title="${esc(pi.label)}"></span><span class="pg-pl">${esc(pi.label)}${on ? ` <b data-vin="${n.id}.${pi.id}">${fmt(vin)}</b>` : ''}</span>` : '<span></span><span></span>'}`
          + `${po ? `<span class="pg-pr">${on ? `<b data-v="${n.id}.${po.id}">${fmt(vout)}</b> ` : ''}${esc(po.label)}</span><span class="pg-port out ${po.kind}${pending === n.id + '.' + po.id ? ' pend' : ''}" data-port="${n.id}.${po.id}" title="${esc(po.label)}"></span>` : '<span></span><span></span>'}</div>`;
      }).join('');
      return `<div class="pg-node${s ? ' sel' : ''}${err ? ' err' : ''}" data-node="${n.id}" style="left:${n.x}px;top:${n.y}px;width:${W}px;--c:${CAT_COL[d.cat]}">
        <div class="pg-head" data-drag="${n.id}">${icon('grip', 'pg-grip')}<span>${esc(d.label)}</span></div>${ports}
        <div class="pg-sum">${sm.map(x => `<div style="height:${SUM}px">${esc(x)}</div>`).join('')}${err ? `<div class="pg-err">${esc(err)}</div>` : ''}</div></div>`;
    }).join('');
    $<HTMLElement>('.pg-empty').hidden = prog.nodes.length > 0;
  }

  function renderProps() {
    const n = sel && sel.kind === 'node' ? node(sel.id) : null;
    $<HTMLButtonElement>('[data-pg="del"]').disabled = !sel;
    if (!n) { props.hidden = true; props.innerHTML = ''; return; }
    const d = NODE_DEFS[n.type], live = host.live(), err = live && live.errors[n.id];
    const groups = new Map<string, PinChoice[]>();
    for (const p of pinCache) { if (!groups.has(p.part)) groups.set(p.part, []); groups.get(p.part)!.push(p); }
    props.hidden = false;
    props.innerHTML = `<p class="h" style="margin:0 0 4px;color:${CAT_COL[d.cat]}">${esc(d.cat)}</p><p style="margin:0 0 6px;font-weight:600">${esc(d.label)}</p>
      <p class="help" style="margin:0 0 8px">${esc(d.help)}</p>
      ${d.params.map(pr => {
        const id = 'pgp_' + pr.key, v = n.props[pr.key];
        if (pr.type === 'pin') return `<label class="small" for="${id}">${esc(pr.label)}</label><select id="${id}" data-pp="${pr.key}"><option value="">– válassz lábat –</option>${[...groups].map(([g, ps]) =>
          `<optgroup label="${esc(g)}">${ps.map(p => `<option value="${esc(p.ref)}" ${p.ref === v ? 'selected' : ''}>${esc(p.name)}${p.gpio ? ' → ' + esc(p.gpio) : ' (nincs GPIO-n)'}</option>`).join('')}</optgroup>`).join('')}</select>`;
        if (pr.type === 'select') return `<label class="small" for="${id}">${esc(pr.label)}</label><select id="${id}" data-pp="${pr.key}">${(pr.options || []).map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
        return `<label class="small" for="${id}">${esc(pr.label)}</label><div class="row"><input type="number" id="${id}" data-pp="${pr.key}" value="${esc(v)}" ${pr.min != null ? `min="${pr.min}"` : ''} ${pr.max != null ? `max="${pr.max}"` : ''} step="any" style="width:96px"><span class="muted small">${esc(pr.unit || '')}</span></div>`;
      }).join('')}
      ${err ? `<p class="pg-err" style="margin-top:6px">${esc(err)}</p>` : ''}
      <div class="row" style="margin-top:8px"><button class="btn danger" data-pg="del">Csomópont törlése</button></div>`;
  }

  function render() { applyView(); renderNodes(); renderEdges(); renderProps(); renderRun(); }
  function renderRun() { const b = $<HTMLButtonElement>('[data-pg="run"]'), on = host.running(); b.textContent = on ? '■ Leállítás' : '▶ Futtatás'; b.classList.toggle('on', on); }

  function addNode(type: string) {
    const r = canvas.getBoundingClientRect(), [wx, wy] = toWorld(r.left + r.width / 2 - W / 2 * view.z, r.top + r.height / 3);
    const d = NODE_DEFS[type], p: Record<string, unknown> = {};
    for (const pr of d.params) p[pr.key] = pr.default;
    let x = Math.round(wx), y = Math.round(wy);
    while (prog.nodes.some(n => Math.abs(n.x - x) < 20 && Math.abs(n.y - y) < 20)) { x += 24; y += 24; }
    const n: PNode = { id: nextId('n', prog.nodes), type, x, y, props: p };
    prog.nodes.push(n); sel = { kind: 'node', id: n.id }; save(); render();
  }
  function connect(from: string, to: string) {
    if (from.slice(0, from.lastIndexOf('.')) === to.slice(0, to.lastIndexOf('.')) && NODE_DEFS[node(from.slice(0, from.lastIndexOf('.')))!.type].ins.length === 0) return;
    prog.edges = prog.edges.filter(e => e.to !== to); // egy bemenetre egy él
    const e: PEdge = { id: nextId('e', prog.edges), from, to };
    prog.edges.push(e); save();
  }
  function delSel() {
    if (!sel) return;
    if (sel.kind === 'node') { const id = sel.id; prog.nodes = prog.nodes.filter(n => n.id !== id); prog.edges = prog.edges.filter(e => !e.from.startsWith(id + '.') && !e.to.startsWith(id + '.')); }
    else { const id = sel.id; prog.edges = prog.edges.filter(e => e.id !== id); }
    sel = null; host.highlight(null); save(); render();
  }
  function select(s: typeof sel) {
    sel = s; const n = s && s.kind === 'node' ? node(s.id) : null;
    if (host.onSelect) host.onSelect(n ? n.id : null);
    const pin = n && NODE_DEFS[n.type].params.find(p => p.type === 'pin');
    host.highlight(pin ? String(n!.props[pin.key] || '') || null : null);
    renderNodes(); renderEdges(); renderProps();
  }
  function fit() {
    const r = canvas.getBoundingClientRect();
    if (!prog.nodes.length || !r.width) { view = { x: 20, y: 20, z: 1 }; applyView(); return; }
    const x0 = Math.min(...prog.nodes.map(n => n.x)), y0 = Math.min(...prog.nodes.map(n => n.y));
    const x1 = Math.max(...prog.nodes.map(n => n.x + W)), y1 = Math.max(...prog.nodes.map(n => n.y + HEAD + 4 + rows(NODE_DEFS[n.type]) * ROW + 3 * SUM + 12));
    const z = Math.max(0.75, Math.min(1.1, Math.min((r.width - 40) / (x1 - x0), (r.height - 40) / (y1 - y0)))); // olvasható marad; ami nem fér ki, húzással elérhető
    view = { z, x: Math.max(16 - x0 * z, (r.width - (x1 - x0) * z) / 2 - x0 * z), y: Math.max(16 - y0 * z, (r.height - (y1 - y0) * z) / 3 - y0 * z) };
    applyView(); fitted = true;
  }
  function zoom(f: number, cx?: number, cy?: number) {
    const r = canvas.getBoundingClientRect(), px = cx ?? r.left + r.width / 2, py = cy ?? r.top + r.height / 2;
    const [wx, wy] = toWorld(px, py), z = Math.max(0.3, Math.min(2.5, view.z * f));
    view = { z, x: px - r.left - wx * z, y: py - r.top - wy * z }; applyView();
  }

  // ---------- események ----------
  root.addEventListener('click', e => {
    const t = e.target as HTMLElement, b = t.closest('[data-pg]') as HTMLElement | null, add = t.closest('[data-add]') as HTMLElement | null;
    if (add) { menu.hidden = true; $<HTMLElement>('[data-pg="add"]').setAttribute('aria-expanded', 'false'); addNode(add.dataset.add!); return; }
    if (!b) { if (!t.closest('.pg-add')) menu.hidden = true; return; }
    const a = b.dataset.pg;
    if (a === 'add') { menu.hidden = !menu.hidden; b.setAttribute('aria-expanded', String(!menu.hidden)); }
    else if (a === 'del') delSel();
    else if (a === 'zin') zoom(1.2); else if (a === 'zout') zoom(1 / 1.2); else if (a === 'fit') fit();
    else if (a === 'run') { host.sim(!host.running()); renderRun(); }
  });
  props.addEventListener('change', e => {
    const t = e.target as HTMLInputElement | HTMLSelectElement, k = t.dataset.pp, n = sel && sel.kind === 'node' ? node(sel.id) : null;
    if (!k || !n) return;
    const pr = NODE_DEFS[n.type].params.find(p => p.key === k)!;
    let v: unknown = t.value;
    if (pr.type === 'number') { const x = Number(t.value); if (!isFinite(x)) { renderProps(); return; } v = Math.max(pr.min ?? -Infinity, Math.min(pr.max ?? Infinity, x)); }
    n.props[k] = v; save();
    if (pr.type === 'pin') host.highlight(String(v) || null);
    renderNodes(); renderEdges(); renderProps();
  });
  canvas.addEventListener('pointerdown', e => {
    // középső gomb: a vászon mozgatása bárhonnan (csomópont fölött is)
    if (e.button === 1) { e.preventDefault(); drag = { kind: 'pan', x0: e.clientX, y0: e.clientY, vx: view.x, vy: view.y }; canvas.setPointerCapture(e.pointerId); return; }
    if (e.button !== 0) return;
    const t = e.target as Element, port = t.closest('[data-port]') as HTMLElement | null, edge = t.closest('[data-edge]') as Element | null, head = t.closest('.pg-node') as HTMLElement | null;
    menu.hidden = true; canvas.focus({ preventScroll: true });
    if (port) {
      const ref = port.dataset.port!;
      if (port.classList.contains('out')) { drag = { kind: 'wire', from: ref, x0: e.clientX, y0: e.clientY, moved: false }; root.classList.add('wiring'); canvas.setPointerCapture(e.pointerId); return; }
      if (pending) { connect(pending, ref); pending = null; render(); return; }
      const ed = prog.edges.find(x => x.to === ref); if (ed) select({ kind: 'edge', id: ed.id });
      return;
    }
    if (pending) { pending = null; renderNodes(); }
    if (edge) { select({ kind: 'edge', id: (edge as HTMLElement).dataset.edge! }); return; }
    if (head) {
      const n = node(head.dataset.node!)!;
      if (!sel || sel.kind !== 'node' || sel.id !== n.id) select({ kind: 'node', id: n.id });
      // a csomópont bárhol megfogható, ahol nincs interaktív elem (a port fent már elkapta)
      drag = { kind: 'move', id: n.id, x0: e.clientX, y0: e.clientY, nx: n.x, ny: n.y, moved: false }; canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (sel) select(null);
    drag = { kind: 'pan', x0: e.clientX, y0: e.clientY, vx: view.x, vy: view.y }; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.kind === 'pan') { view.x = drag.vx + e.clientX - drag.x0; view.y = drag.vy + e.clientY - drag.y0; applyView(); return; }
    if (drag.kind === 'move') {
      const n = node(drag.id); if (!n) return;
      const dx = (e.clientX - drag.x0) / view.z, dy = (e.clientY - drag.y0) / view.z;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true; n.x = Math.round(drag.nx + dx); n.y = Math.round(drag.ny + dy);
      const el = nodesEl.querySelector(`[data-node="${n.id}"]`) as HTMLElement | null; if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
      renderEdges(); return;
    }
    if (drag.kind === 'wire') {
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
      drag.moved = true; const [x, y] = toWorld(e.clientX, e.clientY); tmp = { x, y }; renderEdges();
    }
  });
  const end = (e: PointerEvent) => {
    const d = drag; drag = null; tmp = null; root.classList.remove('wiring');
    if (!d) return;
    if (d.kind === 'move' && d.moved) save(true);
    if (d.kind === 'wire') {
      if (!d.moved) { pending = pending === d.from ? null : d.from; renderNodes(); renderEdges(); return; } // érintés: kimenet kiválasztva, a következő bemenetre köt
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-port]') as HTMLElement | null;
      if (over && over.classList.contains('in')) connect(d.from, over.dataset.port!);
      render();
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', () => { drag = null; tmp = null; root.classList.remove('wiring'); renderEdges(); });
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY); }, { passive: false });
  root.addEventListener('keydown', e => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); delSel(); }
    else if (e.key === 'Escape') { pending = null; menu.hidden = true; select(null); }
  });
  renderMenu();

  return {
    refresh() {
      const p = host.get();
      prog = p ? JSON.parse(JSON.stringify(p)) : { nodes: [], edges: [] };
      if (sel && !(sel.kind === 'node' ? node(sel.id) : prog.edges.find(e => e.id === sel!.id))) sel = null;
      pinCache = host.pins();
      // kívülről jött másik program (példa, megnyitás): újra igazítás; a saját szerkesztésnél a nézet marad
      const ns = prog.nodes.map(n => n.id + ':' + n.type).sort().join(',');
      if (!selfEdit && ns !== sig) fitted = false;
      sig = ns; selfEdit = false;
      if (!fitted && prog.nodes.length && canvas.getBoundingClientRect().width) fit();
      render();
    },
    live() {
      // futás közben csak az értékek frissülnek (a DOM marad, így a kattintás és a húzás nem szakad meg)
      const L = host.live(), on = !!L && L.running, key = JSON.stringify([on, L ? L.errors : null]);
      if (key !== liveKey || drag) { liveKey = key; if (!drag) { renderNodes(); renderEdges(); renderProps(); } renderRun(); return; }
      if (!L) return;
      const from = new Map(prog.edges.map(e => [e.to, e.from]));
      nodesEl.querySelectorAll<HTMLElement>('[data-v]').forEach(b => { b.textContent = fmt(L.vals[b.dataset.v!]); });
      nodesEl.querySelectorAll<HTMLElement>('[data-vin]').forEach(b => { b.textContent = fmt(L.vals[from.get(b.dataset.vin!) || '']); });
      for (const e of prog.edges) {
        const v = L.vals[e.from], hot = v === true || (typeof v === 'number' && v > 0.5);
        svg.querySelector(`[data-ev="${e.id}"]`)?.classList.toggle('hot', hot);
        const t = svg.querySelector(`[data-et="${e.id}"]`); if (t) t.textContent = fmt(v);
      }
    },
    select(id) { select(id ? { kind: 'node', id } : null); },
    fit() { fitted = false; fit(); },
  };
}
