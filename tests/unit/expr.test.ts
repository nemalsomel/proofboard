import { describe, expect, it } from 'vitest';
import { evx, fmtSI, num, parseSI, stepE12, tpl } from '../../src/core/expr';

const env = { span: 6, dr: 0, dc: 4, label: 'R1', $opt: { color: { v: 'red', label: 'piros', vf: 2 } } };

describe('kifejezések', () => {
  it('számol és helyettesít', () => {
    expect(evx('1+2*3', env)).toBe(7);
    expect(evx('(1+2)*3', env)).toBe(9);
    expect(evx('-span/2', env)).toBe(-3);
    expect(num('{span}+0.75', env)).toBe(6.75);
    expect(num('{40-i}', { ...env, i: 3 })).toBe(37);
  });
  it('opció-mezőt olvas és sablont tölt', () => {
    expect(num('{color.vf}', env)).toBe(2);
    expect(tpl('{label} {color.label}', env)).toBe('R1 piros');
    expect(tpl('{x|si}Ω', { ...env, x: 4700 })).toBe('4.7kΩ');
  });
  it('hibás kifejezésre kivételt dob', () => {
    expect(() => evx('2 * ?', env)).toThrow();
  });
});

describe('SI-értékek', () => {
  it.each([
    ['4k7', 4700], ['4,7k', 4700], ['100n', 1e-7], ['2.2M', 2.2e6], ['470', 470], ['1R5', 1.5], ['10 kΩ', 1e4], ['3.3V', 3.3],
  ])('%s → %d', (s, v) => expect(parseSI(s)).toBeCloseTo(v as number, 12));
  it('nem értelmezhető értékre NaN', () => expect(parseSI('abc')).toBeNaN());
  it('formáz', () => {
    expect(fmtSI(4700)).toBe('4.7k');
    expect(fmtSI(1e-7)).toBe('100n');
    expect(fmtSI(3.7)).toBe('3.7');
    expect(fmtSI(0)).toBe('0');
  });
  it('E12-sor szerint léptet', () => {
    expect(stepE12(470, 1)).toBe(560);
    expect(stepE12(1000, -1)).toBe(820);
    expect(stepE12(8200, 1)).toBe(10000);
    expect(stepE12(500, 1)).toBe(560);
  });
});
