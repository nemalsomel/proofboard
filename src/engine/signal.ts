/** Jelsorozat: GPIO-kimenetek léptetése mintasorok szerint (pl. léptetőmotor félléptetés). */
import type { Design, SignalCfg } from './types';

export const SIG_PRESETS: Record<string, string[]> = {
  half: ['1000', '1100', '0100', '0110', '0010', '0011', '0001', '1001'],
  full: ['1100', '0110', '0011', '1001'],
  wave: ['1000', '0100', '0010', '0001'],
  count: Array.from({ length: 16 }, (_, i) => i.toString(2).padStart(4, '0').split('').reverse().join('')),
};
export const SIG_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['half', 'félléptetés (8 lépés)'], ['full', 'teljes lépés, két tekercs (4)'], ['wave', 'egy tekercs (4)'], ['count', 'bináris számláló (16)'], ['custom', 'saját minta'],
];
/** A terv jelsorozat-beállítása alapértékekkel. */
export const sigCfg = (D: Design): SignalCfg => ({ preset: 'half', custom: '10 01', pins: [], step: 0, rate: 4, dir: 1, ...(D.signal || {}) });
/** A minta sorai azonos szélességre töltve (saját mintánál a 0/1 csoportok, legfeljebb 8 csatorna). */
export function sigRows(c: Pick<SignalCfg, 'preset' | 'custom'>): { rows: string[]; w: number } {
  let rows = c.preset === 'custom' ? String(c.custom || '').split(/[\s,;]+/).filter(s => /^[01]{1,8}$/.test(s)) : SIG_PRESETS[c.preset] || SIG_PRESETS.half;
  if (!rows.length) rows = ['0'];
  const w = Math.max(...rows.map(r => r.length));
  return { rows: rows.map(r => r.padEnd(w, '0')), w };
}
/** Egy lépés alkalmazása: a csatornák GPIO-i a sor szerint ki: 1 / ki: 0 módba kerülnek. A lépésszámot körbeforgatja. */
export function sigApplyTo(D: Design): void {
  const c = sigCfg(D), { rows, w } = sigRows(c), n = rows.length;
  c.step = ((c.step % n) + n) % n;
  D.signal = c;
  for (let i = 0; i < w; i++) { const k = c.pins[i]; if (k) D.gpio[k] = rows[c.step][i] === '1' ? 'out_high' : 'out_low'; }
}
