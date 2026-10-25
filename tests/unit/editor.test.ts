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
