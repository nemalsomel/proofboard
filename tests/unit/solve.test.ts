import { describe, expect, it } from 'vitest';
import { solve, type Branch } from '../../src/engine/solve';

describe('csomóponti analízis', () => {
  it('feszültségosztó: 5 V, 1k + 1k → 2,5 V', () => {
    // 0: tápcsomópont, 1: középpont
    const els: Branch[] = [
      { a: 0, b: -1, g: 1e4, E: 5 },   // ideálishoz közeli 5 V-os forrás
      { a: 0, b: 1, g: 1 / 1000, E: 0 },
      { a: 1, b: -1, g: 1 / 1000, E: 0 },
    ];
    const V = solve(2, els);
    expect(V[0]).toBeCloseTo(5, 2);
    expect(V[1]).toBeCloseTo(2.5, 2);
  });
  it('nyitott dióda: 3,3 V → 1 kΩ → LED (2 V + 15 Ω) → GND', () => {
    const els: Branch[] = [
      { a: 0, b: -1, g: 1e4, E: 3.3 },
      { a: 0, b: 1, g: 1 / 1000, E: 0 },
      { a: 1, b: -1, g: 1 / 15, E: 2 },
    ];
    const V = solve(2, els);
    const I = (V[0] - V[1]) / 1000;
    expect(I * 1000).toBeCloseTo(1.28, 1); // mA
  });
  it('üres hálózat', () => expect(solve(0, [])).toHaveLength(0));
});
