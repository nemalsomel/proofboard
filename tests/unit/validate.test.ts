import { describe, expect, it } from 'vitest';
import { hasErrors, validatePartDef } from '../../src/core/validate';
import { exportLibrary, importLibrary, typeKeyFor } from '../../src/core/library';
import { PARTS } from '../../src/parts/builtin';
import type { PartDef } from '../../src/core/schema';

const nokia: PartDef = {
  name: 'Nokia 5110 kijelző', fp: '8 láb egy sorban', prefix: 'LCD', cat: 'Kijelző',
  pins: ['RST', 'CE', 'DC', 'DIN', 'CLK', 'VCC', 'BL', 'GND'].map((n, i) => ({ id: String(i + 1), name: n, lr: 0, lc: i, role: n === 'GND' ? 'gnd' : n === 'VCC' ? 'vin' : 'sig' })),
  graphics: [{ shape: 'rect', layer: 'body', r: [-0.6, 0.6], c: [-0.6, 7.6], fill: '#1b4f8a', stroke: '#0d2f55' }],
  model: [{ el: 'resistor', a: '6', b: '8', ohm: 330 }],
};
const msgs = (d: unknown) => validatePartDef(d).filter(p => p.level === 'error').map(p => p.msg).join(' | ');

describe('leírás-ellenőrzés', () => {
  it.each(Object.keys(PARTS))('beépített %s hibátlan', k => expect(msgs(PARTS[k])).toBe(''));
  it('saját modul hibátlan', () => expect(hasErrors(validatePartDef(nokia))).toBe(false));
  it('kiszűri a tipikus hibákat', () => {
    expect(msgs({ ...nokia, prefix: '1x' })).toContain('előtag');
    expect(msgs({ ...nokia, pins: [] })).toContain('Legalább egy láb');
    expect(msgs({ ...nokia, pins: [...nokia.pins, { id: '1', lr: 1, lc: 0 }] })).toContain('Kétszer szerepel a láb: 1');
    expect(msgs({ ...nokia, pins: [...nokia.pins, { id: '9', lr: 0, lc: 0 }] })).toContain('ugyanabban a lyukban');
    expect(msgs({ ...nokia, pins: [{ id: '1', lr: 0.5, lc: 0 }] })).toContain('egész lyukpozíción');
    expect(msgs({ ...nokia, model: [{ el: 'resistor', a: '6', b: '99', ohm: 1 }] })).toContain('Nincs ilyen láb: 99');
    expect(msgs({ ...nokia, model: [{ el: 'diode', a: '6', k: '6', vf: 0.7 }] })).toContain('ugyanaz a láb');
    expect(msgs({ ...nokia, model: [{ el: 'resistor', a: '6', b: '8', ohm: '{nincs+' }] })).toContain('nem értelmezhető');
    expect(msgs({ ...nokia, groups: [['1']] })).toContain('legalább két láb');
    expect(msgs({ ...nokia, pins: [{ id: '1', lr: '{', lc: 0 }] })).toContain('nem értékelhetők ki');
    expect(msgs(null)).toContain('nem objektum');
  });
  it('figyelmeztet, ha nincs test', () => {
    const ps = validatePartDef({ ...nokia, graphics: [] });
    expect(hasErrors(ps)).toBe(false);
    expect(ps.some(p => p.level === 'warn' && p.path === 'graphics')).toBe(true);
  });
});

describe('alkatrészkönyvtár', () => {
  it('típuskulcs a névből, ütközésnél sorszámmal', () => {
    expect(typeKeyFor('Nokia 5110 kijelző', () => false)).toBe('c_nokia_5110_kijelzo');
    expect(typeKeyFor('Nokia 5110 kijelző', k => k === 'c_nokia_5110_kijelzo')).toBe('c_nokia_5110_kijelzo_2');
  });
  it('export → import oda-vissza, foglalt kulcs átnevezésével, hibás leírás kihagyásával', () => {
    const file = exportLibrary({ c_nokia: nokia, c_rossz: { ...nokia, prefix: '' } });
    const res = importLibrary(JSON.parse(JSON.stringify(file)), k => k === 'c_nokia');
    expect(Object.keys(res.parts)).toEqual(['c_nokia_5110_kijelzo']);
    expect(res.renamed).toEqual({ c_nokia: 'c_nokia_5110_kijelzo' });
    expect(res.rejected.map(r => r.key)).toEqual(['c_rossz']);
  });
  it('idegen fájlt elutasít', () => expect(() => importLibrary({ parts: {} }, () => false)).toThrow(/proofboard-parts/));
});

describe('vezérlők és tápbemenetek ellenőrzése', () => {
  it('csúszka csak létező, korlátos számparaméterre', () => {
    const base = { ...nokia, params: [{ key: 'x', label: 'X', type: 'number' as const, default: 0, min: -1, max: 1 }] };
    expect(hasErrors(validatePartDef({ ...base, controls: [{ kind: 'slider', key: 'x' }] }))).toBe(false);
    expect(validatePartDef({ ...base, controls: [{ kind: 'slider', key: 'y' }] }).map(p => p.msg)).toContain('A csúszkához nincs ilyen paraméter: y');
    const nomax = { ...base, params: [{ key: 'x', label: 'X', type: 'number' as const, default: 0 }], controls: [{ kind: 'slider' as const, key: 'x' }] };
    expect(hasErrors(validatePartDef(nomax))).toBe(true);
  });
  it('feszültségtartomány: min < max, csak tápbemenetnél számít', () => {
    const pins = nokia.pins.map(p => (p.name === 'VCC' ? { ...p, vmin: 3.6, vmax: 2.7 } : p.name === 'DIN' ? { ...p, vmax: 3.6 } : p));
    const ps = validatePartDef({ ...nokia, pins });
    expect(ps.find(p => p.level === 'error')?.msg).toBe('6: a minimális feszültség nem lehet nagyobb a maximálisnál.');
    expect(ps.some(p => p.level === 'warn' && p.msg.startsWith('4: feszültségtartomány'))).toBe(true);
  });
  it('tápbemenet GND-láb nélkül: figyelmeztetés', () => {
    const ps = validatePartDef({ ...nokia, pins: nokia.pins.filter(p => p.name !== 'GND'), model: [] });
    expect(ps.map(p => p.msg)).toContain('Van tápbemenet, de nincs GND-láb: a tápfeszültség a panel földjéhez képest számít.');
  });
});

describe('külső alkatrész', () => {
  it('a szerelés csak board vagy off lehet', () => {
    expect(hasErrors(validatePartDef({ ...nokia, mount: 'off' }))).toBe(false);
    expect(validatePartDef({ ...nokia, mount: 'fal' as any }).map(p => p.msg)).toContain('Ismeretlen szerelés: fal (board vagy off).');
  });
  it('a beépített motor és szervó külső, a szervó tápja 4,5–6,5 V', () => {
    expect(PARTS.motor.mount).toBe('off');
    expect(PARTS.servo.mount).toBe('off');
    expect(PARTS.servo.pins.find(p => p.id === 'V+')).toMatchObject({ role: 'vin', vmin: 4.5, vmax: 6.5 });
  });
});
