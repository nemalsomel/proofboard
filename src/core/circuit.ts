/**
 * Belső kapcsolás (az Alkatrész-szerkesztő Működés fülének diagramja). Első lépésben a digitális logika:
 * bemeneti láb, állandó, kapu, tároló és kimenet csomópontok, élekkel. A diagram a szerkesztő adata; a mentett
 * leírásba (`model` → `logic` elem) belőle kifejezések kerülnek (`graphToLogic`), régi vagy JSON-ból jött
 * leírásból pedig a kifejezésekből épül fel (`logicToGraph`). DOM-mentes, unit tesztelt.
 */
import { LogicError, parseExpr, printExpr, pinRef, toGates, varsOf, type Expr, type GateKind, type GateNode } from './logic';

export type CKind = 'in' | 'const' | 'gate' | 'reg' | 'out';
export interface CNode {
  id: string; k: CKind; x: number; y: number;
  /** in / out: a láb azonosítója */ pin?: string;
  /** gate: típus és bemenetszám */ g?: GateKind; n?: number;
  /** const: érték */ v?: 0 | 1;
  /** reg: név és él */ name?: string; edge?: 'rise' | 'fall';
  /** out: nyitott drain */ od?: boolean;
}
/** Él: a `from` csomópont (egyetlen) kimenetétől a `to` csomópont `port` bemenetére. */
export interface CEdge { from: string; to: string; port: string }
export interface CGraph { nodes: CNode[]; edges: CEdge[] }
export interface CPort { id: string; label: string; opt?: boolean }
export interface PinLite { id: string; name: string }

export const GATE_SHORT: Record<GateKind, string> = { and: 'ÉS', nand: 'NEM-ÉS', or: 'VAGY', nor: 'NEM-VAGY', xor: 'KIZÁRÓ VAGY', xnor: 'XNOR', not: 'NEM', buf: 'ERŐSÍTŐ' };
const ONE_IN = (g: GateKind) => g === 'not' || g === 'buf';

/** A csomópont bemenetei (a kimenete mindig egy, kivéve a kimenet csomópontot, amelynek nincs). */
export function portsOf(n: CNode): { ins: CPort[]; out: boolean } {
  switch (n.k) {
    case 'in': case 'const': return { ins: [], out: true };
    case 'gate': {
      const c = ONE_IN(n.g || 'and') ? 1 : Math.max(2, n.n || 2);
      return { ins: Array.from({ length: c }, (_, i) => ({ id: 'i' + i, label: c === 1 ? 'be' : String(i + 1) })), out: true };
    }
    case 'reg': return { ins: [{ id: 'd', label: 'D' }, { id: 'clk', label: 'órajel' }, { id: 'r', label: 'törlés', opt: true }, { id: 's', label: 'beállítás', opt: true }], out: true };
    case 'out': return { ins: [{ id: 'v', label: 'érték' }, { id: 'oe', label: 'engedélyezés', opt: true }], out: false };
  }
}

export const emptyGraph = (): CGraph => ({ nodes: [], edges: [] });
export function nextNodeId(g: CGraph, pre = 'n'): string { let i = 1; while (g.nodes.some(n => n.id === pre + i)) i++; return pre + i; }

/** Él hozzáadása: egy bemenetre egy él (a régi lecserélődik). */
export function connect(g: CGraph, from: string, to: string, port: string): CGraph {
  if (from === to) return g;
  return { nodes: g.nodes, edges: [...g.edges.filter(e => !(e.to === to && e.port === port)), { from, to, port }] };
}
/** Csomópont törlése a hozzá tartozó élekkel. */
export function removeNode(g: CGraph, id: string): CGraph {
  return { nodes: g.nodes.filter(n => n.id !== id), edges: g.edges.filter(e => e.from !== id && e.to !== id) };
}
/** A csomópont változása után az érvénytelenné vált élek (pl. kevesebb kapubemenet) kiesnek. */
export function pruneEdges(g: CGraph): CGraph {
  const ok = new Map(g.nodes.map(n => [n.id, new Set(portsOf(n).ins.map(p => p.id))]));
  return { nodes: g.nodes, edges: g.edges.filter(e => ok.has(e.from) && portsOf(g.nodes.find(n => n.id === e.from)!).out && ok.get(e.to)?.has(e.port)) };
}

export interface LogicOut { pin: string; expr: string; oe: string; type: 'pp' | 'od' }
export interface LogicReg { name: string; clk: string; d: string; edge: 'rise' | 'fall'; reset: string; set: string }
export interface GraphProblem { node: string; msg: string; /** figyelmeztetés (pl. sehova sem kötött kapu); különben hiba */ warn?: boolean }

/** Hivatkozás egy lábra a kifejezésben: a neve, ha egyértelmű azonosító, különben `#azonosító`. */
export function pinToken(pins: readonly PinLite[], id: string, regNames: ReadonlySet<string> = new Set()): string {
  const p = pins.find(x => x.id === id);
  if (!p) return '#' + id;
  const nm = p.name || p.id;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(nm) && !regNames.has(nm) && pins.filter(x => (x.name || x.id) === nm).length === 1) return nm;
  return '#' + id;
}

/** A diagram rövid megnevezése (hibaüzenetekhez, a fejlécben). */
export function nodeTitle(n: CNode, pins: readonly PinLite[]): string {
  const pn = (id?: string) => { const p = pins.find(x => x.id === id); return p ? p.name || p.id : '–'; };
  switch (n.k) {
    case 'in': return `Bemenet ${pn(n.pin)}`;
    case 'const': return `Állandó ${n.v ?? 0}`;
    case 'gate': return GATE_SHORT[n.g || 'and'];
    case 'reg': return `Tároló ${n.name || ''}`.trim();
    case 'out': return `Kimenet ${pn(n.pin)}`;
  }
}

/**
 * A diagramból a leírás kifejezései. Bekötetlen kapubemenet és kapukból álló kör hiba (`problems`); a kifejezésbe
 * ilyenkor 0 kerül, a mentést a hiba akadályozza meg. A kimenet és a tároló hiányzó bemenete üres kifejezés
 * (azt a leírás ellenőrzése jelzi).
 */
export function graphToLogic(g: CGraph, pins: readonly PinLite[]): { outs: LogicOut[]; regs: LogicReg[]; problems: GraphProblem[] } {
  const problems: GraphProblem[] = [];
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  const regNames = new Set(g.nodes.filter(n => n.k === 'reg' && n.name).map(n => n.name!));
  const src = (to: string, port: string) => g.edges.find(e => e.to === to && e.port === port)?.from;
  const memo = new Map<string, Expr>(), busy = new Set<string>();
  const exprOf = (id: string): Expr => {
    const n = byId.get(id);
    if (!n) return { t: 'const', v: 0 };
    if (n.k === 'in') {
      if (!n.pin || !pins.some(p => p.id === n.pin)) { problems.push({ node: id, msg: 'Bemenet: nincs láb kiválasztva.' }); return { t: 'const', v: 0 }; }
      return { t: 'var', name: pinToken(pins, n.pin, regNames) };
    }
    if (n.k === 'const') return { t: 'const', v: n.v === 1 ? 1 : 0 };
    if (n.k === 'reg') return { t: 'var', name: n.name || '_' };
    if (n.k === 'out') return { t: 'const', v: 0 };
    if (memo.has(id)) return memo.get(id)!;
    if (busy.has(id)) { problems.push({ node: id, msg: 'Kapukból álló kör: a jel önmagába fut vissza (tárolóval szakítható meg).' }); return { t: 'const', v: 0 }; }
    busy.add(id);
    const ins = portsOf(n).ins.map((p, i) => {
      const s = src(id, p.id);
      if (!s) { problems.push({ node: id, msg: `${GATE_SHORT[n.g || 'and']} kapu: a(z) ${i + 1}. bemenete nincs bekötve.` }); return { t: 'const', v: 0 } as Expr; }
      return exprOf(s);
    });
    busy.delete(id);
    const flat = (t: 'and' | 'or' | 'xor'): Expr => ({ t, args: ins.flatMap(a => (a.t === t ? a.args : [a])) });
    let e: Expr;
    switch (n.g || 'and') {
      case 'and': e = flat('and'); break; case 'or': e = flat('or'); break; case 'xor': e = flat('xor'); break;
      case 'nand': e = { t: 'not', a: flat('and') }; break; case 'nor': e = { t: 'not', a: flat('or') }; break; case 'xnor': e = { t: 'not', a: flat('xor') }; break;
      case 'not': e = { t: 'not', a: ins[0] }; break; default: e = ins[0];
    }
    memo.set(id, e);
    return e;
  };
  const text = (to: string, port: string) => { const s = src(to, port); return s ? printExpr(exprOf(s)) : ''; };
  const outs: LogicOut[] = [], regs: LogicReg[] = [];
  for (const n of g.nodes) {
    if (n.k === 'out') outs.push({ pin: n.pin || '', expr: text(n.id, 'v'), oe: text(n.id, 'oe'), type: n.od ? 'od' : 'pp' });
    if (n.k === 'reg') regs.push({ name: n.name || '', clk: text(n.id, 'clk'), d: text(n.id, 'd'), edge: n.edge === 'fall' ? 'fall' : 'rise', reset: text(n.id, 'r'), set: text(n.id, 's') });
  }
  // a kimenetre nem ható kapuk is ellenőrizve (bekötetlen bemenet), és figyelmeztetés, hogy hatástalanok
  for (const n of g.nodes) if (n.k === 'gate' && !memo.has(n.id)) {
    exprOf(n.id);
    if (!g.edges.some(e => e.from === n.id)) problems.push({ node: n.id, msg: `${GATE_SHORT[n.g || 'and']} kapu: a kimenete sehova sem csatlakozik.`, warn: true });
  }
  const seen = new Set<string>();
  return { outs, regs, problems: problems.filter(p => { const k = p.node + p.msg; if (seen.has(k)) return false; seen.add(k); return true; }) };
}

const COL = 170, ROWH = 90;
/**
 * Kifejezésekből diagram. A változók lábra (név vagy `#azonosító`) vagy tárolóra hivatkoznak; lábanként egy bemeneti
 * csomópont. Elrendezés oszlopokba a mélység szerint; a `prev` diagram bemeneteinek, kimeneteinek és tárolóinak
 * helye megmarad. Hibás kifejezésből üres bemenet lesz.
 */
export function logicToGraph(L: { outs: LogicOut[]; regs?: LogicReg[] }, pins: readonly PinLite[], prev?: CGraph): CGraph {
  const g: CGraph = emptyGraph();
  const add = (n: Omit<CNode, 'id' | 'x' | 'y'>, pre: string): CNode => { const x: CNode = { id: nextNodeId(g, pre), x: 0, y: 0, ...n }; g.nodes.push(x); return x; };
  const regs = L.regs || [], regNames = new Set(regs.map(r => r.name));
  const ins = new Map<string, CNode>(), consts = new Map<number, CNode>(), regNode = new Map<string, CNode>();
  for (const r of regs) regNode.set(r.name, add({ k: 'reg', name: r.name, edge: r.edge === 'fall' ? 'fall' : 'rise' }, 'r'));
  const depth = new Map<string, number>();
  const leaf = (n: GateNode): CNode => {
    if ('c' in n) { if (!consts.has(n.c)) consts.set(n.c, add({ k: 'const', v: n.c }, 'c')); return consts.get(n.c)!; }
    if ('v' in n) {
      if (regNames.has(n.v)) return regNode.get(n.v)!;
      const id = pinRef(n.v, pins) || '';
      if (!ins.has(id)) ins.set(id, add({ k: 'in', pin: id }, 'i'));
      return ins.get(id)!;
    }
    const gn = add({ k: 'gate', g: n.g, ...(ONE_IN(n.g) ? {} : { n: Math.max(2, n.ins.length) }) }, 'g');
    let d = 0;
    n.ins.forEach((k, i) => { const s = leaf(k); g.edges.push({ from: s.id, to: gn.id, port: 'i' + i }); d = Math.max(d, depth.get(s.id) ?? 0); });
    depth.set(gn.id, d + 1);
    return gn;
  };
  const wire = (src: string, to: CNode, port: string) => {
    if (!src.trim()) return;
    let tree: GateNode;
    try { tree = toGates(parseExpr(src)); } catch { return; }
    g.edges.push({ from: leaf(tree).id, to: to.id, port });
  };
  regs.forEach(r => { const n = regNode.get(r.name)!; wire(r.d, n, 'd'); wire(r.clk, n, 'clk'); wire(r.reset, n, 'r'); wire(r.set, n, 's'); });
  for (const o of L.outs) { const n = add({ k: 'out', pin: o.pin, ...(o.type === 'od' ? { od: true } : {}) }, 'o'); wire(o.expr, n, 'v'); wire(o.oe, n, 'oe'); }
  // elrendezés: bemenetek és állandók balra, kapuk a mélységük szerint, tárolók a bemeneteik után, kimenetek a végén
  const maxG = Math.max(0, ...[...depth.values()]);
  const colOf = (n: CNode): number => {
    if (n.k === 'in' || n.k === 'const') return 0;
    if (n.k === 'gate') return depth.get(n.id) ?? 1;
    if (n.k === 'reg') return Math.max(1, ...g.edges.filter(e => e.to === n.id).map(e => (depth.get(e.from) ?? 0) + 1));
    return maxG + 2;
  };
  const rowsIn = new Map<number, number>();
  for (const n of g.nodes) {
    const c = colOf(n), r = rowsIn.get(c) || 0; rowsIn.set(c, r + 1);
    n.x = 20 + c * COL; n.y = 20 + r * ROWH;
  }
  // az előző diagram helyei (bemenet láb szerint, tároló név szerint, kimenet láb szerint)
  if (prev) {
    const keyOf = (n: CNode) => (n.k === 'in' || n.k === 'out' ? n.k + ':' + n.pin : n.k === 'reg' ? 'reg:' + n.name : n.k === 'const' ? 'c:' + n.v : '');
    const old = new Map(prev.nodes.filter(n => keyOf(n)).map(n => [keyOf(n), n]));
    for (const n of g.nodes) { const o = old.get(keyOf(n)); if (o) { n.x = o.x; n.y = o.y; } }
  }
  return g;
}

/** A kimenetekre és tárolókra már nem ható kapuk és állandók eltávolítása. */
export function dropUnused(g: CGraph): CGraph {
  let cur = g;
  for (;;) {
    const used = new Set(cur.edges.map(e => e.from));
    const dead = cur.nodes.filter(n => (n.k === 'gate' || n.k === 'const') && !used.has(n.id));
    if (!dead.length) return cur;
    const ids = new Set(dead.map(n => n.id));
    cur = { nodes: cur.nodes.filter(n => !ids.has(n.id)), edges: cur.edges.filter(e => !ids.has(e.from) && !ids.has(e.to)) };
  }
}

/**
 * Egy bemenet (pl. kimenet értéke) kifejezésből: a régi meghajtó kapuk (ha másra nem hatnak) törlődnek, és a kifejezés
 * kapui a cél elé kerülnek; a lábak bemeneti csomópontjai és a tárolók újrahasznosulnak. Hibás kifejezésnél vagy
 * ismeretlen névnél LogicError.
 */
export function setPortExpr(g: CGraph, to: string, port: string, src: string, pins: readonly PinLite[]): CGraph {
  const regs = new Map(g.nodes.filter(n => n.k === 'reg' && n.name).map(n => [n.name!, n]));
  let tree: GateNode | null = null;
  if (src.trim()) {
    const e = parseExpr(src);
    const bad = varsOf(e).filter(v => !regs.has(v) && !pinRef(v, pins));
    if (bad.length) throw new LogicError(`Nincs ilyen (vagy nem egyértelmű) láb vagy tároló: ${bad.join(', ')}`, 0);
    tree = toGates(e);
  }
  let out: CGraph = dropUnused({ nodes: g.nodes.map(n => ({ ...n })), edges: g.edges.filter(e => !(e.to === to && e.port === port)) });
  if (!tree) return out;
  const target = out.nodes.find(n => n.id === to);
  if (!target) return out;
  const levels = (n: GateNode): number => ('g' in n ? 1 + Math.max(0, ...n.ins.map(levels)) : 0);
  const L = levels(tree);
  const rowAt = new Map<number, number>();
  const place = (lvl: number): [number, number] => { const r = rowAt.get(lvl) || 0; rowAt.set(lvl, r + 1); return [target.x - COL * lvl, target.y + r * ROWH]; };
  const add = (n: Omit<CNode, 'id' | 'x' | 'y'>, pre: string, lvl: number): CNode => { const [x, y] = place(lvl); const c: CNode = { id: nextNodeId(out, pre), x, y, ...n }; out = { nodes: [...out.nodes, c], edges: out.edges }; return c; };
  const build = (n: GateNode, lvl: number): CNode => {
    if ('c' in n) return add({ k: 'const', v: n.c }, 'c', L + 1);
    if ('v' in n) {
      const r = regs.get(n.v); if (r) return r;
      const id = pinRef(n.v, pins)!;
      return out.nodes.find(m => m.k === 'in' && m.pin === id) || add({ k: 'in', pin: id }, 'i', L + 1);
    }
    const gn = add({ k: 'gate', g: n.g, ...(ONE_IN(n.g) ? {} : { n: Math.max(2, n.ins.length) }) }, 'g', lvl);
    n.ins.forEach((k, i) => { const s = build(k, lvl + 1); out = { nodes: out.nodes, edges: [...out.edges, { from: s.id, to: gn.id, port: 'i' + i }] }; });
    return gn;
  };
  const root = build(tree, 1);
  return { nodes: out.nodes, edges: [...out.edges, { from: root.id, to, port }] };
}
