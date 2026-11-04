import { describe, expect, it } from 'vitest';
import { analyze, layoutOf, pinLabel } from '../../src/engine/netlist';
import type { Design } from '../../src/engine/types';
import { DEFS } from '../../src/engine/defs';

const part = (id: string, type: string, label: string, r: number, c: number, props: Record<string, unknown> = {}, rot = 0) =>
  ({ id, type, label, r, c, rot, mir: false, props: { ...DEFS[type].props, ...props } });
const design = (extra: Partial<Design> = {}): Design => ({
  board: { rows: 12, cols: 10, sec: 3 }, parts: [], bridges: [], wires: [], links: [], auto: { bridges: [], wires: [] },
  customParts: {}, notes: [], gpio: {}, pwm: {}, settings: { usb: true, btnMode: 'hold', autoRoute: false }, seq: 10, ...extra,
});

describe('netlista', () => {
  it('egy szekción belüli lábak egy hálózat; a híd két szekciót összeköt', () => {
    // R1 függőlegesen a 2. oszlopban: 1. láb a 0. sorban, 2. láb a 4. sorban (más szekció)
    const D = design({ parts: [part('p1', 'res', 'R1', 0, 2, { dr: 0, dc: 4 }, 1), part('p2', 'led', 'LED1', 4, 2, { dr: 0, dc: 1 }, 1)] });
    let A = analyze(D);
    const net = (pid: string, id: string) => A.byPart.get(pid)!.map[id].net;
    expect(net('p1', '2')).toBe(net('p2', 'A')); // a 4. sor és az 5. sor: ugyanaz a 3–5. szekció
    expect(net('p1', '1')).not.toBe(net('p1', '2'));
    D.bridges.push([2, 2, 3, 2]); // 0–2. és 3–5. szekció összekötése
    A = analyze(D);
    expect(A.byPart.get('p1')!.map['1'].net).toBe(A.byPart.get('p1')!.map['2'].net);
    expect(A.netSecs.get(A.byPart.get('p1')!.map['1'].net)).toBe(2);
  });
  it('a lenyomott gomb összeköti a lábpárját; az elrejtett automatikus híd nem számít', () => {
    const D = design({ parts: [part('p1', 'button', 'SW1', 1, 1)], auto: { bridges: [[3, 6, 3, 7, ['l1']]], wires: [] } });
    const ab = (A: ReturnType<typeof analyze>) => A.byPart.get('p1')!.map;
    expect(ab(analyze(D)).A1.net).not.toBe(ab(analyze(D)).B1.net);
    expect(ab(analyze(D, { pressed: p => p.id === 'p1' })).A1.net).toBe(ab(analyze(D, { pressed: () => true })).B1.net);
    const A = analyze(D), H = analyze(D, { hidden: ids => !!ids && ids.includes('l1') });
    expect(A.find(A.sid(3, 6))).toBe(A.find(A.sid(3, 7)));
    expect(H.find(H.sid(3, 6))).not.toBe(H.find(H.sid(3, 7)));
  });
  it('panelon kívüli láb saját csomópont, vezetékkel köthető; a lábfelirat vezérlőn a GPIO-név', () => {
    const D = design({ parts: [part('p1', 'motor', 'M1', 2, -4), part('p2', 'pico', 'PICO', 0, 0, { span: 6 })], wires: [{ a: [2, -4], b: [5, 5], color: '#000' }] });
    const A = analyze(D), m = A.byPart.get('p1')!;
    expect(m.out).toBe(true);
    expect(m.map['+'].net).toBe(A.find(A.sid(5, 5)));
    expect(pinLabel(A.byPart.get('p2')!.map['20'])).toBe('PICO.GP15');
    expect(pinLabel(m.map['+'])).toBe('M1.+');
    expect(layoutOf(D)).toBe(layoutOf(D)); // gyorsítótár
  });
});
