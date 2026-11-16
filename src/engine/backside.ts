/**
 * Rézoldali alkatrész (`PartInstance.side === 'cu'`): a panel rézoldalára (alulra) kerül. A teste alatt alapból nem
 * lehet forrasztóhíd és más alkatrész forrasztási pontja (lába), mert a forrasztás nem férne el alatta – az
 * útvonalkeresőnek ez tiltott terület (`keepout`). Az `under` jelzővel a felhasználó megengedheti az alatta vezetést.
 * A saját lábai nem tiltottak. DOM-mentes.
 */
import type { PartInstance } from '../core/schema';
import { DEFS, isOff } from './defs';
import { placedPins, xf } from './geometry';
import type { Design } from './types';

export const onCopper = (p: Pick<PartInstance, 'side'>): boolean => p.side === 'cu';

/** A test befoglalója lyukkoordinátában (tört is lehet). */
export function bodyRect(p: PartInstance): { r0: number; r1: number; c0: number; c1: number } {
  const b = DEFS[p.type].bounds(p), cs = [[b.r0, b.c0], [b.r0, b.c1], [b.r1, b.c0], [b.r1, b.c1]].map(([r, c]) => xf(p, r, c));
  const rs = cs.map(x => x[0]), ks = cs.map(x => x[1]);
  return { r0: Math.min(...rs), r1: Math.max(...rs), c0: Math.min(...ks), c1: Math.max(...ks) };
}

/** A rézoldali alkatrész teste alatti lyukak (a saját lábai nélkül), amelyeken nem lehet híd és más forrasztás. */
export function keepoutOf(D: Design, p: PartInstance): Set<string> {
  const out = new Set<string>();
  if (!onCopper(p) || p.under || isOff(p)) return out;
  const b = bodyRect(p), own = new Set(placedPins(p).map(q => q.r + ':' + q.c));
  for (let r = Math.max(0, Math.ceil(b.r0 - 1e-6)); r <= Math.min(D.board.rows - 1, Math.floor(b.r1 + 1e-6)); r++)
    for (let c = Math.max(0, Math.ceil(b.c0 - 1e-6)); c <= Math.min(D.board.cols - 1, Math.floor(b.c1 + 1e-6)); c++) {
      const k = r + ':' + c;
      if (!own.has(k)) out.add(k);
    }
  return out;
}

/** Az összes tiltott lyuk: lyuk → a rézoldali alkatrész, amely alatt van. */
export function keepout(D: Design): Map<string, PartInstance> {
  const m = new Map<string, PartInstance>();
  for (const p of D.parts) for (const k of keepoutOf(D, p)) if (!m.has(k)) m.set(k, p);
  return m;
}
