/**
 * Útvonalkereső: a kapcsolatokat (láb → láb, GND, szabad GPIO) automatikus forrasztóhidakkal köti be a
 * csíkdarabok szomszédsági gráfján (Dijkstra, kanyarbüntetéssel), több sorrendet kipróbálva. Ahol nincs
 * hídút, vezetéket tesz; a külső alkatrészek kábellel kötnek be. Közben a szabad GPIO-kat kiosztja
 * (ADC-tartalékolás, különleges és buszfunkciós lábak figyelembevételével), és csíkos panelen javasolt vágásokat ad.
 */
import type { PartInstance } from '../core/schema';
import { buildLayout, planCuts, type Cut } from './board';
import { DEFS, isMcu, isOff } from './defs';
import { inBoard, placedPins, xf } from './geometry';
import { findPin, partGroups } from './links';
import { fnCaps, fnPenalty, gpioFits, gpioPenalty, hasCap, mcuMux } from './mcu';
import { layoutOf, type Netlist } from './netlist';
import { plugAlias } from './plug';
import type { AutoBridge, Bridge, Design, Hole, Link, PlacedPin, Wire } from './types';

/** Csíkos panelen (teljes csík) alapból automatikus a vágás. */
export const autoCutOn = (D: Design): boolean => D.settings.autoCut ?? D.board.sec >= D.board.rows;

/**
 * Automatikus csíkvágás: a kapcsolatokból kiadódó hálózatok szerint minden csíkdarabban elválasztja az
 * eltérő hálózatú lábakat. GPIO-kapcsolatnál, ha a forrás csíkján szabad GPIO van, azt rendeli hozzá (így ott nem kell vágni).
 */
export function suggestCuts(D: Design): Cut[] {
  const inb = (r: number, c: number) => inBoard(D.board, r, c);
  const par = new Map<string, string>();
  const f = (x: string) => { while (par.has(x) && par.get(x) !== x) x = par.get(x)!; return x; };
  const u = (a: string, b: string) => { a = f(a); b = f(b); if (a !== b) par.set(a, b); };
  const pins: Array<{ q: PlacedPin; key: string }> = [];
  for (const p of D.parts) {
    if (isOff(p)) continue;
    const g = partGroups(p);
    for (const q of placedPins(p)) if (inb(q.r, q.c)) pins.push({ q, key: isMcu(q.part) && q.role === 'gnd' ? 'GND' : p.id + ':' + g[q.id] });
  }
  const AL = plugAlias(D); // csatlakozóba dugott külső láb → a csatlakozó lába
  const keyOf = (ref: string) => { const q = findPin(D, AL(ref)); if (!q) return null; return isMcu(q.part) && q.role === 'gnd' ? 'GND' : q.part.id + ':' + partGroups(q.part)[q.id]; };
  const L0 = buildLayout(D.board, D.cuts || []), claimed = new Set(D.links.filter(l => l.b !== 'GPIO' && l.b !== 'GND').map(l => [l.a, l.b]).flat());
  for (const l of D.links) {
    const a = keyOf(l.a);
    if (!a) continue;
    if (l.b === 'GND') u(a, 'GND');
    else if (l.b === 'GPIO') {
      const qa = findPin(D, AL(l.a)), qm = findPin(D, l.a);
      if (!qa || !qm || !inb(qa.r, qa.c)) continue;
      const an = qm.role === 'adc', cell = L0.cell(qa.r, qa.c);
      const same = pins.map(x => x.q).filter(q => gpioFits(q, an) && !claimed.has(q.part.id + '.' + q.id) && L0.cell(q.r, q.c) === cell)
        .sort((x, y) => gpioPenalty(x) + fnPenalty(qm.fn, x) - gpioPenalty(y) - fnPenalty(qm.fn, y) || Math.abs(x.r - qa.r) - Math.abs(y.r - qa.r));
      const pref = l.gpio ? same.find(q => q.part.id + '.' + q.id === l.gpio) : undefined, g = pref || same[0];
      if (g) { const ref = g.part.id + '.' + g.id; claimed.add(ref); l.gpio = ref; u(a, keyOf(ref)!); }
    } else { const b = keyOf(l.b); if (b) u(a, b); }
  }
  return planCuts(D.board, D.cuts || [], pins.map(x => ({ r: x.q.r, c: x.q.c, net: f(x.key) })), D.cutBan || []);
}

interface RouteState {
  par: Int32Array; sz: Int32Array; used: Uint8Array;
  find(x: number): number; uni(a: number, b: number): void;
  bridges: AutoBridge[]; wires: Array<Wire & { links: string[] }>; wireEnds: Set<string>;
}
export interface RouteOpts { full?: boolean; moved?: Set<string> | null }

/** Bekötés: D.auto (hidak, vezetékek, kábelek, csíkvágások) újraszámolása; a GPIO-kapcsolatok `gpio` mezője a kiosztott láb. */
export function route(D: Design, opts: RouteOpts = {}): void {
  const inb = (r: number, c: number) => inBoard(D.board, r, c);
  if (autoCutOn(D)) {
    const before = JSON.stringify(D.auto.cuts || []);
    D.auto.cuts = suggestCuts(D);
    if (JSON.stringify(D.auto.cuts) !== before) opts = { ...opts, full: true };
  } else D.auto.cuts = [];
  const LY = layoutOf(D), NC = LY.N;
  const cellOf = (r: number, c: number) => LY.cell(r, c);
  const allPins: PlacedPin[] = [];
  for (const p of D.parts) for (const q of placedPins(p)) if (inb(q.r, q.c)) allPins.push(q);
  const pinByRef = new Map(allPins.map(q => [q.part.id + '.' + q.id, q]));
  // csatlakozóba dugott külső alkatrész: a kapcsolat a csatlakozó lábáról indul; a láb szerepe, buszfunkciója az eredetié
  const AL = plugAlias(D), ORIG = new Map<string, string>(), back: Array<[Link, Link]> = [];
  const RL = D.links.map(l => {
    const a = AL(l.a), b = l.b === 'GND' || l.b === 'GPIO' ? l.b : AL(l.b);
    if (a === l.a && b === l.b) return l;
    if (a !== l.a) ORIG.set(a, l.a);
    if (b !== l.b) ORIG.set(b, l.b);
    const x = { ...l, a, b }; back.push([x, l]); return x;
  });
  const metaPin = (ref: string): PlacedPin | null | undefined => (ORIG.has(ref) ? findPin(D, ORIG.get(ref)!) : pinByRef.get(ref));
  const links = RL.filter(l => pinByRef.has(l.a) && (l.b === 'GND' || l.b === 'GPIO' || pinByRef.has(l.b)));
  const valid = new Set(links.map(l => l.id));
  const pinHoles = new Set(allPins.map(q => q.r + ':' + q.c));
  const PG = new Map(D.parts.map(p => [p.id, partGroups(p)]));
  const okB = (b: Bridge | AutoBridge) => inb(b[0], b[1]) && inb(b[2], b[3]);
  const pin = (ref: string) => pinByRef.get(ref)!;

  function base(kb: AutoBridge[], kw: Array<Wire & { links: string[] }>): RouteState {
    const par = new Int32Array(NC), sz = new Int32Array(NC).fill(1), used = new Uint8Array(NC);
    for (let i = 0; i < NC; i++) par[i] = i;
    const find = (x: number) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const uni = (a: number, b: number) => { a = find(a); b = find(b); if (a === b) return; if (a > b) { const t = a; a = b; b = t; } par[b] = a; sz[a] += sz[b]; };
    for (const b of [...D.bridges, ...kb]) if (okB(b)) { const x = cellOf(b[0], b[1]), y = cellOf(b[2], b[3]); used[x] = used[y] = 1; uni(x, y); }
    for (const w of [...D.wires, ...kw]) if (inb(w.a[0], w.a[1]) && inb(w.b[0], w.b[1])) { const x = cellOf(w.a[0], w.a[1]), y = cellOf(w.b[0], w.b[1]); used[x] = used[y] = 1; uni(x, y); }
    for (const q of allPins) used[cellOf(q.r, q.c)] = 1;
    for (const p of D.parts) {
      const m: Record<string, PlacedPin> = {};
      for (const q of placedPins(p)) m[q.id] = q;
      for (const [a, b] of DEFS[p.type].internal(p)) if (inb(m[a].r, m[a].c) && inb(m[b].r, m[b].c)) uni(cellOf(m[a].r, m[a].c), cellOf(m[b].r, m[b].c));
    }
    return {
      par, sz, used, find, uni,
      bridges: kb.map(b => [b[0], b[1], b[2], b[3], [...b[4]]] as AutoBridge),
      wires: kw.map(w => ({ ...w, links: [...w.links] })),
      wireEnds: new Set([...D.wires, ...kw].flatMap(w => [w.a.join(':'), w.b.join(':')])),
    };
  }
  type Info = Map<number, PlacedPin[]>;
  const info = (S: RouteState): Info => {
    const m: Info = new Map();
    for (const q of allPins) { const r = S.find(cellOf(q.r, q.c)); if (!m.has(r)) m.set(r, []); m.get(r)!.push(q); }
    return m;
  };
  const isGnd = (qs: PlacedPin[] | undefined) => !!qs && qs.some(q => isMcu(q.part) && q.role === 'gnd');
  const freeGpio = (qs: PlacedPin[] | undefined, r: number, S: RouteState): qs is PlacedPin[] =>
    !!qs && qs.length === 1 && isMcu(qs[0].part) && qs[0].role === 'gpio' && S.sz[r] === 1;
  const needAdc = (l: Link) => (metaPin(l.a) || { role: '' }).role === 'adc';
  // konkrét lábra mutató kapcsolat célja (pl. „→ GPIO25”): szabad GPIO-célnak nem választható
  const claimedG = new Set(links.filter(l => l.b !== 'GND' && l.b !== 'GPIO').flatMap(l => [l.a, l.b]));
  const srcOf = (S: RouteState, l: Link) => { const qa = pin(l.a); return S.find(cellOf(qa.r, qa.c)); };

  function predFor(S: RouteState, l: Link, I: Info): (r: number) => boolean {
    if (l.b === 'GND') return r => isGnd(I.get(r));
    if (l.b === 'GPIO') {
      const an = needAdc(l);
      // annyi ADC-képes GPIO-t hagy szabadon, ahány analóg kapcsolat még bekötetlen
      let useAdc = an;
      if (!an) {
        let free = 0;
        const seen = new Set<number>();
        for (const q of allPins) {
          if (!hasCap(q, 'adc') || q.role !== 'gpio') continue;
          const r = S.find(cellOf(q.r, q.c));
          if (!seen.has(r) && freeGpio(I.get(r), r, S)) { seen.add(r); free++; }
        }
        const pend = links.filter(x => x.b === 'GPIO' && needAdc(x) && !sat(S, x, I)).length;
        useAdc = free > pend;
      }
      return r => {
        const qs = I.get(r);
        if (!freeGpio(qs, r, S)) return false;
        const q = qs[0];
        if (claimedG.has(q.part.id + '.' + q.id)) return false;
        if (an) return hasCap(q, 'adc');
        if (hasCap(q, 'in')) return false;
        return hasCap(q, 'adc') ? useAdc : true;
      };
    }
    const qb = pin(l.b), t = S.find(cellOf(qb.r, qb.c));
    return r => r === t;
  }
  function sat(S: RouteState, l: Link, I: Info): boolean {
    const src = srcOf(S, l);
    if (l.b === 'GPIO') { const an = needAdc(l); return (I.get(src) || []).some(q => isMcu(q.part) && q.role === 'gpio' && (!an || hasCap(q, 'adc'))); }
    return predFor(S, l, I)(src);
  }
  const srcSig = new Map<string, string>();
  for (const l of links) {
    const q = pin(l.a), k = q.part.id + ':' + PG.get(q.part.id)![q.id];
    const sg = l.b === 'GND' ? 'GND' : l.b === 'GPIO' ? 'G' + l.id : null;
    if (sg && !srcSig.has(k)) srcSig.set(k, sg);
  }
  const badNet = (qs: PlacedPin[]) => {
    const pico = qs.filter(q => isMcu(q.part)), gnd = pico.some(q => q.role === 'gnd');
    const sigs = new Set<string>(gnd ? ['GND'] : []);
    for (const q of qs) { const sg = srcSig.get(q.part.id + ':' + PG.get(q.part.id)![q.id]); if (sg) sigs.add(sg); }
    if (sigs.size > 1) return true;
    const other = new Set(pico.filter(q => q.role !== 'gnd').map(q => q.part.id + '.' + q.id));
    if ((gnd && other.size) || other.size > 1) return true;
    const seen = new Map<string, string>();
    for (const q of qs) {
      if (isMcu(q.part)) continue;
      const g = PG.get(q.part.id)![q.id];
      if (seen.has(q.part.id) && seen.get(q.part.id) !== g) return true;
      seen.set(q.part.id, g);
    }
    return false;
  };
  const geo = (a: number, b: number) => LY.edge(a, b)!.br;
  // ugyanannak a perifériának a már bekötött, azonos buszú (I²C/SPI/UART) lábai: melyik buszszámon vannak
  const busOf = (S: RouteState, I: Info, l: Link): Set<string> | null => {
    const a = metaPin(l.a);
    if (!a || !a.fn || l.b !== 'GPIO') return null;
    const bt = a.fn.split('.')[0];
    const sets: Array<Set<string>> = [];
    for (const o of links) {
      if (o === l || o.b !== 'GPIO') continue;
      const x = metaPin(o.a);
      if (!x || x.part !== a.part || !x.fn || x.fn.split('.')[0] !== bt) continue;
      const g = (I.get(srcOf(S, o)) || []).find(q => isMcu(q.part) && q.role === 'gpio');
      if (!g) continue;
      sets.push(new Set(fnCaps(g, x.fn).map(c => c.split('.')[0])));
    }
    if (!sets.length) return null;
    return sets.slice(1).reduce((acc, b) => new Set([...acc].filter(v => b.has(v))), sets[0]);
  };

  function routeOne(S: RouteState, l: Link): { ok: boolean; n?: number } {
    const I = info(S), src = srcOf(S, l), busPref = busOf(S, I, l), fnA = (metaPin(l.a) || { fn: undefined }).fn;
    if (sat(S, l, I)) return { ok: true, n: 0 };
    const pred = predFor(S, l, I);
    const spare = l.b === 'GPIO' && !needAdc(l); // az ADC-képes GPIO-kat az analóg jeleknek tartogatja
    let prefRoot = -1;
    if (l.b === 'GPIO' && l.gpio && pinByRef.has(l.gpio)) { const g = pin(l.gpio); prefRoot = S.find(cellOf(g.r, g.c)); }
    const dist = new Float64Array(NC * 5).fill(1e9), prev = new Int32Array(NC * 5).fill(-1);
    const hp: Array<[number, number]> = [];
    const push = (d: number, s: number) => {
      hp.push([d, s]);
      let i = hp.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (hp[p][0] <= hp[i][0]) break; [hp[p], hp[i]] = [hp[i], hp[p]]; i = p; }
    };
    const pop = () => {
      const t = hp[0], l2 = hp.pop()!;
      if (hp.length) {
        hp[0] = l2;
        let i = 0;
        for (;;) {
          const a = 2 * i + 1, b = a + 1;
          let m = i;
          if (a < hp.length && hp[a][0] < hp[m][0]) m = a;
          if (b < hp.length && hp[b][0] < hp[m][0]) m = b;
          if (m === i) break;
          [hp[m], hp[i]] = [hp[i], hp[m]];
          i = m;
        }
      }
      return t;
    };
    for (let i = 0; i < NC; i++) if (S.find(i) === src) { dist[i * 5 + 4] = 0; push(0, i * 5 + 4); }
    let best: { s: number; n: number } | null = null, bc = 1e9;
    while (hp.length) {
      const [d, s] = pop();
      if (d > dist[s]) continue;
      if (d >= bc) break;
      const cell = (s / 5) | 0, dir = s % 5;
      for (const e of LY.adj(cell)) {
        const k = e.dir, n = e.to, rn = S.find(n);
        if (rn === src) continue;
        const step = 1 + (dir !== 4 && dir !== k ? 0.6 : 0);
        if (S.used[n] || S.sz[rn] > 1) {
          if (pred(rn)) {
            const tq = (I.get(rn) || [])[0];
            const busMiss = !!busPref && busPref.size > 0 && !!tq && mcuMux(tq.part) !== 'matrix' && !fnCaps(tq, fnA || '').some(c => busPref.has(c.split('.')[0]));
            const tc = d + step + (prefRoot >= 0 && rn !== prefRoot ? 14 : 0) + (spare && hasCap(tq, 'adc') ? 12 : 0)
              + (l.b === 'GPIO' && rn !== prefRoot ? gpioPenalty(tq) + fnPenalty(fnA, tq) + (busMiss ? 12 : 0) : 0);
            if (tc < bc) { bc = tc; best = { s, n }; }
          }
          continue;
        }
        const ns = n * 5 + k, nd = d + step;
        if (nd < dist[ns]) { dist[ns] = nd; prev[ns] = s; push(nd, ns); }
      }
    }
    if (!best) return { ok: false };
    const cells = [best.n];
    let s = best.s;
    while (s >= 0) { cells.push((s / 5) | 0); s = prev[s]; }
    for (let i = 0; i + 1 < cells.length; i++) { const g = geo(cells[i], cells[i + 1]); S.bridges.push([g[0], g[1], g[2], g[3], [l.id]]); }
    for (const c of cells) S.used[c] = 1;
    for (let i = 0; i + 1 < cells.length; i++) S.uni(cells[i], cells[i + 1]);
    return { ok: true, n: cells.length - 1 };
  }
  const est = (l: Link) => {
    const a = pin(l.a);
    if (l.b !== 'GND' && l.b !== 'GPIO') { const b = pin(l.b); return Math.abs(a.r - b.r) / 3 + Math.abs(a.c - b.c); }
    const an = l.b === 'GPIO' && needAdc(l);
    let bd = 1e9;
    for (const q of allPins) if (l.b === 'GND' ? isMcu(q.part) && q.role === 'gnd' : gpioFits(q, an)) bd = Math.min(bd, Math.abs(a.r - q.r) / 3 + Math.abs(a.c - q.c));
    return bd;
  };
  const prio = (l: Link) => (l.b === 'GND' ? 2 : l.b === 'GPIO' ? (needAdc(l) ? 0.5 : 1) : 0);
  const cmp = (x: Link, y: Link) => prio(x) - prio(y) || est(y) - est(x);

  function full(): { S: RouteState; fails: Link[] } {
    let order = [...links].sort(cmp);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let best: { score: number; S: RouteState; fails: Link[] } | null = null, firstOk = -1;
    for (let att = 0; att < 60; att++) {
      const S = base([], []), fails: Link[] = [];
      let nb = 0;
      for (const l of order) { const r = routeOne(S, l); if (!r.ok) fails.push(l); else nb += r.n || 0; }
      // buszfunkció-hibák (nem megfelelő láb vagy szétszórt busz, fix lábkiosztású vezérlőn) a pontszámba
      let busBad = 0;
      {
        const I = info(S);
        for (const l of links) {
          const a = metaPin(l.a);
          if (!a || !a.fn || l.b !== 'GPIO') continue;
          const g = (I.get(srcOf(S, l)) || []).find(q => isMcu(q.part) && q.role === 'gpio');
          if (!g || mcuMux(g.part) === 'matrix') continue;
          if (!fnCaps(g, a.fn).length) { busBad++; continue; }
          const bp = busOf(S, I, l);
          if (bp && bp.size === 0) busBad++;
          else if (bp && !fnCaps(g, a.fn).some(c => bp.has(c.split('.')[0]))) busBad++;
        }
      }
      const score = fails.length * 10000 + busBad * 300 + nb;
      if (!best || score < best.score) best = { score, S, fails };
      if (!fails.length && firstOk < 0) firstOk = att;
      if (firstOk >= 0 && att >= firstOk + 14) break;
      if (fails.length) order = [...fails, ...order.filter(l => !fails.includes(l))];
      if (att > 8 || firstOk >= 0) for (let i = order.length - 1; i > 0; i--) if (rnd() < 0.3) { const j = (rnd() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
    }
    return best || { S: base([], []), fails: [] };
  }
  function incremental(): { S: RouteState; fails: Link[] } {
    let kb: AutoBridge[] = D.auto.bridges.filter(okB).map(b => [b[0], b[1], b[2], b[3], [...(b[4] || [])]]);
    let kw = D.auto.wires.map(w => ({ ...w, links: [...(w.links || [])] }));
    const dirty = new Set<string>();
    if (opts.moved) for (const l of links) if ([l.a, l.b].some(x => opts.moved!.has(x.split('.')[0]))) dirty.add(l.id);
    for (let it = 0; it < 10; it++) {
      const strip = (x: string[]) => x.filter(id => valid.has(id) && !dirty.has(id));
      kb = kb.map(b => { b[4] = strip(b[4]); return b; }).filter(b => b[4].length);
      kw = kw.map(w => { w.links = strip(w.links); return w; }).filter(w => w.links.length);
      const S = base(kb, kw), I = info(S), bad = new Set<number>();
      let more = false;
      for (const [r, qs] of I) if (badNet(qs)) bad.add(r);
      const mark = (ids: string[]) => { for (const id of ids) if (!dirty.has(id)) { dirty.add(id); more = true; } };
      for (const b of kb) if (bad.has(S.find(cellOf(b[0], b[1])))) mark(b[4]);
      for (const w of kw) if (bad.has(S.find(cellOf(w.a[0], w.a[1])))) mark(w.links);
      const own = new Set([...kb.flatMap(b => b[4]), ...kw.flatMap(w => w.links)]);
      for (const l of links) if (own.has(l.id) && !sat(S, l, I)) mark([l.id]);
      if (!more) break;
    }
    const S = base(kb, kw), fails: Link[] = [];
    for (const l of links.filter(l => !sat(S, l, info(S))).sort(cmp)) { const r = routeOne(S, l); if (!r.ok) fails.push(l); }
    return { S, fails };
  }

  let out = opts.full || (!D.auto.bridges.length && !D.auto.wires.length) ? full() : incremental();
  if (out.fails.length && !opts.full) { const f = full(); if (f.fails.length < out.fails.length) out = f; }
  const S = out.S;
  const freeHoles = (cell: number): Hole[] => {
    if (LY.segs[cell].drilled) return [];
    return LY.holes(cell).filter(([r, c]) => { const k = r + ':' + c; return !pinHoles.has(k) && !S.wireEnds.has(k); });
  };
  // hídút nélküli kapcsolatok: vezeték a két hálózat legközelebbi szabad lyukai között
  for (const l of out.fails) {
    const src = srcOf(S, l), I = info(S), pred = predFor(S, l, I);
    const sc: number[] = [], tc: number[] = [];
    for (let i = 0; i < NC; i++) { const r = S.find(i); if (r === src) sc.push(i); else if (pred(r)) tc.push(i); }
    let bp: [Hole, Hole, number] | null = null, bd = 1e9;
    for (const a of sc) for (const h1 of freeHoles(a)) for (const t of tc) for (const h2 of freeHoles(t)) {
      const d = Math.hypot(h1[0] - h2[0], h1[1] - h2[1]);
      if (d < bd) { bd = d; bp = [h1, h2, t]; }
    }
    if (bp) { S.wires.push({ a: bp[0], b: bp[1], color: '#7048e8', links: [l.id] }); S.wireEnds.add(bp[0].join(':')); S.wireEnds.add(bp[1].join(':')); S.uni(src, bp[2]); }
  }
  // kábelek: külső kivezetés → a cél szekciójának (vagy hálózatának) szabad lyuka, a kivezetéshez legközelebb
  const offByRef = new Map<string, PlacedPin>();
  for (const p of D.parts) if (isOff(p)) for (const q of placedPins(p)) offByRef.set(p.id + '.' + q.id, q);
  const cables = RL.filter(l => offByRef.has(l.a) || offByRef.has(l.b)).sort((x, y) => prio(x) - prio(y));
  const takenG = new Set<number>();
  // a panelra ültetett alkatrészek teste: a kábel vége lehetőleg ne kerüljön alá
  const bodies = D.parts.filter(p => !isOff(p)).map((p: PartInstance) => {
    const b = DEFS[p.type].bounds(p), pts = [xf(p, b.r0, b.c0), xf(p, b.r1, b.c1)];
    return [Math.min(pts[0][0], pts[1][0]), Math.max(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][1], pts[1][1])];
  });
  const covered = (h: Hole) => bodies.some(([r0, r1, c0, c1]) => h[0] > r0 && h[0] < r1 && h[1] > c0 && h[1] < c1);
  const POW = new Set(['p33', 'pwr', 'bp', 'chg', 'pout', 'vin', 'mp']);
  for (const l of cables) {
    const T = (offByRef.get(l.a) || offByRef.get(l.b))!, other = offByRef.has(l.a) ? l.b : l.a;
    if (offByRef.has(other)) { const U = offByRef.get(other)!; S.wires.push({ a: [T.r, T.c], b: [U.r, U.c], color: '#495057', links: [l.id] }); continue; }
    // kábelszín: föld fekete, táp piros, jel narancs
    const X0 = pinByRef.get(other);
    const color = other === 'GND' || T.role === 'gnd' || (X0 && X0.role === 'gnd') ? '#212529' : POW.has(T.role) || (X0 && POW.has(X0.role)) ? '#c92a2a' : '#e8590c';
    const I = info(S);
    let ok: (r: number) => boolean, pref = -1;
    if (other === 'GND') ok = r => isGnd(I.get(r));
    else if (other === 'GPIO') {
      const an = T.role === 'adc';
      if (l.gpio && pinByRef.has(l.gpio)) { const g = pin(l.gpio); pref = S.find(cellOf(g.r, g.c)); }
      ok = r => {
        const qs = I.get(r);
        if (takenG.has(r) || !freeGpio(qs, r, S)) return false;
        const q = qs[0];
        if (claimedG.has(q.part.id + '.' + q.id)) return false;
        return an ? hasCap(q, 'adc') : !hasCap(q, 'in');
      };
    } else {
      const X = pinByRef.get(other);
      if (!X) continue;
      const t = S.find(cellOf(X.r, X.c));
      ok = r => r === t;
    }
    let best: { h: Hole; r: number } | null = null, bd = 1e9;
    for (let i = 0; i < NC; i++) {
      const r = S.find(i);
      if (!ok(r)) continue;
      const tq = (I.get(r) || [])[0];
      const spare = other === 'GPIO' && T.role !== 'adc' && hasCap(tq, 'adc') ? 6 : 0, bonus = r === pref ? -1e4 : 0;
      const gp = other === 'GPIO' ? gpioPenalty(tq) + fnPenalty(T.fn, tq) : 0;
      for (const h of freeHoles(i)) { const d = Math.hypot(h[0] - T.r, h[1] - T.c) + spare + bonus + gp + (covered(h) ? 20 : 0); if (d < bd) { bd = d; best = { h, r }; } }
    }
    // modul lábára mutató kábel: ha a szekció szabad lyukai a test alatt vannak, a kábel a lábba (csatlakozóba) dugva végződik
    {
      const X = other !== 'GND' && other !== 'GPIO' ? pinByRef.get(other) : null;
      if (X && !isMcu(X.part)) {
        const own = freeHoles(cellOf(X.r, X.c)).some(h => !covered(h)), d = Math.hypot(X.r - T.r, X.c - T.c) + (own ? 3 : -5);
        if (d < bd && !S.wireEnds.has(X.r + ':' + X.c)) { bd = d; best = { h: [X.r, X.c], r: S.find(cellOf(X.r, X.c)) }; }
      }
    }
    if (!best) continue;
    const bh = best.h, br = best.r;
    S.wires.push({ a: [T.r, T.c], b: bh, color, links: [l.id] });
    S.wireEnds.add(bh.join(':'));
    if (other === 'GPIO') { takenG.add(br); const g = (I.get(br) || []).find(q => q.role === 'gpio'); if (g) l.gpio = g.part.id + '.' + g.id; }
  }
  D.auto = { bridges: S.bridges, wires: S.wires, cuts: D.auto.cuts || [] };
  const I = info(S);
  for (const l of links) {
    if (l.b !== 'GPIO' || cables.includes(l)) continue;
    const an = needAdc(l);
    const g = (I.get(srcOf(S, l)) || []).find(q => isMcu(q.part) && q.role === 'gpio' && (!an || hasCap(q, 'adc')));
    if (g) l.gpio = g.part.id + '.' + g.id;
  }
  for (const [x, l] of back) l.gpio = x.gpio;
}

/**
 * Kézi bekötés → kapcsolatok: a (pid alkatrész vagy minden) kézi hídjaiból és vezetékeiből kapcsolatokat
 * készít, a hidakat/vezetékeket automatikussá alakítja (kapcsolatonként a saját útjukkal).
 * `A`: netlista az automatikus bekötés nélkül. `before`: közvetlenül a módosítás előtt hívódik (visszavonás).
 * Visszaadja az új kapcsolatok számát (0: nem volt mit átalakítani, a terv változatlan).
 */
export function manualToAuto(D: Design, A: Netlist, pid: string | Set<string> | null, before: () => void): number {
  const inb = (r: number, c: number) => inBoard(D.board, r, c);
  const want = pid ? (pid instanceof Set ? pid : new Set([pid])) : null;
  const conv = new Set<number>(), add: Array<{ a: string; b: string; gpio?: string }> = [];
  const has = (a: string, b: string) => D.links.some(l => (l.a === a && l.b === b) || (l.a === b && l.b === a)) || add.some(l => l.a === a && l.b === b);
  const ref = (q: PlacedPin) => q.part.id + '.' + q.id;
  for (const [net, qs] of A.netPins) {
    if (want && !qs.some(q => want.has(q.part.id))) continue;
    const groups = new Map<string, PlacedPin>();
    for (const q of qs) { const k = q.part.id + ':' + (isMcu(q.part) && q.role === 'gnd' ? 'GND' : partGroups(q.part)[q.id]); if (!groups.has(k)) groups.set(k, q); }
    if (groups.size < 2) continue;
    conv.add(net);
    const reps = [...groups.values()];
    const gnd = reps.find(q => isMcu(q.part) && q.role === 'gnd');
    const gp = reps.filter(q => isMcu(q.part) && q.role === 'gpio');
    const others = reps.filter(q => !isMcu(q.part));
    const pico = reps.filter(q => isMcu(q.part) && q.role !== 'gnd' && q.role !== 'gpio');
    if (gnd) {
      for (const q of others) if (!has(ref(q), 'GND')) add.push({ a: ref(q), b: 'GND' });
      for (const q of [...pico, ...gp]) add.push({ a: ref(q), b: ref(gnd) });
    } else if (gp.length === 1 && others.length && !pico.length && (D.gpio[gp[0].part.id + '.' + gp[0].id] || 'pullup').startsWith('pull')) {
      const g = ref(gp[0]);
      others.forEach((q, i) => {
        if (i === 0) { if (!has(ref(q), 'GPIO')) add.push({ a: ref(q), b: 'GPIO', gpio: g }); }
        else if (!has(ref(q), ref(others[0]))) add.push({ a: ref(q), b: ref(others[0]) });
      });
    } else {
      const anchor = reps[0];
      for (const q of reps.slice(1)) if (!has(ref(q), ref(anchor))) add.push({ a: ref(q), b: ref(anchor) });
    }
  }
  if (!add.length) return 0;
  before();
  const inConv = (r: number, c: number) => inb(r, c) && conv.has(A.find(A.sid(r, c)));
  const pinless = (r: number, c: number) => inb(r, c) && !(A.netPins.get(A.find(A.sid(r, c))) || []).length;
  const isC = (r1: number, c1: number, r2: number, c2: number) => inConv(r1, c1) || inConv(r2, c2);
  const convB = D.bridges.filter(b => isC(b[0], b[1], b[2], b[3])), convW = D.wires.filter(w => isC(w.a[0], w.a[1], w.b[0], w.b[1]));
  // a meglévő hidakat útvonalakra bontja: minden kapcsolat megkapja a saját útját
  const cell = (r: number, c: number) => A.sid(r, c), adj = new Map<number, Array<[number, string, number]>>();
  const addE = (x: number, y: number, k: string, i: number) => {
    if (!adj.has(x)) adj.set(x, []);
    if (!adj.has(y)) adj.set(y, []);
    adj.get(x)!.push([y, k, i]); adj.get(y)!.push([x, k, i]);
  };
  convB.forEach((b, i) => addE(cell(b[0], b[1]), cell(b[2], b[3]), 'b', i));
  convW.forEach((w, i) => addE(cell(w.a[0], w.a[1]), cell(w.b[0], w.b[1]), 'w', i));
  for (const p of D.parts) {
    const m: Record<string, PlacedPin> = {};
    for (const q of placedPins(p)) m[q.id] = q;
    for (const [a, b] of DEFS[p.type].internal(p)) if (inb(m[a].r, m[a].c) && inb(m[b].r, m[b].c)) addE(cell(m[a].r, m[a].c), cell(m[b].r, m[b].c), 'i', -1);
  }
  const cellPins = new Map<number, PlacedPin[]>();
  for (const q of A.pins) { if (!q.on) continue; if (!cellPins.has(q.s)) cellPins.set(q.s, []); cellPins.get(q.s)!.push(q); }
  const aB: string[][] = convB.map(() => []), aW: string[][] = convW.map(() => []);
  const newLinks: Link[] = add.map(l => ({ id: 'l' + D.seq++, a: l.a, b: l.b, gpio: l.gpio || null }));
  for (const l of newLinks) {
    const qa = findPin(D, l.a)!, start = cell(qa.r, qa.c);
    const goal = l.b === 'GND' ? (c: number) => (cellPins.get(c) || []).some(q => isMcu(q.part) && q.role === 'gnd')
      : l.b === 'GPIO' ? (c: number) => { const g = findPin(D, l.gpio!); return !!g && c === cell(g.r, g.c); }
        : (c: number) => { const t = findPin(D, l.b); return !!t && c === cell(t.r, t.c); };
    const prev = new Map<number, [number, string, number] | null>([[start, null]]), qu = [start];
    let hit = goal(start) ? start : -1;
    while (qu.length && hit < 0) {
      const x = qu.shift()!;
      for (const e of adj.get(x) || []) {
        if (prev.has(e[0])) continue;
        prev.set(e[0], [x, e[1], e[2]]);
        if (goal(e[0])) { hit = e[0]; break; }
        qu.push(e[0]);
      }
    }
    for (let x = hit; x >= 0 && prev.get(x);) {
      const [px, k, i] = prev.get(x)!;
      if (k === 'b') aB[i].push(l.id); else if (k === 'w') aW[i].push(l.id);
      x = px;
    }
  }
  D.bridges = D.bridges.filter(b => !(isC(b[0], b[1], b[2], b[3]) || (!pid && pinless(b[0], b[1]))));
  D.wires = D.wires.filter(w => !isC(w.a[0], w.a[1], w.b[0], w.b[1]));
  D.auto.bridges.push(...convB.map((b, i) => [b[0], b[1], b[2], b[3], aB[i]] as AutoBridge).filter(b => b[4].length));
  D.auto.wires.push(...convW.map((w, i) => ({ a: w.a, b: w.b, color: w.color, links: aW[i] })).filter(w => w.links.length));
  D.links.push(...newLinks);
  D.settings.autoRoute = true;
  return newLinks.length;
}
