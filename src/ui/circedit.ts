/**
 * Belső kapcsolás szerkesztője (Alkatrész-szerkesztő, Működés fül): csomópontok és élek, a programszerkesztő
 * kezelésével. Elem a „+ Elem” menüből; él kimenetről bemenetre húzással (vagy érintéssel: kimenet, majd bemenet);
 * a csomópont bárhol megfogva mozgatható; üres helyen húzva vagy középső gombbal a vászon mozog, görgővel nagyít.
 * A kijelölt csomópont beállításai a vászon jobb oldalán. Önálló, típusos komponens: az adatot a gazdától kapja.
 */
import { EL_KINDS, GATE_SHORT, canConnect, connect, nextNodeId, nodeTitle, portsOf, pruneEdges, removeNode, type CGraph, type CKind, type CNode, type ElKind, type PinLite } from '../core/circuit';
import type { GateKind } from '../core/logic';
import { icon } from './icons';
import { N_, t } from '../i18n/i18n';
import { setFull } from './fullscreen';
import { fmtSI } from '../core/expr';

export interface CircHost {
  get(): CGraph;
  /** Új diagram; `layoutOnly`: csak a helyek változtak. */
  set(g: CGraph, layoutOnly: boolean): void;
  pins(): PinLite[];
  /** Csomópontonkénti hibák (pl. bekötetlen kapubemenet). */
  problems(): Map<string, string>;
  /** Kimenet csomópont: a belőle számolt kifejezések. */
  exprOf(id: string): { v: string; oe: string } | null;
  /** Kimenet kifejezése szövegből (a diagram ebből újraépül); hibánál az üzenet. */
  setExpr(id: string, which: 'v' | 'oe', src: string): string | null;
  onSelect?(id: string | null): void;
  /** Teljes képernyőből kilépve, ha a régi helye közben eltűnt: a gazda tegye vissza. */
  reattach?(): void;
  /** Billentyű a gazdának (pl. visszavonás; teljes képernyőn is); igaz, ha kezelte. */
  key?(e: KeyboardEvent): boolean;
}
export interface CircEditor { el: HTMLElement; refresh(): void; select(id: string | null): void; fit(): void }

const HEAD = 26, ROW = 22;
const WID: Record<CKind, number> = { in: 128, const: 104, gate: 128, reg: 150, out: 150, el: 160, press: 140 };
const COLOR: Record<CKind, string> = { in: '#1c7ed6', const: '#868e96', gate: '#7048e8', reg: '#2f9e44', out: '#e8590c', el: '#a8571f', press: '#c2255c' };
const KIND_HU: Record<CKind, string> = { in: N_('Láb'), const: N_('Állandó'), gate: N_('Kapu'), reg: N_('Tároló'), out: N_('Kimenet'), el: N_('Villamos elem'), press: N_('Nyomógomb') };
const GATES: GateKind[] = ['and', 'or', 'xor', 'not', 'nand', 'nor', 'xnor', 'buf'];
const fmtNum = (v: number) => fmtSI(v);
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));

export function mountCircEditor(host: CircHost): CircEditor {
  const root = document.createElement('div');
  root.className = 'pg cg';
  root.innerHTML = `
    <div class="pg-bar" role="toolbar" aria-label="Belső kapcsolás">
      <div class="pg-add"><button class="btn" data-cg="add" aria-haspopup="true" aria-expanded="false">+ Elem</button><div class="pg-menu" hidden></div></div>
      <button class="btn" data-cg="del" disabled title="A kijelölt elem vagy él törlése (Delete)">Törlés</button>
      <span class="pg-sp"></span><span class="cg-hint small" role="status" hidden></span>
      <button class="btn icon" data-cg="zout" aria-label="Kicsinyítés">${icon('zoomOut')}</button><button class="btn icon" data-cg="zin" aria-label="Nagyítás">${icon('zoomIn')}</button>
      <button class="btn icon" data-cg="fit" aria-label="Az egész kapcsolás látszódjon" title="Az egész kapcsolás látszódjon">${icon('fit')}</button>
      <button class="btn icon" data-cg="full" aria-pressed="false" aria-label="Teljes képernyő" title="Teljes képernyő (Esc: vissza)">${icon('full')}</button>
    </div>
    <div class="pg-canvas" tabindex="0" aria-label="Belső kapcsolás vászna">
      <div class="pg-layer"><svg class="pg-edges" width="1" height="1"></svg><div class="pg-nodes"></div></div>
      <p class="pg-empty" hidden>Üres. A <b>+ Elem</b> menüből rakj le bemenetet, kaput és kimenetet, majd húzz élt a kimeneti pontjától a bemeneti pontig.</p>
    </div>
    <aside class="pg-props" hidden></aside>`;
  const $ = <T extends Element>(s: string) => root.querySelector(s) as T;
  const canvas = $<HTMLDivElement>('.pg-canvas'), layer = $<HTMLDivElement>('.pg-layer'), nodesEl = $<HTMLDivElement>('.pg-nodes');
  const svg = $<SVGSVGElement>('.pg-edges'), props = $<HTMLElement>('.pg-props'), menu = $<HTMLDivElement>('.pg-menu');
  let g: CGraph = { nodes: [], edges: [] }, pins: PinLite[] = [], probs = new Map<string, string>();
  let view = { x: 16, y: 16, z: 1 }, fitted = false, exprErr: { id: string; which: string; msg: string } | null = null;
  let sel: { kind: 'node'; id: string } | { kind: 'edge'; i: number } | null = null;
  let pending: string | null = null;
  let drag: null | { kind: 'move'; id: string; x0: number; y0: number; nx: number; ny: number; moved: boolean }
    | { kind: 'pan'; x0: number; y0: number; vx: number; vy: number }
    | { kind: 'wire'; from: string; x0: number; y0: number; moved: boolean } = null;
  let tmp: { x: number; y: number } | null = null;

  const node = (id: string) => g.nodes.find(n => n.id === id);
  const rows = (n: CNode) => Math.max(1, portsOf(n).ins.length);
  const height = (n: CNode) => HEAD + 8 + rows(n) * ROW + 22;
  const inPos = (n: CNode, port: string): [number, number] => { const i = Math.max(0, portsOf(n).ins.findIndex(p => p.id === port)); return [n.x, n.y + HEAD + 4 + i * ROW + ROW / 2]; };
  const outPos = (n: CNode): [number, number] => [n.x + WID[n.k], n.y + HEAD + 4 + ROW / 2];
  const toWorld = (cx: number, cy: number): [number, number] => { const r = canvas.getBoundingClientRect(); return [(cx - r.left - view.x) / view.z, (cy - r.top - view.y) / view.z]; };
  const save = (layoutOnly = false) => host.set(JSON.parse(JSON.stringify(g)), layoutOnly);
  const pinName = (id?: string) => { const p = pins.find(x => x.id === id); return p ? p.name || p.id : ''; };
  const applyView = () => { layer.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`; };

  function renderMenu() {
    const item = (k: string, l: string, h: string) => `<button class="pg-mitem" data-add="${k}" title="${esc(t(h))}">${esc(t(l))}</button>`;
    menu.innerHTML = `<div class="pg-mcat" style="--c:${COLOR.in}">${t('Lábak')}</div>${item('in', N_('Láb'), N_('Az alkatrész egy lába: logikai bemenet, és ide kötnek a villamos elemek is'))}${item('out', N_('Kimenet (láb)'), N_('Logikai kimenet: az ide kötött jel hajtja a lábat'))}`
      + `<div class="pg-mcat" style="--c:${COLOR.gate}">${t('Kapuk')}</div>${GATES.map(x => `<button class="pg-mitem" data-add="g:${x}" title="${esc(t('{x} kapu', { x: t(GATE_SHORT[x]) }))}">${esc(t(GATE_SHORT[x]))}</button>`).join('')}`
      + `<div class="pg-mcat" style="--c:${COLOR.reg}">${t('Egyéb')}</div>${item('reg', N_('Tároló'), N_('Az órajel élén felveszi a D értékét, egyébként megtartja'))}${item('c:0', N_('Állandó 0'), N_('Mindig 0'))}${item('c:1', N_('Állandó 1'), N_('Mindig 1'))}`
      + `<div class="pg-mcat" style="--c:${COLOR.el}">${t('Villamos elemek')}</div>${(Object.keys(EL_KINDS) as ElKind[]).map(k => item('el:' + k, EL_KINDS[k].label, N_('Kivezetései lábakhoz köthetők'))).join('')}`
      + `<div class="pg-mcat" style="--c:${COLOR.press}">${t('Vezérlő')}</div>${item('press', N_('Nyomógomb'), N_('Szimulációban lenyomva a két lábát összeköti'))}`;
  }

  function renderEdges() {
    let h = '';
    g.edges.forEach((e, i) => {
      const a = node(e.from), b = node(e.to); if (!a || !b) return;
      const [x1, y1] = outPos(a), [x2, y2] = inPos(b, e.port), dx = Math.max(36, Math.abs(x2 - x1) / 2);
      const d = `M${x1} ${y1} C${x1 + dx} ${y1},${x2 - dx} ${y2},${x2} ${y2}`;
      const s = sel && sel.kind === 'edge' && sel.i === i;
      h += `<path class="pg-hit" d="${d}" data-edge="${i}"/><path class="pg-edge${s ? ' sel' : ''}" d="${d}"/>`;
    });
    if (drag && drag.kind === 'wire' && tmp) {
      const a = node(drag.from);
      if (a) { const [x1, y1] = outPos(a), dx = Math.max(36, Math.abs(tmp.x - x1) / 2); h += `<path class="pg-edge tmp" d="M${x1} ${y1} C${x1 + dx} ${y1},${tmp.x - dx} ${tmp.y},${tmp.x} ${tmp.y}"/>`; }
    }
    svg.innerHTML = h;
  }

  function sumOf(n: CNode): string {
    if (n.k === 'in' || n.k === 'out') return n.pin ? '' : t('nincs láb kiválasztva');
    if (n.k === 'reg') return n.edge === 'fall' ? t('lefutó él') + ' ↓' : t('felfutó él') + ' ↑';
    if (n.k === 'el') { const K = EL_KINDS[n.el || 'resistor']; return K.vals.map(([, , u], i) => (n.vals?.[i] ? n.vals[i] + (u ? ' ' + u : '') : '')).filter(Boolean).join(' · '); }
    return '';
  }
  function renderNodes() {
    nodesEl.innerHTML = g.nodes.map(n => {
      const P = portsOf(n), err = probs.get(n.id), s = sel && sel.kind === 'node' && sel.id === n.id, R = rows(n);
      const ports = Array.from({ length: R }, (_, i) => {
        const pi = P.ins[i], wired = pi && g.edges.some(e => e.to === n.id && e.port === pi.id);
        const left = pi ? `<span class="pg-port in${pending ? ' can' : ''}${pi.opt && !wired ? ' opt' : ''}" data-cport="${n.id}.${pi.id}" title="${esc(t(pi.label))}${pi.opt ? ' (' + t('nem kötelező') + ')' : ''}"></span><span class="pg-pl">${esc(t(pi.label))}</span>` : '<span></span><span></span>';
        const right = P.out && i === 0 ? `<span class="pg-pr">${n.k === 'reg' ? 'Q' : ''}</span><span class="pg-port out${pending === n.id ? ' pend' : ''}" data-cout="${n.id}" title="${t('kimenet')}"></span>` : '<span></span><span></span>';
        return `<div class="pg-row">${left}${right}</div>`;
      }).join('');
      const title = n.k === 'in' || n.k === 'out' ? `${n.k === 'in' ? t('Láb') : t('Ki')}: ${pinName(n.pin) || '–'}` : n.k === 'reg' ? `${t('Tároló')} ${n.name || ''}` : nodeTitle(n, pins, t);
      const sm = sumOf(n);
      return `<div class="pg-node cg-${n.k}${s ? ' sel' : ''}${err ? ' err' : ''}" data-cnode="${n.id}" data-k="${n.k}" style="left:${n.x}px;top:${n.y}px;width:${WID[n.k]}px;--c:${COLOR[n.k]}">
        <div class="pg-head">${icon('grip', 'pg-grip')}<span>${esc(title)}</span></div>${ports}
        ${sm || err ? `<div class="pg-sum">${sm ? `<div>${esc(sm)}</div>` : ''}${err ? `<div class="pg-err">${esc(err)}</div>` : ''}</div>` : ''}</div>`;
    }).join('');
    $<HTMLElement>('.pg-empty').hidden = g.nodes.length > 0;
  }

  const opt = (v: string, l: string, cur: string) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  const pinSel = (cur: string) => `<select id="cg_pin" data-cp="pin"><option value="">– ${t('válassz lábat')} –</option>${pins.map(p => opt(p.id, `${p.name || p.id}${p.name && p.name !== p.id ? ` (${t('azon.')} ${p.id})` : ''}`, cur || '')).join('')}</select>`;
  function renderProps() {
    const n = sel && sel.kind === 'node' ? node(sel.id) : null;
    $<HTMLButtonElement>('[data-cg="del"]').disabled = !sel;
    if (!n) { props.hidden = true; props.innerHTML = ''; return; }
    const err = probs.get(n.id);
    let body = '';
    if (n.k === 'in') body = `<label class="small" for="cg_pin">${t('Láb')}</label>${pinSel(n.pin || '')}`;
    else if (n.k === 'const') body = `<label class="small" for="cg_v">${t('Érték')}</label><select id="cg_v" data-cp="v">${opt('0', '0', String(n.v ?? 0))}${opt('1', '1', String(n.v ?? 0))}</select>`;
    else if (n.k === 'gate') {
      const many = !(n.g === 'not' || n.g === 'buf');
      body = `<label class="small" for="cg_g">${t('Kapu')}</label><select id="cg_g" data-cp="g">${GATES.map(x => opt(x, t(GATE_SHORT[x]), n.g || 'and')).join('')}</select>`
        + (many ? `<label class="small" for="cg_n">${t('Bemenetek száma')}</label><input type="number" id="cg_n" data-cp="n" min="2" max="8" value="${Math.max(2, n.n || 2)}">` : '');
    } else if (n.k === 'reg') body = `<label class="small" for="cg_name">${t('Név')}</label><input type="text" id="cg_name" data-cp="name" value="${esc(n.name || '')}" spellcheck="false" title="${t('Erre a névre a kifejezések is hivatkozhatnak')}">
        <label class="small" for="cg_edge">${t('Órajel')}</label><select id="cg_edge" data-cp="edge">${opt('rise', t('felfutó él') + ' ↑', n.edge || 'rise')}${opt('fall', t('lefutó él') + ' ↓', n.edge || 'rise')}</select>
        <p class="help">${t('A {r} (0-ra) és a {s} (1-re) bemenet nem kötelező; 1 szintnél azonnal hat.', { r: `<b>${t('törlés')}</b>`, s: `<b>${t('beállítás')}</b>` })}</p>`;
    else if (n.k === 'el') {
      const K = EL_KINDS[n.el || 'resistor'];
      body = `<label class="small" for="cg_el">${t('Elem')}</label><select id="cg_el" data-cp="el">${(Object.keys(EL_KINDS) as ElKind[]).map(k => opt(k, t(EL_KINDS[k].label), n.el || 'resistor')).join('')}</select>`
        + K.vals.map(([, l, u], i) => `<label class="small" for="cg_val${i}">${esc(t(l))}</label><div class="row"><input type="text" id="cg_val${i}" data-cv="${i}" value="${esc(n.vals?.[i] ?? '')}" style="width:96px"><span class="small muted">${esc(u)}</span></div>`).join('')
        + (n.el === 'mcu' ? `<span></span><label class="check small" title="${t('ESP32-szerű lap: a buszfunkció bármely GPIO-ra kiosztható; a képességek ekkor az alapértelmezett lábak')}"><input type="checkbox" id="cg_mux" data-cp="mux" ${n.mux ? 'checked' : ''}> ${t('szabadon kiosztható buszok')}</label>` : '')
        + `<p class="help">${t('A kivezetéseit egy-egy {x} elemhez kösd (a láb kimeneti pontjától húzva).', { x: `<b>${t('Láb')}</b>` })}</p>`;
    } else if (n.k === 'press') body = `<p class="help">${t('Szimuláció közben a gombot lenyomva a két lábát összeköti. Mindkét kivezetését egy-egy {x} elemhez kösd.', { x: `<b>${t('Láb')}</b>` })}</p>`;
    else {
      const ex = host.exprOf(n.id) || { v: '', oe: '' };
      const msg = (w: string) => (exprErr && exprErr.id === n.id && exprErr.which === w ? `<p class="pg-err" data-cgmsg="${w}">${esc(exprErr.msg)}</p>` : '');
      body = `<label class="small" for="cg_pin">${t('Láb')}</label>${pinSel(n.pin || '')}
        <label class="small" for="cg_od">${t('Típus')}</label><select id="cg_od" data-cp="od" title="${t('Push-pull: 1-nél a táp felé, 0-nál a föld felé hajt. Nyitott drain: csak a föld felé (felhúzó ellenállás kell).')}">${opt('pp', 'push-pull', n.od ? 'od' : 'pp')}${opt('od', t('nyitott drain'), n.od ? 'od' : 'pp')}</select>
        <label class="small" for="cg_expr">${t('Érték kifejezéssel')}</label><input type="text" id="cg_expr" data-cx="v" value="${esc(ex.v)}" placeholder="${t('pl. !(A & B)')}" spellcheck="false" title="${t('Jelek: ! NEM, & ÉS, | VAGY, ^ KIZÁRÓ VAGY, zárójel, 0/1. Enterre a diagram ebből újraépül.')}">${msg('v')}
        <label class="small" for="cg_oe">${t('Engedélyezés')}</label><input type="text" id="cg_oe" data-cx="oe" value="${esc(ex.oe)}" placeholder="${t('üres = mindig hajt; pl. !OE')}" spellcheck="false">${msg('oe')}
        <p class="help">${t('A kifejezést átírva (Enter) a kimenet előtti kapuk ebből újraépülnek.')}</p>`;
    }
    props.hidden = false;
    props.innerHTML = `<p class="h" style="margin:0 0 4px;color:${COLOR[n.k]}">${esc(t(KIND_HU[n.k]))}</p>${body}
      ${err ? `<p class="pg-err" style="margin-top:6px">${esc(err)}</p>` : ''}
      <div class="row" style="margin-top:8px"><button class="btn danger" data-cg="del">${t('Elem törlése')}</button></div>`;
  }
  /** A sáv feliratai (nyelvváltáskor is: a sablon csak egyszer épül). */
  function relabel() {
    const set = (sel: string, text: string | null, attrs: Record<string, string> = {}) => { const e = root.querySelector<HTMLElement>(sel); if (!e) return; if (text !== null) e.textContent = text; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); };
    set('.pg-bar', null, { 'aria-label': t('Belső kapcsolás') });
    set('[data-cg="add"]', t('+ Elem'));
    set('.pg-bar [data-cg="del"]', t('Törlés'), { title: t('A kijelölt elem vagy él törlése (Delete)') });
    set('[data-cg="zout"]', null, { 'aria-label': t('Kicsinyítés') }); set('[data-cg="zin"]', null, { 'aria-label': t('Nagyítás') });
    set('[data-cg="fit"]', null, { 'aria-label': t('Az egész kapcsolás látszódjon'), title: t('Az egész kapcsolás látszódjon') });
    const on = root.classList.contains('pg-full');
    set('[data-cg="full"]', null, { title: on ? t('Vissza (Esc)') : t('Teljes képernyő (Esc: vissza)'), 'aria-label': on ? t('Kilépés a teljes képernyőből') : t('Teljes képernyő') });
    set('.pg-canvas', null, { 'aria-label': t('Belső kapcsolás vászna') });
    $<HTMLElement>('.pg-empty').innerHTML = t('Üres. A {x} menüből rakj le bemenetet, kaput és kimenetet, majd húzz élt a kimeneti pontjától a bemeneti pontig.', { x: `<b>${t('+ Elem')}</b>` });
  }
  function render() { relabel(); if (menu.hidden) renderMenu(); applyView(); renderNodes(); renderEdges(); renderProps(); }

  function addNode(what: string) {
    const r = canvas.getBoundingClientRect(), [wx, wy] = r.width ? toWorld(r.left + r.width / 2 - 70 * view.z, r.top + r.height / 3) : [40, 40];
    let x = Math.round(wx), y = Math.round(wy);
    // szabad hely: lefelé lépve, amíg egy meglévő elemmel sem fedné egymást
    const hits = (px: number, py: number) => g.nodes.some(n => px < n.x + WID[n.k] + 16 && px + 160 > n.x - 16 && py < n.y + height(n) + 12 && py + 110 > n.y - 12);
    for (let k = 0; k < 60 && hits(x, y); k++) { y += 40; if (k % 15 === 14) { x += 190; y = Math.round(wy); } }
    const base = { id: '', x, y };
    let n: CNode;
    if (what === 'in' || what === 'out') {
      // kimenetnek a kimeneti szerepű (vagy az utolsó szabad) láb, bemenetnek az első szabad jel-láb
      const used = new Set(g.nodes.filter(m => m.k === what).map(m => m.pin)), free = pins.filter(p => !used.has(p.id) && p.role !== 'gnd' && p.role !== 'vin');
      const pick = what === 'out' ? free.find(p => p.role === 'out') || free[free.length - 1] : free[0];
      n = { ...base, k: what, pin: pick?.id || '' };
    }
    else if (what === 'reg') { let k = 1; while (g.nodes.some(m => m.name === 'F' + k) || pins.some(p => p.name === 'F' + k)) k++; n = { ...base, k: 'reg', name: 'F' + k, edge: 'rise' }; }
    else if (what.startsWith('c:')) n = { ...base, k: 'const', v: what === 'c:1' ? 1 : 0 };
    else if (what.startsWith('el:')) { const k = what.slice(3) as ElKind; n = { ...base, k: 'el', el: k, vals: EL_KINDS[k].vals.map(v => fmtNum(v[3])) }; }
    else if (what === 'press') n = { ...base, k: 'press' };
    else { const gk = what.slice(2) as GateKind; n = { ...base, k: 'gate', g: gk, ...(gk === 'not' || gk === 'buf' ? {} : { n: 2 }) }; }
    n.id = nextNodeId(g, { in: 'i', out: 'o', reg: 'r', const: 'c', gate: 'g', el: 'e', press: 'p' }[n.k]);
    g = { nodes: [...g.nodes, n], edges: g.edges }; sel = { kind: 'node', id: n.id }; save(); render();
  }
  /** Él, ha szabályos; különben rövid üzenet a sávban. */
  function tryConnect(from: string, to: string, port: string) {
    const why = canConnect(g, from, to, t);
    if (why) { hint(why); return; }
    g = connect(g, from, to, port); save();
  }
  let hintT = 0;
  function hint(m: string) { const h = $<HTMLElement>('.cg-hint'); h.textContent = m; h.hidden = false; clearTimeout(hintT); hintT = window.setTimeout(() => { h.hidden = true; }, 3500); }
  function delSel() {
    if (!sel) return;
    g = sel.kind === 'node' ? removeNode(g, sel.id) : { nodes: g.nodes, edges: g.edges.filter((_, i) => i !== (sel as { i: number }).i) };
    sel = null; host.onSelect?.(null); save(); render();
  }
  function select(s: typeof sel) { sel = s; exprErr = null; host.onSelect?.(s && s.kind === 'node' ? s.id : null); renderNodes(); renderEdges(); renderProps(); }
  /** Teljes képernyő: a szerkesztő az egész ablakot kitölti (Esc vagy a gomb: vissza). */
  function full(on: boolean) {
    setFull(root, on, () => host.reattach?.());
    const b = root.querySelector('[data-cg="full"]') as HTMLElement;
    b.innerHTML = icon(on ? 'fullExit' : 'full'); b.setAttribute('aria-pressed', String(on));
    b.title = on ? t('Vissza (Esc)') : t('Teljes képernyő (Esc: vissza)'); b.setAttribute('aria-label', on ? t('Kilépés a teljes képernyőből') : t('Teljes képernyő'));
    requestAnimationFrame(() => fit());
  }
  function fit() {
    const r = canvas.getBoundingClientRect();
    if (!g.nodes.length || !r.width) { view = { x: 16, y: 16, z: 1 }; applyView(); return; }
    const x0 = Math.min(...g.nodes.map(n => n.x)), y0 = Math.min(...g.nodes.map(n => n.y));
    const x1 = Math.max(...g.nodes.map(n => n.x + WID[n.k])), y1 = Math.max(...g.nodes.map(n => n.y + height(n)));
    const z = Math.max(0.6, Math.min(1.1, Math.min((r.width - 32) / (x1 - x0), (r.height - 32) / (y1 - y0))));
    view = { z, x: (r.width - (x1 - x0) * z) / 2 - x0 * z, y: Math.max(12 - y0 * z, (r.height - (y1 - y0) * z) / 2 - y0 * z) };
    applyView(); fitted = true;
  }
  function zoom(f: number, cx?: number, cy?: number) {
    const r = canvas.getBoundingClientRect(), px = cx ?? r.left + r.width / 2, py = cy ?? r.top + r.height / 2;
    const [wx, wy] = toWorld(px, py), z = Math.max(0.3, Math.min(2.5, view.z * f));
    view = { z, x: px - r.left - wx * z, y: py - r.top - wy * z }; applyView();
  }

  // ---------- események ----------
  root.addEventListener('click', e => {
    const t = e.target as HTMLElement, add = t.closest('[data-add]') as HTMLElement | null, b = t.closest('[data-cg]') as HTMLElement | null;
    if (add) { menu.hidden = true; $<HTMLElement>('[data-cg="add"]').setAttribute('aria-expanded', 'false'); addNode(add.dataset.add!); return; }
    if (!b) { if (!t.closest('.pg-add')) menu.hidden = true; return; }
    const a = b.dataset.cg;
    if (a === 'add') { menu.hidden = !menu.hidden; b.setAttribute('aria-expanded', String(!menu.hidden)); }
    else if (a === 'del') delSel();
    else if (a === 'zin') zoom(1.2); else if (a === 'zout') zoom(1 / 1.2); else if (a === 'fit') fit();
    else if (a === 'full') full(!root.classList.contains('pg-full'));
  });
  props.addEventListener('change', e => {
    const t = e.target as HTMLInputElement & HTMLSelectElement, n = sel && sel.kind === 'node' ? node(sel.id) : null;
    if (!n) return;
    if (t.dataset.cx) { // kifejezés → a diagram a gazdánál újraépül
      const cur = host.exprOf(n.id)?.[t.dataset.cx as 'v' | 'oe'];
      if (cur !== undefined && cur.replace(/\s+/g, '') === t.value.replace(/\s+/g, '') && !(exprErr && exprErr.id === n.id)) return; // változatlan (pl. Enter után a fókusz elvesztése): nem épül újra
      const err = host.setExpr(n.id, t.dataset.cx as 'v' | 'oe', t.value);
      exprErr = err ? { id: n.id, which: t.dataset.cx, msg: err } : null;
      if (!err) return; // a gazda frissít
      renderProps(); return;
    }
    if (t.dataset.cv != null) { const i = +t.dataset.cv, vs = [...(n.vals || [])]; vs[i] = t.value.trim(); n.vals = vs; save(); renderNodes(); renderEdges(); return; }
    const k = t.dataset.cp; if (!k) return;
    if (k === 'pin') n.pin = t.value;
    else if (k === 'v') n.v = t.value === '1' ? 1 : 0;
    else if (k === 'g') { n.g = t.value as GateKind; if (n.g === 'not' || n.g === 'buf') delete n.n; else n.n = Math.max(2, n.n || 2); }
    else if (k === 'n') n.n = Math.max(2, Math.min(8, Math.round(+t.value) || 2));
    else if (k === 'name') n.name = t.value.trim();
    else if (k === 'edge') n.edge = t.value === 'fall' ? 'fall' : 'rise';
    else if (k === 'od') { if (t.value === 'od') n.od = true; else delete n.od; }
    else if (k === 'el') { const nk = t.value as ElKind; n.el = nk; n.vals = EL_KINDS[nk].vals.map(v => fmtNum(v[3])); if (nk !== 'mcu') delete n.mux; }
    else if (k === 'mux') { if (t.checked) n.mux = true; else delete n.mux; }
    g = pruneEdges(g); save(); render();
  });
  props.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.target as HTMLElement).dataset.cx) (e.target as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true })); });
  canvas.addEventListener('pointerdown', e => {
    if (e.button === 1) { e.preventDefault(); drag = { kind: 'pan', x0: e.clientX, y0: e.clientY, vx: view.x, vy: view.y }; canvas.setPointerCapture(e.pointerId); return; }
    if (e.button !== 0) return;
    const t = e.target as Element, pin = t.closest('[data-cport]') as HTMLElement | null, out = t.closest('[data-cout]') as HTMLElement | null;
    const edge = t.closest('[data-edge]') as HTMLElement | null, nd = t.closest('[data-cnode]') as HTMLElement | null;
    menu.hidden = true; canvas.focus({ preventScroll: true });
    if (out) { drag = { kind: 'wire', from: out.dataset.cout!, x0: e.clientX, y0: e.clientY, moved: false }; root.classList.add('wiring'); canvas.setPointerCapture(e.pointerId); return; }
    if (pin) {
      const ref = pin.dataset.cport!, k = ref.lastIndexOf('.');
      if (pending) { tryConnect(pending, ref.slice(0, k), ref.slice(k + 1)); pending = null; render(); return; }
      const i = g.edges.findIndex(x => x.to === ref.slice(0, k) && x.port === ref.slice(k + 1)); if (i >= 0) select({ kind: 'edge', i });
      return;
    }
    if (pending) { pending = null; renderNodes(); }
    if (edge) { select({ kind: 'edge', i: +edge.dataset.edge! }); return; }
    if (nd) { const n = node(nd.dataset.cnode!)!; drag = { kind: 'move', id: n.id, x0: e.clientX, y0: e.clientY, nx: n.x, ny: n.y, moved: false }; canvas.setPointerCapture(e.pointerId); return; }
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
      const el = nodesEl.querySelector(`[data-cnode="${n.id}"]`) as HTMLElement | null; if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
      renderEdges(); return;
    }
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.moved = true; const [x, y] = toWorld(e.clientX, e.clientY); tmp = { x, y }; renderEdges();
  });
  canvas.addEventListener('pointerup', e => {
    const d = drag; drag = null; tmp = null; root.classList.remove('wiring');
    if (!d) return;
    if (d.kind === 'move' && d.moved) save(true);
    if (d.kind === 'move' && !d.moved) select({ kind: 'node', id: d.id });
    if (d.kind === 'wire') {
      if (!d.moved) { pending = pending === d.from ? null : d.from; renderNodes(); renderEdges(); return; }
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-cport]') as HTMLElement | null;
      if (over) { const ref = over.dataset.cport!, k = ref.lastIndexOf('.'); tryConnect(d.from, ref.slice(0, k), ref.slice(k + 1)); }
      render();
    }
  });
  canvas.addEventListener('pointercancel', () => { drag = null; tmp = null; root.classList.remove('wiring'); renderEdges(); });
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY); }, { passive: false });
  root.addEventListener('keydown', e => {
    if (host.key?.(e)) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delSel(); }
    else if (e.key === 'Escape' && (sel || pending)) { e.preventDefault(); e.stopPropagation(); pending = null; menu.hidden = true; select(null); }
    else if (e.key === 'Escape' && root.classList.contains('pg-full')) { e.preventDefault(); e.stopPropagation(); full(false); }
  });
  renderMenu();

  return {
    el: root,
    refresh() {
      g = JSON.parse(JSON.stringify(host.get())); pins = host.pins(); probs = host.problems();
      if (sel && (sel.kind === 'node' ? !node(sel.id) : !g.edges[sel.i])) sel = null;
      if (!fitted && g.nodes.length && canvas.getBoundingClientRect().width) fit();
      render();
    },
    select(id) { select(id ? { kind: 'node', id } : null); },
    fit() { fitted = false; fit(); },
  };
}
