import { expect, test, type Page } from '@playwright/test';

/* Csatlakozó: a külső alkatrész kábele egy mozgatható tüskesorba dugva; a tüskesor lábnevei. */

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
const click = async (page: Page, r: number, c: number) => { const p = await pcb<{ x: number; y: number }>(page, `return pcb.reveal(${r}, ${c});`); await page.mouse.click(p.x, p.y); };

test('külső alkatrész lerakásakor tüskesor kerül a panelra; mozgatható, a bekötés onnan indul; törléssel együtt megy', async ({ page }) => {
  await pcb(page, 'pcb.example("servo");');
  const plug = await pcb<any>(page, 'return pcb.plug("SV1");');
  expect(plug.header).toBe('J1');
  expect(plug.pins.map((x: any) => x.name)).toEqual(['GND', 'V+', 'SIG']);
  // a tüskesor elmozdítása után is bekötött marad
  expect(await pcb<boolean>(page, 'return pcb.move("J1", -4, 6);')).toBe(true);
  const r = await pcb<any>(page, 'pcb.route(); return { ok: pcb.links().every(l => l.ok), iss: pcb.issues().filter(i => i.sev === "err").length, wires: pcb.get().auto.wires.length };');
  expect(r).toEqual({ ok: true, iss: 0, wires: 0 });
  // kihúzás és visszadugás a tulajdonságpanelen
  await pcb(page, 'pcb.select(["SV1"]);');
  await page.click('[data-ltab="edit"]');
  await page.click('#pUnplug');
  expect(await pcb(page, 'return pcb.plug("SV1");')).toBeNull();
  await pcb(page, 'pcb.select(["J1"]);');
  await page.click('#pPlugGo');
  expect((await pcb<any>(page, 'return pcb.plug("SV1");')).header).toBe('J1');
  // törlés: a szervóval a tüskesora is megy, visszavonással visszajön
  await pcb(page, 'pcb.select(["SV1"]);');
  await page.click('#pDel');
  expect(await pcb(page, 'return pcb.get().parts.map(p => p.label).sort();')).toEqual(['PICO']);
  await pcb(page, 'pcb.undo();');
  expect((await pcb<any>(page, 'return pcb.plug("SV1");')).header).toBe('J1');
});

test('lerakás a könyvtárból: a motor mellé a panelra kerül a tüskesor, a lábaihoz közel', async ({ page }) => {
  await pcb(page, `pcb.load({ board: { rows: 30, cols: 30, sec: 3 }, parts: [], bridges: [], wires: [], links: [], gpio: {}, settings: { usb: true, btnMode: 'hold', autoRoute: true }, seq: 10 });`);
  await page.click('[data-ltab="lib"]');
  await page.click('[data-lib="motor"]');
  await click(page, 14, -6);
  const r = await pcb<any>(page, 'return { parts: pcb.get().parts.map(p => p.type), plug: pcb.plug("M1") };');
  expect(r.parts).toEqual(['motor', 'header']);
  expect(r.plug.pins.map((x: any) => x.name)).toEqual(['+', '−']);
  for (const q of r.plug.pins) expect(q.c).toBeLessThan(4); // a panel bal szélén, a motor mellett
});

test('önálló tüskesor: lábnevek a tulajdonságpanelen', async ({ page }) => {
  await pcb(page, `pcb.load({ board: { rows: 20, cols: 20, sec: 3 }, parts: [{ id: 'p1', type: 'header', label: 'J1', r: 5, c: 5, rot: 0, mir: false, props: { n: 4 } }], bridges: [], wires: [], links: [], gpio: {}, settings: { usb: true, btnMode: 'hold', autoRoute: true }, seq: 10 });
    pcb.select(["J1"]);`);
  await page.click('[data-ltab="edit"]');
  await page.fill('#pp_names', 'GND, VCC, SDA, SCL');
  await page.locator('#pp_names').blur();
  expect(await pcb(page, 'return pcb.pins("J1").map(q => q.name);')).toEqual(['GND', 'VCC', 'SDA', 'SCL']);
  expect(await pcb(page, 'return pcb.get().parts[0].props.names;')).toBe('GND,VCC,SDA,SCL');
});
