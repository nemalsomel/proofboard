import { expect, test, type Page } from '@playwright/test';

/* Bekötés a tulajdonságokból: lábtáblázat, kapcsolat célja lenyílóból, lebegő lábak, PWM-kitöltés bemenet nélkül. */
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
const MOS = `pcb.load({ board: { rows: 40, cols: 39, sec: 3 }, parts: [{ id: 'p1', type: 'pico', label: 'PICO', r: 4, c: 12, rot: 0, props: {} },
  { id: 'p2', type: 'nmos', label: 'Q1', r: 30, c: 6, rot: 0, props: {} }], bridges: [], wires: [], links: [], gpio: {}, settings: { usb: true, btnMode: 'hold', autoRoute: true }, seq: 10 });`;

test('lábtáblázat: a MOSFET lábai lebegnek; S → GND, G → szabad GPIO a lenyílóból, útvonallal', async ({ page }) => {
  await pcb(page, MOS + `pcb.select(['Q1']);`);
  const rows = await pcb<any[]>(page, `return pcb.pinRows('Q1');`);
  expect(rows.map(r => [r.name, r.floating])).toEqual([['S', true], ['G', true], ['D', true]]);
  await expect(page.locator('#pinsSec .pin.float')).toHaveCount(3);
  await page.selectOption('[data-pinlink="p2.S"]', 'GND');
  await page.selectOption('[data-pinlink="p2.G"]', 'GPIO');
  const ls = await pcb<any[]>(page, `return pcb.links();`);
  expect(ls.map(l => l.text)).toEqual(['Q1.S → GND', 'Q1.G → GPIO']);
  expect(ls.every(l => l.ok)).toBe(true); // az útvonalkereső bekötötte
  const r2 = await pcb<any[]>(page, `return pcb.pinRows('Q1');`);
  expect(r2.map(r => r.target)).toEqual(['GND', 'GPIO', null]);
  await expect(page.locator('#pinsSec .pin.float')).toHaveCount(1); // csak a D lebeg
  // a cél cseréje és a kapcsolat törlése ugyanígy; visszavonható
  await page.selectOption('[data-pinlink="p2.S"]', '');
  expect((await pcb<any[]>(page, `return pcb.links();`)).map(l => l.text)).toEqual(['Q1.G → GPIO']);
  await pcb(page, `pcb.undo();`);
  expect((await pcb<any[]>(page, `return pcb.links();`)).length).toBe(2);
});

test('Kapcsolatok fül: a kijelölt kapcsolat célja lenyílóból cserélhető (pl. konkrét GPIO-ra)', async ({ page }) => {
  await pcb(page, MOS + `pcb.setPin('Q1', 'G', 'GPIO'); pcb.selectLink(0);`);
  await expect(page.locator('#lkTo')).toBeVisible();
  const opt = await page.locator('#lkTo option', { hasText: /^GP5$/ }).getAttribute('value');
  await page.selectOption('#lkTo', opt!);
  const l = (await pcb<any[]>(page, `return pcb.links();`))[0];
  expect(l.text).toBe('Q1.G → PICO.GP5');
  expect(l.ok).toBe(true);
});

test('lebegő kötelező láb részben bekötött alkatrészen: megjegyzés a Problémák között (nem hiba)', async ({ page }) => {
  const r = await pcb<any>(page, `pcb.load({ board: { rows: 40, cols: 39, sec: 3 }, parts: [{ id: 'p1', type: 'pico', label: 'PICO', r: 4, c: 12, rot: 0, props: {} },
    { id: 'p2', type: 'hc00', label: 'U1', r: 26, c: 10, rot: 0, props: {} }], bridges: [], wires: [], links: [{ id: 'l1', a: 'p2.14', b: 'p1.36', gpio: null }], gpio: {}, settings: { usb: true, btnMode: 'hold', autoRoute: true }, seq: 10 });
    return { all: pcb.issues(true).filter(i => i.sev === 'info').map(i => i.msg), def: pcb.issues().filter(i => i.sev === 'info').length };`);
  expect(r.all.join(' ')).toMatch(/föld láb sehova sincs kötve/);
  expect(r.def).toBe(0); // a megjegyzés alapból nem számít problémának
  await expect(page.locator('#sbIss')).not.toContainText('hiba');
  await expect(page.locator('#issues .c-info')).toHaveCount(1);
});

test('PWM kimenet bemenet nélkül a saját kitöltésével megy, a kódban is', async ({ page }) => {
  const r = await pcb<any>(page, `pcb.example('prog-blink'); pcb.program({ nodes: [{ id: 'n1', type: 'pwm', x: 40, y: 40, props: { pin: 'p2.1', duty: 30, freq: 500 } }], edges: [] });
    pcb.progAuto(false); pcb.sim(true); pcb.progStep(); const st = pcb.progState(); pcb.sim(false); return { pwm: Object.values(st.pwm)[0], py: pcb.code('micropython').code };`);
  expect(r.pwm).toEqual({ duty: 30, freq: 500 });
  expect(r.py).toContain('duty_u16(int(max(0, min(1, 0.3)) * 65535))');
});
