import { describe, expect, it } from 'vitest';
import { checkAll } from '../../src/engine/check';
import { linkStates } from '../../src/engine/links';
import { analyze } from '../../src/engine/netlist';
import { simulate } from '../../src/engine/simulate';
import { DEFS } from '../../src/engine/defs';
import type { Design } from '../../src/engine/types';

const part = (id: string, type: string, label: string, r: number, c: number, props: Record<string, unknown> = {}, rot = 0) =>
  ({ id, type, label, r, c, rot, mir: false, props: { ...DEFS[type].props, ...props } });
const design = (extra: Partial<Design>): Design => ({
  board: { rows: 30, cols: 40, sec: 3 }, parts: [], bridges: [], wires: [], links: [], auto: { bridges: [], wires: [] },
  customParts: {}, notes: [], gpio: {}, pwm: {}, settings: { usb: true, btnMode: 'hold', autoRoute: false }, seq: 10, ...extra,
});
const run = (D: Design, sim = false) => {
  const A = analyze(D);
  return checkAll(D, { A0: A, AS: A, SIM: sim ? simulate(D, A, { running: true }) : null, linkState: linkStates(D, A) }).map(i => `${i.sev}: ${i.msg}`);
};

describe('ellenőrzés', () => {
  it('ütközés egy lyukban és átfedő testek', () => {
    const r = run(design({ parts: [part('p1', 'res', 'R1', 5, 5, { dr: 0, dc: 4 }), part('p2', 'res', 'R2', 5, 9, { dr: 0, dc: 4 })] }));
    expect(r).toContain('err: Ütközés a 5:9 lyukban: R1.2, R2.1');
  });
  it('vezetékkel GND–3V3 zárlat a Picón; bekötetlen kapcsolat figyelmeztet', () => {
    const D = design({ parts: [part('p1', 'pico', 'PICO', 10, 0, { span: 6 })], wires: [{ a: [11, 2], b: [11, 4], color: '#000' }] });
    // 10. sor = 40…21. láb (lc 0…19): lc 2 → 38 (GND), lc 4 → 36 (3V3); a 11. sor ugyanabban a szekcióban
    expect(run(D)).toContain('err: Zárlat: GND – 3V3');
    D.wires = [];
    D.parts.push(part('p2', 'button', 'SW1', 20, 2));
    D.links = [{ id: 'l1', a: 'p2.A1', b: 'GPIO', gpio: null }];
    expect(run(D)).toContain('warn: Kapcsolat nincs bekötve: SW1.A → GPIO');
  });
  it('szimulációval: GPIO-ra közvetlenül kötött LED túl nagy áramot kap', () => {
    // GP15 (20. láb, 16. sor, 19. oszlop) ugyanabban a szekcióban, mint a LED anódja; katód a GND-re (18. láb) vezetékkel
    const D = design({ parts: [part('p1', 'pico', 'PICO', 10, 0, { span: 6 }), part('p2', 'led', 'LED1', 17, 19, { color: 'red', dr: 0, dc: 1 })], wires: [{ a: [17, 20], b: [15, 17], color: '#000' }], gpio: { 'p1.20': 'out_high' } });
    expect(run(D, true).some(m => /^warn: LED1: \d+ mA, előtét-ellenállás kell$/.test(m) || /^warn: GP15: .* mA, sok/.test(m))).toBe(true);
  });
});

describe('üzenetek más nyelven', () => {
  it('a fordító paraméterként: angol üzenet ugyanazokkal az értékekkel, alapból magyar', async () => {
    const { t } = await import('../../src/i18n/i18n');
    const en = (s: string, p?: Readonly<Record<string, string | number>>) => t(s, p, 'en');
    const D = design({ parts: [part('p1', 'res', 'R1', 5, 5, { dr: 0, dc: 4 }), part('p2', 'res', 'R2', 5, 9, { dr: 0, dc: 4 })] });
    const A = analyze(D);
    const msgs = checkAll(D, { A0: A, AS: A, SIM: null, linkState: linkStates(D, A), tr: en }).map(i => i.msg);
    expect(msgs).toContain('Collision in hole 5:9: R1.2, R2.1');
    expect(run(D)).toContain('err: Ütközés a 5:9 lyukban: R1.2, R2.1');
  });
  it('leírás-ellenőrzés és kifejezés-hiba angolul', async () => {
    const { t } = await import('../../src/i18n/i18n');
    const { validatePartDef } = await import('../../src/core/validate');
    const { logicMsg, parseExpr } = await import('../../src/core/logic');
    const en = (s: string, p?: Readonly<Record<string, string | number>>) => t(s, p, 'en');
    expect(validatePartDef({ name: '', prefix: 'U', fp: 'x', pins: [{ id: '1', lr: 0, lc: 0 }] }, en).map(p => p.msg)).toContain('The name is missing.');
    expect(validatePartDef({ name: '', prefix: 'U', fp: 'x', pins: [{ id: '1', lr: 0, lc: 0 }] }).map(p => p.msg)).toContain('Hiányzik a név.');
    let err: unknown; try { parseExpr('A & )'); } catch (x) { err = x; }
    expect(logicMsg(err)).toBe('Itt nem állhat: „)”');
    expect(logicMsg(err, en)).toBe('Not allowed here: “)”');
  });
});
