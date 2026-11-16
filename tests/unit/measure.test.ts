import { describe, expect, it } from 'vitest';
import { engineCtx, runTool } from '../../src/agent/tools';
import { normalize } from '../../src/engine/design';
import { simulateFor } from '../../src/engine/headless';
import { fmtReading, gndNet, probeVoltage, readMeter, resistance } from '../../src/engine/measure';
import { analyze } from '../../src/engine/netlist';
import { route } from '../../src/engine/route';
import { EXAMPLES } from '../../src/ui/examples';
import type { ProbeAt } from '../../src/engine/types';

function load(id: string) {
  const raw = JSON.parse(JSON.stringify(EXAMPLES.find(e => e.id === id)!.design));
  const D = normalize({ ...raw, bridges: raw.bridges || [], wires: raw.wires || [], auto: { bridges: [], wires: [] }, notes: [], settings: { usb: true, btnMode: 'hold', autoRoute: true },
    links: (raw.links || []).map(([a, b]: [string, string], i: number) => ({ id: 'l' + i, a, b, gpio: null })) });
  route(D, { full: true });
  return D;
}
const at = (A: ReturnType<typeof analyze>, label: string, id: string): ProbeAt => { const q = A.pins.find(x => x.part.label === label && x.id === id)!; return [q.r, q.c]; };

describe('mérőműszerek', () => {
  it('feszültség, áram és lábáram a csíkos példán (akku, ellenállás, LED)', () => {
    const D = load('strip'), { A, SIM } = simulateFor(D);
    const r1a = at(A, 'R1', '1'), r1b = at(A, 'R1', '2');
    const va = readMeter(D, A, SIM, { mode: 'V', red: r1a, black: null }), vb = readMeter(D, A, SIM, { mode: 'V', red: r1b, black: null });
    expect(va.status).toBe('ok'); expect(vb.status).toBe('ok');
    const hi = Math.max(va.value!, vb.value!), lo = Math.min(va.value!, vb.value!);
    expect(hi).toBeGreaterThan(3.5);
    // a két láb közti feszültség (piros–fekete) = ellenálláson eső
    const drop = readMeter(D, A, SIM, { mode: 'V', red: va.value! > vb.value! ? r1a : r1b, black: va.value! > vb.value! ? r1b : r1a }).value!;
    expect(drop).toBeCloseTo(hi - lo, 6);
    const led = SIM.leds[0].I;
    expect(led).toBeGreaterThan(1e-3);
    // az ellenállás lábán befolyó áram = a LED árama (az egyik lábon be, a másikon ki)
    const ia = readMeter(D, A, SIM, { mode: 'A', red: r1a, black: null }), ib = readMeter(D, A, SIM, { mode: 'A', red: r1b, black: null });
    expect(Math.abs(ia.value!)).toBeCloseTo(led, 6);
    expect(ia.value! + ib.value!).toBeCloseTo(0, 9);
    expect(ia.pin).toMatch(/^R1\./);
    expect(fmtReading({ mode: 'A', value: 0.0124, status: 'ok' })).toBe('12.4mA');
    expect(probeVoltage(D, A, SIM, r1a)).toBeCloseTo(va.value!, 9);
    // szimuláció nélkül V/A nincs, R/C van
    expect(readMeter(D, A, null, { mode: 'V', red: r1a, black: null }).status).toBe('nosim');
  });

  it('ellenállás és szakadás a táp nélküli áramkörön', () => {
    const D = load('strip'), A = analyze(D);
    const r1a = at(A, 'R1', '1'), r1b = at(A, 'R1', '2');
    expect(resistance(D, A, A.find(A.sid(...r1a)), A.find(A.sid(...r1b)))).toBeCloseTo(330, 3);
    const r = readMeter(D, A, null, { mode: 'R', red: r1a, black: r1b });
    expect(r.value).toBeCloseTo(330, 3);
    expect(fmtReading(r)).toBe('330Ω');
    const c = readMeter(D, A, null, { mode: 'C', red: r1a, black: r1a });
    expect(c).toMatchObject({ value: 0, cont: true });
    // két nem összekötött pont: nyitott
    const free: ProbeAt = [D.board.rows - 1, D.board.cols - 1];
    expect(readMeter(D, A, null, { mode: 'R', red: free, black: r1a }).status).toBe('open');
    expect(gndNet(A)).not.toBeNull();
  });

  it('agent: measure eszköz', async () => {
    const ctx = engineCtx(load('strip'));
    const v = (await runTool(ctx, 'measure', { kind: 'voltage', at: 'R1.1' })).text;
    expect(v).toMatch(/V/);
    const i = (await runTool(ctx, 'measure', { kind: 'current', at: 'R1.1' })).text;
    expect(i).toMatch(/mA/);
    const r = (await runTool(ctx, 'measure', { kind: 'resistance', at: 'R1.1', to: 'R1.2' })).text;
    expect(r).toMatch(/330/);
  });
});
