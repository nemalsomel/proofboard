/**
 * Csíkvágások szerkesztése: hová kerül a vágás a kattintás helyén, melyik vágás van a kurzor alatt,
 * hozzáadás, törlés (kézi és automatikus is). DOM-mentes; a felület (`app.ts`) csak meghívja.
 *
 * Automatikus vágás törlése: a helye a `D.cutBan` listára kerül, így az automatikus csíkvágás oda nem tesz újat
 * (a két láb között máshol vág, ha lehet). Kézi vágás ugyanoda letéve feloldja a tiltást.
 */
import { buildLayout, type BoardSpec, type Cut } from './board';
import type { Design } from './types';

/** A csíkvágás eszköz típusa: hely szerint (a kattintás helye dönt), furat vagy rés. */
export type CutKind = 'auto' | 'hole' | 'gap';
/** Pont a panelon lyukegységben (`rf`, `cf`) és a legközelebbi lyuk (`r`, `c`). */
export interface HolePoint { rf: number; cf: number; r: number; c: number }
/** Kurzor alatti vágás: kézi vagy automatikus. */
export interface CutHit { src: 'manual' | 'auto'; cut: Cut }

export const sameCut = (a: Cut, b: Cut) => a[0] === b[0] && a[1] === b[1] && (a[2] ? 1 : 0) === (b[2] ? 1 : 0);

/** A kattintás helyén keletkező vágás: furat a lyukban, rés a lyuk alatt vagy fölött (a `kind` szerint). */
export function cutAt(b: BoardSpec, h: HolePoint, kind: CutKind): Cut {
  const gap = (): Cut => [Math.max(0, Math.min(b.rows - 2, Math.floor(h.rf))), h.c, 0];
  if (kind === 'hole') return [h.r, h.c, 1];
  if (kind === 'gap') return gap();
  return Math.abs(h.rf - h.r) < 0.28 ? [h.r, h.c, 1] : gap();
}

/** A ponthoz legközelebbi vágás (`tol` lyuktávolságon belül), kézi és automatikus is; a kézi előnyt kap. */
export function hitCut(D: Design, rf: number, cf: number, tol = 0.4): CutHit | null {
  let best: CutHit | null = null, bd = tol;
  const at = (x: Cut) => (x[2] ? Math.hypot(x[0] - rf, x[1] - cf) : Math.hypot(x[0] + 0.5 - rf, x[1] - cf));
  for (const [src, list] of [['manual', D.cuts || []], ['auto', (D.auto && D.auto.cuts) || []]] as const)
    for (const cut of list) { const d = at(cut); if (d < bd - (src === 'auto' ? 1e-9 : 0)) { bd = d; best = { src, cut }; } }
  return best;
}

/** Vágás törlése; automatikusnál a hely tiltólistára kerül. */
export function removeCut(D: Design, hit: CutHit): void {
  if (hit.src === 'manual') { D.cuts = (D.cuts || []).filter(x => !sameCut(x, hit.cut)); return; }
  D.auto.cuts = (D.auto.cuts || []).filter(x => !sameCut(x, hit.cut));
  if (!(D.cutBan || []).some(x => sameCut(x, hit.cut))) D.cutBan = [...(D.cutBan || []), hit.cut];
}

/** Tehető-e ide vágás: van-e mit elvágni (szekcióhatáron, a csík végén nincs; furat csak a panelon). */
export function cutCheck(b: BoardSpec, ct: Cut): 'ok' | 'bad-hole' | 'nothing' {
  return buildLayout(b, [ct]).cuts.length ? 'ok' : ct[2] ? 'bad-hole' : 'nothing';
}

export type ToggleResult = 'added' | 'removed' | 'bad-hole' | 'nothing';
/**
 * Kézi vágás ki/be ugyanott: ha van ilyen kézi vágás, törli; különben hozzáadja (ha van mit elvágni).
 * A hozzáadott vágás feloldja az ugyanott lévő tiltást, és kiveszi az azonos automatikusat.
 */
export function toggleCut(D: Design, ct: Cut): ToggleResult {
  if ((D.cuts || []).some(x => sameCut(x, ct))) { removeCut(D, { src: 'manual', cut: ct }); return 'removed'; }
  { const ok = cutCheck(D.board, ct); if (ok !== 'ok') return ok; }
  D.cuts = [...(D.cuts || []), ct];
  if ((D.auto.cuts || []).some(x => sameCut(x, ct))) D.auto.cuts = D.auto.cuts!.filter(x => !sameCut(x, ct));
  if (D.cutBan) { D.cutBan = D.cutBan.filter(x => !sameCut(x, ct)); if (!D.cutBan.length) delete D.cutBan; }
  return 'added';
}

/** Minden kézi vágás törlése; a darabszámot adja. */
export function clearManualCuts(D: Design): number { const n = (D.cuts || []).length; D.cuts = []; return n; }
