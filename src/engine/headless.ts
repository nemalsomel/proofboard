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
