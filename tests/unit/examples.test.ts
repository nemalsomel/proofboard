import { describe, expect, it } from 'vitest';
import { EXAMPLES, EX_CATS } from '../../src/ui/examples';
import { PARTS } from '../../src/parts/builtin';

describe('példatár', () => {
  it('egyedi azonosítók, ismert kategóriák és alkatrésztípusok', () => {
    expect(new Set(EXAMPLES.map(e => e.id)).size).toBe(EXAMPLES.length);
    for (const e of EXAMPLES) {
      expect(EX_CATS as readonly string[]).toContain(e.cat);
      for (const p of e.design.parts) expect(PARTS, `${e.id}: ${p.type}`).toHaveProperty(p.type);
      expect(new Set(e.design.parts.map(p => p.id)).size, e.id).toBe(e.design.parts.length);
    }
  });
  it('a kapcsolatok és jegyzetcélok létező alkatrészre mutatnak', () => {
    for (const e of EXAMPLES) {
      const ids = new Set(e.design.parts.map(p => p.id));
      for (const [a, b] of e.design.links) for (const x of [a, b]) if (x !== 'GND' && x !== 'GPIO') expect(ids.has(x.split('.')[0]), `${e.id}: ${x}`).toBe(true);
      for (const n of e.design.notes) if (n.target) expect(ids.has(n.target), `${e.id}: ${n.target}`).toBe(true);
      for (const a of e.signal?.from || []) expect(e.design.links.some(([x, y]) => x === a && y === 'GPIO'), `${e.id}: ${a}`).toBe(true);
    }
  });
});
