/**
 * Tömörség: a terv által foglalt terület és a kitöltöttsége (a későbbi tömörítés kiindulópontja és mércéje).
 * A foglalt terület a panelra szerelt alkatrészek teste, valamint a hidak és vezetékek befoglaló téglalapja
 * (a panelra vágva); a kitöltés az alkatrésztestek összterülete ehhez képest. A tömörítés (`planCompaction`) a
 * mozdítható alkatrészeket kisebb területre, a kapcsolódó lábak közelébe teszi; az eredményét az `applyCompaction` írja a tervbe.
 */
import type { PartInstance } from '../core/schema';
import { buildLayout } from './board';
import { DEFS, isMcu, isOff } from './defs';
import { placedPins, xf } from './geometry';
import { equivPins, findPin, linkStates, partGroups } from './links';
import { analyze } from './netlist';
import { route } from './route';
import type { Design } from './types';

export interface LayoutStats {
  /** foglalt terület (befoglaló téglalap, lyukban); üres tervnél null */
  box: { r0: number; r1: number; c0: number; c1: number } | null;
  rows: number; cols: number;
  /** a foglalt terület és a panel területe (lyuk) */
  area: number; boardArea: number;
  /** az alkatrésztestek területe (lyuk) és aránya a foglalt területhez (0–1) */
  partArea: number; fill: number;
  /** a panelra szerelt / rögzített alkatrészek száma */
  parts: number; fixed: number;
}

/** Az alkatrész testének téglalapja a panel koordinátáiban (a forgatás és tükrözés után). */
export function partRect(p: PartInstance): { r0: number; r1: number; c0: number; c1: number } {
  const b = DEFS[p.type].bounds(p), cs = [[b.r0, b.c0], [b.r0, b.c1], [b.r1, b.c0], [b.r1, b.c1]].map(([r, c]) => xf(p, r, c));
  const rs = cs.map(x => x[0]), ks = cs.map(x => x[1]);
  return { r0: Math.round(Math.min(...rs)), r1: Math.round(Math.max(...rs)), c0: Math.round(Math.min(...ks)), c1: Math.round(Math.max(...ks)) };
}

export function layoutStats(D: Design): LayoutStats {
  const B = D.board, clip = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
  let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity, partArea = 0, parts = 0, fixed = 0;
  const grow = (r: number, c: number) => { r = clip(r, B.rows); c = clip(c, B.cols); r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); };
  for (const p of D.parts) {
    if (isOff(p)) continue;
    const q = partRect(p);
    const a = { r0: clip(q.r0, B.rows), r1: clip(q.r1, B.rows), c0: clip(q.c0, B.cols), c1: clip(q.c1, B.cols) };
    parts++; if (p.fixed) fixed++;
    partArea += (a.r1 - a.r0 + 1) * (a.c1 - a.c0 + 1);
    grow(a.r0, a.c0); grow(a.r1, a.c1);
  }
  for (const b of [...D.bridges, ...D.auto.bridges]) { grow(b[0], b[1]); grow(b[2], b[3]); }
  for (const w of [...D.wires, ...D.auto.wires]) for (const e of [w.a, w.b]) if (e[0] >= 0 && e[0] < B.rows && e[1] >= 0 && e[1] < B.cols) grow(e[0], e[1]);
  const boardArea = B.rows * B.cols;
  if (r0 === Infinity) return { box: null, rows: 0, cols: 0, area: 0, boardArea, partArea: 0, fill: 0, parts, fixed };
  const rows = r1 - r0 + 1, cols = c1 - c0 + 1, area = rows * cols;
  return { box: { r0, r1, c0, c1 }, rows, cols, area, boardArea, partArea, fill: Math.min(1, partArea / area), parts, fixed };
}

/* ---------- Tömörítés ---------- */

export interface CompactOpts {
  /** 0 = laza (nagyobb hézag, kevés mozgás), 1 = szoros (nincs hézag, szabad mozgás); alapból 0,5 */
  strength?: number;
  /** csak ezek az alkatrészek (azonosító) mozdulhatnak; alapból mind */
  only?: Iterable<string> | null;
  /** a vezérlőlap a helyén marad (alapból igen) */
  keepMcu?: boolean;
  /** a kezelőszervek (gomb, csúszka, csatlakozó) a helyükön maradnak (alapból igen) */
  keepControls?: boolean;
  /** elforgatás is (alapból igen) */
  rotate?: boolean;
  /** legfeljebb ennyi kör (alapból 40) */
  maxPasses?: number;
}
/** A bekötés és a terület egy pillanatban. */
export interface CompactMetrics { stats: LayoutStats; links: number; linksOk: number; bridges: number; wires: number; cuts: number }
export interface CompactMove { id: string; label: string; from: { r: number; c: number; rot: number }; to: { r: number; c: number; rot: number } }
/** Miért marad egy alkatrész a helyén. */
export type KeepReason = 'fixed' | 'mcu' | 'control' | 'manual' | 'off' | 'scope';
export interface CompactResult {
  moves: CompactMove[];
  before: CompactMetrics; after: CompactMetrics;
  /** a helyén maradt alkatrészek (címke → ok) */
  kept: Record<string, KeepReason>;
}

const clone = (D: Design): Design => JSON.parse(JSON.stringify(D)) as Design;
/** a csíkok mentén olcsó a távolság (egy szakaszon belül nem kell híd) */
const dist = (a: { r: number; c: number }, b: { r: number; c: number }) => Math.abs(a.r - b.r) / 3 + Math.abs(a.c - b.c);

/** A terv bekötésének mérőszámai (a terv mostani `auto` bekötéséből és netlistájából). */
export function compactMetrics(D: Design): CompactMetrics {
  const st = linkStates(D, analyze(D));
  let ok = 0; for (const s of st.values()) if (s.ok) ok++;
  return { stats: layoutStats(D), links: D.links.length, linksOk: ok, bridges: D.bridges.length + D.auto.bridges.length, wires: D.wires.length + D.auto.wires.length, cuts: (D.cuts || []).length + (D.auto.cuts || []).length };
}
const reroute = (D: Design) => { if (D.settings.autoRoute && D.links.length) route(D, { full: true }); };

/**
 * Tömörítési terv (a tervet nem módosítja): a mozdítható alkatrészek a kapcsolódó lábak felé, kisebb területre kerülnek.
 * Helyi keresés: körönként alkatrészenként a legjobb szabad hely (eltolás, elforgatás) a becsült bekötési hossz, a foglalt
 * terület és az elmozdulás súlyozott összege szerint, amíg javul. A végén teljes útvonalkeresés ellenőrzi: a bekötött
 * kapcsolatok száma nem csökken, nem kell több vezeték, és a hidak száma és a terület súlyozott összege kisebb lesz; ha
 * nem, a köztes körök közül a legutolsó jót választja (felezéssel), végső esetben nem mozdít semmit.
 * Nem mozdul: a rögzített, a külső, a kézi hidakkal/vezetékekkel vagy kapcsolat nélküli közös csíkkal bekötött alkatrész.
 */
export function planCompaction(D0: Design, o: CompactOpts = {}): CompactResult {
  const s = Math.max(0, Math.min(1, o.strength ?? 0.5));
  const gap = s < 0.34 ? 2 : s < 0.67 ? 1 : 0, wMove = 0.25 - 0.22 * s, wArea = 0.02 + 0.1 * s, R = Math.round(4 + 8 * s);
  const keepMcu = o.keepMcu !== false, keepCtl = o.keepControls !== false, rotate = o.rotate !== false, maxPasses = o.maxPasses ?? 40;
  const only = o.only ? new Set(o.only) : null;
  // „előtte”: ahogy a terv most áll (amit a felhasználó lát); a keresés a teljesen újratervezett állapotból indul
  const D = clone(D0); reroute(D);
  const cur = compactMetrics(D0), full = compactMetrics(D), before = cur.linksOk >= full.linksOk ? cur : full; // be nem kötött (régi) állapotnál az újratervezett
  const B = D.board, onB = (r: number, c: number) => r >= 0 && c >= 0 && r < B.rows && c < B.cols;
  const LY = buildLayout(B, D.cuts || []); // csak a kézi vágások: az automatikusakat az útvonalkereső újratervezi
  const cellOf = (r: number, c: number) => (onB(r, c) && !LY.drilled(r, c) ? LY.cell(r, c) : -1);

  // szándékolt hálózatok a kapcsolatokból: láb → hálózat (a gyárilag összekötött lábak egyben, GND egy hálózat)
  const par = new Map<string, string>();
  const f = (x: string): string => { const p = par.get(x); if (p == null || p === x) { par.set(x, x); return x; } const r = f(p); par.set(x, r); return r; };
  const uni = (a: string, b: string) => { const x = f(a), y = f(b); if (x !== y) par.set(x, y); };
  for (const p of D.parts) { const g = partGroups(p); for (const k in g) uni(p.id + '.' + k, p.id + '.' + g[k]); for (const q of placedPins(p)) if (isMcu(p) && q.role === 'gnd') uni(p.id + '.' + q.id, 'GND'); }
  for (const l of D.links) { if (l.b === 'GND') uni(l.a, 'GND'); else if (l.b === 'GPIO') { if (l.gpio) uni(l.a, l.gpio); } else uni(l.a, l.b); }
  const netOf = (pid: string, pin: string) => f(pid + '.' + pin);

  // ki mozdulhat
  const kept: Record<string, KeepReason> = {};
  const isCtl = (p: PartInstance) => !!((DEFS[p.type].def.controls || []).length || DEFS[p.type].def.socket);
  for (const p of D.parts) {
    const why: KeepReason | null = isOff(p) ? 'off' : p.fixed ? 'fixed' : keepMcu && isMcu(p) ? 'mcu' : keepCtl && isCtl(p) ? 'control' : only && !only.has(p.id) ? 'scope' : null;
    if (why) kept[p.id] = why;
  }
  // kézi bekötés: kézi híd/vezeték a láb cellájában, vagy kapcsolat nélküli közös csík egy másik alkatrész lábával
  const manualCells = new Set<number>();
  for (const b of D.bridges) { manualCells.add(cellOf(b[0], b[1])); manualCells.add(cellOf(b[2], b[3])); }
  for (const w of D.wires) for (const e of [w.a, w.b]) manualCells.add(cellOf(e[0], e[1]));
  const occ = new Map<number, Array<{ pid: string; net: string }>>();
  for (const p of D.parts) if (!isOff(p)) for (const q of placedPins(p)) { const k = cellOf(q.r, q.c); if (k < 0) continue; if (!occ.has(k)) occ.set(k, []); occ.get(k)!.push({ pid: p.id, net: netOf(p.id, q.id) }); }
  for (const p of D.parts) {
    if (kept[p.id] || isOff(p)) continue;
    for (const q of placedPins(p)) {
      const k = cellOf(q.r, q.c); if (k < 0) continue;
      const n = netOf(p.id, q.id);
      if ((manualCells.has(k) && k >= 0) || (occ.get(k) || []).some(x => x.pid !== p.id && x.net !== n)) { kept[p.id] = 'manual'; break; }
    }
  }
  const movable = D.parts.filter(p => !kept[p.id]);
  const keptOut: Record<string, KeepReason> = {};
  for (const id in kept) { const p = D.parts.find(x => x.id === id)!; keptOut[p.label] = kept[id]; }
  if (!movable.length) return { moves: [], before, after: before, kept: keptOut };

  // a kapcsolatok végpontjai: lábcsoportok (gyárilag összekötött lábak), a célnál a lehetséges lábak
  type End = Array<{ pid: string; pin: string }>;
  const grp = (ref: string): End => { const q = findPin(D, ref); return q ? equivPins(q).map(x => ({ pid: q.part.id, pin: x.id })) : []; };
  const mcuPins = (role: string): End => D.parts.filter(p => isMcu(p)).flatMap(p => placedPins(p).filter(q => q.role === role && onB(q.r, q.c)).map(q => ({ pid: p.id, pin: q.id })));
  const ends: Array<[End, End]> = D.links.map(l => [grp(l.a), l.b === 'GND' ? mcuPins('gnd') : l.b === 'GPIO' ? (l.gpio ? grp(l.gpio) : mcuPins('gpio')) : grp(l.b)]);
  const partLinks = new Map<string, number[]>();
  ends.forEach(([a, b], i) => { for (const x of [...a, ...b]) { if (!partLinks.has(x.pid)) partLinks.set(x.pid, []); const L = partLinks.get(x.pid)!; if (!L.includes(i)) L.push(i); } });

  // pillanatnyi állapot: alkatrészenként a lábak helye és a test téglalapja
  const pinPos = new Map<string, Map<string, { r: number; c: number }>>();
  const rectOf = new Map<string, { r0: number; r1: number; c0: number; c1: number }>();
  const shapeRect = (p: PartInstance) => { const q = partRect(p), ps = placedPins(p); return { r0: Math.min(q.r0, ...ps.map(x => x.r)), r1: Math.max(q.r1, ...ps.map(x => x.r)), c0: Math.min(q.c0, ...ps.map(x => x.c)), c1: Math.max(q.c1, ...ps.map(x => x.c)) }; };
  const setState = (p: PartInstance) => { pinPos.set(p.id, new Map(placedPins(p).map(q => [q.id, { r: q.r, c: q.c }]))); if (!isOff(p)) rectOf.set(p.id, shapeRect(p)); };
  for (const p of D.parts) setState(p);
  const linkCost = (i: number, over?: { pid: string; pins: Map<string, { r: number; c: number }> }) => {
    const pos = (e: { pid: string; pin: string }) => (over && e.pid === over.pid ? over.pins : pinPos.get(e.pid))!.get(e.pin);
    let best = Infinity;
    for (const a of ends[i][0]) { const pa = pos(a); if (!pa) continue; for (const b of ends[i][1]) { if (b.pid === a.pid && b.pin === a.pin) continue; const pb = pos(b); if (pb) best = Math.min(best, dist(pa, pb)); } }
    return best === Infinity ? 0 : best;
  };
  const orig = new Map(movable.map(p => [p.id, { r: p.r, c: p.c, rot: p.rot }]));

  // alkatrészenként, elforgatásonként: a lábak és a téglalap eltolása az origóhoz képest
  type Shape = { rot: number; pins: Array<{ id: string; r: number; c: number }>; rect: { r0: number; r1: number; c0: number; c1: number } };
  const shapes = new Map<string, Shape[]>();
  for (const p of movable) {
    const rots = rotate ? [0, 1, 2, 3] : [p.rot];
    shapes.set(p.id, rots.map(rot => { const t = { ...p, r: 0, c: 0, rot }; return { rot, pins: placedPins(t).map(q => ({ id: q.id, r: q.r, c: q.c })), rect: shapeRect(t) }; }));
  }

  const tryPart = (p: PartInstance): boolean => {
    // a többi alkatrész téglalapja és a foglalt terület nélküle
    let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
    for (const [id, q] of rectOf) { if (id === p.id) continue; r0 = Math.min(r0, q.r0); r1 = Math.max(r1, q.r1); c0 = Math.min(c0, q.c0); c1 = Math.max(c1, q.c1); }
    const others = [...rectOf].filter(([id]) => id !== p.id).map(x => x[1]);
    const lk = partLinks.get(p.id) || [], o0 = orig.get(p.id)!;
    const evalAt = (sh: Shape, r: number, c: number) => {
      const pins = new Map(sh.pins.map(q => [q.id, { r: q.r + r, c: q.c + c }]));
      let L = 0; for (const i of lk) L += linkCost(i, { pid: p.id, pins });
      const a = { r0: Math.min(r0, sh.rect.r0 + r), r1: Math.max(r1, sh.rect.r1 + r), c0: Math.min(c0, sh.rect.c0 + c), c1: Math.max(c1, sh.rect.c1 + c) };
      const area = (a.r1 - a.r0 + 1) * (a.c1 - a.c0 + 1);
      return L + wArea * area + wMove * (Math.abs(r - o0.r) + Math.abs(c - o0.c) + (sh.rot !== o0.rot ? 2 : 0));
    };
    const cur = shapes.get(p.id)!.find(x => x.rot === p.rot) || shapes.get(p.id)![0];
    const curCost = evalAt(cur, p.r, p.c);
    const seen = new Set<string>(), cands: Array<[number, Shape, number, number]> = [];
    const add = (sh: Shape, r: number, c: number) => { const k = sh.rot + ':' + r + ':' + c; if (seen.has(k)) return; seen.add(k); cands.push([evalAt(sh, r, c), sh, r, c]); };
    for (const sh of shapes.get(p.id)!) {
      for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) add(sh, p.r + dr, p.c + dc);
      // a kapcsolódó lábak közelébe is
      if (lk.length <= 8) for (const i of lk) for (const side of [0, 1]) {
        const mine = ends[i][side].filter(e => e.pid === p.id), them = ends[i][1 - side].filter(e => e.pid !== p.id);
        for (const m of mine) { const off = sh.pins.find(q => q.id === m.pin); if (!off) continue;
          for (const t of them) { const pt = pinPos.get(t.pid)!.get(t.pin); if (!pt) continue;
            for (let dr = -4; dr <= 4; dr++) for (let dc = -3; dc <= 3; dc++) add(sh, pt.r + dr - off.r, pt.c + dc - off.c); } }
      }
    }
    cands.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[3] - b[3] || a[1].rot - b[1].rot);
    for (const [cost, sh, r, c] of cands) {
      if (cost >= curCost - 1e-6) return false;
      if (valid(p, sh, r, c, others)) { p.r = r; p.c = c; p.rot = sh.rot; setState(p); return true; }
    }
    return false;
  };
  const valid = (p: PartInstance, sh: Shape, r: number, c: number, others: Array<{ r0: number; r1: number; c0: number; c1: number }>) => {
    const q = { r0: sh.rect.r0 + r, r1: sh.rect.r1 + r, c0: sh.rect.c0 + c, c1: sh.rect.c1 + c };
    if (q.r0 < 0 || q.c0 < 0 || q.r1 >= B.rows || q.c1 >= B.cols) return false;
    for (const x of others) if (q.r0 - gap <= x.r1 && x.r0 <= q.r1 + gap && q.c0 - gap <= x.c1 && x.c0 <= q.c1 + gap) return false;
    const mine = new Map<number, string>();
    for (const pn of sh.pins) {
      const k = cellOf(pn.r + r, pn.c + c); if (k < 0) return false;
      const n = netOf(p.id, pn.id);
      if (mine.has(k) && mine.get(k) !== n) return false; mine.set(k, n);
      if (manualCells.has(k)) return false;
      for (const x of occ.get(k) || []) if (x.pid !== p.id && x.net !== n) return false;
    }
    return true;
  };
  const occMove = (p: PartInstance, add: boolean) => {
    for (const q of placedPins(p)) { const k = cellOf(q.r, q.c); if (k < 0) continue;
      if (add) { if (!occ.has(k)) occ.set(k, []); occ.get(k)!.push({ pid: p.id, net: netOf(p.id, q.id) }); }
      else occ.set(k, (occ.get(k) || []).filter(x => x.pid !== p.id)); }
  };
  // a bekötés pontszáma (útvonalkeresés után): kevesebb híd, kisebb terület; laza beállításnál a híd számít többet
  const lam = 0.05 + 0.6 * s, score = (m: CompactMetrics) => m.bridges + lam * m.stats.area;
  const okState = (): boolean => { const T = clone(D); reroute(T); const m = compactMetrics(T); return m.linksOk >= before.linksOk && m.wires <= before.wires && score(m) < score(before) - 1e-9; };
  const snaps: Array<Map<string, { r: number; c: number; rot: number }>> = [];
  const take = () => new Map(movable.map(p => [p.id, { r: p.r, c: p.c, rot: p.rot }]));
  const restore = (m: Map<string, { r: number; c: number; rot: number }>) => { for (const p of movable) { occMove(p, false); const x = m.get(p.id)!; p.r = x.r; p.c = x.c; p.rot = x.rot; setState(p); occMove(p, true); } };
  snaps.push(take());
  for (let pass = 0; pass < maxPasses; pass++) {
    // a legtöbbet „húzó” alkatrész előbb
    const weight = (p: PartInstance) => (partLinks.get(p.id) || []).reduce((s2, i) => s2 + linkCost(i), 0);
    let n = 0;
    for (const p of [...movable].sort((a, b) => weight(b) - weight(a) || a.id.localeCompare(b.id))) { occMove(p, false); if (tryPart(p)) n++; occMove(p, true); }
    if (!n) break;
    snaps.push(take());
  }
  // ellenőrzés: a legutolsó jó állapot (ha a végső nem jó, felezéssel keresi a köztes körök közül)
  if (snaps.length > 1 && !okState()) {
    let lo = 0, hi = snaps.length - 1; // lo: jó (a kiinduló mindig elfogadható), hi: nem jó
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; restore(snaps[mid]); if (mid > 0 && okState()) lo = mid; else hi = mid; }
    restore(snaps[lo]);
  }

  const moves: CompactMove[] = [];
  for (const p of movable) { const a = orig.get(p.id)!; if (a.r !== p.r || a.c !== p.c || a.rot !== p.rot) moves.push({ id: p.id, label: p.label, from: a, to: { r: p.r, c: p.c, rot: p.rot } }); }
  reroute(D);
  return { moves, before, after: moves.length ? compactMetrics(D) : before, kept: keptOut };
}

/** A tömörítési terv alkalmazása (a tervet helyben módosítja, az útvonalat nem számolja újra – utána teljes útvonalkeresés kell, `route(D, { full: true })`, különben a régi hidak megmaradnak); volt-e változás. */
export function applyCompaction(D: Design, res: CompactResult): boolean {
  let n = 0;
  for (const m of res.moves) { const p = D.parts.find(x => x.id === m.id); if (!p) continue; p.r = m.to.r; p.c = m.to.c; p.rot = m.to.rot; n++; }
  return n > 0;
}
