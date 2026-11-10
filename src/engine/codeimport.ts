/**
 * Kód → program: Arduino (C++) vagy MicroPython vázlatból blokkprogram. A kód nem soronként fordul, hanem
 * jelképesen lefut: a beállítás (setup) konkrétan, a fő ciklus (loop / while True) egyszer, a bemenetek
 * (digitalRead, analogRead) és az előző körből megmaradt változók jelképes értékek. Az eredményből:
 *  - időzítés (`delay`) konkrét kimenetekkel → Ütemadó, vagy több lábnál Sorozat (futófény);
 *  - kifejezések, feltételek → logikai blokkok, Összehasonlítás;
 *  - állapotváltozók: `s = !s` feltétellel → Váltókapcsoló (élfigyelés `last…` változóval is),
 *    `n = (n + 1) % M` → Számláló, `millis()`-időzítő → Ütemadó.
 * Ami nem fordítható, sorszámmal megjegyzésbe kerül. DOM-mentes, a tervet nem módosítja (`applyImport` igen).
 */
import { fmt, N_, type Tr } from '../i18n/i18n';
import { isMcu } from './defs';
import { placedPins } from './geometry';
import { arrangeProgram, BLOCK_W, COL_GAP, progOf } from './progops';
import { NODE_DEFS, type PEdge, type PNode, type Program } from './program';
import type { Design } from './types';
import { detectLang, parseCode, type Expr, type Func, type Stmt } from './codeparse';

export type ImportLang = 'arduino' | 'micropython';
export interface ImportNote { line: number; msg: string }
export interface ImportResult {
  lang: ImportLang;
  program: Program;
  notes: ImportNote[];
  /** a létrejött blokkok rövid leírása (pl. „Ütemadó 1000 ms → Digitális kimenet PICO1.GP15”) */ summary: string[];
}

type G = number | 'LED';
type V =
  | { k: 'n'; v: number } | { k: 'b'; v: boolean } | { k: 's'; v: string } | { k: 'none' }
  | { k: 'list'; a: V[] }
  | { k: 'obj'; o: 'pin' | 'pwm' | 'adc'; g: G }
  | { k: 'mod'; n: string }
  | { k: 'meth'; obj: V; n: string }
  | { k: 'fn'; n: string }
  | { k: 'in'; g: G }
  | { k: 'adc'; g: G; max: number }
  | { k: 'st'; n: string }
  | { k: 'time' }
  | { k: 'tick'; ms: number }
  /** a feltétel az utóbbi `ms` ezredmásodpercben igaz volt (utánfutás) */
  | { k: 'after'; c: V; ms: number }
  | { k: 'op'; op: string; a: V; b?: V }
  | { k: 'mux'; c: V; a: V; b: V };

const N = (v: number): V => ({ k: 'n', v }), Bv = (v: boolean): V => ({ k: 'b', v });
const isC = (v: V): v is { k: 'n'; v: number } | { k: 'b'; v: boolean } => v.k === 'n' || v.k === 'b';
const cnum = (v: V): number => (v.k === 'n' ? v.v : v.k === 'b' ? (v.v ? 1 : 0) : NaN);
const key = (v: V): string => JSON.stringify(v);
const eqV = (a: V, b: V) => key(a) === key(b);
const SYM = new Set(['in', 'adc', 'st', 'time', 'tick', 'after', 'op', 'mux']);
const isSym = (v: V) => SYM.has(v.k);
function truthy(v: V): boolean | null {
  switch (v.k) { case 'n': return v.v !== 0; case 'b': return v.v; case 's': return v.v !== ''; case 'none': return false; case 'list': return v.a.length > 0; case 'obj': case 'mod': case 'meth': case 'fn': return true; default: return null; }
}
const BOOL_OPS = new Set(['&&', '||', '!', '==', '!=', '<', '>', '<=', '>=', '^b']);
/** logikai jellegű-e az érték (bemeneti szint, összehasonlítás, logikai művelet) */
function boolish(v: V): boolean {
  if (v.k === 'b' || v.k === 'in' || v.k === 'tick' || v.k === 'after') return true;
  if (v.k === 'op') return BOOL_OPS.has(v.op) || ((v.op === '^' || v.op === '&' || v.op === '|') && boolish(v.a) && !!v.b && boolish(v.b));
  if (v.k === 'mux') return boolish(v.a) && boolish(v.b);
  return false;
}
function contains(v: V, f: (x: V) => boolean): boolean {
  if (f(v)) return true;
  if (v.k === 'op') return contains(v.a, f) || (!!v.b && contains(v.b, f));
  if (v.k === 'mux') return contains(v.c, f) || contains(v.a, f) || contains(v.b, f);
  if (v.k === 'after') return contains(v.c, f);
  return false;
}
function subst(v: V, f: (x: V) => V | null): V {
  const r = f(v); if (r) return r;
  if (v.k === 'op') return op(v.op, subst(v.a, f), v.b && subst(v.b, f));
  if (v.k === 'mux') return mux(subst(v.c, f), subst(v.a, f), subst(v.b, f));
  if (v.k === 'after') return { k: 'after', c: subst(v.c, f), ms: v.ms };
  return v;
}

/* ---------- jelképes műveletek, egyszerűsítéssel ---------- */
function not(a: V): V {
  const t = truthy(a); if (t !== null && !isSym(a)) return Bv(!t);
  if (a.k === 'op' && a.op === '!') return a.a;
  if (a.k === 'op' && a.b) { const inv: Record<string, string> = { '==': '!=', '!=': '==', '<': '>=', '>=': '<', '>': '<=', '<=': '>' }; if (inv[a.op]) return op(inv[a.op], a.a, a.b); }
  return { k: 'op', op: '!', a };
}
function and(a: V, b: V): V {
  const ta = isSym(a) ? null : truthy(a), tb = isSym(b) ? null : truthy(b);
  if (ta === false || tb === false) return Bv(false);
  if (ta === true) return tb === null ? b : Bv(tb);
  if (tb === true) return a;
  if (eqV(a, b)) return a;
  if (eqV(not(a), b)) return Bv(false);
  return { k: 'op', op: '&&', a, b };
}
function or(a: V, b: V): V {
  const ta = isSym(a) ? null : truthy(a), tb = isSym(b) ? null : truthy(b);
  if (ta === true || tb === true) return Bv(true);
  if (ta === false) return tb === null ? b : Bv(tb);
  if (tb === false) return a;
  if (eqV(a, b)) return a;
  if (eqV(not(a), b)) return Bv(true);
  if (b.k === 'after' && eqV(b.c, a)) return b;
  if (a.k === 'after' && eqV(a.c, b)) return a;
  return { k: 'op', op: '||', a, b };
}
function mux(c: V, a: V, b: V): V {
  const t = isSym(c) ? null : truthy(c);
  if (t !== null) return t ? a : b;
  if (eqV(a, b)) return a;
  if (c.k === 'op' && c.op === '!') return mux(c.a, b, a);
  // mux(a != b, a, b) = a
  if (c.k === 'op' && (c.op === '!=' || c.op === '^b') && c.b && ((eqV(c.a, a) && eqV(c.b, b)) || (eqV(c.a, b) && eqV(c.b, a)))) return a;
  if (boolish(a) && boolish(b) && isC(a) && isC(b)) return truthy(a) ? c : not(c);
  // egymásba ágyazott: mux(c1, mux(c2, x, s), s) → mux(c1 && c2, x, s)
  if (a.k === 'mux' && eqV(a.b, b)) return mux(and(c, a.c), a.a, b);
  if (b.k === 'mux' && eqV(b.b, a)) return mux(and(not(c), b.c), b.a, a);
  if (b.k === 'mux' && eqV(b.a, a)) return mux(or(c, b.c), a, b.b);
  return { k: 'mux', c, a, b };
}
function op(o: string, a: V, b?: V): V {
  if (o === '!') return not(a);
  if (o === '&&') return and(a, b!);
  if (o === '||') return or(a, b!);
  if (o === '^b' && b) {
    if (eqV(a, b)) return Bv(false);
    if (eqV(not(a), b)) return Bv(true);
    if (isC(a)) return truthy(a) ? not(b) : b;
    if (isC(b)) return truthy(b) ? not(a) : a;
  }
  if (b && isC(a) && isC(b)) {
    const x = cnum(a), y = cnum(b);
    switch (o) {
      case '+': return N(x + y); case '-': return N(x - y); case '*': return N(x * y);
      case '/': return N(y === 0 ? 0 : x / y); case '//': return N(y === 0 ? 0 : Math.floor(x / y)); case '%': return N(y === 0 ? 0 : ((x % y) + y) % y);
      case '**': return N(x ** y); case '&': return N(x & y); case '|': return N(x | y); case '^': return N(x ^ y); case '<<': return N(x << y); case '>>': return N(x >> y);
      case '==': return Bv(x === y); case '!=': return Bv(x !== y); case '<': return Bv(x < y); case '>': return Bv(x > y); case '<=': return Bv(x <= y); case '>=': return Bv(x >= y);
    }
  }
  if (!b && isC(a)) { if (o === '-') return N(-cnum(a)); if (o === '~') return N(~cnum(a)); }
  if (b) {
    // logikai értékek összevetése állandóval: x == HIGH → x, x == LOW → !x
    if ((o === '==' || o === '!=') && (isC(a) || isC(b)) && boolish(isC(a) ? b : a)) {
      const s = isC(a) ? b : a, k = cnum(isC(a) ? a : b), t = o === '==' ? k !== 0 : k === 0;
      return t ? s : not(s);
    }
    const stOrBool = (x: V) => boolish(x) || x.k === 'st';
    if ((o === '==' || o === '!=' || o === '^') && stOrBool(a) && stOrBool(b) && (boolish(a) || boolish(b))) return o === '==' ? not({ k: 'op', op: '^b', a, b }) : { k: 'op', op: '^b', a, b };
    if ((o === '&' || o === '|') && boolish(a) && boolish(b)) return o === '&' ? and(a, b) : or(a, b);
    if ((o === '+' || o === '-') && isC(b) && cnum(b) === 0) return a;
    if (o === '*' && isC(b) && cnum(b) === 1) return a;
    if (o === '/' && isC(b) && cnum(b) === 1) return a;
  }
  return { k: 'op', op: o, a, b };
}

/** „feltételesen új érték, különben marad”: mux(c, a, s) – a mux bármelyik ágán lehet az s. */
function sel(v: V, s: V): { c: V; a: V } | null {
  if (v.k !== 'mux') return null;
  if (eqV(v.b, s)) return { c: v.c, a: v.a };
  if (eqV(v.a, s)) return { c: not(v.c), a: v.b };
  return null;
}

/* ---------- lineáris alak: a·s + b, ahol s egy jelképes alap (analóg érték, számláló) ---------- */
type Lin = { s: V | null; a: number; b: number };
function lin(v: V): Lin | null {
  if (isC(v)) return { s: null, a: 0, b: cnum(v) };
  if (v.k === 'adc' || v.k === 'st') return { s: v, a: 1, b: 0 };
  if (v.k === 'op' && v.b) {
    const x = lin(v.a), y = lin(v.b); if (!x || !y) return null;
    if (x.s && y.s && !eqV(x.s, y.s)) return null;
    const s = x.s || y.s;
    switch (v.op) {
      case '+': return { s, a: x.a + y.a, b: x.b + y.b };
      case '-': return { s, a: x.a - y.a, b: x.b - y.b };
      case '*': if (x.s && y.s) return null; return { s, a: x.a * y.b + y.a * x.b, b: x.b * y.b };
      case '/': case '//': if (y.s || y.b === 0) return null; return { s, a: x.a / y.b, b: x.b / y.b };
      case '>>': if (y.s) return null; return { s, a: x.a / 2 ** y.b, b: x.b / 2 ** y.b };
    }
  }
  if (v.k === 'op' && !v.b && v.op === '-') { const x = lin(v.a); return x && { s: x.s, a: -x.a, b: -x.b }; }
  return null;
}

/* ---------- futtatás ---------- */
class Flow { constructor(readonly kind: 'ret' | 'break' | 'continue', readonly v: V = { k: 'none' }) {} }
class Capture { constructor(readonly body: Stmt[], readonly frame: Map<string, V> | null) {} }
class Budget {}
interface PinCfg { mode?: 'out' | 'in' | 'pwm' | 'adc'; pull?: 'pullup' | 'pulldown' | 'float'; freq?: number; line: number }
interface Write { t: number; v: V; guarded: boolean; line: number }

const C_CONST: Record<string, V> = {
  HIGH: N(1), LOW: N(0), true: Bv(true), false: Bv(false), NULL: { k: 'none' }, nullptr: { k: 'none' },
  INPUT: { k: 's', v: 'INPUT' }, OUTPUT: { k: 's', v: 'OUTPUT' }, INPUT_PULLUP: { k: 's', v: 'INPUT_PULLUP' }, INPUT_PULLDOWN: { k: 's', v: 'INPUT_PULLDOWN' },
  LED_BUILTIN: { k: 's', v: 'LED' },
};
const PY_CONST: Record<string, V> = { True: Bv(true), False: Bv(false), None: { k: 'none' } };
const PY_MODS = new Set(['Pin', 'PWM', 'ADC', 'time', 'utime', 'machine', 'Signal']);
const IGNORE = new Set(['Serial', 'print', 'Serial.begin', 'Serial.print', 'Serial.println', 'Serial.printf', 'Serial.write', 'Serial.available', 'Serial.read', 'Serial.flush', 'yield', 'gc.collect', 'randomSeed', 'interrupts', 'noInterrupts', 'analogReference']);

class Run {
  globals = new Map<string, V>();
  frames: Array<{ vars: Map<string, V>; globalNames: Set<string> }> = [];
  pins = new Map<G, PinCfg>();
  writes = new Map<string, Write[]>();
  notes: ImportNote[] = [];
  noted = new Set<string>();
  t = 0; guard = 0; steps = 0; phase: 'setup' | 'loop' = 'setup';
  adcMax: number; pwmMax = 255; pwmFreq = 0;
  ledc = new Map<number, { g?: G; max: number; freq: number }>();
  depth = 0;
  constructor(readonly py: boolean, readonly funcs: Map<string, Func>, readonly tr: Tr) { this.adcMax = py ? 65535 : 1023; }

  note(line: number, msg: string, once = msg): void { if (this.noted.has(once)) return; this.noted.add(once); this.notes.push({ line, msg }); }
  scope(): Map<string, V> { return this.frames.length ? this.frames[this.frames.length - 1].vars : this.globals; }
  lookup(n: string, line: number): V {
    const f = this.frames[this.frames.length - 1];
    if (f && f.vars.has(n)) return f.vars.get(n)!;
    if (this.globals.has(n)) return this.globals.get(n)!;
    if (this.py ? n in PY_CONST : n in C_CONST) return (this.py ? PY_CONST : C_CONST)[n];
    if (this.funcs.has(n)) return { k: 'fn', n };
    if (this.py && PY_MODS.has(n)) return { k: 'mod', n: n === 'utime' ? 'time' : n };
    if (!this.py && n === 'Serial') return { k: 'mod', n };
    this.note(line, this.tr('{l}. sor: ismeretlen név: {n}', { l: line, n }), 'name:' + n);
    return N(0);
  }
  assignName(n: string, v: V, decl: boolean): void {
    const f = this.frames[this.frames.length - 1];
    if (f) {
      if (decl || f.vars.has(n) || (this.py && !f.globalNames.has(n))) { f.vars.set(n, v); return; }
    }
    this.globals.set(n, v);
  }
  pinKey(v: V, line: number): G | null {
    if (v.k === 'n' && Number.isInteger(v.v) && v.v >= 0) return v.v;
    if (v.k === 's' && /^(LED|LED_BUILTIN)$/i.test(v.v)) return 'LED';
    if (v.k === 's' && /^\D*(\d+)$/.test(v.v)) return +/(\d+)$/.exec(v.v)![1];
    if (v.k === 'obj') return v.g;
    this.note(line, this.tr('{l}. sor: a láb száma nem állapítható meg', { l: line }), 'pinkey' + line);
    return null;
  }
  cfg(g: G, line: number): PinCfg { let c = this.pins.get(g); if (!c) { c = { line }; this.pins.set(g, c); } return c; }
  write(kind: 'd' | 'p', g: G, v: V, line: number): void {
    const k = kind + String(g);
    this.assignState('@' + k, v);
    if (!this.writes.has(k)) this.writes.set(k, []);
    if (this.phase === 'loop') this.writes.get(k)!.push({ t: this.t, v, guarded: this.guard > 0, line });
    else this.writes.get(k)!.length = 0;
    const c = this.cfg(g, line);
    if (kind === 'p') c.mode = 'pwm'; else if (!c.mode || c.mode === 'in') c.mode = 'out';
  }
  assignState(n: string, v: V): void { this.globals.set(n, v); }
  readDigital(g: G, line: number): V {
    const c = this.cfg(g, line);
    if (c.mode === 'out') return this.globals.get('@d' + String(g)) ?? N(0);
    if (!c.mode) c.mode = 'in';
    return { k: 'in', g };
  }
  delay(ms: number, line: number): void {
    if (this.phase !== 'loop') return;
    if (this.guard > 0) {
      if (ms <= 100) this.note(line, this.tr('{l}. sor: rövid várakozás (pergésmentesítés) kimaradt; a blokkok 20 ms-onként figyelnek', { l: line }), 'gdelay');
      else this.note(line, this.tr('{l}. sor: feltételes ágban lévő várakozás nem fordítható; kimaradt', { l: line }), 'gdelay');
      return;
    }
    this.t += Math.max(0, ms);
  }

  /* ---------- kifejezések ---------- */
  ev(e: Expr): V {
    if (++this.steps > 200000) throw new Budget();
    switch (e.k) {
      case 'num': return N(e.v);
      case 'str': return { k: 's', v: e.v };
      case 'name': return this.lookup(e.n, e.line);
      case 'list': return { k: 'list', a: e.items.map(x => this.ev(x)) };
      case 'tern': { const c = this.ev(e.c), t = isSym(c) ? null : truthy(c); return t === null ? mux(c, this.ev(e.a), this.ev(e.b)) : this.ev(t ? e.a : e.b); }
      case 'un': { const a = this.ev(e.a); return e.op === '!' ? not(a) : op(e.op, a); }
      case 'bin': {
        if (e.op === '&&' || e.op === '||') {
          const a = this.ev(e.a), t = isSym(a) ? null : truthy(a);
          if (t !== null && (e.op === '&&' ? !t : t)) return Bv(t);
          const b = this.ev(e.b);
          return e.op === '&&' ? and(a, b) : or(a, b);
        }
        const a = this.ev(e.a), b = this.ev(e.b);
        if (a.k === 'list' && b.k === 'list' && e.op === '+') return { k: 'list', a: [...a.a, ...b.a] };
        if (a.k === 's' && b.k === 's' && e.op === '+') return { k: 's', v: a.v + b.v };
        if (!this.py && e.op === '/' && a.k === 'n' && b.k === 'n' && Number.isInteger(a.v) && Number.isInteger(b.v)) return N(b.v === 0 ? 0 : Math.trunc(a.v / b.v));
        return op(e.op, a, b);
      }
      case 'index': {
        const o = this.ev(e.o), i = this.ev(e.i);
        if (o.k === 'list' && i.k === 'n') return o.a[((i.v % o.a.length) + o.a.length) % o.a.length] ?? N(0);
        if (o.k === 's' && i.k === 'n') return { k: 's', v: o.v[i.v] ?? '' };
        if (o.k === 'list' && isSym(i)) {
          // jelképes index (pl. minta[n]): a lehetséges értékek közül feltétellel választ
          let r: V = o.a[0] ?? N(0);
          o.a.forEach((x, k) => { if (k) r = mux(op('==', i, N(k)), x, r); });
          return r;
        }
        return N(0);
      }
      case 'attr': {
        const o = this.ev(e.o);
        if (o.k === 'mod') {
          if (o.n === 'Pin' && /^(OUT|IN|PULL_UP|PULL_DOWN|OPEN_DRAIN|IRQ_RISING|IRQ_FALLING)$/.test(e.n)) return { k: 's', v: e.n };
          if (o.n === 'machine') return { k: 'mod', n: e.n };
          return { k: 'mod', n: o.n + '.' + e.n };
        }
        if (o.k === 'obj') return { k: 'meth', obj: o, n: e.n };
        return { k: 'mod', n: '?.' + e.n };
      }
      case 'call': return this.call(e);
    }
  }

  call(e: Extract<Expr, { k: 'call' }>): V {
    const line = e.line, f = e.f;
    const name = f.k === 'name' ? f.n : null;
    if (name && this.funcs.has(name) && !(this.frames.length && this.frames[this.frames.length - 1].vars.has(name))) return this.callUser(name, e.args.map(a => this.ev(a)), line);
    const callee = name ? null : this.ev(f);
    const args = () => e.args.map(a => this.ev(a));
    const A = (i: number) => (e.args[i] ? this.ev(e.args[i]) : N(0));
    const num = (v: V, what: string): number => { if (isC(v)) return cnum(v); this.note(line, this.tr('{l}. sor: {w} nem állandó; kimaradt', { l: line, w: this.tr(what) }), 'nc' + line); return NaN; };
    const path = name ?? (callee && (callee.k === 'mod' ? callee.n : callee.k === 'meth' ? '#' + callee.obj.k + '.' + callee.n : callee.k === 'obj' ? '#call' : callee.k === 'fn' ? callee.n : '?'));
    if (callee && callee.k === 'fn') return this.callUser(callee.n, args(), line);
    if (!path) return N(0);
    if (IGNORE.has(path) || /^Serial\./.test(path) || /^(print|time\.time_ns|gc\.)/.test(path)) { args(); return { k: 'none' }; }
    if (!this.py) switch (path) {
      case 'pinMode': { const g = this.pinKey(A(0), line), m = A(1); if (g === null) return { k: 'none' }; const c = this.cfg(g, line), s = m.k === 's' ? m.v : '';
        if (s === 'OUTPUT') c.mode = c.mode === 'pwm' ? 'pwm' : 'out'; else { c.mode = 'in'; c.pull = s === 'INPUT_PULLUP' ? 'pullup' : s === 'INPUT_PULLDOWN' ? 'pulldown' : 'float'; }
        return { k: 'none' }; }
      case 'digitalWrite': { const g = this.pinKey(A(0), line); if (g !== null) this.write('d', g, A(1), line); return { k: 'none' }; }
      case 'digitalRead': { const g = this.pinKey(A(0), line); return g === null ? N(0) : this.readDigital(g, line); }
      case 'analogRead': { const g = this.pinKey(A(0), line); if (g === null) return N(0); const c = this.cfg(g, line); c.mode = 'adc'; return { k: 'adc', g, max: this.adcMax }; }
      case 'analogWrite': { const g = this.pinKey(A(0), line); if (g !== null) this.write('p', g, op('/', A(1), N(this.pwmMax)), line); return { k: 'none' }; }
      case 'analogReadResolution': { const b = num(A(0), N_('a felbontás')); if (isFinite(b)) this.adcMax = 2 ** b - 1; return { k: 'none' }; }
      case 'analogWriteResolution': { const b = num(A(0), N_('a felbontás')); if (isFinite(b)) this.pwmMax = 2 ** b - 1; return { k: 'none' }; }
      case 'analogWriteRange': { const r = num(A(0), N_('a tartomány')); if (isFinite(r)) this.pwmMax = r; return { k: 'none' }; }
      case 'analogWriteFreq': case 'analogWriteFrequency': { const v = e.args.length > 1 ? A(1) : A(0); const f2 = num(v, N_('a frekvencia')); if (isFinite(f2)) this.pwmFreq = f2; return { k: 'none' }; }
      case 'ledcSetup': { const ch = num(A(0), N_('a csatorna')), fq = num(A(1), N_('a frekvencia')), res = num(A(2), N_('a felbontás')); this.ledc.set(ch, { ...(this.ledc.get(ch) || {}), max: 2 ** (isFinite(res) ? res : 8) - 1, freq: fq }); return { k: 'none' }; }
      case 'ledcAttachPin': { const g = this.pinKey(A(0), line), ch = num(A(1), N_('a csatorna')); if (g !== null) { const c = this.ledc.get(ch) || { max: 255, freq: 5000 }; c.g = g; this.ledc.set(ch, c); this.cfg(g, line).mode = 'pwm'; } return { k: 'none' }; }
      case 'ledcAttach': { const g = this.pinKey(A(0), line), fq = num(A(1), N_('a frekvencia')), res = num(A(2), N_('a felbontás')); if (g !== null) { this.ledc.set(1000 + Number(g), { g, max: 2 ** (isFinite(res) ? res : 8) - 1, freq: fq }); this.cfg(g, line).mode = 'pwm'; } return { k: 'none' }; }
      case 'ledcWrite': { const ch = num(A(0), N_('a csatorna')), c = this.ledc.get(ch) ?? this.ledc.get(1000 + ch); if (c && c.g !== undefined) { if (c.freq) this.pwmFreq = c.freq; this.write('p', c.g, op('/', A(1), N(c.max)), line); } return { k: 'none' }; }
      case 'delay': { const ms = num(A(0), N_('a várakozás')); if (isFinite(ms)) this.delay(ms, line); return { k: 'none' }; }
      case 'delayMicroseconds': { const us = num(A(0), N_('a várakozás')); if (isFinite(us)) this.delay(us / 1000, line); return { k: 'none' }; }
      case 'millis': return this.phase === 'setup' ? N(0) : { k: 'time' };
      case 'micros': return op('*', { k: 'time' }, N(1000));
      case 'map': { const [x, a, b, c, d] = args(); return op('+', c, op('/', op('*', op('-', x, a), op('-', d, c)), op('-', b, a))); }
      case 'constrain': { const [x, a, b] = args(); return isC(x) && isC(a) && isC(b) ? N(Math.max(cnum(a), Math.min(cnum(b), cnum(x)))) : x; }
      case 'random': this.note(line, this.tr('{l}. sor: véletlenszám nem fordítható; 0-val számolva', { l: line }), 'random'); return N(0);
      case 'tone': case 'noTone': this.note(line, this.tr('{l}. sor: hang (tone) nem fordítható; kimaradt', { l: line }), 'tone'); return { k: 'none' };
      case 'attachInterrupt': this.note(line, this.tr('{l}. sor: megszakítás nem fordítható; kimaradt', { l: line }), 'irq'); return { k: 'none' };
    }
    switch (path) {
      case 'min': case 'max': case 'abs': case 'round': case 'int': case 'float': case 'bool': case 'len': {
        const as = args();
        if (path === 'len') { const x = as[0]; return N(x && x.k === 'list' ? x.a.length : x && x.k === 's' ? x.v.length : 0); }
        if (path === 'bool') { const t = truthy(as[0]); return t === null ? as[0] : Bv(t); }
        if (as.every(isC)) { const ns = as.map(cnum); return N(path === 'min' ? Math.min(...ns) : path === 'max' ? Math.max(...ns) : path === 'abs' ? Math.abs(ns[0]) : path === 'round' ? Math.round(ns[0]) : path === 'int' ? Math.trunc(ns[0]) : ns[0]); }
        return as.find(isSym) ?? as[0]; // jelképes érték korlátozása (min, max): a kitöltés úgyis 0…1
      }
      case '__postinc': case '__postdec': case '__preinc': case '__predec': {
        const tgt = e.args[0], old = this.ev(tgt), nv = op(/inc$/.test(path) ? '+' : '-', old, N(1));
        this.store(tgt, nv, false, line);
        return /^__post/.test(path) ? old : nv;
      }
    }
    if (this.py) return this.pyCall(path, callee, e, args, A, num, line);
    this.note(line, this.tr('{l}. sor: ismeretlen függvény: {f}', { l: line, f: path }), 'fn:' + path);
    args();
    return N(0);
  }

  pyCall(path: string, callee: V | null, e: Extract<Expr, { k: 'call' }>, args: () => V[], A: (i: number) => V, num: (v: V, w: string) => number, line: number): V {
    if (path === 'Pin' || path === 'Signal') {
      const as = args(), g = as[0] && as[0].k === 'obj' ? as[0].g : this.pinKey(as[0] ?? N(0), line);
      if (g === null) return N(0);
      const c = this.cfg(g, line), m = as[1], pull = as[2];
      if (m && m.k === 's' && m.v === 'OUT') { if (!c.mode || c.mode === 'in') c.mode = 'out'; }
      else if (m && m.k === 's' && m.v === 'IN') { c.mode = 'in'; c.pull = pull && pull.k === 's' ? (pull.v === 'PULL_UP' ? 'pullup' : pull.v === 'PULL_DOWN' ? 'pulldown' : 'float') : 'float'; }
      return { k: 'obj', o: 'pin', g };
    }
    if (path === 'PWM') {
      const as = args(), p = as[0], g = p && p.k === 'obj' ? p.g : this.pinKey(p ?? N(0), line);
      if (g === null) return N(0);
      this.cfg(g, line).mode = 'pwm';
      if (as[1] && isC(as[1])) this.pwmFreq = cnum(as[1]);
      return { k: 'obj', o: 'pwm', g };
    }
    if (path === 'ADC') {
      const p = A(0); let g: G | null;
      if (p.k === 'obj') g = p.g; else { const n = num(p, N_('az ADC')); g = isFinite(n) ? (n <= 4 ? 26 + n : n) : null; }
      if (g === null) return N(0);
      this.cfg(g, line).mode = 'adc';
      return { k: 'obj', o: 'adc', g };
    }
    switch (path) {
      case 'time.sleep': { const s = num(A(0), N_('a várakozás')); if (isFinite(s)) this.delay(s * 1000, line); return { k: 'none' }; }
      case 'time.sleep_ms': { const s = num(A(0), N_('a várakozás')); if (isFinite(s)) this.delay(s, line); return { k: 'none' }; }
      case 'time.sleep_us': { const s = num(A(0), N_('a várakozás')); if (isFinite(s)) this.delay(s / 1000, line); return { k: 'none' }; }
      case 'time.ticks_ms': return this.phase === 'setup' ? N(0) : { k: 'time' };
      case 'time.ticks_us': return op('*', { k: 'time' }, N(1000));
      case 'time.time': return op('/', { k: 'time' }, N(1000));
      case 'time.ticks_diff': return op('-', A(0), A(1));
      case 'time.ticks_add': return op('+', A(0), A(1));
    }
    const m = callee && callee.k === 'meth' ? callee : null;
    if (m && m.obj.k === 'obj') {
      const o = m.obj, g = o.g;
      if (o.o === 'pin') switch (m.n) {
        case 'value': if (e.args.length) { this.write('d', g, A(0), line); return { k: 'none' }; } return this.readDigital(g, line);
        case 'on': case 'high': this.write('d', g, N(1), line); return { k: 'none' };
        case 'off': case 'low': this.write('d', g, N(0), line); return { k: 'none' };
        case 'toggle': this.write('d', g, not(this.readDigital(g, line)), line); return { k: 'none' };
        case 'init': case 'irq': args(); return { k: 'none' };
      }
      if (o.o === 'pwm') switch (m.n) {
        case 'freq': { if (e.args.length) { const f = num(A(0), N_('a frekvencia')); if (isFinite(f)) this.pwmFreq = f; } return N(this.pwmFreq || 1000); }
        case 'duty_u16': this.write('p', g, op('/', A(0), N(65535)), line); return { k: 'none' };
        case 'duty': this.write('p', g, op('/', A(0), N(1023)), line); return { k: 'none' };
        case 'deinit': return { k: 'none' };
      }
      if (o.o === 'adc') switch (m.n) {
        case 'read_u16': return { k: 'adc', g, max: 65535 };
        case 'read': return { k: 'adc', g, max: 4095 };
        case 'atten': case 'width': args(); return { k: 'none' };
      }
    }
    if (callee && callee.k === 'obj' && callee.o === 'pin') { if (e.args.length) { this.write('d', callee.g, A(0), line); return { k: 'none' }; } return this.readDigital(callee.g, line); }
    this.note(line, this.tr('{l}. sor: ismeretlen függvény: {f}', { l: line, f: path.replace(/^#obj\./, '') }), 'fn:' + path);
    args();
    return N(0);
  }

  callUser(name: string, args: V[], line: number): V {
    const fn = this.funcs.get(name)!;
    if (this.depth > 40) { this.note(line, this.tr('{l}. sor: túl mély függvényhívás', { l: line }), 'deep'); return N(0); }
    const vars = new Map<string, V>(); fn.params.forEach((p, i) => vars.set(p, args[i] ?? N(0)));
    this.frames.push({ vars, globalNames: new Set() }); this.depth++;
    try { this.block(fn.body); return { k: 'none' }; }
    catch (x) { if (x instanceof Flow && x.kind === 'ret') return x.v; throw x; }
    finally { this.frames.pop(); this.depth--; }
  }

  store(t: Expr, v: V, decl: boolean, line: number): void {
    if (t.k === 'name') { this.assignName(t.n, v, decl); return; }
    if (t.k === 'index') {
      const o = this.ev(t.o), i = this.ev(t.i);
      if (o.k === 'list' && i.k === 'n') { const a = [...o.a]; a[i.v] = v; if (t.o.k === 'name') this.assignName(t.o.n, { k: 'list', a }, false); return; }
    }
    this.note(line, this.tr('{l}. sor: ez az értékadás nem fordítható; kimaradt', { l: line }), 'store' + line);
  }

  /* ---------- utasítások ---------- */
  block(b: Stmt[]): void { for (const s of b) this.stmt(s); }
  stmt(s: Stmt): void {
    if (++this.steps > 200000) throw new Budget();
    switch (s.k) {
      case 'expr': this.ev(s.e); return;
      case 'global': { const f = this.frames[this.frames.length - 1]; if (f) for (const n of s.names) f.globalNames.add(n); return; }
      case 'assign': {
        if (!s.v) return;
        let v = this.ev(s.v);
        if (s.op !== '=') v = op(s.op.slice(0, -1), this.ev(s.t), v);
        this.store(s.t, v, !!s.decl, s.line);
        return;
      }
      case 'ret': throw new Flow('ret', s.v ? this.ev(s.v) : { k: 'none' });
      case 'break': throw new Flow('break');
      case 'continue': throw new Flow('continue');
      case 'if': {
        const c = this.ev(s.c), t = isSym(c) ? null : truthy(c);
        if (t !== null) { this.block(t ? s.a : s.b); return; }
        this.branch(c, s.a, s.b, s.line);
        return;
      }
      case 'while': {
        const c0 = this.ev(s.c), t0 = isSym(c0) ? null : truthy(c0);
        if (t0 === true && this.isForever(s)) {
          if (this.phase === 'setup') throw new Capture(s.body, this.frames.length ? this.frames[this.frames.length - 1].vars : null);
          this.note(s.line, this.tr('{l}. sor: a fő cikluson belüli végtelen ciklus nem fordítható; kimaradt', { l: s.line }), 'inner');
          return;
        }
        if (t0 === null) {
          this.note(s.line, this.tr('{l}. sor: bemenetre váró ciklus (while) kimaradt; a blokkok folyamatosan figyelnek', { l: s.line }), 'wait' + s.line);
          return;
        }
        for (let n = 0; n < 1000; n++) {
          const c = n ? this.ev(s.c) : c0, t = isSym(c) ? null : truthy(c);
          if (!t) { if (t === null) this.note(s.line, this.tr('{l}. sor: a ciklus feltétele bemenettől függ; kimaradt', { l: s.line }), 'wait' + s.line); return; }
          try { this.block(s.body); } catch (x) { if (x instanceof Flow && x.kind === 'break') return; if (!(x instanceof Flow && x.kind === 'continue')) throw x; }
        }
        this.note(s.line, this.tr('{l}. sor: túl sok ismétlés; a ciklus megszakítva', { l: s.line }), 'many' + s.line);
        return;
      }
      case 'for': {
        this.block(s.init);
        for (let n = 0; n < 1000; n++) {
          if (s.c) {
            const c = this.ev(s.c), t = isSym(c) ? null : truthy(c);
            if (t === null) { this.note(s.line, this.tr('{l}. sor: a ciklus feltétele bemenettől függ; kimaradt', { l: s.line }), 'for' + s.line); return; }
            if (!t) return;
          } else if (n > 0 && this.phase === 'setup') { throw new Capture(s.body, null); }
          try { this.block(s.body); } catch (x) { if (x instanceof Flow && x.kind === 'break') return; if (!(x instanceof Flow && x.kind === 'continue')) throw x; }
          this.block(s.step);
        }
        this.note(s.line, this.tr('{l}. sor: túl sok ismétlés; a ciklus megszakítva', { l: s.line }), 'many' + s.line);
        return;
      }
    }
  }
  isForever(s: Extract<Stmt, { k: 'while' }>): boolean { return !s.body.some(x => x.k === 'break'); }
  /** Jelképes feltétel: mindkét ág lefut, a változók és a lábak értéke feltételes (mux). */
  branch(c: V, a: Stmt[], b: Stmt[], line: number): void {
    const snap = () => ({ g: new Map(this.globals), f: this.frames.map(f => new Map(f.vars)), t: this.t });
    const restore = (s: ReturnType<typeof snap>) => { this.globals = new Map(s.g); s.f.forEach((m, i) => { this.frames[i].vars = new Map(m); }); this.t = s.t; };
    const s0 = snap();
    this.guard++;
    const runB = (body: Stmt[]) => { try { this.block(body); } catch (x) { if (x instanceof Flow) this.note(line, this.tr('{l}. sor: feltételes ágból kilépés (return, break) nem fordítható', { l: line }), 'flow'); else throw x; } };
    runB(a); const sa = snap(); restore(s0);
    runB(b); const sb = snap();
    this.guard--;
    const merge = (A: Map<string, V>, B: Map<string, V>, into: Map<string, V>) => { for (const k of new Set([...A.keys(), ...B.keys()])) { const x = A.get(k) ?? B.get(k)!, y = B.get(k) ?? A.get(k)!; into.set(k, eqV(x, y) ? x : mux(c, x, y)); } };
    const g = new Map<string, V>(); merge(sa.g, sb.g, g); this.globals = g;
    this.frames.forEach((f, i) => { const m = new Map<string, V>(); merge(sa.f[i], sb.f[i], m); f.vars = m; });
    this.t = Math.max(sa.t, sb.t);
  }
}

/** A ciklusban értéket kapó nevek (a hívott függvényekben is). */
function assignedNames(body: Stmt[], funcs: Map<string, Func>, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  const ex = (e: Expr | null): void => {
    if (!e) return;
    if (e.k === 'call') { if (e.f.k === 'name') { if (/^__(pre|post)/.test(e.f.n) && e.args[0].k === 'name') out.add(e.args[0].n); const f = funcs.get(e.f.n); if (f && !seen.has(e.f.n)) { seen.add(e.f.n); assignedNames(f.body, funcs, seen).forEach(n => out.add(n)); } } e.args.forEach(ex); ex(e.f); }
    else if (e.k === 'bin') { ex(e.a); ex(e.b); } else if (e.k === 'un') ex(e.a); else if (e.k === 'tern') { ex(e.c); ex(e.a); ex(e.b); } else if (e.k === 'index') { ex(e.o); ex(e.i); } else if (e.k === 'attr') ex(e.o); else if (e.k === 'list') e.items.forEach(ex);
  };
  const st = (s: Stmt): void => {
    switch (s.k) {
      case 'assign': if (s.t.k === 'name') out.add(s.t.n); else if (s.t.k === 'index' && s.t.o.k === 'name') out.add(s.t.o.n); ex(s.v); break;
      case 'expr': ex(s.e); break;
      case 'if': ex(s.c); s.a.forEach(st); s.b.forEach(st); break;
      case 'while': ex(s.c); s.body.forEach(st); break;
      case 'for': s.init.forEach(st); ex(s.c); s.step.forEach(st); s.body.forEach(st); break;
      case 'ret': ex(s.v); break;
    }
  };
  body.forEach(st);
  return out;
}

/* ---------- állapotváltozók felismerése ---------- */
type StateKind =
  | { kind: 'const'; v: V } | { kind: 'prev'; e: V } | { kind: 'timer' }
  | { kind: 'toggle'; c: V; init: boolean } | { kind: 'counter'; c: V; m: number } | { kind: 'unknown'; v: V };

/* ---------- a teljes átalakítás ---------- */
export function importCode(D: Design, code: string, o: { lang?: ImportLang; tr?: Tr } = {}): ImportResult {
  const tr = o.tr || fmt, lang = o.lang || detectLang(code), py = lang === 'micropython';
  const parsed = parseCode(code, lang);
  const R = new Run(py, parsed.funcs, tr);
  for (const s of parsed.skipped) R.note(s.line, tr('{l}. sor: nem értelmezhető, kimaradt: {x}', { l: s.line, x: s.text.slice(0, 60) }), 'skip' + s.line);

  // beállítás: a felső szint (és C-ben a setup), a végtelen ciklus a fő ciklus
  let loop: Stmt[] | null = null, loopFrame: Map<string, V> | null = null;
  try {
    try { R.block(parsed.top); if (!py && parsed.funcs.has('setup')) R.callUser('setup', [], parsed.funcs.get('setup')!.line); }
    catch (x) { if (x instanceof Capture) { loop = x.body; loopFrame = x.frame; } else if (!(x instanceof Flow)) throw x; }
    if (!loop && !py && parsed.funcs.has('loop')) loop = parsed.funcs.get('loop')!.body;
  } catch (x) { if (x instanceof Budget) R.note(0, tr('A beállítás túl hosszú; megszakítva.')); else throw x; }
  if (!loop) { loop = []; if (!R.writes.size && !R.pins.size) R.note(0, py ? tr('Nem találtam fő ciklust (while True:).') : tr('Nem találtam loop() függvényt.')); }

  // a ciklusban változó nevek: jelképes kezdőérték (az előző kör értéke)
  const names = assignedNames(loop, parsed.funcs), init = new Map<string, V>();
  const frameVars = loopFrame;
  if (frameVars) R.frames.push({ vars: frameVars, globalNames: new Set() });
  const scopeOf = (n: string) => (frameVars && frameVars.has(n) ? frameVars : R.globals);
  for (const n of names) { const m = scopeOf(n), v = m.get(n); if (v && isC(v)) { init.set(n, v); m.set(n, { k: 'st', n }); } else if (!v) { init.set(n, N(0)); } }
  for (const [g, c] of R.pins) { if (c.mode === 'out' || c.mode === 'pwm') { const k = (c.mode === 'out' ? '@d' : '@p') + String(g); init.set(k, R.globals.get(k) ?? N(0)); R.globals.set(k, { k: 'st', n: k }); } }
  R.phase = 'loop'; R.t = 0; R.steps = 0;
  for (const w of R.writes.values()) w.length = 0;
  try {
    if (py) R.frames.length = frameVars ? 1 : 0;
    try { R.block(loop); } catch (x) { if (!(x instanceof Flow)) throw x; }
  } catch (x) { if (x instanceof Budget) R.note(0, tr('A fő ciklus túl hosszú; megszakítva.')); else throw x; }
  const T = R.t;
  const next = (n: string): V => { const v = (frameVars && frameVars.has(n) ? frameVars : R.globals).get(n); return v ?? init.get(n) ?? N(0); };

  /* állapotváltozók osztályozása */
  const kinds = new Map<string, StateKind>();
  const kindOf = (n: string): StateKind => {
    const had = kinds.get(n); if (had) return had;
    const s: V = { k: 'st', n }, nx0 = next(n), iv = init.get(n) ?? N(0);
    let r: StateKind;
    const isTime = (x: V) => contains(x, y => y.k === 'time');
    kinds.set(n, { kind: 'unknown', v: iv }); // körkörös hivatkozás ellen
    const sl0 = sel(nx0, s), timer = !!sl0 && isTime(sl0.a) && !contains(sl0.a, y => y.k === 'adc' || y.k === 'in');
    const nx = timer ? nx0 : timerSub(nx0);
    if (eqV(nx, s)) r = { kind: 'const', v: iv };
    else if (timer) r = { kind: 'timer' };
    else if (!contains(nx, y => y.k === 'st' && y.n === n)) r = { kind: 'prev', e: nx };
    else if (eqV(nx, not(s))) r = { kind: 'toggle', c: Bv(true), init: truthy(iv) === true };
    else if (sel(nx, s) && eqV(sel(nx, s)!.a, not(s))) r = { kind: 'toggle', c: sel(nx, s)!.c, init: truthy(iv) === true };
    else if (contains(nx, y => y.k === 'op' && y.op === '+' && eqV(y.a, s) && !!y.b && isC(y.b) && cnum(y.b) === 1)) {
      let m = 0, c: V = Bv(true);
      const scan = (x: V): void => {
        if (x.k === 'op' && x.op === '%' && x.b && isC(x.b)) m = m || cnum(x.b);
        if (x.k === 'op' && x.b && isC(x.b) && contains(x.a, y => y.k === 'st' && y.n === n) && ['>=', '>', '=='].includes(x.op)) m = m || cnum(x.b) + (x.op === '>' ? 1 : 0);
        if (x.k === 'op') { scan(x.a); if (x.b) scan(x.b); } if (x.k === 'mux') { scan(x.c); scan(x.a); scan(x.b); }
      };
      scan(nx);
      const sl = sel(nx, s);
      if (sl) c = sl.c;
      else if (nx.k === 'mux' && contains(nx.c, y => y.k === 'st' && y.n === n) && sel(nx.b, s)) c = sel(nx.b, s)!.c; // n++ feltétellel, utána a túlcsordulás
      if (!m) { m = 1000; R.note(0, tr('A(z) {n} számláló felső határa nem állapítható meg; 1000 lépéssel', { n })); }
      r = { kind: 'counter', c, m: Math.max(1, Math.round(m)) };
    } else r = { kind: 'unknown', v: iv };
    kinds.set(n, r);
    return r;
  };

  /** Időzítő feltétel: millis() - last >= I → ütem; más időfeltétel (pl. pergésmentesítés) igaznak véve. */
  const timerSub = (v: V): V => subst(v, x => {
    const tvar = (y: V | undefined): string | null => { if (!y) return null; if (y.k === 'st') return y.n; if (y.k === 'mux') for (const z of [y.a, y.b]) if (z.k === 'st' && eqV(y, next(z.n))) return z.n; return null; };
    if (x.k === 'op' && x.b && ['>=', '>'].includes(x.op) && isC(x.b) && x.a.k === 'op' && x.a.op === '-' && x.a.a.k === 'time' && tvar(x.a.b)) {
      const tn = tvar(x.a.b)!, nx = next(tn);
      if (kindOf(tn).kind === 'timer') {
        // az időzítő pontosan ezen a feltételen áll vissza → periodikus ütem
        const sl = sel(nx, { k: 'st', n: tn });
        if (sl && contains(sl.c, y => eqV(y, x))) return { k: 'tick', ms: Math.max(20, cnum(x.b)) };
        R.note(0, tr('Időfeltétel (pl. pergésmentesítés, {ms} ms) kihagyva; a blokkok 20 ms-onként figyelnek', { ms: cnum(x.b) }), 'deb');
        return Bv(true);
      }
    }
    if (x.k === 'op' && x.b && ['<', '<='].includes(x.op) && isC(x.b) && x.a.k === 'op' && x.a.op === '-' && x.a.a.k === 'time') {
      const tn = tvar(x.a.b), sl = tn ? sel(next(tn), { k: 'st', n: tn }) : null;
      // millis() - utolsó < idő, ahol az „utolsó” egy feltételre áll be → utánfutás
      if (tn && sl && sl.a.k === 'time' && kindOf(tn).kind === 'timer') return { k: 'after', c: sl.c, ms: cnum(x.b) };
      R.note(0, tr('Időfeltétel kihagyva'), 'deb2'); return Bv(false);
    }
    return null;
  });
  /** Élfigyelés: a feltétel csak a jel változásakor igaz (last… változó) → a változó jel maga a trigger. */
  const trigger = (c0: V): V => {
    let c = timerSub(c0);
    for (let guard = 0; guard < 6; guard++) {
      const st = (() => { let f: string | null = null; contains(c, y => { if (y.k === 'st' && kindOf(y.n).kind === 'prev') { f = y.n; return true; } return false; }); return f as string | null; })();
      if (!st) break;
      const e = (kindOf(st) as { e: V }).e, sv: V = { k: 'st', n: st };
      const same = subst(c, x => (eqV(x, sv) ? e : null)), edge = subst(c, x => (eqV(x, sv) ? not(e) : null));
      c = truthy(same) === false && !isSym(same) ? edge : same;
    }
    return c;
  };

  /* ---------- blokkok ---------- */
  const prog: Program = { nodes: [], edges: [] }, cache = new Map<string, string>();
  const mcu = D.parts.find(p => isMcu(p)) || null;
  const pinRef = (g: G): string => {
    if (!mcu) return '';
    const pins = placedPins(mcu).filter(q => q.role === 'gpio');
    const hit = g === 'LED' ? pins.find(q => (q.caps || []).includes('led')) : pins.find(q => { const m = /(\d+)$/.exec(q.name) || /(\d+)$/.exec(q.id); return !!m && +m[1] === g; });
    if (!hit) { R.note(0, g === 'LED' ? tr('A beépített LED-hez nincs GPIO a vezérlőlapon; a lábat válaszd ki kézzel') : tr('GPIO {g}: nincs ilyen láb a vezérlőlapon; a lábat válaszd ki kézzel', { g }), 'pin' + String(g)); return ''; }
    return mcu.id + '.' + hit.id;
  };
  if (!mcu) R.note(0, tr('Nincs vezérlőlap a tervben: a blokkok lábát utólag kell kiválasztani.'));
  const node = (type: string, props: Record<string, unknown>, k?: string): string => {
    if (k && cache.has(k)) return cache.get(k)!;
    const d = NODE_DEFS[type], p: Record<string, unknown> = {};
    for (const pr of d.params) p[pr.key] = pr.default;
    Object.assign(p, props);
    let i = 1; while (prog.nodes.some(n => n.id === 'n' + i)) i++;
    const id = 'n' + i;
    prog.nodes.push({ id, type, x: 0, y: 0, props: p });
    if (k) cache.set(k, id);
    return id;
  };
  const edge = (from: string, to: string) => { prog.edges = prog.edges.filter(e => e.to !== to); let i = 1; while (prog.edges.some(e => e.id === 'e' + i)) i++; prog.edges.push({ id: 'e' + i, from, to }); };
  type Port = string | { c: number };
  const constPort = (x: number): string => node('const', { value: x }, 'const:' + x) + '.v';
  const asPort = (p: Port): string => (typeof p === 'string' ? p : constPort(p.c));
  const gate = (type: string, a: Port, b?: Port): string => { const id = node(type, {}); edge(asPort(a), id + '.a'); if (b !== undefined) edge(asPort(b), id + '.b'); return id + '.v'; };
  const blinkPort = (period: number, duty = 50): string => node('blink', { period: Math.max(20, Math.round(period)), duty: Math.round(duty) }, `blink:${Math.round(period)}:${Math.round(duty)}`) + '.v';
  const inPort = (g: G, active: 'high' | 'low'): string => { const c = R.pins.get(g); return node('in', { pin: pinRef(g), pull: c?.pull || 'float', active }, `in:${String(g)}:${active}`) + '.v'; };
  const adcPort = (g: G): string => node('adc', { pin: pinRef(g) }, 'adc:' + String(g)) + '.v';
  const stateNodes = new Map<string, string>();
  const toggleOf = (n: string, k: Extract<StateKind, { kind: 'toggle' }>): string => {
    if (stateNodes.has(n)) return stateNodes.get(n)!;
    let out: string;
    const tc = isC(k.c) ? null : trigger(k.c);
    if (tc === null || (tc && isC(tc) && truthy(tc))) {
      if (T > 0) out = blinkPort(2 * T);
      else { R.note(0, tr('A(z) {n} minden körben vált, várakozás nélkül; ütemadóval közelítve (40 ms)', { n })); out = blinkPort(40); }
    } else if (tc.k === 'tick') out = blinkPort(2 * tc.ms);
    else { const id = node('toggle', {}); stateNodes.set(n, id + '.v'); edge(asPort(bool(tc)), id + '.a'); out = id + '.v'; }
    if (k.init && out.startsWith(stateNodes.get(n) || '\u0000')) out = gate('not', out); // kezdetben igaz: a Váltókapcsoló hamisról indul, ezért fordítva
    stateNodes.set(n, out);
    return out;
  };
  const counterOf = (n: string, k: Extract<StateKind, { kind: 'counter' }>): string => {
    if (stateNodes.has(n)) return stateNodes.get(n)!;
    const id = node('counter', { max: k.m }); stateNodes.set(n, id);
    const tc = isC(k.c) ? (truthy(k.c) ? null : Bv(false)) : trigger(k.c);
    if (tc === null) edge(T > 0 ? blinkPort(T) : blinkPort(40), id + '.a');
    else if (tc.k === 'tick') edge(blinkPort(tc.ms), id + '.a');
    else edge(asPort(bool(tc)), id + '.a');
    return id;
  };

  function bool(v: V): Port {
    if (isC(v)) return { c: truthy(v) ? 1 : 0 };
    switch (v.k) {
      case 'in': return inPort(v.g, 'high');
      case 'tick': return blinkPort(v.ms);
      case 'after': { const id = node('delay', { mode: 'off', ms: Math.max(0, Math.round(v.ms)) }); edge(asPort(bool(v.c)), id + '.a'); return id + '.v'; }
      case 'st': {
        const k = kindOf(v.n);
        if (k.kind === 'const' || k.kind === 'unknown') { if (k.kind === 'unknown') R.note(0, tr('A(z) {n} változó állapota nem fordítható; a kezdőértékével számolva', { n: v.n }), 'unk' + v.n); return { c: truthy(k.v) ? 1 : 0 }; }
        if (k.kind === 'prev') return bool(timerSub(k.e));
        if (k.kind === 'toggle') return toggleOf(v.n, k);
        if (k.kind === 'counter') return gate('compare', counterOf(v.n, k) + '.n');
        R.note(0, tr('A(z) {n} időzítő értéke nem fordítható', { n: v.n }), 'tm' + v.n); return { c: 0 };
      }
      case 'adc': return gate('compare', adcPort(v.g));
      case 'mux': {
        const c = v.c, a = v.a, b = v.b, ta = isC(a) ? truthy(a) : null, tb = isC(b) ? truthy(b) : null;
        if (ta === true && tb === false) return bool(c);
        if (ta === false && tb === true) return bool(not(c));
        if (tb === false) return bool(and(c, a));
        if (ta === true) return bool(or(c, b));
        if (ta === false) return bool(and(not(c), b));
        if (tb === true) return bool(or(not(c), a));
        return bool(or(and(c, a), and(not(c), b)));
      }
      case 'op': {
        if (v.op === '!') {
          if (v.a.k === 'in') return inPort(v.a.g, 'low');
          const a = bool(v.a);
          if (typeof a === 'string' && v.a.k === 'st' && /^blink:\d+:50$/.test([...cache].find(([, id]) => id + '.v' === a)?.[0] || '')) return a; // fordított négyszögjel = eltolt fázis
          return typeof a === 'string' ? gate('not', a) : { c: a.c ? 0 : 1 };
        }
        if (v.op === '&&' || v.op === '||') {
          const a = bool(v.a), b = bool(v.b!);
          if (typeof a !== 'string') return (v.op === '&&') === !!a.c ? b : a;
          if (typeof b !== 'string') return (v.op === '&&') === !!b.c ? a : b;
          return gate(v.op === '&&' ? 'and' : 'or', a, b);
        }
        if (v.op === '^b') { const a = bool(v.a), b = bool(v.b!); if (typeof a !== 'string' && typeof b !== 'string') return { c: a.c !== b.c ? 1 : 0 }; return gate('xor', a, b); }
        // t % P < K: négyszögjel (a generált kód Ütemadója)
        if (['<', '<=', '>', '>='].includes(v.op) && v.a.k === 'op' && v.a.op === '%' && v.a.a.k === 'time' && v.a.b && isC(v.a.b) && isC(v.b!)) {
          const P = cnum(v.a.b), K = Math.max(0, Math.min(P, cnum(v.b!)));
          return blinkPort(P, (v.op.startsWith('<') ? K : P - K) / P * 100);
        }
        if (['<', '>', '<=', '>=', '==', '!='].includes(v.op)) return compare(v.op, v.a, v.b!);
        if (contains(v, y => y.k === 'time')) { R.note(0, tr('Időtől függő feltétel nem fordítható'), 'time'); return { c: 0 }; }
        // szám logikai helyen: nem nulla
        return compare('!=', v, N(0));
      }
    }
    return { c: 0 };
  }
  function compare(o: string, a: V, b: V): Port {
    const x = lin(a), y = lin(b);
    if (!x || !y || (x.s && y.s)) { R.note(0, tr('Összetett összehasonlítás nem fordítható; hamisnak véve'), 'cmp'); return { c: 0 }; }
    // s·A + B  op  K  alakra
    const s = x.s || y.s; if (!s) return { c: 0 };
    let A = x.a - y.a, K = y.b - x.b, opx = o;
    if (A === 0) return { c: 0 };
    if (A < 0) { A = -A; K = -K; opx = ({ '<': '>', '>': '<', '<=': '>=', '>=': '<=' } as Record<string, string>)[opx] ?? opx; }
    let thr = K / A, port: string;
    if (s.k === 'adc') { port = adcPort(s.g); thr = thr / s.max; }
    else if (s.k === 'st' && kindOf(s.n).kind === 'counter') { port = counterOf(s.n, kindOf(s.n) as Extract<StateKind, { kind: 'counter' }>) + '.n'; }
    else { R.note(0, tr('Összehasonlítás nem fordítható; hamisnak véve'), 'cmp2'); return { c: 0 }; }
    if (opx === '==' || opx === '!=') {
      if (s.k === 'st') { const lo = gate('compare', port), hi = gate('compare', port); const nlo = prog.nodes.find(n => n.id + '.v' === lo)!, nhi = prog.nodes.find(n => n.id + '.v' === hi)!; nlo.props = { op: '>', value: thr - 0.5 }; nhi.props = { op: '<', value: thr + 0.5 }; const eqp = gate('and', lo, hi); return opx === '==' ? eqp : gate('not', eqp); }
      R.note(0, tr('Analóg érték egyenlőségvizsgálata nem fordítható; „nagyobb”-ként közelítve'), 'eqadc'); opx = opx === '==' ? '>' : '<';
    }
    const id = node('compare', { op: opx.startsWith('<') ? '<' : '>', value: +thr.toFixed(4) });
    edge(port, id + '.a');
    return id + '.v';
  }
  /** kitöltés 0…1 (PWM-bemenet) */
  function duty(v: V): Port {
    if (isC(v)) return { c: Math.max(0, Math.min(1, cnum(v))) };
    if (boolish(v)) return bool(v);
    if (v.k === 'mux' && isC(v.a) && isC(v.b)) {
      const a = cnum(v.a), b = cnum(v.b);
      if (a >= 0.99 && b <= 0.01) return bool(v.c);
      if (b >= 0.99 && a <= 0.01) return bool(not(v.c));
      R.note(0, tr('Feltételes kitöltés ({a} % / {b} %): 0 és 100 % között kapcsol', { a: Math.round(a * 100), b: Math.round(b * 100) }), 'muxd');
      return bool(v.c);
    }
    const l = lin(v);
    if (l && l.s) {
      let port: string, A: number;
      if (l.s.k === 'adc') { port = adcPort(l.s.g); A = l.a * l.s.max; }
      else if (l.s.k === 'st' && kindOf(l.s.n).kind === 'counter') { const k = kindOf(l.s.n) as Extract<StateKind, { kind: 'counter' }>; port = counterOf(l.s.n, k) + '.f'; A = l.a * Math.max(1, k.m - 1); }
      else if (l.s.k === 'st') return duty(bool(l.s) as unknown as V);
      else return { c: 0 };
      if (Math.abs(l.b) > 0.03 || Math.abs(A - 1) > 0.1) R.note(0, tr('A kitöltés skálázása (×{a}{b}) közelítve: a bemenet 0…1 tartománya közvetlenül', { a: +A.toFixed(2), b: l.b ? ` + ${+l.b.toFixed(2)}` : '' }), 'scale');
      return port;
    }
    R.note(0, tr('A kitöltés kifejezése nem fordítható'), 'dutyx');
    return { c: 0 };
  }

  /* kimenetek: az állapotváltozó frissített értéke helyett maga az állapot (a blokk kimenete) */
  const byNext = new Map<string, string>();
  for (const n of [...names, ...init.keys()]) { const k = kindOf(n); if (k.kind === 'toggle' || k.kind === 'counter') { byNext.set(key(next(n)), n); byNext.set(key(timerSub(next(n))), n); } }
  const toState = (v: V): V => subst(v, x => { const n = byNext.get(key(x)); return n ? { k: 'st', n } : null; });
  const canon = (v: V): V => toState(timerSub(toState(v)));
  /** A láb értéke a kör végén: ha csak feltételesen kap értéket (különben megtartja), és ugyanazon a feltételen
   *  egy állapotváltozó is ugyanígy változik, akkor az az állapot; különben a feltételes érték (tárolás nélkül). */
  const pinValue = (pk: string): V => {
    const nx = next(pk), self: V = { k: 'st', n: pk }, sl = sel(nx, self);
    if (sl) {
      for (const n of byNext.values()) { const m = sel(next(n), { k: 'st', n }); if (m && eqV(m.c, sl.c) && eqV(m.a, sl.a)) return { k: 'st', n }; }
      R.note(0, tr('A {p} láb csak feltételesen kap értéket; a feltétel idejére kapcsol (tárolás nélkül)', { p: pk.slice(2) }), 'latch' + pk);
      return canon(mux(sl.c, sl.a, init.get(pk) ?? N(0)));
    }
    return canon(nx);
  };
  const summary: string[] = [];
  type Tl = { g: G; ev: Array<{ t: number; on: boolean }> };
  const timeline: Tl[] = [];
  const digital = [...R.pins.entries()].filter(([, c]) => c.mode === 'out');
  for (const [g, c] of digital) {
    const k = 'd' + String(g), ws = R.writes.get(k) || [];
    const concrete = ws.length > 0 && ws.every(w => isC(w.v) && !w.guarded);
    if (concrete && T > 0 && new Set(ws.map(w => truthy(w.v))).size > 1) {
      // a kör végén (t = T) írt érték a következő kör elején érvényes: azonos időpontban az ilyen előre kerül
      const ev = ws.map((w, i) => ({ t: w.t % T, on: !!truthy(w.v), o: (w.t >= T ? -1 : 0) * 1e6 + i })).sort((a, b) => a.t - b.t || a.o - b.o).map(({ t, on }) => ({ t, on }));
      timeline.push({ g, ev }); continue;
    }
    const id = node('out', { pin: pinRef(g) });
    let v = pinValue('@' + k);
    if (concrete) v = ws[ws.length - 1].v;
    else if (!ws.length) v = init.get('@' + k) ?? N(0);
    const p = bool(v);
    if (typeof p === 'string') edge(p, id + '.a'); else if (p.c) edge(constPort(1), id + '.a');
    void c;
  }
  // időzítés: egy lábnál Ütemadó, többnél Sorozat
  if (timeline.length) {
    const at = (tl: Tl, x: number) => { let v = tl.ev[tl.ev.length - 1].on; for (const e of tl.ev) if (e.t <= x) v = e.on; return v; };
    const segs = (tl: Tl) => { const ts = [...new Set([0, ...tl.ev.map(e => e.t)])].sort((a, b) => a - b); return ts.map((t, i) => ({ t, d: (ts[i + 1] ?? T) - t, on: at(tl, t) })); };
    if (timeline.length === 1) {
      const tl = timeline[0], sg = segs(tl), onT = sg.filter(s => s.on).reduce((a, s) => a + s.d, 0);
      // egyetlen bekapcsolt szakasz (körbefordulva) → Ütemadó
      const runs = sg.filter((s, i) => s.on && !sg[(i - 1 + sg.length) % sg.length].on).length;
      if (runs <= 1) {
        const id = node('out', { pin: pinRef(tl.g) });
        edge(blinkPort(T, onT / T * 100), id + '.a');
        summary.push(tr('Ütemadó: {p} ms, {d} % → GPIO {g}', { p: Math.round(T), d: Math.round(onT / T * 100), g: String(tl.g) }));
      } else seqOut([tl]);
    } else seqOut(timeline);
    function seqOut(tls: Tl[]) {
      const ts = [...new Set([0, T, ...tls.flatMap(tl => tl.ev.map(e => e.t))])].map(x => Math.round(x));
      const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
      let step = ts.reduce((a, x) => gcd(a, x), 0) || Math.round(T);
      let rows = Math.round(T / step);
      if (rows > 64) { step = Math.ceil(T / 64); rows = Math.round(T / step); R.note(0, tr('Az időzítés túl finom; {n} lépésre egyszerűsítve', { n: rows }), 'fine'); }
      if (step < 20) R.note(0, tr('{ms} ms-nál rövidebb lépés: a blokkok 20 ms-onként futnak, ezért lassabb lesz', { ms: step }), 'fast');
      const clk = blinkPort(Math.max(20, step));
      for (let ch = 0; ch < tls.length; ch += 4) {
        const grp = tls.slice(ch, ch + 4);
        const pattern = Array.from({ length: rows }, (_, r) => grp.map(tl => (at(tl, r * step) ? '1' : '0')).join(''));
        const sid = node('seq', { preset: 'custom', custom: pattern.join(' '), dir: 'fwd' });
        edge(clk, sid + '.a');
        grp.forEach((tl, k) => { const id = node('out', { pin: pinRef(tl.g) }); edge(`${sid}.c${k}`, id + '.a'); });
        summary.push(tr('Sorozat: {n} lépés, {ms} ms-onként → GPIO {g}', { n: rows, ms: step, g: grp.map(t => String(t.g)).join(', ') }));
      }
    }
  }
  // PWM
  for (const [g, c] of R.pins) {
    if (c.mode !== 'pwm') continue;
    const k = 'p' + String(g), ws = R.writes.get(k) || [];
    const id = node('pwm', { pin: pinRef(g), ...(R.pwmFreq ? { freq: Math.round(R.pwmFreq) } : {}) });
    const concrete = ws.length > 0 && ws.every(w => isC(w.v) && !w.guarded);
    if (concrete) {
      const vals = ws.map(w => Math.max(0, Math.min(1, cnum(w.v))));
      let d = vals[vals.length - 1];
      if (new Set(vals.map(x => x.toFixed(3))).size > 1) {
        if (T > 0) { d = ws.reduce((a, w, i) => a + Math.max(0, Math.min(1, cnum(w.v))) * (((ws[i + 1]?.t ?? T) - w.t)), 0) / T; }
        R.note(ws[0].line, tr('{l}. sor: fokozatosan változó kitöltés (pl. fade) nem fordítható; az átlagos kitöltéssel ({d} %)', { l: ws[0].line, d: Math.round(d * 100) }), 'fade');
      }
      prog.nodes.find(n => n.id === id)!.props.duty = Math.round(d * 1000) / 10;
      continue;
    }
    const v = ws.length ? pinValue('@' + k) : init.get('@' + k) ?? N(0);
    const p = duty(v);
    if (typeof p === 'string') edge(p, id + '.a'); else prog.nodes.find(n => n.id === id)!.props.duty = Math.round(p.c * 1000) / 10;
  }
  if (T > 100 && digital.some(([g]) => !timeline.some(t => t.g === g)) && !timeline.length && [...kinds.values()].every(k => k.kind !== 'toggle' && k.kind !== 'counter'))
    R.note(0, tr('A fő ciklus {ms} ms-os várakozása a blokkos programban nem kell: a blokkok 20 ms-onként futnak', { ms: Math.round(T) }), 'polldelay');
  if (!prog.nodes.length) R.note(0, tr('A kódból nem keletkezett blokk (nincs kimenet: digitalWrite, analogWrite, pin.value…).'));

  arrangeProgram(prog);
  // összefoglaló: blokktípusonként
  const cnt = new Map<string, number>();
  for (const n of prog.nodes) cnt.set(n.type, (cnt.get(n.type) || 0) + 1);
  if (cnt.size) summary.unshift(tr('{n} blokk: {x}', { n: prog.nodes.length, x: [...cnt].map(([t, k]) => `${k} × ${tr(NODE_DEFS[t].label)}`).join(', ') }));
  R.notes.sort((a, b) => a.line - b.line);
  return { lang, program: prog, notes: R.notes, summary };
}

/** Az átalakított program a tervbe: csere (az eddigi program helyére) vagy hozzáadás (a meglévő mellé, jobbra). */
export function applyImport(D: Design, res: ImportResult, mode: 'replace' | 'append' = 'replace'): string[] {
  if (mode === 'replace' || !D.program || !D.program.nodes.length) {
    D.program = JSON.parse(JSON.stringify(res.program)) as Program;
    return D.program.nodes.map(n => n.id);
  }
  const prog = progOf(D), ren = new Map<string, string>();
  const x0 = Math.max(...prog.nodes.map(n => n.x)) + BLOCK_W + COL_GAP * 2;
  for (const n of res.program.nodes) {
    let i = 1; while (prog.nodes.some(m => m.id === 'n' + i)) i++;
    const id = 'n' + i; ren.set(n.id, id);
    prog.nodes.push({ ...JSON.parse(JSON.stringify(n)) as PNode, id, x: n.x + x0 });
  }
  const r = (ref: string) => { const k = ref.lastIndexOf('.'); return ren.get(ref.slice(0, k)) + ref.slice(k); };
  for (const e of res.program.edges) { let i = 1; while (prog.edges.some(m => m.id === 'e' + i)) i++; prog.edges.push({ id: 'e' + i, from: r(e.from), to: r(e.to) } as PEdge); }
  return [...ren.values()];
}
