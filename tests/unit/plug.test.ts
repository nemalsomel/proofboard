import { describe, expect, it } from 'vitest';
import { DEFS } from '../../src/engine/defs';
import { placedPins } from '../../src/engine/geometry';
import { linkStates } from '../../src/engine/links';
import { analyze } from '../../src/engine/netlist';
import { plugOf, plugSpot, socketProps, socketType } from '../../src/engine/plug';
import { route } from '../../src/engine/route';
import { checkAll } from '../../src/engine/check';
import type { Design } from '../../src/engine/types';

const part = (id: string, type: string, label: string, r: number, c: number, props: Record<string, unknown> = {}, rot = 0) =>
  ({ id, type, label, r, c, rot, mir: false, props: { ...DEFS[type].props, ...props } });
const servoDesign = (): Design => ({
  board: { rows: 30, cols: 30, sec: 3 }, bridges: [], wires: [], auto: { bridges: [], wires: [] }, customParts: {}, notes: [], gpio: {}, pwm: {}, seq: 20,
  settings: { usb: true, btnMode: 'hold', autoRoute: true },
  parts: [part('p1', 'pico', 'PICO', 6, 5, { span: 6 }), part('p2', 'servo', 'SV1', 26, -6)],
  links: [{ id: 'l1', a: 'p2.SIG', b: 'GPIO', gpio: null }, { id: 'l2', a: 'p2.GND', b: 'GND', gpio: null }, { id: 'l3', a: 'p2.V+', b: 'p1.40', gpio: null }],
});

describe('csatlakozó (tüskesor) a külső alkatrészhez', () => {
  it('a tüskesor adatból csatlakozó; lábszám és lábnevek a külső alkatrészből', () => {
    const t = socketType()!;
    expect(t).toBe('header');
    const D = servoDesign();
    const props = socketProps(DEFS[t].def, D.parts[1]);
    expect(props).toEqual({ n: 3, names: DEFS.servo.pins(D.parts[1]).map(q => q.name).join(',') });
    const h = part('p3', t, 'J1', 0, 0, props);
    expect(DEFS[t].pins(h).map(q => q.name)).toEqual(DEFS.servo.pins(D.parts[1]).map(q => q.name));
  });

  it('új csatlakozó szabad helyre kerül, a külső alkatrészhez közel', () => {
    const D = servoDesign();
    const s = plugSpot(D, D.parts[1], 3)!;
    expect(s).toBeTruthy();
    const pico = new Set(placedPins(D.parts[0]).map(q => q.r + ':' + q.c));
    const holes = Array.from({ length: 3 }, (_, i) => (s.rot ? [s.r + i, s.c] : [s.r, s.c + i]));
    expect(holes.every(([r, c]) => !pico.has(r + ':' + c) && r >= 0 && c >= 0 && r < 30 && c < 30)).toBe(true);
    expect(s.r).toBeGreaterThan(15); // a szervó alul, balra áll
  });

  it('bedugva: a lábak egy hálózat a csatlakozóval; a kapcsolatok hidakkal mennek, kábel nélkül', () => {
    const D = servoDesign(), s = plugSpot(D, D.parts[1], 3)!;
    D.parts.push(part('p3', 'header', 'J1', s.r, s.c, socketProps(DEFS.header.def, D.parts[1]), s.rot));
    D.parts[1].plug = 'p3';
    expect(plugOf(D, D.parts[1])!.id).toBe('p3');
    const A = analyze(D), m = A.byPart.get('p2')!.map, h = A.byPart.get('p3')!.map;
    expect([m.GND.net, m['V+'].net, m.SIG.net]).toEqual([h['1'].net, h['2'].net, h['3'].net]);
    route(D, { full: true });
    const off = new Set(placedPins(D.parts[1]).map(q => q.r + ':' + q.c));
    expect(D.auto.wires.filter(w => off.has(w.a.join(':')) || off.has(w.b.join(':')))).toEqual([]); // nincs szabad kábel
    const st = linkStates(D, analyze(D));
    expect([...st.values()].every(x => x.ok)).toBe(true);
    expect(D.links[0].gpio).toMatch(/^p1\./);
    const iss = checkAll(D, { A0: analyze(D), AS: analyze(D), SIM: null, linkState: st } as never);
    expect(iss.filter(i => i.sev === 'err').map(i => i.msg)).toEqual([]);
  });

  it('kevés lábú csatlakozó nem érvényes', () => {
    const D = servoDesign();
    D.parts.push(part('p3', 'header', 'J1', 20, 10, { n: 2 }));
    D.parts[1].plug = 'p3';
    expect(plugOf(D, D.parts[1])).toBeNull();
  });
});
