/**
 * Találatvizsgálat és csoportos kijelölés a panelon: mi van a kurzor alatt (alkatrész, vezeték, híd, jegyzet),
 * és a kijelölt elemek együttes mozgatása. Tiszta függvények (a tervet és a leírásokat paraméterként kapják),
 * a vásznat és a felület állapotát nem olvassák; az interakció (`ui/interact.ts`) és a gazda (`app.ts`) hívja.
 */
import type { Bridge, Design, Hole, Note, Wire } from '../engine/types';
import type { PartInstance } from '../core/schema';
import { ixf } from '../engine/geometry';

/** A leírás határoló téglalapja (helyi koordinátákban). */
export interface Bounds { r0: number; r1: number; c0: number; c1: number }
export type BoundsOf = (p: PartInstance) => Bounds;

/** A pont legfelső alkatrésze (a később lerakott van felül). */
export function hitPart(D: Design, boundsOf: BoundsOf, rf: number, cf: number): PartInstance | null {
  for (let i = D.parts.length - 1; i >= 0; i--) {
    const p = D.parts[i], b = boundsOf(p), [lr, lc] = ixf(p, rf, cf);
    if (lr >= b.r0 && lr <= b.r1 && lc >= b.c0 && lc <= b.c1) return p;
  }
  return null;
}

/** A pont távolsága egy szakasztól (lyukegységben). */
export function segDist(pr: number, pc: number, r1: number, c1: number, r2: number, c2: number): number {
  const dr = r2 - r1, dc = c2 - c1, l = dr * dr + dc * dc;
  let t = l ? ((pr - r1) * dr + (pc - c1) * dc) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(pr - (r1 + t * dr), pc - (c1 + t * dc));
}

/**
 * A legközelebbi vezeték indexe (`tol`-on belül), különben -1. Rövid vezeték nézetben (`stub`) csak a két végén
 * látszó csonk számít, ha a vonal épp nem látszik teljesen (`full`).
 */
export function hitWire(D: Design, rf: number, cf: number, tol: number,
  stub: (w: Wire) => { k: number } | null, full: (w: Wire, i: number) => boolean): number {
  let best = -1, bd = tol;
  D.wires.forEach((w, i) => {
    const sb = stub(w);
    let d: number;
    if (sb && !full(w, i)) {
      const ar = w.a[0] + (w.b[0] - w.a[0]) * sb.k, ac = w.a[1] + (w.b[1] - w.a[1]) * sb.k;
      const br = w.b[0] - (w.b[0] - w.a[0]) * sb.k, bc = w.b[1] - (w.b[1] - w.a[1]) * sb.k;
      d = Math.min(segDist(rf, cf, w.a[0], w.a[1], ar, ac), segDist(rf, cf, br, bc, w.b[0], w.b[1]));
    } else d = segDist(rf, cf, w.a[0], w.a[1], w.b[0], w.b[1]);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/** A legközelebbi kézi híd indexe (`tol`-on belül), különben -1. */
export function hitBridge(D: Design, rf: number, cf: number, tol: number): number {
  let best = -1, bd = tol;
  D.bridges.forEach((b, i) => { const d = segDist(rf, cf, b[0], b[1], b[2], b[3]); if (d < bd) { bd = d; best = i; } });
  return best;
}

/** A pont legfelső jegyzete. */
export function hitNote(D: Design, rf: number, cf: number): Note | null {
  const ns = D.notes || [];
  for (let i = ns.length - 1; i >= 0; i--) {
    const n = ns[i];
    if (rf >= n.r - 0.5 && rf <= n.r + n.h - 0.5 && cf >= n.c - 0.5 && cf <= n.c + n.w - 0.5) return n;
  }
  return null;
}
/** A jegyzet jobb alsó sarka (átméretezés). */
export const noteCorner = (n: Note, rf: number, cf: number): boolean => Math.abs(rf - (n.r + n.h - 0.5)) < 0.6 && Math.abs(cf - (n.c + n.w - 0.5)) < 0.6;

/** Csoportos kijelölés: alkatrész-azonosítók, kézi hidak és vezetékek indexei. */
export interface Group { kind: 'group'; parts: Set<string>; bridges: Set<number>; wires: Set<number> }
export const grp = (parts?: Iterable<string>, bridges?: Iterable<number>, wires?: Iterable<number>): Group =>
  ({ kind: 'group', parts: new Set(parts || []), bridges: new Set(bridges || []), wires: new Set(wires || []) });
export const gSize = (g: Group): number => g.parts.size + g.bridges.size + g.wires.size;

/** A csoport kiinduló helyzete mozgatáshoz. */
export interface GroupSnap {
  parts: Array<{ p: PartInstance; r: number; c: number }>;
  bridges: Array<{ i: number; b: Bridge }>;
  wires: Array<{ i: number; a: Hole; b: Hole }>;
}
export function groupSnap(D: Design, g: Group): GroupSnap {
  return {
    parts: [...g.parts].map(id => D.parts.find(p => p.id === id)).filter((p): p is PartInstance => !!p).map(p => ({ p, r: p.r, c: p.c })),
    bridges: [...g.bridges].map(i => ({ i, b: [...D.bridges[i]] as Bridge })),
    wires: [...g.wires].map(i => ({ i, a: [...D.wires[i].a] as Hole, b: [...D.wires[i].b] as Hole })),
  };
}
/** Eltolható-e a csoport (`fits`: az alkatrész elfér; `inb`: a lyuk a panelon). */
export function groupOk(sn: GroupSnap, dr: number, dc: number, fits: (p: PartInstance) => boolean, inb: (r: number, c: number) => boolean): boolean {
  return sn.parts.every(o => fits({ ...o.p, r: o.r + dr, c: o.c + dc }))
    && sn.bridges.every(o => inb(o.b[0] + dr, o.b[1] + dc) && inb(o.b[2] + dr, o.b[3] + dc))
    && sn.wires.every(o => inb(o.a[0] + dr, o.a[1] + dc) && inb(o.b[0] + dr, o.b[1] + dc));
}
/** A csoport eltolása a kiinduló helyzethez képest. */
export function groupApply(D: Design, sn: GroupSnap, dr: number, dc: number): void {
  for (const o of sn.parts) { o.p.r = o.r + dr; o.p.c = o.c + dc; }
  for (const o of sn.bridges) { const b = D.bridges[o.i]; b[0] = o.b[0] + dr; b[1] = o.b[1] + dc; b[2] = o.b[2] + dr; b[3] = o.b[3] + dc; }
  for (const o of sn.wires) { const w = D.wires[o.i]; w.a = [o.a[0] + dr, o.a[1] + dc]; w.b = [o.b[0] + dr, o.b[1] + dc]; }
}
