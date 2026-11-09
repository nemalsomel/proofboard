import { describe, expect, it } from 'vitest';
import { layoutStats, partRect } from '../../src/engine/compact';
import { emptyDesign, normalize } from '../../src/engine/design';
import { placePart } from '../../src/engine/ops';
import { engineCtx, runTool, summarize } from '../../src/agent/tools';

describe('tömörség', () => {
  it('üres terv: nincs foglalt terület', () => {
    const s = layoutStats(emptyDesign());
    expect(s.box).toBeNull(); expect(s.fill).toBe(0); expect(s.boardArea).toBeGreaterThan(0);
  });

  it('foglalt terület: az alkatrésztestek és a hidak befoglalója; a kitöltés a testek aránya', () => {
    const D = emptyDesign();
    const r = placePart(D, 'res', 10, 10)!, l = placePart(D, 'led', 30, 20)!;
    const a = partRect(r), b = partRect(l);
    let s = layoutStats(D);
    expect(s.box).toEqual({ r0: Math.min(a.r0, b.r0), r1: Math.max(a.r1, b.r1), c0: Math.min(a.c0, b.c0), c1: Math.max(a.c1, b.c1) });
    expect(s.parts).toBe(2);
    const body = (q: typeof a) => (q.r1 - q.r0 + 1) * (q.c1 - q.c0 + 1);
    expect(s.partArea).toBe(body(a) + body(b));
    expect(s.fill).toBeCloseTo(s.partArea / s.area);
    // közelebb téve kisebb a terület, nagyobb a kitöltés
    const far = s.area;
    l.r = 12; l.c = 16;
    s = layoutStats(D);
    expect(s.area).toBeLessThan(far);
    // a híd is a foglalt területhez tartozik
    D.bridges.push([40, 2, 40, 4]);
    expect(layoutStats(D).box!.r1).toBe(40);
    expect(layoutStats(D).box!.c0).toBe(2);
  });

  it('rögzített alkatrész: a terv megőrzi, az agent nem mozdítja, az összefoglaló jelzi', async () => {
    const D = emptyDesign();
    const p = placePart(D, 'button', 20, 20)!; p.fixed = true;
    const n = normalize(JSON.parse(JSON.stringify(D)));
    expect(n.parts[0].fixed).toBe(true);
    expect(layoutStats(n).fixed).toBe(1);
    const ctx = engineCtx(n);
    const r = await runTool(ctx, 'move_part', { label: p.label, row: 30 });
    expect(r.isError).toBe(true); expect(r.text).toMatch(/fixed in place by the user/);
    expect(ctx.D().parts[0].r).toBe(20);
    const sum = summarize(ctx.D());
    expect(sum).toMatch(/FIXED by the user/);
    expect(sum).toMatch(/Footprint: rows \d+–\d+/);
  });
});
