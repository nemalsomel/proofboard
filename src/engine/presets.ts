/**
 * Regressziós mintatervek: a macropad (Pico W, 10 gomb, 3 LED) kézi hidakkal és ugyanez kapcsolatokkal
 * (útvonalkeresővel). A tesztek ezekre építenek (157 híd, gombtérkép, 29/29 kapcsolat vezeték nélkül).
 */
import type { PartInstance } from '../core/schema';
import { DEFS, isMcu } from './defs';
import { emptyDesign } from './design';
import type { Design } from './types';

export function presetMacropad(): Design {
  /* Hídra optimalizált kiosztás: 0 vezeték. Cella = 3 lyukas szekció; sáv b = 3b…3b+2. sor.
     Pico alsó sora a 4. sávban (12. sor), a csatornák a gombtestek alatt futnak fel,
     a GND-t a gombok belső B1–B2 kötése viszi át soron belül. */
  const d = emptyDesign();
  const add = (type: string, r: number, c: number, rot: number, mir: boolean, props: Record<string, unknown>, label: string): PartInstance => {
    const p = { id: 'p' + d.seq++, type, label, r, c, rot, mir, props: { ...DEFS[type].props, ...props } };
    d.parts.push(p);
    return p;
  };
  const br = (a: number, b: number, c: number, e: number) => d.bridges.push([a, b, c, e]);
  const V = (col: number, b1: number, b2: number) => { for (let b = Math.min(b1, b2); b < Math.max(b1, b2); b++) br(3 * b + 2, col, 3 * b + 3, col); }; // függőleges lánc sávok között
  const H = (row: number, c1: number, c2: number) => { const s = Math.sign(c2 - c1); for (let c = c1; c !== c2; c += s) br(row, c, row, c + s); }; // vízszintes lánc egy soron
  const mid = (b: number) => 3 * b + 1;
  const pico = add('pico', 12, 32, 2, false, { span: 6 }, 'PICO');
  const ROWS = [25, 34, 43], COLS = [9, 17, 25], NM = [['K1', 'K2', 'K3'], ['K4', 'K5', 'K6'], ['K7', 'K8', 'K9']];
  ROWS.forEach((r, i) => COLS.forEach((c, j) => add('button', r, c, 0, false, {}, NM[i][j])));
  add('button', 43, 1, 0, false, {}, 'Fn');
  // jelcsatornák → GPIO
  V(14, 8, 7); H(mid(7), 14, 17); V(17, 7, 4);                     // K1 → GP19
  H(34, 14, 13); V(13, 11, 6); H(mid(6), 13, 16); V(16, 6, 4);     // K4 → GP18
  H(43, 14, 12); V(12, 14, 5); H(mid(5), 12, 14); V(14, 5, 4);     // K7 → GP17
  H(25, 17, 18); V(18, 8, 4);                                      // K2 → GP20
  H(34, 17, 19); V(19, 11, 4);                                     // K5 → GP21
  H(43, 22, 21); V(21, 14, 4);                                     // K8 → GP22
  H(25, 25, 26); V(26, 8, 4);                                      // K3 → GP28
  H(34, 25, 24); V(24, 11, 4);                                     // K6 → GP27
  H(43, 25, 23); V(23, 14, 4);                                     // K9 → GP26
  H(43, 6, 7); V(7, 14, 4); H(13, 7, 13);                          // Fn → GP16 (balról, a Pico mellett)
  // GND: soron belül a gombok viszik, résekben híd
  for (const r of [27, 36, 45]) H(r, 14, 17);                      // K1–K2, K4–K5, K7–K8
  V(15, 9, 15);                                                    // bal oldali gerinc a sorok között
  H(45, 6, 9); H(45, 22, 25);                                      // Fn–K7, K8–K9
  for (const r of [27, 36, 45]) br(r, 30, r, 31);                  // jobb oldali gerinc
  V(31, 5, 15); H(mid(5), 31, 30); V(30, 5, 4);                    // → Pico GND (38. láb)
  // LED-ek a Pico bal oldalán, a felső lábsorról
  br(7, 13, 7, 12);                                                // GP15 → 2. sáv
  br(5, 14, 6, 14); H(5, 14, 12);                                  // GP14 → 1. sáv
  br(5, 16, 6, 16); br(2, 16, 3, 16); H(2, 16, 12);                // GP13 → 0. sáv
  br(8, 15, 9, 15); H(10, 15, 7); br(8, 7, 9, 7); br(5, 7, 6, 7); br(2, 7, 3, 7); // GND (18. láb) → katódok
  ([['red', 'R1', 'LED1'], ['green', 'R2', 'LED2'], ['yellow', 'R3', 'LED3']] as const).forEach(([color, rl, ll], k) => {
    add('res', 3 * k, 12, 2, false, { ohm: 1000 }, rl);             // GPIO-cella (12. oszlop) → 8. oszlop
    add('led', 3 * k + 1, 8, 2, false, { color }, ll);              // anód 8. oszlop, katód 7. oszlop (GND)
  });
  d.gpio[pico.id + '.17'] = 'out_high'; d.gpio[pico.id + '.19'] = 'out_low'; d.gpio[pico.id + '.20'] = 'out_low';
  return d;
}

/** Ugyanaz a macropad kapcsolatokkal: gombok A → GPIO, B → GND; LED-ek a GP13–15-ről ellenálláson át. */
export function presetRouted(): Design {
  const d = presetMacropad();
  d.bridges = []; d.wires = []; d.links = []; d.auto = { bridges: [], wires: [] }; d.settings.autoRoute = true;
  const P = d.parts.find(p => isMcu(p))!.id, L = (a: string, b: string) => d.links.push({ id: 'l' + d.seq++, a, b, gpio: null });
  for (const p of d.parts) if (p.type === 'button') { L(p.id + '.A1', 'GPIO'); L(p.id + '.B1', 'GND'); }
  const by = (lab: string) => d.parts.find(p => p.label === lab)!.id;
  [['17', 'R1', 'LED1'], ['19', 'R2', 'LED2'], ['20', 'R3', 'LED3']].forEach(([pin, r, led]) => {
    L(P + '.' + pin, by(r) + '.1'); L(by(r) + '.2', by(led) + '.A'); L(by(led) + '.K', 'GND');
  });
  return d;
}
