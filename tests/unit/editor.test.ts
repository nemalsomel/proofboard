import { describe, expect, it } from 'vitest';
import { guessRole, parseRange } from '../../src/ui/editor';

describe('alkatrész-szerkesztő segédfüggvényei', () => {
  it('szerep a lábnévből', () => {
    expect(['GND', 'VCC', 'VRx', 'A0', 'CLK', 'IN+'].map(guessRole)).toEqual(['gnd', 'vin', 'adc', 'adc', 'sig', 'vin']);
  });
  it('feszültségtartomány szövegből', () => {
    expect(parseRange('2.7-3.6')).toEqual({ vmin: 2.7, vmax: 3.6 });
    expect(parseRange('3,3 – 5,5')).toEqual({ vmin: 3.3, vmax: 5.5 });
    expect(parseRange('-5.5')).toEqual({ vmax: 5.5 });
    expect(parseRange('4.5-')).toEqual({ vmin: 4.5 });
    expect(parseRange('')).toEqual({});
    expect(parseRange('sok')).toEqual({});
  });
});

import { defToForm, formToDef, splitCaps } from '../../src/ui/editor';
import { matchPart } from '../../src/core/library';
import { rekeyAgainstLibrary } from '../../src/engine/design';
import { PARTS } from '../../src/parts/builtin';
import type { PartDef } from '../../src/core/schema';

const mini: PartDef = {
  name: 'Mini MCU', prefix: 'U', cat: 'Vezérlő', fp: '6 láb',
  pins: [
    { id: 'G', name: 'GND', lr: 0, lc: 0, role: 'gnd' }, { id: 'V', name: '5V', lr: 0, lc: 1, role: 'pwr' }, { id: '3', name: '3V3', lr: 0, lc: 2, role: 'p33' },
    { id: 'A', name: 'IO1', lr: 2, lc: 0, role: 'gpio', caps: ['adc', 'i2c0.sda'] }, { id: 'B', name: 'IO2', lr: 2, lc: 1, role: 'gpio', caps: ['strap'] },
    { id: 'S', name: 'SDA', lr: 2, lc: 2, role: 'sig', fn: 'i2c.sda' },
  ],
  graphics: [],
  model: [{ el: 'mcu', gnd: 'G', vsys: 'V', v33: '3', vreg: 3.5, vmax: 6, igpio: 0.02, mux: 'matrix' }],
};

describe('szerkesztő: vezérlőlap és lábképességek', () => {
  it('a képességek szövegből', () => expect(splitCaps(' adc, i2c0.sda;adc  strap')).toEqual(['adc', 'i2c0.sda', 'strap']));
  it('MCU modell, GPIO-képességek és buszfunkció űrlapon át veszteség nélkül', () => {
    const { form } = defToForm(mini);
    expect(form).toBeTruthy();
    const d = formToDef(form!);
    expect(d.model).toEqual(mini.model);
    expect(d.pins.map(p => [p.id, p.role, p.caps ?? null, p.fn ?? null])).toEqual(mini.pins.map(p => [p.id, p.role, p.caps ?? null, p.fn ?? null]));
  });
  it('vbus elhagyható, mux nélkül nem kerül a leírásba', () => {
    const { form } = defToForm({ ...mini, model: [{ el: 'mcu', gnd: 'G', vsys: 'V', v33: '3', vbus: 'V', vreg: 1.8, vmax: 5.5, igpio: 0.012 }] });
    expect(formToDef(form!).model).toEqual([{ el: 'mcu', gnd: 'G', vsys: 'V', v33: '3', vbus: 'V', vreg: 1.8, vmax: 5.5, igpio: 0.012 }]);
  });
});

describe('alkatrészkönyvtár', () => {
  it('keresés: név, ékezet nélkül, lábfunkció, képesség, modell', () => {
    expect(matchPart(mini, 'mini')).toBe(true);
    expect(matchPart(mini, 'vezerlo')).toBe(true);
    expect(matchPart(mini, 'i2c sda')).toBe(true);
    expect(matchPart(mini, 'strap')).toBe(true);
    expect(matchPart(mini, 'mini motor')).toBe(false);
    expect(matchPart(PARTS.pico, 'adc')).toBe(true);
    expect(matchPart(PARTS.pico, '')).toBe(true);
  });
  it('a megnyitott terv ütköző alkatrésze új kulcsot kap, a könyvtár nem változik', () => {
    const lib = { c_mini: mini };
    const other = { ...mini, name: 'Mini MCU', fp: 'más' };
    const raw = { customParts: { c_mini: other, c_x: { ...mini, name: 'X' } }, parts: [{ id: 'p1', type: 'c_mini' }, { id: 'p2', type: 'c_x' }, { id: 'p3', type: 'pico' }] };
    const { raw: r, renamed } = rekeyAgainstLibrary(raw, lib);
    expect(renamed).toEqual([{ name: 'Mini MCU', from: 'c_mini', to: 'c_mini_2' }]);
    expect(Object.keys(r.customParts as object).sort()).toEqual(['c_mini_2', 'c_x']);
    expect((r.parts as Array<{ type: string }>).map(p => p.type)).toEqual(['c_mini_2', 'c_x', 'pico']);
    // azonos tartalom: nincs átnevezés
    expect(rekeyAgainstLibrary({ customParts: { c_mini: mini }, parts: [] }, lib).renamed).toEqual([]);
  });
});
