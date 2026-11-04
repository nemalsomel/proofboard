import { expect, test, type Page } from '@playwright/test';

/* Vezérlés nézet: csomópontos szerkesztő (lerakás, élhúzás, érintéses kötés, láb, törlés, visszavonás), példák. */

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
const center = async (page: Page, sel: string) => { const b = (await page.locator(sel).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

test('programos példa: a Mindkettő nézetben a panel mellett látszik, futás közben az élek értéke frissül', async ({ page }) => {
  await pcb(page, `pcb.example('prog-toggle');`);
  expect(await pcb(page, 'return pcb.work();')).toBe('split');
  await expect(page.locator('#progView .pg-node')).toHaveCount(3);
  await expect(page.locator('[data-work="split"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#progView [data-pg="run"]');
  await expect(page.locator('#progView [data-pg="run"]')).toHaveText('■ Leállítás');
  await expect(page.locator('[data-v="n2.v"]')).toHaveText('0');
  await pcb(page, `pcb.press('SW1', true);`);
  await expect(page.locator('[data-v="n2.v"]')).toHaveText('1');
  await pcb(page, `pcb.press('SW1', false);`);
  await expect(page.locator('[data-v="n2.v"]')).toHaveText('1');
  await page.click('[data-work="board"]');
  await expect(page.locator('#progView')).toBeHidden();
});

test('szerkesztés: csomópont a menüből, él húzással és érintéssel, láb választása, törlés és visszavonás', async ({ page }) => {
  await pcb(page, 'pcb.preset(); pcb.work("prog");');
  await expect(page.locator('.pg-empty')).toBeVisible();
  const add = async (label: string) => { await page.click('[data-pg="add"]'); await page.click(`.pg-mitem:text-is("${label}")`); };
  await add('Ütemadó');
  await add('Digitális kimenet');
  expect((await pcb<any>(page, 'return pcb.program();')).nodes.map((n: any) => n.type)).toEqual(['blink', 'out']);
  // a kimenet a lerakás után kijelölt: lábválasztás a tulajdonságoknál
  const r1 = await pcb<string>(page, `return pcb.get().parts.find(p => p.label === 'R1').id + '.1';`);
  await page.selectOption('#pgp_pin', r1);
  // a második csomópont kerüljön odébb, hogy a portok ne fedjék egymást
  const h = await center(page, '[data-node="n2"] .pg-head');
  await page.mouse.move(h.x, h.y); await page.mouse.down(); await page.mouse.move(h.x + 260, h.y + 120, { steps: 6 }); await page.mouse.up();
  // él húzással: ütemadó kimenete → kimenet bemenete
  const a = await center(page, '[data-port="n1.v"]'), b = await center(page, '[data-port="n2.a"]');
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  let p = await pcb<any>(page, 'return pcb.program();');
  expect(p.edges.map((e: any) => e.from + '>' + e.to)).toEqual(['n1.v>n2.a']);
  expect(p.nodes[1].props.pin).toBe(r1);
  expect(p.nodes[1].x).toBeGreaterThan(p.nodes[0].x + 150);
  // a program fut: a LED villog
  await pcb(page, 'pcb.progAuto(false); pcb.sim(true); pcb.progStep(0);');
  expect(await pcb<number>(page, `return pcb.ledView().find(l => l.label === 'LED1').I;`)).toBeGreaterThan(1e-3);
  await pcb(page, 'pcb.sim(false);');
  // érintéses kötés: NEM csomópont, kimenet koppintás, majd bemenet koppintás (a régi él helyére)
  await add('NEM');
  const n3 = await center(page, '[data-node="n3"] .pg-head');
  await page.mouse.move(n3.x, n3.y); await page.mouse.down(); await page.mouse.move(n3.x - 40, n3.y + 220, { steps: 6 }); await page.mouse.up();
  await page.click('[data-port="n1.v"]');
  await page.click('[data-port="n3.a"]');
  await page.click('[data-port="n3.v"]');
  await page.click('[data-port="n2.a"]');
  p = await pcb<any>(page, 'return pcb.program();');
  expect(p.edges.map((e: any) => e.from + '>' + e.to).sort()).toEqual(['n1.v>n3.a', 'n3.v>n2.a']);
  // törlés Delete-tel, visszavonás
  await page.click('[data-node="n3"] .pg-head');
  await page.keyboard.press('Delete');
  p = await pcb<any>(page, 'return pcb.program();');
  expect(p.nodes.map((n: any) => n.id)).toEqual(['n1', 'n2']);
  expect(p.edges).toEqual([]);
  await page.keyboard.press('Control+z');
  expect((await pcb<any>(page, 'return pcb.program();')).nodes.length).toBe(3);
  await expect(page.locator('#progView .pg-node')).toHaveCount(3);
});

test('a kijelölt csomópont lába a panelon is kiemelődik; hibás láb a csomóponton látszik', async ({ page }) => {
  await pcb(page, `pcb.preset(); pcb.program({ nodes: [{ id: 'n1', type: 'out', x: 40, y: 40, props: {} }], edges: [] }); pcb.work('split'); pcb.progAuto(false); pcb.sim(true); pcb.progStep();`);
  await expect(page.locator('[data-node="n1"]')).toHaveClass(/err/);
  await expect(page.locator('[data-node="n1"] .pg-err')).toHaveText('Nincs kiválasztva láb');
});

test('Kód fül: MicroPython és Arduino, a kijelölt csomópont sorai kiemelve, sorra kattintva kijelöl; letöltés és PlatformIO-zip', async ({ page }) => {
  await pcb(page, `pcb.example('prog-toggle');`);
  await page.click('[data-node="n2"] .pg-head');
  await page.click('[data-pvtab="code"]');
  await expect(page.locator('#pvNodes')).toBeHidden();
  await expect(page.locator('.pc-code')).toContainText('from machine import Pin');
  await expect(page.locator('.pc-ln.on').first()).toContainText('n2');
  const [py] = await Promise.all([page.waitForEvent('download'), page.click('[data-pc="dl"]')]);
  expect(py.suggestedFilename()).toBe('main.py');
  await page.click('[data-lang="arduino"]');
  await expect(page.locator('.pc-code')).toContainText('void loop() {');
  await expect(page.locator('.pc-info')).toContainText('rp2040:rp2040:rpipicow');
  const [z] = await Promise.all([page.waitForEvent('download'), page.click('[data-pc="pio"]')]);
  expect(z.suggestedFilename()).toBe('proofboard-platformio.zip');
  // sorra kattintva a hozzá tartozó csomópont lesz kijelölve
  await page.locator('.pc-ln[data-node="n3"]').first().click();
  await page.click('[data-pvtab="nodes"]');
  await expect(page.locator('.pg-node[data-node="n3"]')).toHaveClass(/sel/);
  expect((await pcb<any>(page, `return pcb.code('arduino');`)).file).toBe('proofboard.ino');
});
