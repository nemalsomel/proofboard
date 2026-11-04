import { expect, test, type Page } from '@playwright/test';

/* Program réteg: a csomópontos program a szimuláció futása közben állítja a GPIO-kat. */

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message));
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).pcb);
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

const pcb = <T>(page: Page, body: string): Promise<T> => page.evaluate(`(() => { const pcb = window.pcb; ${body} })()`) as Promise<T>;
const id = (l: string) => `pcb.get().parts.find(p => p.label === '${l}').id`;

test('gomb → váltókapcsoló → LED: a gombnyomás be- és kikapcsolja a LED-et', async ({ page }) => {
  await pcb(page, `pcb.preset(); pcb.progAuto(false);
    pcb.program({ nodes: [
      { id: 'n1', type: 'in', x: 0, y: 0, props: { pin: ${id('K1')} + '.A1' } },
      { id: 'n2', type: 'toggle', x: 200, y: 0, props: {} },
      { id: 'n3', type: 'out', x: 400, y: 0, props: { pin: ${id('R1')} + '.1' } }],
      edges: [{ id: 'e1', from: 'n1.v', to: 'n2.a' }, { id: 'e2', from: 'n2.v', to: 'n3.a' }] });
    pcb.sim(true);`);
  const led = () => pcb<number>(page, `return pcb.ledView().find(l => l.label === 'LED1').I;`);
  await pcb(page, 'pcb.progStep();');
  expect(await led()).toBeLessThan(1e-4);
  await pcb(page, `pcb.press('K1', true); pcb.progStep(); pcb.progStep();`);
  expect(await led()).toBeGreaterThan(1e-3);
  await pcb(page, `pcb.press('K1', false); pcb.progStep(); pcb.progStep();`);
  expect(await led()).toBeGreaterThan(1e-3); // elengedve is ég
  await pcb(page, `pcb.press('K1', true); pcb.progStep(); pcb.progStep(); pcb.press('K1', false); pcb.progStep();`);
  expect(await led()).toBeLessThan(1e-4);
  const st = await pcb<any>(page, 'return pcb.progState();');
  expect(st.errors).toEqual({});
  expect(Object.values(st.gpio)).toEqual(expect.arrayContaining(['pullup', 'out_low']));
});

test('ütemadó → kimenet: a program futás közben villogtat, leállítva nem fut; a program a tervvel mentődik', async ({ page }) => {
  await pcb(page, `pcb.preset(); pcb.progAuto(false);
    pcb.program({ nodes: [{ id: 'b', type: 'blink', x: 0, y: 0, props: { period: 1000, duty: 50 } }, { id: 'o', type: 'out', x: 300, y: 0, props: { pin: ${id('R2')} + '.1' } }],
      edges: [{ id: 'e', from: 'b.v', to: 'o.a' }] });
    pcb.sim(true);`);
  const led = () => pcb<number>(page, `return pcb.ledView().find(l => l.label === 'LED2').I;`);
  await pcb(page, 'pcb.progStep(0);');
  expect(await led()).toBeGreaterThan(1e-3);
  await pcb(page, 'pcb.progStep(600);');
  expect(await led()).toBeLessThan(1e-4);
  await pcb(page, 'pcb.progStep(500);');
  expect(await led()).toBeGreaterThan(1e-3);
  expect((await pcb<any>(page, 'return pcb.get().program;')).nodes.length).toBe(2);
  await pcb(page, 'pcb.sim(false);');
  expect(await pcb(page, 'return pcb.progState();')).toBeNull();
});

test('láb nélküli vagy GPIO-ra nem kötött csomópont hibát jelez', async ({ page }) => {
  await pcb(page, `pcb.preset(); pcb.progAuto(false);
    pcb.program({ nodes: [{ id: 'o', type: 'out', x: 0, y: 0, props: {} }, { id: 'g', type: 'out', x: 0, y: 0, props: { pin: ${id('K1')} + '.B1' } }], edges: [] });
    pcb.sim(true); pcb.progStep();`);
  expect((await pcb<any>(page, 'return pcb.progState();')).errors).toEqual({ o: 'Nincs kiválasztva láb', g: 'A láb nincs GPIO-ra kötve' });
});

test('valós időben fut: az ütemadó magától villogtatja a LED-et', async ({ page }) => {
  await pcb(page, `pcb.preset();
    pcb.program({ nodes: [{ id: 'b', type: 'blink', x: 0, y: 0, props: { period: 200, duty: 50 } }, { id: 'o', type: 'out', x: 300, y: 0, props: { pin: ${id('R3')} + '.1' } }],
      edges: [{ id: 'e', from: 'b.v', to: 'o.a' }] });
    pcb.sim(true);`);
  const seen = new Set<boolean>();
  for (let i = 0; i < 16; i++) { await page.waitForTimeout(45); seen.add(await pcb<number>(page, `return pcb.ledView().find(l => l.label === 'LED3').I;`) > 1e-3); }
  expect([...seen].sort()).toEqual([false, true]);
});
