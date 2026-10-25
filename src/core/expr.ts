import type { Env } from './schema';

/**
 * Kifejezések és értékek az alkatrész-leírásokhoz.
 *  - {kulcs}        paraméter értéke
 *  - {kulcs.mező}   a kiválasztott opció mezője (pl. {color.vf})
 *  - {kifejezés}    + - * / zárójel, számok, azonosítók
 *  - {x|si}         formázás (si, fix1, fix2)
 */

export function lookup(env: Partial<Env> & Record<string, unknown>, path: string): unknown {
  const ps = path.split('.');
  if (ps.length > 1 && env.$opt && env.$opt[ps[0]]) return env.$opt[ps[0]][ps[1]];
  let v: any = env;
  for (const k of ps) {
    if (v == null) return undefined;
    v = v[k];
  }
  return v;
}

/** Numerikus kifejezés kiértékelése (biztonságos, saját értelmező; nincs eval). */
export function evx(src: unknown, env: Record<string, unknown>): number {
  const s = String(src);
  let i = 0;
  const ws = () => { while (s[i] === ' ') i++; };
  const prim = (): number => {
    ws();
    const ch = s[i];
    if (ch === '(') { i++; const v = add(); ws(); i++; return v; }
    if (ch === '-') { i++; return -prim(); }
    if (ch === '+') { i++; return prim(); }
    let m = /^(\d+\.?\d*(?:e-?\d+)?|\.\d+)/.exec(s.slice(i));
    if (m) { i += m[0].length; return parseFloat(m[0]); }
    m = /^[A-Za-z_$][\w.]*/.exec(s.slice(i));
    if (m) {
      i += m[0].length;
      const v = lookup(env as Env, m[0]);
      return typeof v === 'number' ? v : parseFloat(String(v)) || 0;
    }
    throw new Error('Hibás kifejezés: ' + s);
  };
  const mul = (): number => {
    let v = prim();
    for (;;) { ws(); if (s[i] === '*') { i++; v *= prim(); } else if (s[i] === '/') { i++; v /= prim(); } else return v; }
  };
  const add = (): number => {
    let v = mul();
    for (;;) { ws(); if (s[i] === '+') { i++; v += mul(); } else if (s[i] === '-') { i++; v -= mul(); } else return v; }
  };
  return add();
}

const SIP: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };

/** SI-előtagos érték: "4k7", "4,7k", "100n", "2.2M", "1R5", "470Ω". NaN, ha nem értelmezhető. */
export function parseSI(x: unknown): number {
  const s = String(x).trim().replace(',', '.').replace(/\s+/g, '').replace(/(Ω|ohm|F|V|A|Hz)$/i, '');
  let m = /^(-?\d*\.?\d+(?:e-?\d+)?)([pnuµmkKMG]?)$/.exec(s);
  if (m) return parseFloat(m[1]) * SIP[m[2]];
  m = /^(\d+)([pnuµmkKMGR])(\d+)$/.exec(s);
  if (m) return parseFloat(m[1] + '.' + m[3]) * (m[2] === 'R' ? 1 : SIP[m[2]]);
  return NaN;
}

/** Érték SI-előtaggal, 3 értékes jegyre: 4700 → "4.7k", 1e-7 → "100n". */
export function fmtSI(v: unknown): string {
  const n = +(v as number);
  if (!isFinite(n)) return '';
  if (n === 0) return '0';
  const a = Math.abs(n);
  for (const [f, p] of [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']] as const) {
    if (a >= f * 0.99995) return +(n / f).toPrecision(3) + p;
  }
  return String(+n.toPrecision(3));
}

export const FMT: Record<string, (v: unknown) => string> = {
  si: fmtSI,
  fix1: v => (+(v as number)).toFixed(1),
  fix2: v => (+(v as number)).toFixed(2),
};

/** Szöveg-sablon: minden {…} helyére a kifejezés értéke kerül. */
export function tpl(str: unknown, env: Record<string, unknown>): string {
  return String(str).replace(/\{([^}|]+)(?:\|(\w+))?\}/g, (_, e: string, fm?: string) => {
    const t = e.trim();
    const v = /^[A-Za-z_$][\w.]*$/.test(t) ? lookup(env as Env, t) : evx(t, env);
    if (fm && FMT[fm]) return FMT[fm](v);
    return v == null ? '' : typeof v === 'number' ? String(+v.toFixed(6)) : String(v);
  });
}

/** Szám vagy kifejezés kiértékelése. */
export function num(x: unknown, env: Record<string, unknown>): number {
  if (typeof x === 'number') return x;
  if (x == null) return 0;
  return evx(tpl(x, env), env);
}

export const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];

/** Következő (dir=1) vagy előző (dir=-1) E12-sorbeli érték. */
export function stepE12(v: number, dir: 1 | -1): number {
  v = Math.max(1e-12, +v || 1);
  const d = Math.floor(Math.log10(v) + 1e-9);
  const m = v / Math.pow(10, d);
  let k = E12.findIndex(x => x >= m - 1e-9);
  if (k < 0) k = 12;
  if (dir > 0) { k = E12[k] && Math.abs(E12[k] - m) < 1e-6 ? k + 1 : k; } else { k = k - 1; }
  const dd = d + Math.floor(k / 12), kk = ((k % 12) + 12) % 12;
  return +(E12[kk] * Math.pow(10, dd)).toPrecision(3);
}
