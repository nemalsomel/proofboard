/**
 * Netlista: a rézcsík-darabok (cellák), hidak, vezetékek, alkatrészen belüli kötések és lenyomott
 * gombok alapján hálózatokba sorolja a lábakat (unió–keresés).
 */
import type { PartInstance } from '../core/schema';
import { buildLayout, type Layout } from './board';
import { DEFS, isMcu } from './defs';
import { inBoard, placedPins } from './geometry';
import { plugPairs } from './plug';
import type { Design, NetPin } from './types';


export interface PartPins { pins: NetPin[]; map: Record<string, NetPin>; out: boolean }
export interface Netlist {
  /** A panel celláinak száma (a csomópontok 0…N-1 a cellák, felette a panelon kívüli lábak). */
  N: number;
  find(x: number): number;
  /** A lyuk cellája. */
  sid(r: number, c: number): number;
  pins: NetPin[];
  byPart: Map<string, PartPins>;
  /** Hálózat (gyökér) → lábai. */
  netPins: Map<number, NetPin[]>;
  /** Hálózat → hány cellára terjed ki. */
  netSecs: Map<number, number>;
}

let layKey = '', layVal: Layout | null = null;
/** A terv panel-elrendezése (szekciók + kézi és automatikus csíkvágások), gyorsítótárazva. */
export function layoutOf(D: Design): Layout {
  const cuts = [...(D.cuts || []), ...((D.auto && D.auto.cuts) || [])];
  const k = D.board.rows + 'x' + D.board.cols + '/' + D.board.sec + '|' + cuts.map(x => x.join(',')).join(';');
  if (k !== layKey || !layVal) { layKey = k; layVal = buildLayout(D.board, cuts); }
  return layVal;
}

export interface AnalyzeOpts {
  /** Lenyomott gomb (a press-vezérlő lábpárjai összeérnek). */
  pressed?: (p: PartInstance) => boolean;
  /** Elrejtett automatikus bekötés (a kapcsolatok azonosítói szerint). */
  hidden?: (links: string[] | undefined) => boolean;
}

export function analyze(D: Design, opts: AnalyzeOpts = {}): Netlist {
  const LY = layoutOf(D), N = LY.N, inb = (r: number, c: number) => inBoard(D.board, r, c);
  const sid = (r: number, c: number) => LY.cell(r, c);
  const hidden = opts.hidden || (() => false);
  const parts = D.parts.map(p => [p, placedPins(p)] as const);
  let off = 0;
  for (const [, gp] of parts) for (const q of gp) if (!inb(q.r, q.c)) off++;
  const par = new Int32Array(N + off);
  for (let i = 0; i < N + off; i++) par[i] = i;
  const find = (x: number) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const uni = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); };
  const AB = D.auto.bridges.filter(b => !hidden(b[4])), AW = D.auto.wires.filter(w => !hidden(w.links));
  for (const b of [...D.bridges, ...AB]) if (inb(b[0], b[1]) && inb(b[2], b[3])) uni(sid(b[0], b[1]), sid(b[2], b[3]));
  const pins: NetPin[] = [], byPart = new Map<string, PartPins>();
  let k = N;
  for (const [p, gp] of parts) {
    const m: Record<string, NetPin> = {}, list: NetPin[] = [];
    for (const g of gp) {
      const on = inb(g.r, g.c);
      const q: NetPin = Object.assign(g, { on, s: on ? sid(g.r, g.c) : k++, net: -1 }); // panelon kívüli láb: saját, magányos csomópont
      m[q.id] = q; pins.push(q); list.push(q);
    }
    byPart.set(p.id, { pins: list, map: m, out: list.some(q => !q.on) });
    for (const [a, b] of DEFS[p.type].internal(p)) uni(m[a].s, m[b].s);
    if (opts.pressed && opts.pressed(p))
      for (const c of DEFS[p.type].def.controls || []) if (c.kind === 'press') for (const [a, b] of c.closes) if (m[a] && m[b]) uni(m[a].s, m[b].s);
  }
  // csatlakozóba dugott külső alkatrész: lábanként egy hálózat a csatlakozó lábával
  for (const p of D.parts) for (const [q, h] of plugPairs(D, p)) { const a = byPart.get(p.id)!.map[q.id], b = byPart.get(h.part.id)!.map[h.id]; if (a && b) uni(a.s, b.s); }
  // vezetékek: lyuk–lyuk, vagy kábel egy panelon kívüli kivezetéshez
  const offAt = new Map<string, number>();
  for (const q of pins) if (!q.on) offAt.set(q.r + ':' + q.c, q.s);
  const node = (e: [number, number]) => (inb(e[0], e[1]) ? sid(e[0], e[1]) : offAt.get(e[0] + ':' + e[1]));
  for (const w of [...D.wires, ...AW]) { const x = node(w.a), y = node(w.b); if (x != null && y != null) uni(x, y); }
  for (const q of pins) q.net = find(q.s);
  const netPins = new Map<number, NetPin[]>(), netSecs = new Map<number, number>();
  for (const q of pins) { if (!netPins.has(q.net)) netPins.set(q.net, []); netPins.get(q.net)!.push(q); }
  for (let s = 0; s < N; s++) { const r = find(s); netSecs.set(r, (netSecs.get(r) || 0) + 1); }
  return { N, find, sid, pins, byPart, netPins, netSecs };
}

/** Láb felirata: vezérlőn a GPIO-név (PICO.GP15), máshol az azonosító (R1.2). */
export const pinLabel = (q: { part: PartInstance; name: string; id: string }): string =>
  isMcu(q.part) ? `${q.part.label}.${q.name}` : `${q.part.label}.${q.id}`;
