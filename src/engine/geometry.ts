/** Alkatrész-geometria: lokális (lr, lc) ↔ panel (r, c) koordináták forgatással és tükrözéssel. */
import type { PartInstance } from '../core/schema';
import { DEFS } from './defs';
import type { BoardSize, PlacedPin } from './types';

type Pose = Pick<PartInstance, 'r' | 'c' | 'rot' | 'mir'>;

/** Lokális pont a panelon. */
export function xf(p: Pose, lr: number, lc: number): [number, number] {
  let r = lr, c = p.mir ? -lc : lc;
  for (let k = 0; k < (p.rot & 3); k++) { const t = r; r = c; c = -t; }
  return [p.r + r, p.c + c];
}
/** Lokális irányvektor a panelon (eltolás nélkül). */
export function xv(p: Pose, lr: number, lc: number): [number, number] {
  let r = lr, c = p.mir ? -lc : lc;
  for (let k = 0; k < (p.rot & 3); k++) { const t = r; r = c; c = -t; }
  return [r, c];
}
/** Panelpont az alkatrész lokális koordinátáiban. */
export function ixf(p: Pose, R: number, C: number): [number, number] {
  let r = R - p.r, c = C - p.c;
  const n = (4 - (p.rot & 3)) & 3;
  for (let k = 0; k < n; k++) { const t = r; r = c; c = -t; }
  if (p.mir) c = -c;
  return [r, c];
}
/** Az alkatrész lábai panel-koordinátákkal. */
export function placedPins(p: PartInstance): PlacedPin[] {
  return DEFS[p.type].pins(p).map(pn => { const [r, c] = xf(p, pn.lr, pn.lc); return { ...pn, r, c, part: p }; });
}
/** A lyuk a panelon van-e. */
export const inBoard = (b: BoardSize, r: number, c: number): boolean => r >= 0 && c >= 0 && r < b.rows && c < b.cols;
