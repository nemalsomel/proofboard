import { describe, expect, it } from 'vitest';
import { linkStates } from '../../src/engine/links';
import { analyze } from '../../src/engine/netlist';
import { autoCutOn, manualToAuto, route } from '../../src/engine/route';
import { DEFS } from '../../src/engine/defs';
import type { Design } from '../../src/engine/types';

const part = (id: string, type: string, label: string, r: number, c: number, props: Record<string, unknown> = {}, rot = 0) =>
  ({ id, type, label, r, c, rot, mir: false, props: { ...DEFS[type].props, ...props } });
const ledDesign = (sec = 3): Design => ({
  board: { rows: 21, cols: 26, sec }, bridges: [], wires: [], auto: { bridges: [], wires: [] }, customParts: {}, notes: [], gpio: {}, pwm: {}, seq: 10,
  settings: { usb: true, btnMode: 'hold', autoRoute: true },
  parts: [part('p1', 'bat', 'BT1', 4, 3, { volt: 3.7 }), part('p2', 'res', 'R1', 10, 3, { ohm: 330, dr: 0, dc: 4 }), part('p3', 'led', 'LED1', 16, 7, { color: 'green', dr: 0, dc: 1 })],
  links: [{ id: 'l1', a: 'p1.+', b: 'p2.1', gpio: null }, { id: 'l2', a: 'p2.2', b: 'p3.A', gpio: null }, { id: 'l3', a: 'p3.K', b: 'p1.-', gpio: null }],
});

describe('útvonalkereső', () => {
  it('hidakkal köti be a kapcsolatokat, vezeték nélkül', () => {
    const D = ledDesign();
    route(D, { full: true });
    expect(D.auto.wires).toEqual([]);
    expect(D.auto.bridges.length).toBeGreaterThan(0);
    expect([...linkStates(D, analyze(D)).values()].every(s => s.ok)).toBe(true);
  });
  it('csíkos panelen automatikusan vág, és így is bekötött', () => {
    const D = ledDesign(21);
    // mint a „Csíkos panel” példában: R1 és LED1 függőlegesen ugyanabban az oszlopban, mint az akku − pólusa
    D.parts = [part('p1', 'bat', 'BT1', 3, 3, { volt: 3.7 }), part('p2', 'res', 'R1', 9, 4, { ohm: 330, dr: 0, dc: 4 }, 1), part('p3', 'led', 'LED1', 15, 4, { color: 'yellow', dr: 0, dc: 1 }, 1)];
    expect(autoCutOn(D)).toBe(true);
    route(D, { full: true });
    expect((D.auto.cuts || []).length).toBeGreaterThan(0);
    expect([...linkStates(D, analyze(D)).values()].every(s => s.ok)).toBe(true);
  });
  it('kézi → automatikus: a rögzített hidakból újra kapcsolatok lesznek', () => {
    const D = ledDesign();
    route(D, { full: true });
    D.bridges = D.auto.bridges.map(b => [b[0], b[1], b[2], b[3]]);
    D.auto = { bridges: [], wires: [] };
    D.links = [];
    let called = 0;
    const n = manualToAuto(D, analyze(D), null, () => called++);
    expect(n).toBe(3);
    expect(called).toBe(1);
    expect(D.bridges).toEqual([]);
    expect([...linkStates(D, analyze(D)).values()].every(s => s.ok)).toBe(true);
  });
});
