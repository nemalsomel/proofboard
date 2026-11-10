/**
 * Szimuláció felület nélkül: a terv, a lenyomott gombok és (ha van) a program futása adott ideig, ütemenként.
 * Az agent eszközei és a későbbi MCP-szerver használja; a felület a saját, valós idejű ciklusát futtatja.
 */
import type { PartInstance } from '../core/schema';
import { hasPress } from './defs';
import { analyze, type Netlist } from './netlist';
import { evalProgram, newRuntime, withProgram, type ProgOut } from './program';
import { resetSimState, simulate, type SimResult } from './simulate';
import type { Design } from './types';

export interface HeadlessOpts {
  /** lenyomott gombok (alkatrész-azonosító) */ pressed?: Set<string>;
  /** a program futásának ideje (ms); 0: egyetlen kiértékelés */ ms?: number;
  /** egy ütem (ms) */ tick?: number;
}
export interface HeadlessResult { A: Netlist; SIM: SimResult; prog: ProgOut | null; t: number }

/** Szimuláció a megadott ideig: a program ütemenként kiértékelődik, a GPIO-beállításai a terv fölé kerülnek. */
export function simulateFor(D: Design, o: HeadlessOpts = {}): HeadlessResult {
  resetSimState();
  const pressed = o.pressed || new Set<string>();
  const A = analyze(D, { pressed: (p: PartInstance) => hasPress(p) && pressed.has(p.id) });
  let SIM = simulate(D, A, { running: true });
  const prog = D.program && D.program.nodes.length ? D.program : null;
  if (!prog) return { A, SIM, prog: null, t: 0 };
  const rt = newRuntime(), tick = o.tick || 20, end = Math.max(0, o.ms || 0);
  let t = 0, out: ProgOut | null = null;
  for (;;) {
    const lv = new Map(SIM.gpios.map(g => [g.p.id + '.' + g.q.id, { level: (!g.powered || g.float ? null : g.V >= 2 ? 1 : g.V <= 0.8 ? 0 : null) as 0 | 1 | null, V: g.V }]));
    out = evalProgram(D, A, prog, rt, t, k => lv.get(k) || null);
    SIM = simulate(withProgram(D, out), A, { running: true });
    if (t >= end) break;
    t = Math.min(end, t + tick);
  }
  return { A, SIM, prog: out, t };
}

/** Gombnyomás egy időszakra: az alkatrész (azonosító) `from`…`to` ms között lenyomva (`to` nélkül a végéig). */
export interface Press { part: string; from: number; to?: number }
export interface TraceSample {
  t: number;
  /** a blokkok kimenetei (blokk.kimenet → érték) */ vals: Record<string, boolean | number>;
  /** a program által vezérelt / olvasott GPIO-k (vezérlő.láb → szint vagy PWM-kitöltés %) */ gpio: Record<string, string>;
  /** LED-ek (címke → világít-e) */ leds: Record<string, boolean>;
}
export interface TraceResult { samples: TraceSample[]; errors: Map<string, string> }

/**
 * A program futása idővonalon: gombnyomások időzítve, `every` ms-onként mintavétel (a blokkok kimenetei, a GPIO-k,
 * a LED-ek). A futás logikája azonos a `simulateFor`-éval (ütemenként kiértékelés, majd szimuláció).
 */
export function traceProgram(D: Design, o: { ms: number; every?: number; tick?: number; presses?: Press[] }): TraceResult {
  resetSimState();
  const tick = o.tick || 20, end = Math.max(0, o.ms), every = Math.max(tick, o.every || Math.max(tick, Math.round(end / 20 / tick) * tick || tick));
  const presses = o.presses || [];
  const pressedAt = (t: number) => new Set(presses.filter(p => t >= p.from && (p.to == null || t < p.to)).map(p => p.part));
  const prog = D.program && D.program.nodes.length ? D.program : null;
  const rt = newRuntime(), samples: TraceSample[] = [];
  let key = '', A = analyze(D), SIM = simulate(D, A, { running: true }), out: ProgOut | null = null, next = 0;
  for (let t = 0; ; t = Math.min(end, t + tick)) {
    const pr = pressedAt(t), k = [...pr].sort().join(',');
    if (k !== key) { key = k; A = analyze(D, { pressed: (p: PartInstance) => hasPress(p) && pr.has(p.id) }); SIM = simulate(withProgram(D, out), A, { running: true }); }
    if (prog) {
      const lv = new Map(SIM.gpios.map(g => [g.p.id + '.' + g.q.id, { level: (!g.powered || g.float ? null : g.V >= 2 ? 1 : g.V <= 0.8 ? 0 : null) as 0 | 1 | null, V: g.V }]));
      out = evalProgram(D, A, prog, rt, t, x => lv.get(x) || null);
      SIM = simulate(withProgram(D, out), A, { running: true });
    }
    if (t >= next || t >= end) {
      next = t + every;
      const gpio: Record<string, string> = {};
      const used = new Set(Object.keys(out ? out.gpio : {}));
      for (const g of SIM.gpios) if (used.has(g.p.id + '.' + g.q.id)) gpio[g.p.label + '.' + g.q.name] = g.mode === 'pwm' ? `pwm ${(withProgram(D, out).pwm || {})[g.p.id + '.' + g.q.id]?.duty ?? '?'}%` : g.V >= 2 ? '1' : g.V <= 0.8 ? '0' : '?';
      samples.push({ t, vals: Object.fromEntries(rt.vals), gpio, leds: Object.fromEntries(SIM.leds.filter(l => l.light).map(l => [l.p.label, l.on && l.I > 1e-4])) });
    }
    if (t >= end) break;
  }
  return { samples, errors: out ? out.errors : new Map() };
}
