import { describe, expect, it } from 'vitest';
import { compileAll, penvD } from '../../src/core/compile';
import { num } from '../../src/core/expr';
import { PARTS } from '../../src/parts/builtin';
import type { PartInstance } from '../../src/core/schema';

const DEFS = compileAll(PARTS);
const inst = (type: string, props: Record<string, unknown> = {}): PartInstance =>
  ({ id: 'x', type, label: 'X1', r: 0, c: 0, rot: 0, mir: false, props: { ...DEFS[type].props, ...props } });

describe('beépített alkatrészek', () => {
  it.each(Object.keys(PARTS))('%s: a leírás érvényes', type => {
    const d = DEFS[type], p = inst(type), pins = d.pins(p);
    expect(pins.length).toBeGreaterThan(0);
    // egyedi lábazonosítók, nincs két láb egy lyukban
    expect(new Set(pins.map(q => q.id)).size).toBe(pins.length);
    expect(new Set(pins.map(q => q.lr + ':' + q.lc)).size).toBe(pins.length);
    // a modell és a csoportok csak létező lábakra hivatkoznak
    const ids = new Set(pins.map(q => q.id));
    for (const [a, b] of d.internal()) { expect(ids.has(a)).toBe(true); expect(ids.has(b)).toBe(true); }
    for (const el of d.def.model || []) for (const [k, v] of Object.entries(el))
      if (k.length === 1 || ['gnd', 'vbus', 'vsys', 'v33'].includes(k)) if (typeof v === 'string' && !v.includes('{')) expect(ids.has(v), `${type}.${k}=${v}`).toBe(true);
    // a test-téglalap tartalmazza a lábakat
    const b = d.bounds(p);
    for (const q of pins) { expect(q.lr).toBeGreaterThanOrEqual(b.r0); expect(q.lr).toBeLessThanOrEqual(b.r1); expect(q.lc).toBeGreaterThanOrEqual(b.c0); expect(q.lc).toBeLessThanOrEqual(b.c1); }
  });

  it('Pico W: 40 láb, 8 közös GND, a sortáv paraméterezhető', () => {
    const p = inst('pico');
    const pins = DEFS.pico.pins(p);
    expect(pins).toHaveLength(40);
    expect(pins.filter(q => q.role === 'gnd')).toHaveLength(8);
    expect(pins.find(q => q.id === '1')).toMatchObject({ name: 'GP0', lr: 6, lc: 0, role: 'gpio' });
    expect(pins.find(q => q.id === '40')).toMatchObject({ name: 'VBUS', lr: 0, lc: 0 });
    expect(DEFS.pico.pins(inst('pico', { span: 7 })).find(q => q.id === '1')!.lr).toBe(7);
  });

  it('tüskesor: a lábszám paraméterből jön és korlátozott', () => {
    expect(DEFS.header.pins(inst('header', { n: 6 }))).toHaveLength(6);
    expect(DEFS.header.pins(inst('header', { n: 99 }))).toHaveLength(20);
  });

  it('LED: a szín meghatározza a nyitófeszültséget, a katód helye állítható', () => {
    const e = penvD(PARTS.led, inst('led', { color: 'blue' }));
    expect(e.$opt.color.vf).toBe(3);
    const k = DEFS.led.pins(inst('led', { dr: 2, dc: -1 })).find(q => q.id === 'K')!;
    expect([k.lr, k.lc]).toEqual([2, -1]);
    // 0:0 nem lehet: visszaáll az alapra
    expect(DEFS.led.pins(inst('led', { dr: 0, dc: 0 })).find(q => q.id === 'K')!.lc).toBe(1);
  });

  it('a gomb lenyomva A–B oldalt zár', () => {
    expect(PARTS.button.controls?.[0]).toEqual({ kind: 'press', closes: [['A1', 'B1']] });
  });
});

describe('modulok és lábképességek', () => {
  it('a Picón csak a GP26–GP28 ADC-képes', () => {
    const adc = DEFS.pico.pins(inst('pico')).filter(q => q.caps?.includes('adc')).map(q => q.name).sort();
    expect(adc).toEqual(['GP26', 'GP27', 'GP28']);
  });
  it('tápbemenetek feszültségtartománnyal', () => {
    const vin = (t: string) => DEFS[t].pins(inst(t)).filter(q => q.role === 'vin').map(q => [q.id, q.vmin, q.vmax]);
    expect(vin('nokia5110')).toEqual([['VCC', 2.7, 3.6]]);
    expect(vin('joystick')).toEqual([['5V', 3, 5.5]]);
    expect(vin('tp4056')).toEqual([['IN+', 4, 8]]);
  });
  it('a modulok lábai nem esnek közös 3 lyukas szekcióba alapállásban', () => {
    for (const t of ['nokia5110', 'joystick', 'tp4056']) {
      const ps = DEFS[t].pins(inst(t)), seen = new Set<string>();
      for (const q of ps) { const k = Math.floor(q.lr / 3) + ':' + q.lc; expect(seen.has(k), `${t} ${q.id}`).toBe(false); seen.add(k); }
    }
  });
  it('a joystick-tengely a paraméterből osztja a feszültséget', () => {
    const r = (x: number) => (DEFS.joystick.def.model || []).filter(e => e.el === 'resistor').slice(0, 2).map(e => num((e as any).ohm, penvD(DEFS.joystick.def, inst('joystick', { x }))));
    expect(r(0)).toEqual([5001, 5001]);
    expect(r(100)).toEqual([1, 10001]);
    expect(r(-100)).toEqual([10001, 1]);
  });
});

describe('kondenzátor és NPN', () => {
  it('az NPN lábsorrendje a típustól függ', () => {
    const order = (kind: string) => DEFS.npn.pins(inst('npn', { kind })).sort((a, b) => a.lc - b.lc).map(q => q.id).join('');
    expect(order('BC547')).toBe('CBE');
    expect(order('2N2222')).toBe('EBC');
  });
  it('kis értékek is pontosan jutnak a modellbe (100 nF, 10 pF)', () => {
    for (const f of [100e-9, 10e-12]) {
      const el = (DEFS.cap.def.model || [])[0] as { f: string };
      expect(num(el.f, penvD(DEFS.cap.def, inst('cap', { f })))).toBeCloseTo(f, 20);
    }
  });
});
