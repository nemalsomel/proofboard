/**
 * Csatlakozók: a külső alkatrész (mount 'off') kábele egy panelra ültetett csatlakozóba (tüskesor, `socket`)
 * dugva. A külső alkatrész i. lába és a csatlakozó i. lába egy hálózat; a kapcsolatok útvonalkeresése
 * a csatlakozó lábáról indul, így a kábel helyett hidak és vezetékek viszik tovább a jelet.
 */
import type { PartDef, PartInstance } from '../core/schema';
import { buildLayout } from './board';
import { DEFS, isOff } from './defs';
import { inBoard, placedPins, xf } from './geometry';
import type { Design, Hole, PlacedPin } from './types';

/** A csatlakozó lábai sorrendben (a `socket.pins` szerint, vagy az összes láb). */
export function socketPins(h: PartInstance): PlacedPin[] {
  const s = DEFS[h.type] && DEFS[h.type].def.socket;
  if (!s) return [];
  const all = placedPins(h);
  if (!s.pins) return all;
  const m = new Map(all.map(q => [q.id, q]));
  return s.pins.map(id => m.get(id)).filter((q): q is PlacedPin => !!q);
}

/** A külső alkatrész csatlakozója (ha érvényes: létező, csatlakozó típusú, elég lábú). */
export function plugOf(D: Design, p: PartInstance): PartInstance | null {
  if (!p.plug || !isOff(p)) return null;
  const h = D.parts.find(x => x.id === p.plug);
  if (!h || !DEFS[h.type] || !DEFS[h.type].def.socket) return null;
  return socketPins(h).length >= DEFS[p.type].pins(p).length ? h : null;
}

/** A csatlakozóba dugott külső alkatrész. */
export const pluggedInto = (D: Design, h: PartInstance): PartInstance | null =>
  D.parts.find(p => p.plug === h.id && plugOf(D, p) === h) || null;

/** Lábpárok: [külső láb, csatlakozó láb], a lábak sorrendjében. */
export function plugPairs(D: Design, p: PartInstance): Array<[PlacedPin, PlacedPin]> {
  const h = plugOf(D, p);
  if (!h) return [];
  const a = placedPins(p), b = socketPins(h);
  return a.map((q, i) => [q, b[i]] as [PlacedPin, PlacedPin]);
}

/** Hivatkozás (alkatrész.láb) → a csatlakozó lába, ha a láb egy bedugott külső alkatrészé; különben önmaga. */
export function plugAlias(D: Design): (ref: string) => string {
  const m = new Map<string, string>();
  for (const p of D.parts) for (const [q, h] of plugPairs(D, p)) m.set(p.id + '.' + q.id, h.part.id + '.' + h.id);
  return ref => m.get(ref) ?? ref;
}

/** Az első csatlakozó típus (adatból: `socket`), amellyel új csatlakozó készül. */
export function socketType(defs: Record<string, { def: PartDef }> = DEFS): string | null {
  for (const [k, c] of Object.entries(defs)) if (c.def.socket && c.def.socket.count && c.def.mount !== 'off') return k;
  return null;
}

/**
 * Új csatlakozó helye a külső alkatrészhez: n egymás melletti szabad lyuk (nincs ott láb, nincs alkatrésztest
 * alatta, a széleken belül), a külső alkatrész lábaihoz legközelebb. Vízszintes (rot 0) vagy függőleges (rot 1).
 * A lábak külön rézdarabra (cellára) esnek, különben összezárnának; ahol lehet, olyan cellára, amelyen nincs más láb.
 */
export function plugSpot(D: Design, p: PartInstance, n: number): { r: number; c: number; rot: number } | null {
  const B = D.board, used = new Set<string>(), boxes: number[][] = [];
  for (const x of D.parts) {
    if (isOff(x)) continue;
    for (const q of placedPins(x)) used.add(q.r + ':' + q.c);
    const b = DEFS[x.type].bounds(x), pts = [xf(x, b.r0, b.c0), xf(x, b.r1, b.c1)];
    boxes.push([Math.min(pts[0][0], pts[1][0]), Math.max(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][1], pts[1][1])]);
  }
  for (const w of D.wires) for (const e of [w.a, w.b]) used.add(e[0] + ':' + e[1]);
  const LY = buildLayout(B, [...(D.cuts || []), ...((D.auto && D.auto.cuts) || [])]), busy = new Set<number>();
  for (const x of D.parts) if (!isOff(x)) for (const q of placedPins(x)) if (inBoard(B, q.r, q.c)) busy.add(LY.cell(q.r, q.c));
  // az alkatrésztestektől egy lyuk távolság marad, hogy a hidak és vezetékek elférjenek
  const free = (r: number, c: number) => inBoard(B, r, c) && !used.has(r + ':' + c) && !boxes.some(([r0, r1, c0, c1]) => r > r0 - 1 && r < r1 + 1 && c > c0 - 1 && c < c1 + 1);
  const ps = placedPins(p), cr = ps.reduce((t, q) => t + q.r, 0) / ps.length, cc = ps.reduce((t, q) => t + q.c, 0) / ps.length;
  // a kábel iránya: a test közepétől a kivezetések felé; a csatlakozó lehetőleg ebben az irányban legyen
  const pb = DEFS[p.type].bounds(p), [or, oc] = xf(p, (pb.r0 + pb.r1) / 2, (pb.c0 + pb.c1) / 2), ul = Math.hypot(cr - or, cc - oc) || 1, ur = (cr - or) / ul, uc = (cc - oc) / ul;
  let best: { r: number; c: number; rot: number } | null = null, bd = Infinity;
  for (let r = 0; r < B.rows; r++) for (let c = 0; c < B.cols; c++) for (const rot of [0, 1]) {
    const holes: Hole[] = Array.from({ length: n }, (_, i) => (rot ? [r + i, c] : [r, c + i]));
    if (!holes.every(([hr, hc]) => free(hr, hc))) continue;
    const cells = holes.map(([hr, hc]) => LY.cell(hr, hc));
    if (new Set(cells).size < n) continue;
    const mr = rot ? r + (n - 1) / 2 : r, mc = rot ? c : c + (n - 1) / 2;
    const dl = Math.hypot(mr - cr, mc - cc) || 1, cos = ((mr - cr) * ur + (mc - cc) * uc) / dl;
    const d = dl + 4 * (1 - cos) + (rot ? 0.5 : 0) + 40 * cells.filter(x => busy.has(x)).length;
    if (d < bd) { bd = d; best = { r, c, rot: rot ? 1 : 0 }; }
  }
  return best;
}

/** Csatlakozó beállításai a külső alkatrészhez: lábszám és lábnevek a `socket` szerint. */
export function socketProps(def: PartDef, p: PartInstance): Record<string, unknown> {
  const s = def.socket!, ps = DEFS[p.type].pins(p);
  return { ...(s.count ? { [s.count]: ps.length } : {}), ...(s.names ? { [s.names]: ps.map(q => q.name).join(',') } : {}) };
}

/**
 * Meglévő, szabad csatlakozó a külső alkatrészhez: a kábel lábszámával egyező, és a külső alkatrész kapcsolatai
 * lábról lábra éppen ennek a lábaira mutatnak (pl. a léptetőmotor A–D, + → a ULN2003 motorcsatlakozója).
 */
export function matchingSocket(D: Design, p: PartInstance): PartInstance | null {
  const ps = DEFS[p.type].pins(p);
  for (const h of D.parts) {
    if (isOff(h) || !DEFS[h.type].def.socket || pluggedInto(D, h)) continue;
    const sp = socketPins(h);
    if (sp.length !== ps.length) continue;
    const ok = ps.every((q, i) => {
      const a = p.id + '.' + q.id, b = h.id + '.' + sp[i].id;
      return D.links.some(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
    });
    if (ok) return h;
  }
  return null;
}

/** Bedugás után fölösleges kapcsolatok: a külső lábról a neki megfelelő csatlakozólábra mutatók. */
export function plugRedundantLinks(D: Design): Set<string> {
  const al = plugAlias(D), out = new Set<string>();
  for (const l of D.links) if (l.b !== 'GND' && l.b !== 'GPIO' && al(l.a) === al(l.b)) out.add(l.id);
  return out;
}
