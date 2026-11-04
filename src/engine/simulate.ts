/**
 * Áramkör-szimuláció: egyenáramú csomóponti analízis szakaszonként lineáris elemekkel (dióda, MOSFET,
 * NPN lezárt/aktív/telített), iterálva, amíg az állapotok be nem állnak. PWM: időszeletekre bontva,
 * súlyozott átlaggal; órajeles logika: a beállt állapotok közti éleken léptet; léptetőmotor: a tekercsek
 * gerjesztési sorrendjéből lép.
 */
import type { Expr, Level } from '../core/logic';
import { evalExpr, parseExpr, pinRef, varsOf } from '../core/logic';
import { num } from '../core/expr';
import type { PartInstance } from '../core/schema';
import { DEFS, penv } from './defs';
import { gpioDefault, gpioModeOk } from './mcu';
import type { Netlist } from './netlist';
import { solve, type Branch } from './solve';
import type { Design, NetPin, PwmCfg } from './types';

/* ---------- eredmény ---------- */

export interface SimLed { p: PartInstance; I: number; on: boolean; light: boolean; imax: number | null }
export interface SimMcu { p: PartInstance; powered: boolean; usb: boolean; feeds: boolean; vsys: number; vsysName: string; Usys: number; vreg: number; vmax: number | null; igpio: number }
export interface SimGpio { p: PartInstance; q: NetPin; mode: string; V: number; I: number; float: boolean; powered: boolean }
export interface SimBat { p: PartInstance; I: number; kind: string; node: number }
export interface SimSrc { kind: 'vbus' | 'v33'; pc: unknown; I: number }
export interface SimFet { p: PartInstance; on: boolean; vgs: number; I: number; imax: number | null; floatGate: boolean }
export interface SimCap { p: PartInstance; U: number; f: number; vmax: number | null; polar: boolean; R: number; tau: number | null; float: boolean }
export type BjtState = 'off' | 'act' | 'sat';
export interface SimBjt { p: PartInstance; st: BjtState; ib: number; ic: number; vbe: number; vce: number; beta: number; imax: number | null; floatBase: boolean }
export interface SimMotor { p: PartInstance; U: number; I: number; vnom: number; speed: number }
export interface SimServo { p: PartInstance; U: number; I: number; sigNet: number; pmin: number; pmax: number; pulse?: number | null; angle?: number | null }
export type OutState = Level | 'z';
export interface SimLogic {
  p: PartInstance; vdd: number; imax: number;
  ins: Array<{ name: string; lv: Level; open: boolean }>;
  outs: Array<{ name: string; st: OutState; I: number }>;
  regs: Array<{ name: string; val: Level; clk: Level; d: Level; async: 0 | 1 | null; edge: 'rise' | 'fall' }>;
}
export interface SimStepper {
  p: PartInstance; steps: number; rotor: number; ua: number; ub: number; uc: number; ud: number; I: number;
  pattern?: number; pos?: number; coils?: string; angle?: number; rotorAngle?: number;
}
export interface PwmPin extends PwmCfg { key: string; q: NetPin }
export interface SimResult {
  /** Hálózat (vagy belső csomópont, pl. 'usb:p1') feszültsége. */
  netV: Map<number | string, number>;
  /** Forrásból el nem érhető (lebegő) hálózatok. */
  floating: Set<number | string>;
  leds: SimLed[]; picos: SimMcu[]; gpios: SimGpio[]; bats: SimBat[]; srcI: SimSrc[]; fets: SimFet[]; caps: SimCap[];
  bjts: SimBjt[]; motors: SimMotor[]; servos: SimServo[]; logics: SimLogic[]; steppers: SimStepper[];
  /** PWM-kimenetek a hálózatuk szerint. */
  pwm?: Map<number, PwmPin>;
}

/* ---------- állapot a szimulációk között ---------- */

/** Logikai tárolók alkatrészenként (a szimulációk között megmarad; szimuláció indításakor törlődik). */
export const LSTATE = new Map<string, { regs: Record<string, Level>; clk: Record<string, Level> }>();
/** Léptetőmotorok helyzete (fél lépés) és utolsó fázisa. */
export const STSTATE = new Map<string, { pos: number; phase: number | null }>();
export function resetSimState(): void { LSTATE.clear(); STSTATE.clear(); }

/* ---------- GPIO és PWM ---------- */

/** A GPIO tényleges módja: a beállított, ha a láb képességei engedik, különben az alapmód. */
export function gpioMode(D: Design, p: PartInstance, id: string, q: NetPin | null | undefined, A?: Netlist | null): string {
  const m = D.gpio[p.id + '.' + id];
  if (!q) return m || 'pullup';
  return m && gpioModeOk(q, m) ? m : gpioDefault(q, A);
}
export const pwmCfg = (D: Design, key: string): PwmCfg => Object.assign({ duty: 50, freq: 1000 }, (D.pwm || {})[key] || {});
/** Ennél lassabb PWM-et a szimuláció nem átlagolja, hanem valós időben villogtatja (a szem kb. 25 Hz alatt látja a villogást). */
export const BLINK_HZ = 25;
/** NPN: bázis-emitter és telítési soros ellenállás (Ω). */
const RBE = 20, RCE = 1;

export interface SimOpts {
  /** Fut-e a szimuláció (a léptetőmotor csak ekkor lép). */
  running: boolean;
  /** A lassú PWM-lábak közül az éppen magas szintűek (villogtatás); elhagyva minden PWM a kitöltés szerint átlagolódik. */
  slow?: Set<string>;
}

/**
 * PWM: időszeletekre bontott szimuláció. Az azonos frekvenciájú, egyszerre induló PWM-kimenetek
 * kitöltéseiből szakaszok lesznek (mindegyikben fix magas/alacsony szintek); az eredmény a szakaszok
 * idővel súlyozott átlaga, a GPIO- és forrásáramoknál a csúcsérték.
 */
export function simulate(D: Design, A: Netlist, opts: SimOpts): SimResult {
  const all: PwmPin[] = [];
  for (const p of D.parts) for (const q of A.byPart.get(p.id)!.pins)
    if (q.role === 'gpio' && gpioMode(D, p, q.id, q, A) === 'pwm') all.push({ key: p.id + '.' + q.id, q, ...pwmCfg(D, p.id + '.' + q.id) });
  const slow = opts.slow;
  const pw = slow ? all.filter(x => +x.freq >= BLINK_HZ) : all, fixed = slow || new Set<string>();
  const cuts = [...new Set(pw.map(x => Math.max(0, Math.min(100, +x.duty || 0))))].filter(d => d > 0 && d < 100).sort((a, b) => a - b);
  const bounds = [0, ...cuts, 100];
  const runAll = () => {
    const runs: Array<{ w: number; o: SimResult }> = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const lo = bounds[i], w = (bounds[i + 1] - lo) / 100;
      if (w <= 0) continue;
      runs.push({ w, o: simulate1(D, A, new Set([...fixed, ...pw.filter(x => x.duty > lo).map(x => x.key)])) });
    }
    return mergeSims(runs);
  };
  // órajeles logika: két beállt állapot között az órajel élén a tárolók átveszik a D értékét, utána újraszámol (kaszkád: legfeljebb 16 kör)
  let out = runAll();
  for (let pass = 0; pass < 16 && clockStep(out); pass++) out = runAll();
  out.pwm = new Map(all.map(x => [x.q.net, x]));
  stepperStep(out, opts.running);
  // szervó: a jelvezetéken érkező PWM impulzusszélessége → szög
  for (const s of out.servos) {
    const x = out.pwm.get(s.sigNet);
    s.pulse = x ? x.duty / 100 / Math.max(1e-9, x.freq) * 1000 : null;
    const ok = !!x && x.freq >= 40 && x.freq <= 400 && s.pulse! >= s.pmin - 0.2 && s.pulse! <= s.pmax + 0.2;
    s.angle = ok ? Math.max(0, Math.min(180, (s.pulse! - s.pmin) / (s.pmax - s.pmin) * 180)) : null;
  }
  return out;
}

/*
 * Léptetőmotor: a gerjesztett tekercsek mintájából (A=1, B=2, C=4, D=8) a félléptetéses fázis; a fázis
 * változásából lép előre/hátra (±1–3 fél lépés; 4-es ugrásnál nem dönthető el az irány, nem mozdul).
 */
const STEP_PHASE: Record<number, number> = { 1: 0, 3: 1, 2: 2, 6: 3, 4: 4, 12: 5, 8: 6, 9: 7 };
function stepperStep(out: SimResult, running: boolean): void {
  for (const s of out.steppers) {
    const st = STSTATE.get(s.p.id) || { pos: 0, phase: null };
    const pat = [s.ua, s.ub, s.uc, s.ud].reduce((m, u, i) => m | (u > 1.5 ? 1 << i : 0), 0), ph = STEP_PHASE[pat];
    if (running && ph != null) {
      if (st.phase != null) { const d = (ph - st.phase + 8) % 8; if (d >= 1 && d <= 3) st.pos += d; else if (d >= 5) st.pos -= 8 - d; }
      st.phase = ph;
    }
    STSTATE.set(s.p.id, st);
    s.pattern = pat; s.pos = st.pos; s.coils = 'ABCD'.split('').filter((_, i) => pat & (1 << i)).join('');
    s.angle = st.pos * 360 / s.steps; s.rotorAngle = st.pos * 360 / (s.steps / s.rotor);
  }
}

function clockStep(out: SimResult): boolean {
  let changed = false;
  for (const L of out.logics) {
    if (!L.regs.length) continue;
    const st = LSTATE.get(L.p.id) || { regs: {}, clk: {} }, next: Record<string, Level> = {};
    for (const r of L.regs) {
      const prev = st.clk[r.name], now = r.clk;
      st.clk[r.name] = now;
      const edge = r.edge === 'fall' ? prev === 1 && now === 0 : prev === 0 && now === 1;
      next[r.name] = r.async != null ? r.async : edge ? r.d : r.name in st.regs ? st.regs[r.name] : r.val;
    }
    for (const k in next) if (next[k] !== st.regs[k]) changed = true;
    st.regs = next;
    LSTATE.set(L.p.id, st);
  }
  return changed;
}

const SIM_MAX: Record<string, Set<string>> = { gpios: new Set(['I']), srcI: new Set(['I']) };
const ST_RANK: Record<string, number> = { off: 0, sat: 1, act: 2 };
const SIM_LISTS = ['leds', 'picos', 'gpios', 'bats', 'srcI', 'fets', 'caps', 'bjts', 'motors', 'servos', 'logics', 'steppers'] as const;

/** Időszeletek összevonása: számok súlyozott átlaga (áramoknál a csúcs), logikai „van-e”, tranzisztornál a legaktívabb állapot. */
export function mergeSims(runs: ReadonlyArray<{ w: number; o: SimResult }>): SimResult {
  if (runs.length === 1) return runs[0].o;
  const o0 = runs[0].o, out: SimResult = { ...o0, netV: new Map(), floating: new Set() };
  for (const { w, o } of runs) {
    for (const [k, v] of o.netV) out.netV.set(k, (out.netV.get(k) || 0) + w * v);
    for (const k of o.floating) out.floating.add(k);
  }
  for (const name of SIM_LISTS) {
    const merged = (o0[name] as unknown as Array<Record<string, unknown>>).map((x, i) => {
      const r: Record<string, unknown> = { ...x };
      for (const k in x) {
        const v = x[k], vs = runs.map(({ w, o }) => [w, (o[name][i] as unknown as Record<string, unknown>)[k]] as const);
        if (typeof v === 'number' && vs.every(([, y]) => y === v)) r[k] = v; // azonos érték (pl. hálózat-azonosító): pontosan marad
        else if (typeof v === 'number')
          r[k] = SIM_MAX[name] && SIM_MAX[name].has(k)
            ? vs.reduce<number>((m, [, y]) => (Math.abs(y as number) > Math.abs(m) ? (y as number) : m), 0)
            : vs.reduce<number>((t, [w, y]) => t + w * (typeof y === 'number' ? y : 0), 0);
        else if (typeof v === 'boolean') r[k] = vs.some(([, y]) => y);
        else if (k === 'st') r[k] = vs.reduce<unknown>((m, [, y]) => (ST_RANK[y as string] > ST_RANK[m as string] ? y : m), v);
      }
      return r;
    });
    (out as unknown as Record<string, unknown>)[name] = merged;
  }
  return out;
}

/* ---------- egy állapot megoldása ---------- */

interface McuEl { p: PartInstance; gnd: number; vbus: number; vsys: number; v33: number; vsysPin: NetPin; vreg: number; vmax: number | null; igpio: number; gp: GpioEl[]; reg: boolean; d: boolean }
interface GpioEl { q: NetPin; node: number; mode: string }
interface LedEl { p: PartInstance; a: number; k: number; vf: number; ron: number; imax: number | null; light: boolean; on: boolean }
interface ResEl { p: PartInstance; a: number; b: number; g: number }
interface BatEl { p: PartInstance; a: number; b: number; E: number; g: number; kind: string }
interface CapEl { p: PartInstance; a: number; b: number; f: number; vmax: number | null; polar: boolean }
interface BjtEl { p: PartInstance; c: number; b: number; e: number; beta: number; vbe: number; vcesat: number; imax: number | null; be: boolean; st: BjtState; ic: number }
interface MotorEl { p: PartInstance; a: number; b: number; g: number; vnom: number }
interface StepperEl { p: PartInstance; com: number; coils: number[]; g: number; steps: number; rotor: number }
interface ServoEl { p: PartInstance; vp: number; gnd: number; sigNet: number; g: number; pmin: number; pmax: number }
interface FetEl { p: PartInstance; d: number; g: number; s: number; vth: number; ron: number; imax: number | null; on: boolean }
interface LogicIn { q: NetPin; node: number; open: boolean }
interface LogicOutEl { p: PartInstance; pin: NetPin; node: number; ast: Expr; oe: Expr | null; type: 'pp' | 'od'; st: OutState }
interface LogicRegEl { name: string; clk: Expr; d: Expr; reset: Expr | null; set: Expr | null; edge: 'rise' | 'fall'; stored: Level; eff: Level; async?: 0 | 1 | null }
interface LogicEl { p: PartInstance; vcc: number; gnd: number; ins: Map<string, LogicIn>; outs: LogicOutEl[]; regs: LogicRegEl[]; vih: number; vil: number; g: number; imax: number; vdd: number; lvl?: (name: string) => Level }
interface El extends Branch { kind: string; ref?: unknown }

/** Egy rögzített állapot (a PWM-lábak közül a `high` halmazban lévők magasak) megoldása. */
export function simulate1(D: Design, A: Netlist, high: Set<string> | null): SimResult {
  const idx = new Map<number | string, number>();
  const nd = (net: number | string) => { if (!idx.has(net)) idx.set(net, idx.size); return idx.get(net)!; };
  for (const q of A.pins) if (q.net >= 0) nd(q.net);
  // vezérlőlap belső USB-csomópontja, ha a VBUS nincs kivezetve
  for (const p of D.parts) for (const el of DEFS[p.type].def.model || []) if (el.el === 'mcu' && !el.vbus) nd('usb:' + p.id);
  const n = idx.size;
  const picos: McuEl[] = [], leds: LedEl[] = [], ress: ResEl[] = [], bats: BatEl[] = [], fets: FetEl[] = [], caps: CapEl[] = [], bjts: BjtEl[] = [],
    motors: MotorEl[] = [], servos: ServoEl[] = [], logics: LogicEl[] = [], steppers: StepperEl[] = [];
  for (const p of D.parts) {
    const bp = A.byPart.get(p.id)!, m = bp.map, N = (id: string) => idx.get(m[id].net)!;
    const model = DEFS[p.type].def.model;
    if (!model) continue;
    const E = penv(p), nn = (x: unknown) => (x != null ? num(x, E) : null);
    for (const el of model) {
      if (el.el === 'mcu') picos.push({ p, gnd: N(el.gnd), vbus: el.vbus ? N(el.vbus) : idx.get('usb:' + p.id)!, vsys: N(el.vsys), v33: N(el.v33), vsysPin: m[el.vsys],
        vreg: num(el.vreg ?? 1.8, E), vmax: nn(el.vmax), igpio: num(el.igpio ?? 0.012, E),
        gp: bp.pins.filter(q => q.role === 'gpio').map(q => ({ q, node: idx.get(q.net)!, mode: gpioMode(D, p, q.id, q, A) })), reg: false, d: false });
      else if (el.el === 'diode') leds.push({ p, a: N(el.a), k: N(el.k), vf: num(el.vf, E), ron: Math.max(1e-3, num(el.ron ?? 15, E)), imax: nn(el.imax), light: !!el.light, on: false });
      else if (el.el === 'resistor') ress.push({ p, a: N(el.a), b: N(el.b), g: 1 / Math.max(1e-3, num(el.ohm, E)) });
      else if (el.el === 'source') bats.push({ p, a: N(el.p), b: N(el.n), E: num(el.v, E), g: 1 / Math.max(1e-3, num(el.rint ?? 0.1, E)), kind: el.kind || 'battery' });
      else if (el.el === 'capacitor') caps.push({ p, a: N(el.a), b: N(el.b), f: num(el.f, E), vmax: nn(el.vmax), polar: !!el.polar });
      else if (el.el === 'npn') bjts.push({ p, c: N(el.c), b: N(el.b), e: N(el.e), beta: Math.max(1, num(el.beta, E)), vbe: num(el.vbe ?? 0.65, E), vcesat: num(el.vcesat ?? 0.1, E), imax: nn(el.imax), be: false, st: 'off', ic: 0 });
      else if (el.el === 'motor') motors.push({ p, a: N(el.a), b: N(el.b), g: 1 / Math.max(1e-3, num(el.ohm, E)), vnom: Math.max(0.1, num(el.vnom, E)) });
      else if (el.el === 'stepper') steppers.push({ p, com: N(el.com), coils: [N(el.a), N(el.b), N(el.c), N(el.d)], g: 1 / Math.max(1e-3, num(el.ohm, E)), steps: Math.max(1, num(el.steps ?? 4096, E)), rotor: Math.max(1, num(el.rotor ?? 64, E)) });
      else if (el.el === 'servo') servos.push({ p, vp: N(el.vp), gnd: N(el.gnd), sigNet: m[el.sig].net, g: 1 / Math.max(1e-3, num(el.ohm, E)), pmin: num(el.pmin ?? 0.5, E), pmax: num(el.pmax ?? 2.5, E) });
      else if (el.el === 'logic') {
        const ps = bp.pins, ast = (x: unknown): Expr | null => { try { return x && String(x).trim() ? parseExpr(String(x)) : null; } catch { return null; } };
        const ins = new Map<string, LogicIn>(), outs: LogicOutEl[] = [], stored = (LSTATE.get(p.id) || { regs: {} as Record<string, Level> }).regs;
        const regs: LogicRegEl[] = [];
        for (const r of el.regs || []) {
          const clk = ast(r.clk), d = ast(r.d);
          if (!clk || !d) continue;
          regs.push({ name: r.name, clk, d, reset: ast(r.reset), set: ast(r.set), edge: r.edge === 'fall' ? 'fall' : 'rise', stored: stored[r.name] ?? (r.init ?? 0), eff: 'X' });
        }
        const rn = new Set(regs.map(r => r.name));
        const addIns = (a: Expr | null) => {
          if (!a) return;
          for (const v of varsOf(a)) {
            if (ins.has(v) || rn.has(v)) continue;
            const id = pinRef(v, ps);
            if (!id) continue;
            const q = m[id];
            ins.set(v, { q, node: N(id), open: (A.netPins.get(q.net) || []).length <= 1 && (A.netSecs.get(q.net) || 0) <= 1 });
          }
        };
        for (const o of el.outs || []) {
          const a = ast(o.expr), oe = ast(o.oe);
          if (!a || !m[o.pin]) continue;
          outs.push({ p, pin: m[o.pin], node: N(o.pin), ast: a, oe, type: o.type === 'od' ? 'od' : 'pp', st: 'z' });
          addIns(a); addIns(oe);
        }
        for (const r of regs) { addIns(r.clk); addIns(r.d); addIns(r.reset); addIns(r.set); }
        logics.push({ p, vcc: N(el.vcc), gnd: N(el.gnd), ins, outs, regs, vih: num(el.vih ?? 0.7, E), vil: num(el.vil ?? 0.3, E), g: 1 / Math.max(1, num(el.rout ?? 50, E)), imax: num(el.imax ?? 0.025, E), vdd: 0 });
      }
      else if (el.el === 'nmos') fets.push({ p, d: N(el.d), g: N(el.g), s: N(el.s), vth: num(el.vth, E), ron: Math.max(1e-3, num(el.ron, E)), imax: nn(el.imax), on: false });
    }
  }

  let V = new Float64Array(n), els: El[] = [];
  for (let it = 0; it < 60; it++) {
    els = [];
    const add = (a: number, b: number, g: number, E: number, kind: string, ref?: unknown, cp?: number, cn?: number) =>
      els.push(cp == null ? { a, b, g, E, kind, ref } : { a, b, g, E, kind, ref, cp, cn });
    for (let i = 0; i < n; i++) add(i, -1, 1e-9, 0, 'leak');
    for (const pc of picos) {
      add(pc.gnd, -1, 1e4, 0, 'gref', pc);
      if (D.settings.usb) add(pc.vbus, pc.gnd, 10, 5, 'vbus', pc);
      if (pc.vbus !== pc.vsys) add(pc.vbus, pc.vsys, pc.d ? 5 : 1e-9, pc.d ? 0.3 : 0, 'pdiode', pc);
      if (pc.reg) {
        add(pc.v33, pc.gnd, 10, 3.3, 'v33', pc);
        for (const g of pc.gp) {
          const md = g.mode === 'pwm' ? (high && high.has(pc.p.id + '.' + g.q.id) ? 'out_high' : 'out_low') : g.mode;
          if (md === 'pullup') add(g.node, pc.v33, 2e-5, 0, 'pull', g);
          else if (md === 'pulldown') add(g.node, pc.gnd, 2e-5, 0, 'pull', g);
          else if (md === 'out_high') add(g.node, pc.gnd, 1 / 40, 3.3, 'gout', g);
          else if (md === 'out_low') add(g.node, pc.gnd, 1 / 40, 0, 'gout', g);
        }
      }
    }
    for (const r of ress) add(r.a, r.b, r.g, 0, 'res', r);
    for (const m of motors) add(m.a, m.b, m.g, 0, 'motor', m);
    for (const L of logics) for (const o of L.outs) { if (o.st === 1) add(o.node, L.vcc, L.g, 0, 'lout', o); else if (o.st === 0) add(o.node, L.gnd, L.g, 0, 'lout', o); }
    for (const s of servos) add(s.vp, s.gnd, s.g, 0, 'servo', s);
    for (const s of steppers) for (const k of s.coils) add(s.com, k, s.g, 0, 'coil', s);
    for (const l of leds) add(l.a, l.k, l.on ? 1 / l.ron : 1e-9, l.on ? l.vf : 0, 'led', l);
    for (const b of bats) add(b.a, b.b, b.g, b.E, 'bat', b);
    for (const f of fets) add(f.d, f.s, f.on ? 1 / f.ron : 1e-9, 0, 'fet', f);
    // NPN: B–E dióda; C–E lezárva, telítve (kis ellenállás + Uce,sat) vagy aktívan (áramforrás Ic = β·Ib)
    for (const t of bjts) {
      add(t.b, t.e, t.be ? 1 / RBE : 1e-9, t.be ? t.vbe : 0, 'bjt_be', t);
      if (t.st === 'sat') add(t.c, t.e, 1 / RCE, t.vcesat, 'bjt_ce', t);
      else if (t.st === 'act') add(t.c, t.e, t.beta / RBE, t.vbe, 'bjt_ce', t, t.b, t.e); // aktív: Ic = β·(Ube−0,65)/Rbe = β·Ib
    }
    V = solve(n, els);
    let ch = false;
    for (const l of leds) { const d = V[l.a] - V[l.k]; if (!l.on && d > l.vf + 1e-4) { l.on = true; ch = true; } else if (l.on && d < l.vf) { l.on = false; ch = true; } }
    for (const f of fets) { const on = V[f.g] - V[f.s] > f.vth; if (on !== f.on) { f.on = on; ch = true; } }
    // logika: a bemeneti szintekből a kimenetek (push-pull: VCC/GND felé, nyitott drain: csak GND felé, X vagy OE=0: nem hajt)
    for (const L of logics) {
      const vdd = V[L.vcc] - V[L.gnd];
      L.vdd = vdd;
      const pin = (name: string): Level => {
        const x = L.ins.get(name);
        if (!x || x.open) return 'X';
        const v = V[x.node] - V[L.gnd];
        return v >= L.vih * vdd ? 1 : v <= L.vil * vdd ? 0 : 'X';
      };
      // tárolók: a tárolt érték, amíg az aszinkron törlés/beállítás nem írja felül
      const rg = new Map(L.regs.map(r => [r.name, r]));
      const lvS = (name: string): Level => (rg.has(name) ? rg.get(name)!.stored : pin(name));
      for (const r of L.regs) {
        const rs = r.reset ? evalExpr(r.reset, lvS) : 0, ss = r.set ? evalExpr(r.set, lvS) : 0;
        r.async = vdd < 1 ? null : rs === 1 ? 0 : ss === 1 ? 1 : null;
        r.eff = vdd < 1 ? 'X' : r.async ?? r.stored;
      }
      const lvl = (name: string): Level => (rg.has(name) ? rg.get(name)!.eff : pin(name));
      L.lvl = lvl;
      for (const o of L.outs) {
        let st: OutState = 'z';
        if (vdd >= 1) {
          const en = o.oe ? evalExpr(o.oe, lvl) : 1;
          if (en === 1) { const v = evalExpr(o.ast, lvl); st = v === 'X' ? 'z' : o.type === 'od' ? (v ? 'z' : 0) : v; }
        }
        if (st !== o.st) { o.st = st; ch = true; }
      }
    }
    for (const t of bjts) {
      const vbe = V[t.b] - V[t.e], vce = V[t.c] - V[t.e];
      if (!t.be && vbe > t.vbe + 1e-4) { t.be = true; ch = true; } else if (t.be && vbe < t.vbe) { t.be = false; ch = true; }
      const want = t.beta * (t.be ? Math.max(0, (vbe - t.vbe) / RBE) : 0);
      if (!t.be) { if (t.st !== 'off') { t.st = 'off'; ch = true; } }
      else if (t.st === 'off') { t.st = 'act'; ch = true; }
      else if (t.st === 'sat') { if ((vce - t.vcesat) / RCE > want * 1.02 + 1e-9) { t.st = 'act'; ch = true; } }
      else if (vce < t.vcesat - 0.01) { t.st = 'sat'; ch = true; }
    }
    for (const pc of picos) {
      if (pc.vbus === pc.vsys) pc.d = !!D.settings.usb;
      else { const d = V[pc.vbus] - V[pc.vsys]; if (!pc.d && d > 0.3001) { pc.d = true; ch = true; } else if (pc.d && d < 0.3) { pc.d = false; ch = true; } }
      const w = V[pc.vsys] - V[pc.gnd] > pc.vreg;
      if (w !== pc.reg) { pc.reg = w; ch = true; }
    }
    if (!ch) break;
  }

  const vv = (i: number | undefined) => (i != null && i >= 0 ? V[i] : 0);
  const cur = (e: El) => e.g * (vv(e.cp ?? e.a) - vv(e.cn ?? e.b) - e.E);
  // lebegés: forrásokból elérhető-e
  const adj: number[][] = Array.from({ length: n }, () => []), seed = new Set<number>();
  for (const e of els) {
    if (e.kind === 'leak' || e.g < 1e-6 || e.cp != null) continue;
    if (e.a >= 0 && e.b >= 0) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
    if (['gref', 'vbus', 'v33', 'gout', 'bat'].includes(e.kind)) { if (e.a >= 0) seed.add(e.a); if (e.b >= 0) seed.add(e.b); }
  }
  const reach = new Uint8Array(n), stack = [...seed];
  stack.forEach(i => (reach[i] = 1));
  while (stack.length) { const i = stack.pop()!; for (const j of adj[i]) if (!reach[j]) { reach[j] = 1; stack.push(j); } }
  const netV = new Map<number | string, number>(), floating = new Set<number | string>();
  for (const [net, i] of idx) { netV.set(net, V[i]); if (!reach[i]) floating.add(net); }
  const out: SimResult = { netV, floating, leds: [], picos: [], gpios: [], bats: [], srcI: [], fets: [], caps: [], bjts: [], motors: [], servos: [], logics: [], steppers: [] };
  for (const s of steppers) {
    const U = s.coils.map(k => V[s.com] - V[k]);
    out.steppers.push({ p: s.p, steps: s.steps, rotor: s.rotor, ua: U[0], ub: U[1], uc: U[2], ud: U[3], I: U.reduce((t, u) => t + Math.max(0, u), 0) * s.g });
  }
  for (const L of logics) {
    const gl = V[L.gnd];
    const lv = (x: LogicIn): Level => { if (x.open || !reach[x.node]) return 'X'; const v = V[x.node] - gl; return v >= L.vih * L.vdd ? 1 : v <= L.vil * L.vdd ? 0 : 'X'; };
    out.logics.push({
      p: L.p, vdd: L.vdd, imax: L.imax,
      ins: [...L.ins].map(([name, x]) => ({ name, lv: L.vdd >= 1 ? lv(x) : 'X', open: x.open || !reach[x.node] })),
      outs: L.outs.map(o => { const e = els.find(x => x.kind === 'lout' && x.ref === o); return { name: o.pin.name, st: o.st, I: e ? Math.abs(cur(e)) : 0 }; }),
      regs: L.regs.map(r => ({ name: r.name, val: r.eff, clk: L.vdd >= 1 && L.lvl ? evalExpr(r.clk, L.lvl) : 'X', d: L.vdd >= 1 && L.lvl ? evalExpr(r.d, L.lvl) : 'X', async: r.async ?? null, edge: r.edge })),
    });
  }
  for (const m of motors) { const U = V[m.a] - V[m.b]; out.motors.push({ p: m.p, U, I: U * m.g, vnom: m.vnom, speed: Math.max(-1.5, Math.min(1.5, U / m.vnom)) }); }
  for (const s of servos) { const U = V[s.vp] - V[s.gnd]; out.servos.push({ p: s.p, U, I: U * s.g, sigNet: s.sigNet, pmin: s.pmin, pmax: s.pmax }); }
  // kondenzátor: feszültség és időállandó (τ = R·C, R a kapcsain látott Thevenin-ellenállás a munkapontban)
  for (const k of caps) {
    const U = V[k.a] - V[k.b], test = solve(n, [...els, { a: k.a, b: k.b, g: 1e-9, E: -1e6 }]), R = Math.abs(test[k.a] - test[k.b] - U) / 1e-3;
    out.caps.push({ p: k.p, U, f: k.f, vmax: k.vmax, polar: k.polar, R, tau: R < 1e8 ? R * k.f : null, float: !reach[k.a] || !reach[k.b] });
  }
  for (const t of bjts) {
    const be = els.find(e => e.kind === 'bjt_be' && e.ref === t), ce = els.find(e => e.kind === 'bjt_ce' && e.ref === t);
    out.bjts.push({ p: t.p, st: t.st, ib: be ? Math.max(0, cur(be)) : 0, ic: ce ? cur(ce) : 0, vbe: V[t.b] - V[t.e], vce: V[t.c] - V[t.e], beta: t.beta, imax: t.imax, floatBase: !reach[t.b] });
  }
  for (const e of els) {
    if (e.kind === 'led') { const l = e.ref as LedEl; out.leds.push({ p: l.p, I: Math.max(0, cur(e)), on: l.on, light: l.light, imax: l.imax }); }
    if (e.kind === 'fet') { const f = e.ref as FetEl; out.fets.push({ p: f.p, on: f.on, vgs: V[f.g] - V[f.s], I: cur(e), imax: f.imax, floatGate: !reach[f.g] }); }
    if (e.kind === 'bat') { const b = e.ref as BatEl; out.bats.push({ p: b.p, I: cur(e), kind: b.kind, node: e.a }); }
    if (e.kind === 'vbus') out.srcI.push({ kind: 'vbus', pc: e.ref, I: -cur(e) });
    if (e.kind === 'v33') out.srcI.push({ kind: 'v33', pc: e.ref, I: -cur(e) });
  }
  for (const pc of picos) {
    out.picos.push({ p: pc.p, powered: pc.reg, usb: D.settings.usb, feeds: pc.d, vsys: pc.vsys, vsysName: pc.vsysPin.name, Usys: V[pc.vsys] - V[pc.gnd], vreg: pc.vreg, vmax: pc.vmax, igpio: pc.igpio });
    for (const g of pc.gp) {
      const e = els.find(x => x.kind === 'gout' && x.ref === g);
      out.gpios.push({ p: pc.p, q: g.q, mode: g.mode, V: V[g.node] - V[pc.gnd], I: e ? -cur(e) : 0, float: !reach[g.node], powered: pc.reg });
    }
  }
  return out;
}

/** GPIO kijelzett szintje: – (nincs táp), ? (lebeg vagy köztes), A (analóg), P (PWM), 1, 0. */
export const gpioLevel = (g: SimGpio): string =>
  !g.powered ? '–' : g.float ? '?' : g.mode === 'adc' ? 'A' : g.mode === 'pwm' ? 'P' : g.V >= 2 ? '1' : g.V <= 0.8 ? '0' : '?';
