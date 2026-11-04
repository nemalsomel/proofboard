import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/engine/netlist';
import { presetMacropad } from '../../src/engine/presets';
import { evalProgram, gpioOf, newRuntime, normProgram, withProgram, type Program } from '../../src/engine/program';
import { simulate } from '../../src/engine/simulate';

const lab = (D: ReturnType<typeof presetMacropad>, l: string) => D.parts.find(p => p.label === l)!.id;

describe('program réteg', () => {
  it('alkatrészlábból a vele egy hálózaton lévő GPIO', () => {
    const D = presetMacropad(), A = analyze(D);
    const pico = D.parts.find(p => p.type === 'pico')!.id;
    expect(gpioOf(D, A, lab(D, 'K1') + '.A1')).toMatch(new RegExp('^' + pico + '\\.'));
    expect(gpioOf(D, A, lab(D, 'R1') + '.1')).toMatch(new RegExp('^' + pico + '\\.'));
    expect(gpioOf(D, A, lab(D, 'K1') + '.B1')).toBeNull(); // a gomb B oldala GND
  });

  it('gomb → váltókapcsoló → LED: élre vált, a kimenet a GPIO-módot adja', () => {
    const D = presetMacropad(), A = analyze(D), k = lab(D, 'K1') + '.A1', r = lab(D, 'R1') + '.1';
    const prog: Program = normProgram({
      nodes: [{ id: 'n1', type: 'in', x: 0, y: 0, props: { pin: k } }, { id: 'n2', type: 'toggle', x: 0, y: 0, props: {} }, { id: 'n3', type: 'out', x: 0, y: 0, props: { pin: r } }],
      edges: [{ id: 'e1', from: 'n1.v', to: 'n2.a' }, { id: 'e2', from: 'n2.v', to: 'n3.a' }],
    })!;
    const rt = newRuntime(), kg = gpioOf(D, A, k)!, led = gpioOf(D, A, r)!;
    const run = (level: 0 | 1) => evalProgram(D, A, prog, rt, 0, g => (g === kg ? { level, V: level * 3.3 } : null));
    let o = run(1);
    expect(o.gpio[kg]).toBe('pullup');
    expect(o.gpio[led]).toBe('out_low');
    expect(run(0).gpio[led]).toBe('out_high'); // lenyomva (alacsony) → bekapcsol
    expect(run(1).gpio[led]).toBe('out_high'); // elengedve marad
    o = run(0);
    expect(o.gpio[led]).toBe('out_low');
    expect(o.errors.size).toBe(0);
    // a szimulációban a LED világít, ha a program bekapcsolta
    run(1); run(0);
    const S = simulate(withProgram(D, run(1)), A, { running: true });
    const l1 = S.leds.find(x => x.p.label === 'LED1')!;
    expect(l1.I).toBeGreaterThan(1e-3);
  });

  it('ütemadó, számláló, PWM-kimenet, összehasonlítás', () => {
    const D = presetMacropad(), A = analyze(D), r = lab(D, 'R2') + '.1', led = gpioOf(D, A, r)!;
    const prog = normProgram({
      nodes: [{ id: 'b', type: 'blink', x: 0, y: 0, props: { period: 1000, duty: 50 } }, { id: 'c', type: 'counter', x: 0, y: 0, props: { max: 5 } },
        { id: 'p', type: 'pwm', x: 0, y: 0, props: { pin: r, freq: 500 } }, { id: 'q', type: 'compare', x: 0, y: 0, props: { op: '>', value: 0.6 } }],
      edges: [{ id: 'e1', from: 'b.v', to: 'c.a' }, { id: 'e2', from: 'c.f', to: 'p.a' }, { id: 'e3', from: 'c.f', to: 'q.a' }],
    })!;
    const rt = newRuntime(), at = (t: number) => evalProgram(D, A, prog, rt, t, () => null);
    expect(at(0).pwm[led]).toEqual({ duty: 25, freq: 500 }); // első felfutó él: 1/4
    at(600); // le
    const o = at(1000); // második él
    expect(o.gpio[led]).toBe('pwm');
    expect(o.pwm[led].duty).toBe(50);
    expect(rt.vals.get('q.v')).toBe(false);
    at(1600); at(2000);
    expect(rt.vals.get('q.v')).toBe(true); // 3/4 > 0,6
  });

  it('kör a gráfban: az előző ütem értékével számol', () => {
    const D = presetMacropad(), A = analyze(D);
    const prog = normProgram({ nodes: [{ id: 'n', type: 'not', x: 0, y: 0, props: {} }], edges: [{ id: 'e', from: 'n.v', to: 'n.a' }] })!;
    const rt = newRuntime(), vals = [0, 1, 2, 3].map(t => { evalProgram(D, A, prog, rt, t, () => null); return rt.vals.get('n.v'); });
    expect(vals).toEqual([true, false, true, false]);
  });

  it('beolvasás: ismeretlen csomópont, hibás vagy második él egy bemenetre kimarad; láb nélküli kimenet hibát jelez', () => {
    const p = normProgram({
      nodes: [{ id: 'a', type: 'blink' }, { id: 'b', type: 'not' }, { id: 'x', type: 'nincsilyen' }, { id: 'o', type: 'out' }],
      edges: [{ id: 'e1', from: 'a.v', to: 'b.a' }, { id: 'e2', from: 'a.v', to: 'b.a' }, { id: 'e3', from: 'x.v', to: 'o.a' }, { id: 'e4', from: 'b.v', to: 'o.nincs' }, { id: 'e5', from: 'b.v', to: 'o.a' }],
    })!;
    expect(p.nodes.map(n => n.id)).toEqual(['a', 'b', 'o']);
    expect(p.edges.map(e => e.id)).toEqual(['e1', 'e5']);
    expect(p.nodes[0].props).toEqual({ period: 1000, duty: 50 });
    const D = presetMacropad(), o = evalProgram(D, analyze(D), p, newRuntime(), 0, () => null);
    expect(o.errors.get('o')).toBe('Nincs kiválasztva láb');
  });
});
