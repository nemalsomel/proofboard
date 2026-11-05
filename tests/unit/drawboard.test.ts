import { describe, expect, it } from 'vitest';
import { netTint, stubOf } from '../../src/ui/drawboard';
import type { NetPin } from '../../src/engine/types';

/** Nem vezérlőlapi láb (a szín a szimulációban a feszültségből, egyébként a hálózat sorszámából jön). */
const pin = (role: string) => ({ role, name: '', part: { type: 'resistor' } } as unknown as NetPin);

describe('panel rajza: hálózat színe, rövid vezeték', () => {
  it('lábak nélküli, egycellás hálózat nem színeződik; több cellás igen', () => {
    const A = { netPins: new Map(), netSecs: new Map([[1, 1], [2, 3]]) };
    expect(netTint(1, A, null)).toBeNull();
    expect(netTint(2, A, null)).toMatch(/^hsla\(/);
  });
  it('szimulációban a feszültség szerint (0 V kék, 3,3 V piros felé), lebegő hálózat szürke', () => {
    const A = { netPins: new Map([[5, [pin('sig')]], [6, [pin('sig')]]]), netSecs: new Map() };
    const sim = { netV: new Map([[5, 0], [6, 3.3]]), floating: new Set([7]) };
    expect(netTint(5, A, sim)).toBe('hsla(215,78%,50%,A)');
    expect(netTint(6, A, sim)).toBe('hsla(25,78%,50%,A)');
    expect(netTint(7, { netPins: new Map([[7, [pin('sig')]]]), netSecs: new Map() }, sim)).toBe('hsla(210,8%,62%,A)');
    expect(netTint(8, { netPins: new Map(), netSecs: new Map([[8, 5]]) }, sim)).toBeNull(); // szimulációban csak lábas hálózat
  });
  it('rövid vezeték: kikapcsolva vagy 5 lyuknál rövidebb vezetéknél nincs csonk', () => {
    const w = { a: [0, 0] as [number, number], b: [0, 10] as [number, number] };
    expect(stubOf(w, false)).toBeNull();
    expect(stubOf({ a: [0, 0], b: [0, 4] }, true)).toBeNull();
    expect(stubOf(w, true)).toEqual({ k: 0.16, len: 10 });
  });
});
