import { expect, test, type Page } from '@playwright/test';

/* Gyártás elrendezés: anyaglista, beültetési sorrend pipálható lépésekkel, 1:1-es nyomtatható lapok. */

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message + ' @ ' + (e.stack || '').split('\n')[1]));
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

const ready = (p: Page) => p.waitForFunction(() => !!(window as any).pcb);

test('Gyártás (Alt+4): anyaglista, lépések pipálása (megmarad), rézoldal kiemeléssel, nyomtatás új ablakban', async ({ page }) => {
  await page.goto('./'); await ready(page);
  expect(await page.evaluate(() => (window as any).pcb.example('strip'))).toBe(true);
  await page.locator('#cv').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('Alt+4');
  await expect(page.locator('#mfgView')).toBeVisible();
  expect(await page.evaluate(() => (window as any).pcb.layout())).toBe('mfg');
  // a panel eszközsávja és nézetsávja nem látszik
  await expect(page.locator('#toolstrip')).toBeHidden();

  // Beültetés: az első lépés nyitva; a vágások lépése a rézoldalt mutatja X-jelekkel
  const v = page.locator('#mfgView');
  await expect(v.locator('.mf-step.on .mf-st')).toHaveText('A panel előkészítése');
  await v.locator('button[data-step="cuts"]').click();
  await expect(v.locator('.mf-side')).toContainText('Rézoldal');
  await expect(v.locator('.mf-prev svg')).toContainText('X1');
  const boxes = v.locator('.mf-step.on input[type=checkbox]');
  await expect(boxes).toHaveCount(3);
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();
  await expect(v.locator('.mf-step[data-step="cuts"]')).toHaveClass(/done/);
  await expect(v.locator('.mf-prog')).toContainText('Kész: 3 /');

  // a pipák tervenként megmaradnak (újratöltés után is)
  await page.reload(); await ready(page);
  if (await page.evaluate(() => (window as any).pcb.layout()) !== 'mfg') await page.evaluate(() => (window as any).pcb.layout('mfg'));
  await expect(page.locator('#mfgView .mf-prog')).toContainText('Kész: 3 /');
  await page.locator('#mfgView [data-mf="reset"]').click();
  await expect(page.locator('#mfgView .mf-prog')).toContainText('Kész: 0 /');

  // Anyaglista
  await page.locator('#mfgView [data-mtab="bom"]').click();
  await expect(page.locator('#mfgView .mf-tbl tbody tr')).toHaveCount(3);
  await expect(page.locator('#mfgView .mf-tbl')).toContainText('330Ω');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#mfgView [data-mf="csv"]').click()]);
  expect(dl.suggestedFilename()).toBe('anyaglista.csv');

  // Lapok és nyomtatás: új ablak A4-es lapokkal
  await page.locator('#mfgView [data-mtab="sheets"]').click();
  await expect(page.locator('#mfgView .mf-two svg')).toHaveCount(2);
  await page.locator('#mfgView [data-pr="steps"]').uncheck();
  // alkatrész- és rézoldal, anyaglista, méretrajz
  const [pop] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Control+p')]);
  await pop.waitForLoadState();
  await expect(pop.locator('section.page')).toHaveCount(4);
  await pop.close();

  // vissza a Tervezésbe: a gyártás nézet eltűnik, a panel billentyűi újra élnek
  await page.keyboard.press('Alt+1');
  await expect(page.locator('#mfgView')).toBeHidden();
  await expect(page.locator('#toolstrip')).toBeVisible();
});

test('Gyártás: üres terv üzenete; API: anyaglista, lépések, lap SVG', async ({ page }) => {
  await page.goto('./'); await ready(page);
  await page.evaluate(() => { (window as any).pcb.example('led-auto'); });
  const m = await page.evaluate(() => { const x = (window as any).pcb.mfg(); return { rows: x.bom.rows.length, last: x.steps.at(-1).id, svg: (window as any).pcb.mfgSheet('cu').slice(0, 4) }; });
  expect(m).toEqual({ rows: 3, last: 'check', svg: '<svg' });
  await page.evaluate(() => (window as any).pcb.layout('mfg'));
  await expect(page.locator('#mfgView .mf-tbl')).toBeVisible().catch(() => {});
  // új (üres) terv a Fájl menüből, a gyártás nézet frissül
  await page.click('#bFile'); await page.click('#bNew'); await page.click('#bNewOk');
  await expect(page.locator('#mfgView .mf-empty')).toBeVisible();
});

test('Méretrajz: koordináta-táblázat, elemenként kapcsolható méretezés (megmarad), SVG és DXF letöltés, nyomtatásban is', async ({ page }) => {
  await page.goto('./'); await ready(page);
  await page.evaluate(() => { const p = (window as any).pcb; p.example('esp32'); p.layout('mfg'); p.mfgTab('dims'); });
  const v = page.locator('#mfgView');
  const rows = v.locator('.mf-dtab tbody tr');
  await expect(rows).toHaveCount(6);
  await expect(v.locator('[data-dim-row]').filter({ hasText: 'ESP1 USB' })).toHaveCount(1);
  // R1 alapból nincs méretezve; bekapcsolva a rajzon is megjelenik a koordinátája
  const r1 = v.locator('[data-dim-row]').filter({ hasText: 'R1' }), x = (await r1.locator('td.n').first().innerText()).trim();
  await expect(r1.locator('input')).not.toBeChecked();
  await expect(v.locator('.mf-prev svg')).not.toContainText(x);
  await r1.locator('input').check();
  await expect(v.locator('.mf-prev svg')).toContainText(x);
  expect(await page.evaluate(() => (window as any).pcb.mfgDims().shown.length)).toBe(6);
  await page.reload(); await ready(page);
  await page.evaluate(() => { const p = (window as any).pcb; if (p.layout() !== 'mfg') p.layout('mfg'); p.mfgTab('dims'); });
  await expect(page.locator('#mfgView [data-dim-row]').filter({ hasText: 'R1' }).locator('input')).toBeChecked();
  await page.locator('#mfgView [data-mf="ddef"]').click();
  await expect(page.locator('#mfgView [data-dim-row]').filter({ hasText: 'R1' }).locator('input')).not.toBeChecked();

  const [svg] = await Promise.all([page.waitForEvent('download'), page.locator('#mfgView [data-mf="svg"]').click()]);
  expect(svg.suggestedFilename()).toMatch(/meretrajz\.svg$/);
  const [dxf] = await Promise.all([page.waitForEvent('download'), page.locator('#mfgView [data-mf="dxf"]').click()]);
  expect(dxf.suggestedFilename()).toMatch(/meretrajz\.dxf$/);
  const html = await page.evaluate(() => (window as any).pcb.mfgPrintHtml({ comp: false, cu: false, bom: false, steps: false, dims: true }));
  expect(html.match(/<section class="page/g)).toHaveLength(1);
  expect(html).toContain('99.1');
});

test('Rögzítőfurat és magasság: a könyvtárból lerakható, a méretrajzon furat, elöl- és oldalnézet a legmagasabb ponttal', async ({ page }) => {
  await page.goto('./'); await ready(page);
  await page.evaluate(() => { (window as any).pcb.example('esp32'); });
  const n = await page.evaluate(() => (window as any).pcb.libSearch('rögzítőfurat'));
  expect(n).toContain('mhole');
  await page.evaluate(() => { const p = (window as any).pcb, d = p.get(); d.parts.push({ id: 'mh1', type: 'mhole', label: 'MH1', r: 1, c: 1, rot: 0, props: { size: 'M2.5' } }); p.load(d); p.layout('mfg'); p.mfgTab('dims'); });
  const v = page.locator('#mfgView');
  await expect(v.locator('[data-dim-row="mh1"]')).toContainText('⌀2.7');
  await expect(v.locator('[data-dim-row="mh1"] input')).toBeChecked();
  await expect(v.locator('.mf-max')).toContainText('JS1');
  await expect(v.locator('.mf-prev svg')).toContainText('Elölnézet');
  await expect(v.locator('.mf-prev svg')).toContainText('Oldalnézet');
  // a panel előkészítése lépésben a furat
  await v.locator('[data-mtab="asm"]').click();
  await expect(v.locator('.mf-step[data-step="board"] .mf-cnt')).toHaveText('0/2');
  const dims = await page.evaluate(() => (window as any).pcb.mfgDims());
  expect(dims.dxf).toContain('HOLES');
});
