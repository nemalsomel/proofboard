import { describe, expect, it } from 'vitest';
import { emptyDesign } from '../../src/engine/design';
import { arrangeProgram } from '../../src/engine/progops';
import { engineCtx, runTool, toolSpecs } from '../../src/agent/tools';

const call = (ctx: ReturnType<typeof engineCtx>, name: string, input: Record<string, unknown> = {}) => runTool(ctx, name, input);
async function board() {
  const ctx = engineCtx(emptyDesign());
  await call(ctx, 'place_part', { type: 'pico', row: 2, col: 2 });
  await call(ctx, 'place_part', { type: 'res', near: 'PICO1.GP15', params: { ohm: 330 } });
  await call(ctx, 'place_part', { type: 'led', near: 'R1.2' });
  await call(ctx, 'place_part', { type: 'button', near: 'PICO1.GP2' });
  for (const [a, b] of [['R1.1', 'GPIO'], ['R1.2', 'LED1.A'], ['LED1.K', 'GND'], ['S1.A1', 'GPIO'], ['S1.B1', 'GND']]) {
    const r = await call(ctx, 'connect', { from: a, to: b }); expect(r.isError, r.text).toBeFalsy();
  }
  return ctx;
}

describe('programeszközök', () => {
  it('blokktípusok és üres program; az olvasók Megbeszélés módban is', async () => {
    const ctx = engineCtx(emptyDesign());
    expect((await call(ctx, 'list_block_types')).text).toMatch(/^in — Digital input/m);
    expect((await call(ctx, 'get_program')).text).toMatch(/program is empty/);
    const ro = toolSpecs('discuss').map(t => t.name);
    for (const n of ['list_block_types', 'get_program', 'run_program']) expect(ro).toContain(n);
    for (const n of ['add_block', 'connect_blocks', 'remove_blocks']) expect(ro).not.toContain(n);
  });

  it('villogó: blokkok lábhivatkozással, összekötés, elrendezés; a futás idővonala villogást mutat', async () => {
    const ctx = await board();
    let r = await call(ctx, 'add_block', { type: 'blink', params: { period: 400 } });
    expect(r.text).toMatch(/^Added n1: blink — period=400ms, duty=50%/);
    r = await call(ctx, 'add_block', { type: 'out', params: { pin: 'R1.1' } });
    expect(r.text).toMatch(/^Added n2: out — pin=R1\.1/);
    expect(ctx.D().program!.nodes[1].props.pin).toMatch(/^p\d+\.1$/); // belső hivatkozás
    r = await call(ctx, 'connect_blocks', { from: 'n1.v', to: 'n2.a' });
    expect(r.text).toBe('Connected n1.v → n2.a.');
    await call(ctx, 'arrange_program');
    const [a, b] = ctx.D().program!.nodes;
    expect(b.x).toBeGreaterThan(a.x);
    r = await call(ctx, 'get_program');
    expect(r.text).toMatch(/n2: out \(Digital output\) — pin=R1\.1/);
    expect(r.text).not.toMatch(/PROBLEM/);
    r = await call(ctx, 'run_program', { ms: 800, sample_ms: 100 });
    const lines = r.text.split('\n'), head = lines[0].split(' | '), li = head.indexOf('LED1(lit)');
    expect(li).toBeGreaterThan(0);
    const lit = lines.slice(1).map(l => l.split(' | ')[li]);
    expect(lit.slice(0, 8)).toEqual(['1', '1', '0', '0', '1', '1', '0', '0']);
  });

  it('váltókapcsoló gombbal: időzített gombnyomások; hibás bemenetek érthető hibával', async () => {
    const ctx = await board();
    await call(ctx, 'add_block', { type: 'in', params: { pin: 'S1.A1' } });
    await call(ctx, 'add_block', { type: 'toggle' });
    await call(ctx, 'add_block', { type: 'out', params: { pin: 'LED1.A' } });
    // LED1.A nem GPIO-n van (az ellenálláson át) → a program jelzi
    expect((await call(ctx, 'get_program')).text).toMatch(/n3: out .*PROBLEM: The pin is not connected to a GPIO/);
    await call(ctx, 'set_block_params', { block: 'n3', params: { pin: 'R1.1' } });
    await call(ctx, 'connect_blocks', { from: 'n1.v', to: 'n2.a' });
    await call(ctx, 'connect_blocks', { from: 'n2.v', to: 'n3.a' });
    const r = await call(ctx, 'run_program', { ms: 1000, sample_ms: 100, presses: [{ button: 'S1', from_ms: 200, to_ms: 300 }, { button: 'S1', from_ms: 600, to_ms: 700 }] });
    const lines = r.text.split('\n'), li = lines[0].split(' | ').indexOf('LED1(lit)');
    const lit = lines.slice(1).map(l => l.split(' | ')[li]).join('');
    expect(lit).toMatch(/^0+1+0+$/); // be az első nyomásra, ki a másodikra
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ['add_block', { type: 'nincs' }, /Unknown block type/],
      ['add_block', { type: 'blink', params: { period: 5 } }, /period must be between 20/],
      ['add_block', { type: 'in', params: { pin: 'X9.1' } }, /Unknown pin "X9\.1"/],
      ['add_block', { type: 'in', params: { pull: 'semmi' } }, /pull must be one of: pullup, pulldown, float/],
      ['connect_blocks', { from: 'n1.zz', to: 'n2.a' }, /has no output "zz"/],
      ['connect_blocks', { from: 'n1.v', to: 'n9.a' }, /No block "n9"/],
      ['set_block_params', { block: 'n2', params: { x: 1 } }, /has no parameter "x"/],
      ['run_program', { ms: 100, presses: [{ button: 'R1', from_ms: 0 }] }, /not a button/],
    ];
    for (const [n, inp, re] of cases) { const x = await call(ctx, n, inp); expect(x.isError, n).toBe(true); expect(x.text).toMatch(re); }
    expect((await call(ctx, 'remove_blocks', { blocks: ['all'] })).text).toBe('Removed 3 block(s).');
    expect(ctx.D().program!.edges).toEqual([]);
  });

  it('elrendezés: a visszacsatolás nem akasztja meg, a kimenet az utolsó oszlopba kerül', () => {
    const prog = { nodes: [{ id: 'n1', type: 'blink', x: 0, y: 0, props: {} }, { id: 'n2', type: 'toggle', x: 0, y: 0, props: {} }, { id: 'n3', type: 'out', x: 0, y: 0, props: {} }, { id: 'n4', type: 'not', x: 0, y: 0, props: {} }],
      edges: [{ id: 'e1', from: 'n1.v', to: 'n2.a' }, { id: 'e2', from: 'n2.v', to: 'n4.a' }, { id: 'e3', from: 'n4.v', to: 'n3.a' }] };
    arrangeProgram(prog);
    const x = Object.fromEntries(prog.nodes.map(n => [n.id, n.x]));
    expect(x.n1 < x.n2 && x.n2 < x.n4 && x.n4 < x.n3).toBe(true);
  });
});
