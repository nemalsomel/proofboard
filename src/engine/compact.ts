/**
 * Tömörség: a terv által foglalt terület és a kitöltöttsége (a későbbi tömörítés kiindulópontja és mércéje).
 * A foglalt terület a panelra szerelt alkatrészek teste, valamint a hidak és vezetékek befoglaló téglalapja
 * (a panelra vágva); a kitöltés az alkatrésztestek összterülete ehhez képest.
 */
import type { PartInstance } from '../core/schema';
import { DEFS, isOff } from './defs';
import { xf } from './geometry';
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
