import { beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../../src/engine/netlist';
import { resetSimState, simulate, STSTATE } from '../../src/engine/simulate';
import { DEFS } from '../../src/engine/defs';
import type { Design } from '../../src/engine/types';

const part = (id: string, type: string, label: string, r: number, c: number, props: Record<string, unknown> = {}, rot = 0) =>
  ({ id, type, label, r, c, rot, mir: false, props: { ...DEFS[type].props, ...props } });
const design = (extra: Partial<Design>): Design => ({
  board: { rows: 24, cols: 40, sec: 3 }, parts: [], bridges: [], wires: [], links: [], auto: { bridges: [], wires: [] },
  customParts: {}, notes: [], gpio: {}, pwm: {}, settings: { usb: true, btnMode: 'hold', autoRoute: false }, seq: 10, ...extra,
});
const sim = (D: Design, running = true, slow?: Set<string>) => simulate(D, analyze(D), { running, slow });

beforeEach(() => resetSimState());

/** Akku + 330 Ω + piros LED, közvetlenül szekciókban: + (0,1) → R (1,1)-(1,5) → LED A (2,5), K (2,6) → akku − (0,2) vezetékkel. */
const ledLoop = () => design({
  parts: [part('p1', 'bat', 'BT1', 0, 1, { volt: 3.7 }), part('p2', 'res', 'R1', 1, 1, { ohm: 330, dr: 0, dc: 4 }), part('p3', 'led', 'LED1', 2, 5, { color: 'red', dr: 0, dc: 1 })],
  wires: [{ a: [2, 6], b: [0, 2], color: '#000' }],
});

describe('szimuláció', () => {
  it('LED akkuról: I = (U − Uf) / R', () => {
    const r = sim(ledLoop());
    expect(r.leds[0].I).toBeCloseTo((3.7 - 2.0) / (330 + 15 + 0.1), 4);
    expect(r.bats[0].I).toBeLessThan(0); // merül
  });

  /** Pico GP15 (20. láb) → 150 Ω → LED → GND (18. láb), PWM-mel. */
  const picoLed = (duty: number, freq: number) => {
    const D = design({
      parts: [part('p1', 'pico', 'PICO', 10, 0, { span: 6 }), part('p2', 'res', 'R1', 20, 19, { ohm: 150, dr: 0, dc: 4 }, 1), part('p3', 'led', 'LED1', 24 - 1, 19, { color: 'red', dr: 0, dc: 1 })],
      wires: [{ a: [16, 19], b: [21, 19], color: '#000' }, { a: [23, 20], b: [16, 17], color: '#000' }],
      gpio: { 'p1.20': 'pwm' }, pwm: { 'p1.20': { duty, freq } },
    });
    D.board.rows = 30;
    return D;
  };
  it('PWM: az átlag a kitöltéssel arányos; lassú PWM-nél a magas szakasz a teljes áram', () => {
    const full = sim(picoLed(100, 1000)).leds[0].I, half = sim(picoLed(50, 1000)).leds[0].I;
    expect(full).toBeGreaterThan(0.005);
    expect(half).toBeCloseTo(full / 2, 6);
    expect(sim(picoLed(50, 1), true, new Set(['p1.20'])).leds[0].I).toBeCloseTo(full, 6);
    expect(sim(picoLed(50, 1), true, new Set()).leds[0].I).toBeLessThan(1e-6);
    expect(sim(picoLed(50, 1)).leds[0].I).toBeCloseTo(half, 6); // villogtatás nélkül: átlag
  });

  it('léptetőmotor csak futó szimulációban lép', () => {
    const D = design({
      parts: [part('p1', 'bat', 'BT1', 0, 1, { volt: 5 }), part('p2', 'stepper', 'M1', 6, -6)],
      wires: [{ a: [6, -2], b: [0, 1], color: '#000' }, { a: [6, -6], b: [0, 2], color: '#000' }], // + a közösre, A tekercs a −-ra
    });
    sim(D, false);
    expect(STSTATE.get('p2')!.phase).toBeNull();
    const r = sim(D, true);
    expect(r.steppers[0].coils).toBe('A');
    expect(STSTATE.get('p2')!.phase).toBe(0);
  });
});
