/**
 * Logikai kifejezések az alkatrészek digitális viselkedéséhez (pl. kapuk, dekóderek).
 *
 * Nyelv (a változók a lábnevek; azonosítóval `#5` formában is hivatkozható egy láb):
 *   !A  ~A  NOT A        negálás          (legerősebb)
 *   A & B  A * B  A AND B   és
 *   A ^ B  A XOR B          kizáró vagy
 *   A | B  A + B  A OR B    vagy             (leggyengébb)
 *   0, 1, zárójelek
 *
 * Három nézet ugyanarra az adatra: kifejezés (szöveg), kapufa (AND/NAND/OR/NOR/XOR/XNOR/NOT/BUF)
 * és igazságtábla; a táblából minimalizált diszjunktív normálforma (Quine–McCluskey) készül.
 * Az értékelés háromértékű: 0, 1 és 'X' (ismeretlen, pl. lebegő bemenet).
 */

export type Level = 0 | 1 | 'X';
export type Expr =
  | { t: 'var'; name: string }
  | { t: 'const'; v: 0 | 1 }
  | { t: 'not'; a: Expr }
  | { t: 'and' | 'or' | 'xor'; args: Expr[] };

export class LogicError extends Error {
  constructor(msg: string, public pos: number) { super(msg); }
}

type Tok = { k: 'id' | 'op' | '(' | ')' | 'end'; v: string; pos: number; end: number };
const WORD_OPS: Record<string, string> = { AND: '&', OR: '|', XOR: '^', NOT: '!' };
const SYM_OPS: Record<string, string> = { '&': '&', '*': '&', '·': '&', '|': '|', '+': '|', '^': '^', '!': '!', '~': '!', '¬': '!' };

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(' || ch === ')') { out.push({ k: ch, v: ch, pos: i, end: i + 1 }); i++; continue; }
    if (SYM_OPS[ch]) { out.push({ k: 'op', v: SYM_OPS[ch], pos: i, end: i + 1 }); i++; continue; }
    const m = /^#?[A-Za-z0-9_]+/.exec(src.slice(i));
    if (m) {
      const w = m[0], up = w.toUpperCase();
      if (w[0] !== '#' && WORD_OPS[up]) out.push({ k: 'op', v: WORD_OPS[up], pos: i, end: i + w.length });
      else out.push({ k: 'id', v: w, pos: i, end: i + w.length });
      i += w.length; continue;
    }
    throw new LogicError(`Ismeretlen jel: „${ch}”`, i);
  }
  out.push({ k: 'end', v: '', pos: src.length, end: src.length });
  return out;
}

/** Kifejezés értelmezése. Hibánál LogicError (üzenet és hely). */
export function parseExpr(src: string): Expr {
  const ts = tokens(src);
  let i = 0;
  const peek = () => ts[i], take = () => ts[i++];
  const nary = (t: 'and' | 'or' | 'xor', op: string, sub: () => Expr): Expr => {
    const args = [sub()];
    while (peek().k === 'op' && peek().v === op) { take(); args.push(sub()); }
    if (args.length === 1) return args[0];
    return { t, args: args.flatMap(a => (a.t === t ? (a as { args: Expr[] }).args : [a])) };
  };
  const or = (): Expr => nary('or', '|', xor);
  const xor = (): Expr => nary('xor', '^', and);
  const and = (): Expr => nary('and', '&', not);
  const not = (): Expr => {
    if (peek().k === 'op' && peek().v === '!') { take(); return { t: 'not', a: not() }; }
    return atom();
  };
  const atom = (): Expr => {
    const t = take();
    if (t.k === '(') {
      const e = or();
      if (peek().k !== ')') throw new LogicError('Hiányzik a záró zárójel', peek().pos);
      take(); return e;
    }
    if (t.k === 'id') {
      if (t.v === '0' || t.v === '1') return { t: 'const', v: +t.v as 0 | 1 };
      return { t: 'var', name: t.v };
    }
    if (t.k === 'end') throw new LogicError('Hiányzó tag a kifejezés végén', t.pos);
    throw new LogicError(`Itt nem állhat: „${t.v}”`, t.pos);
  };
  if (ts.length === 1) throw new LogicError('Üres kifejezés', 0);
  const e = or();
  if (peek().k !== 'end') throw new LogicError(`Fölösleges rész: „${src.slice(peek().pos)}”`, peek().pos);
  return e;
}

const PREC: Record<Expr['t'], number> = { or: 1, xor: 2, and: 3, not: 4, var: 5, const: 5 };
const SYM: Record<'and' | 'or' | 'xor', string> = { and: ' & ', or: ' | ', xor: ' ^ ' };

/** Egységes szöveges alak (fölösleges zárójelek nélkül). */
export function printExpr(e: Expr): string {
  switch (e.t) {
    case 'var': return e.name;
    case 'const': return String(e.v);
    case 'not': return '!' + (PREC[e.a.t] >= 4 ? printExpr(e.a) : `(${printExpr(e.a)})`);
    default: return e.args.map(a => (PREC[a.t] > PREC[e.t] ? printExpr(a) : `(${printExpr(a)})`)).join(SYM[e.t]);
  }
}

/** A kifejezés változói az első előfordulás sorrendjében. */
export function varsOf(e: Expr, out: string[] = []): string[] {
  if (e.t === 'var') { if (!out.includes(e.name)) out.push(e.name); }
  else if (e.t === 'not') varsOf(e.a, out);
  else if (e.t !== 'const') for (const a of e.args) varsOf(a, out);
  return out;
}

/** Háromértékű kiértékelés. */
export function evalExpr(e: Expr, env: (name: string) => Level): Level {
  switch (e.t) {
    case 'var': return env(e.name);
    case 'const': return e.v;
    case 'not': { const v = evalExpr(e.a, env); return v === 'X' ? 'X' : v ? 0 : 1; }
    case 'and': { let x = false; for (const a of e.args) { const v = evalExpr(a, env); if (v === 0) return 0; if (v === 'X') x = true; } return x ? 'X' : 1; }
    case 'or': { let x = false; for (const a of e.args) { const v = evalExpr(a, env); if (v === 1) return 1; if (v === 'X') x = true; } return x ? 'X' : 0; }
    case 'xor': { let p = 0; for (const a of e.args) { const v = evalExpr(a, env); if (v === 'X') return 'X'; p ^= v; } return p as 0 | 1; }
  }
}

/** A változónevek cseréje a szövegben, a többi írásmódot meghagyva (lábátnevezéshez). */
export function renameVars(src: string, from: string, to: string): string {
  let ts: Tok[];
  try { ts = tokens(src); } catch { return src; }
  let out = '', last = 0;
  for (const t of ts) if (t.k === 'id' && t.v === from) { out += src.slice(last, t.pos) + to; last = t.end; }
  return out + src.slice(last);
}

/**
 * Változónév → láb azonosítója: `#id`, vagy egyedi lábnév, vagy (ha nincs ilyen név) azonosító.
 * null, ha nincs ilyen láb, vagy a név nem egyértelmű.
 */
export function pinRef(token: string, pins: ReadonlyArray<{ id: string; name: string }>): string | null {
  if (token.startsWith('#')) { const id = token.slice(1); return pins.some(p => p.id === id) ? id : null; }
  const byName = pins.filter(p => p.name === token);
  if (byName.length === 1) return byName[0].id;
  if (byName.length > 1) return null;
  return pins.some(p => p.id === token) ? token : null;
}

/* ---------- kapufa ---------- */

export type GateKind = 'and' | 'nand' | 'or' | 'nor' | 'xor' | 'xnor' | 'not' | 'buf';
export type GateNode = { g: GateKind; ins: GateNode[] } | { v: string } | { c: 0 | 1 };
export const GATE_LABEL: Record<GateKind, string> = { and: 'ÉS (AND)', nand: 'NEM-ÉS (NAND)', or: 'VAGY (OR)', nor: 'NEM-VAGY (NOR)', xor: 'KIZÁRÓ VAGY (XOR)', xnor: 'XNOR', not: 'NEM (NOT)', buf: 'ERŐSÍTŐ (BUF)' };

export function toGates(e: Expr): GateNode {
  switch (e.t) {
    case 'var': return { v: e.name };
    case 'const': return { c: e.v };
    case 'not': {
      const a = e.a;
      if (a.t === 'and') return { g: 'nand', ins: a.args.map(toGates) };
      if (a.t === 'or') return { g: 'nor', ins: a.args.map(toGates) };
      if (a.t === 'xor') return { g: 'xnor', ins: a.args.map(toGates) };
      return { g: 'not', ins: [toGates(a)] };
    }
    default: return { g: e.t, ins: e.args.map(toGates) };
  }
}

export function fromGates(n: GateNode): Expr {
  if ('v' in n) return { t: 'var', name: n.v };
  if ('c' in n) return { t: 'const', v: n.c };
  const ins = n.ins.map(fromGates);
  const one = ins[0] ?? ({ t: 'const', v: 0 } as Expr);
  const flat = (t: 'and' | 'or' | 'xor'): Expr => (ins.length < 2 ? one : { t, args: ins.flatMap(a => (a.t === t ? (a as { args: Expr[] }).args : [a])) });
  switch (n.g) {
    case 'and': return flat('and');
    case 'or': return flat('or');
    case 'xor': return flat('xor');
    case 'nand': return { t: 'not', a: flat('and') };
    case 'nor': return { t: 'not', a: flat('or') };
    case 'xnor': return { t: 'not', a: flat('xor') };
    case 'not': return { t: 'not', a: one };
    case 'buf': return one;
  }
}

/* ---------- igazságtábla és minimalizálás ---------- */

/** A változók `vars` sorrendjében: a sor indexének legfelső bitje az első változó. */
export function truthRow(e: Expr, vars: readonly string[], row: number): Level {
  const n = vars.length;
  return evalExpr(e, name => { const j = vars.indexOf(name); return j < 0 ? 'X' : (((row >> (n - 1 - j)) & 1) as 0 | 1); });
}

/**
 * Minimális (prímimplikánsokból álló) diszjunktív normálforma Quine–McCluskey-módszerrel.
 * `ones`: a sorok, ahol a kimenet 1; `dc`: ahol mindegy.
 */
export function minimize(vars: readonly string[], ones: readonly number[], dc: readonly number[] = []): Expr {
  const n = vars.length;
  if (!ones.length) return { t: 'const', v: 0 };
  if (new Set([...ones, ...dc]).size === 1 << n) return { t: 'const', v: 1 }; // minden sor 1 (vagy mindegy)
  type Imp = { val: number; dash: number };
  const key = (x: Imp) => x.val + ':' + x.dash;
  let cur = new Map<string, Imp>();
  for (const m of [...ones, ...dc]) cur.set(key({ val: m, dash: 0 }), { val: m, dash: 0 });
  const primes: Imp[] = [];
  while (cur.size) {
    const next = new Map<string, Imp>(), used = new Set<string>(), list = [...cur.values()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.dash !== b.dash) continue;
      const d = a.val ^ b.val;
      if (d && !(d & (d - 1))) { const c = { val: a.val & ~d, dash: a.dash | d }; next.set(key(c), c); used.add(key(a)); used.add(key(b)); }
    }
    for (const x of list) if (!used.has(key(x))) primes.push(x);
    cur = next;
  }
  const covers = (p: Imp, m: number) => (m & ~p.dash) === (p.val & ~p.dash);
  const left = new Set(ones), chosen: Imp[] = [];
  // lényeges prímimplikánsok, utána mohó lefedés (a legtöbb fedetlen sort lefedő, azonos esetben a legkevesebb literál)
  for (const m of ones) { const ps = primes.filter(p => covers(p, m)); if (ps.length === 1 && !chosen.includes(ps[0])) chosen.push(ps[0]); }
  for (const p of chosen) for (const m of [...left]) if (covers(p, m)) left.delete(m);
  while (left.size) {
    let best: Imp | null = null, bs = -1;
    for (const p of primes) {
      const s = [...left].filter(m => covers(p, m)).length * 100 + popcount(p.dash);
      if (s > bs) { bs = s; best = p; }
    }
    if (!best) break;
    chosen.push(best);
    for (const m of [...left]) if (covers(best, m)) left.delete(m);
  }
  const terms: Expr[] = chosen
    .sort((x, y) => popcount(y.dash) - popcount(x.dash) || (~y.dash & ((1 << n) - 1)) - (~x.dash & ((1 << n) - 1)) || y.val - x.val) // a korábbi változók előre
    .map(p => {
      const lits: Expr[] = [];
      for (let j = 0; j < n; j++) {
        const bit = 1 << (n - 1 - j);
        if (p.dash & bit) continue;
        const v: Expr = { t: 'var', name: vars[j] };
        lits.push(p.val & bit ? v : { t: 'not', a: v });
      }
      return lits.length === 0 ? ({ t: 'const', v: 1 } as Expr) : lits.length === 1 ? lits[0] : { t: 'and', args: lits };
    });
  if (terms.some(t => t.t === 'const')) return { t: 'const', v: 1 };
  return terms.length === 1 ? terms[0] : { t: 'or', args: terms };
}

function popcount(x: number): number { let c = 0; while (x) { x &= x - 1; c++; } return c; }
