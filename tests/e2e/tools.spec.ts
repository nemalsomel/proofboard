import { expect, test, type Page } from '@playwright/test';

/* 5.3: eszközsáv ikonokkal, gyorsbillentyűk Alt-ra, eszközök elrendezésenként és szimulációban; a programszerkesztő mozgatása. */
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

test('eszközsáv: ikon és név, súgóban a gyorsbillentyű; Ctrl nyomva tartva az ikon helyén a betű, máshol címke', async ({ page }) => {
  const tools = page.locator('#tools [data-tool]');
  await expect(tools).toHaveCount(8);
  for (const b of await tools.all()) {
    await expect(b.locator('svg.ic')).toBeVisible();
    await expect(b.locator('.tl')).not.toBeEmpty();
    expect(await b.getAttribute('title')).toMatch(/\([A-Z]\)/);
  }
  const sel = page.locator('#tools [data-tool="select"]');
  await expect(sel.locator('kbd')).toBeHidden();
  await page.keyboard.down('Control');
  await expect(sel.locator('kbd')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#bSim')!, '::after').content)).toBe('"S"');
  // a nyomva tartott Ctrl ismétlődő eseménye (Windows) nem tünteti el a címkéket
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, repeat: true })));
  await expect(sel.locator('kbd')).toBeVisible();
  await expect(sel.locator('kbd')).toHaveText('V');
  await expect(sel.locator('svg.ic')).toBeHidden();
  const box1 = (await sel.boundingBox())!;
  await page.keyboard.up('Control');
  await expect(sel.locator('svg.ic')).toBeVisible();
  const box0 = (await sel.boundingBox())!;
  expect(Math.abs(box1.width - box0.width)).toBeLessThan(1); // a sáv képe nem ugrik
  // összecsukva csak az aktív eszköz (ikonnal)
  await page.keyboard.press('w');
  await page.click('#tsTog');
  await expect(page.locator('#tools [data-tool="wire"]')).toBeVisible();
  await expect(page.locator('#tools [data-tool="wire"] .tl')).toBeHidden();
  await expect(sel).toBeHidden();
});

test('Program és Szimuláció elrendezésben csak Kijelölés és Mozgatás; szimulációban is kijelölhető alkatrész', async ({ page }) => {
  await pcb(page, `pcb.example('rc');`);
  await page.keyboard.press('k');
  await page.keyboard.press('Alt+2');
  await expect(page.locator('#tools [data-tool="select"]')).toHaveClass(/on/); // a Csíkvágás nem elérhető, Kijelölésre vált
  await expect(page.locator('#tools [data-tool="cut"]')).toBeHidden();
  await expect(page.locator('#tools [data-tool="pan"]')).toBeVisible();
  await page.keyboard.press('Alt+1');
  await expect(page.locator('#tools [data-tool="cut"]')).toBeVisible();
  // szimulációban a Kijelölés és a Mozgatás használható, a többi nem
  await pcb(page, `pcb.sim(true);`);
  await expect(page.locator('#tools [data-tool="select"]')).toBeEnabled();
  await page.keyboard.press('h');
  await expect(page.locator('#tools [data-tool="pan"]')).toHaveClass(/on/);
  await page.keyboard.press('v');
  const q = await pcb<any>(page, `const q = pcb.pins('R1'); return pcb.reveal(q[0].r, q[0].c + 2);`);
  await page.mouse.click(q.x, q.y);
  await expect(page.locator('#selSumm')).toHaveText('R1');
});

test('programszerkesztő: a csomópont bárhol megfogható (a porton nem), középső gombbal a vászon mozgatható', async ({ page }) => {
  await pcb(page, `pcb.program({ nodes: [{ id: 'n1', type: 'blink', x: 40, y: 40, props: {} }], edges: [] }); pcb.work('prog');`);
  const node = page.locator('.pg-node[data-node="n1"]');
  await expect(node.locator('.pg-grip')).toBeVisible();
  const b = (await node.locator('.pg-sum').boundingBox())!; // a test összegzése, nem a címsor
  await page.mouse.move(b.x + 20, b.y + 5); await page.mouse.down(); await page.mouse.move(b.x + 120, b.y + 65, { steps: 5 }); await page.mouse.up();
  const n = (await pcb<any>(page, `return pcb.program().nodes[0];`));
  expect(n.x - 40).toBeGreaterThan(80); expect(n.y - 40).toBeGreaterThan(40);
  // középső gomb: a vászon mozog, a csomópont helye a programban nem változik
  const r0 = (await node.boundingBox())!;
  await page.mouse.move(r0.x + 30, r0.y + 30); await page.mouse.down({ button: 'middle' }); await page.mouse.move(r0.x + 130, r0.y + 30, { steps: 5 }); await page.mouse.up({ button: 'middle' });
  const r1 = (await node.boundingBox())!;
  expect(r1.x - r0.x).toBeGreaterThan(80);
  expect((await pcb<any>(page, `return pcb.program().nodes[0];`)).x).toBe(n.x);
});

test('fejléc: oldalsáv- és alsópanel-kapcsolók; Panel beállításai a Fájl menüben', async ({ page }) => {
  await expect(page.locator('#colL')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#colL');
  await expect(page.locator('#colL')).toHaveAttribute('aria-pressed', 'false');
  expect(await pcb(page, `return pcb.sides().l;`)).toBe(true);
  await page.click('#colB');
  expect(await pcb<any>(page, `return pcb.bottom().open;`)).toBe(true);
  await expect(page.locator('#colB')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#colL');
  expect(await pcb(page, `return pcb.sides().l;`)).toBe(false);
});

test('összecsukott eszközsáv rámutatásra nyílik; vezetékszín a sáv fölött; a kurzor az eszközt mutatja', async ({ page }) => {
  await pcb(page, `pcb.preset();`);
  await page.click('#tsTog');
  const wire = page.locator('#tools [data-tool="wire"]');
  await expect(wire).toBeHidden();
  await page.mouse.move(10, 400); // el a sávtól, majd vissza
  await page.locator('#toolstrip').hover();
  await expect(wire).toBeVisible();
  await wire.click();
  await expect(page.locator('#tools [data-tool="select"]')).toBeHidden(); // választás után újra összecsukva
  const sw = (await page.locator('#wireColorRow').boundingBox())!, ts = (await page.locator('#toolstrip').boundingBox())!;
  expect(sw.y + sw.height).toBeLessThanOrEqual(ts.y); // a színek a sáv fölött
  await expect(page.locator('#swatches .sw')).toHaveCount(7);
  await expect(page.locator('#swatches .sw:visible')).toHaveCount(1); // összecsukva csak az aktuális szín
  await expect(page.locator('#swatches .sw.on')).toBeVisible();
  expect(await page.evaluate(() => (document.querySelector('#cv') as HTMLElement).style.cursor)).toContain('url(');
  await page.mouse.move(10, 400);
  await page.keyboard.press('v');
  expect(await page.evaluate(() => (document.querySelector('#cv') as HTMLElement).style.cursor)).toBe('');
});

test('visszavonás és újra csak akkor aktív, ha van mit', async ({ page }) => {
  await pcb(page, `pcb.preset();`);
  await expect(page.locator('#bUndo')).toBeDisabled();
  await expect(page.locator('#bRedo')).toBeDisabled();
  await pcb(page, `pcb.move('K1', 0, 1);`);
  await expect(page.locator('#bUndo')).toBeEnabled();
  await page.click('#bUndo');
  await expect(page.locator('#bUndo')).toBeDisabled();
  await expect(page.locator('#bRedo')).toBeEnabled();
});

test('a rögzített tulajdonságok a bal oldalsávba is áttehetők; ott is saját fül', async ({ page }) => {
  await pcb(page, `pcb.preset(); pcb.select(['K1']);`);
  await page.click('#pwDock');
  await expect(page.locator('.right .rtab.on')).toHaveText('Tulajdonságok');
  await page.click('#pwSwap');
  await expect(page.locator('[data-rtab="props"]')).toBeHidden();
  await expect(page.locator('.left .rtab.on')).toHaveText('Tulajdonságok');
  await expect(page.locator('#lpProps #pLabel')).toHaveValue('K1');
  await page.keyboard.press('Escape');
  await expect(page.locator('.left .rtab.on')).toHaveText('Alkatrészek');
  await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
  await pcb(page, `pcb.select(['K2']);`);
  await expect(page.locator('#lpProps #pLabel')).toHaveValue('K2');
});

test('programszerkesztő: húzáskor nem nyílik fel a blokk beállítása, csak kattintásra', async ({ page }) => {
  await pcb(page, `pcb.program({ nodes: [{ id: 'n1', type: 'blink', x: 40, y: 40, props: {} }], edges: [] }); pcb.work('prog');`);
  await expect(page.locator('[data-pg="add"]')).toHaveText('+ Blokk');
  const head = (await page.locator('.pg-node[data-node="n1"] .pg-head').boundingBox())!;
  await page.mouse.move(head.x + 40, head.y + 10); await page.mouse.down(); await page.mouse.move(head.x + 140, head.y + 60, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('.pg-props')).toBeHidden();
  await page.locator('.pg-node[data-node="n1"] .pg-head').click();
  await expect(page.locator('.pg-props')).toBeVisible();
});

test('nézetmódok a vászon fölött jobbra: Alkatrészoldal és Rézoldal egy csoportban, egyszerre csak az egyik', async ({ page }) => {
  await expect(page.locator('.vbar #vModes')).toBeVisible();
  await expect(page.locator('#vComp')).toHaveClass(/on/);
  await page.click('#vCu');
  await expect(page.locator('#vCu')).toHaveClass(/on/);
  await expect(page.locator('#vComp')).not.toHaveClass(/on/);
  const a = (await page.locator('#vComp').boundingBox())!, b = (await page.locator('#vCu').boundingBox())!;
  expect(Math.abs(a.x + a.width - b.x)).toBeLessThan(2); // összefüggő gombsor
});

test('nézetváltó 1 / 2 / 3, rövid vezeték Shift+W; tulajdonságok: fő műveletek egy rácsban', async ({ page }) => {
  await pcb(page, `pcb.preset();`);
  await page.locator('#cv').hover({ position: { x: 5, y: 5 } });
  await page.keyboard.press('2');
  expect(await pcb(page, `return pcb.work();`)).toBe('prog');
  await page.keyboard.press('3');
  expect(await pcb(page, `return pcb.work();`)).toBe('split');
  await page.keyboard.press('1');
  expect(await pcb(page, `return pcb.work();`)).toBe('board');
  const on0 = await page.locator('#vStub').evaluate(e => e.classList.contains('on'));
  await page.keyboard.press('Shift+W');
  expect(await page.locator('#vStub').evaluate(e => e.classList.contains('on'))).toBe(!on0);
  expect(await pcb(page, `return pcb.get().wires.length;`)).toBe(0); // nem a Vezeték eszköz
  await pcb(page, `pcb.select(['K1']);`);
  const boxes = await Promise.all(['#pRot', '#pMir', '#pDup', '#pDel'].map(s => page.locator(s).boundingBox()));
  expect(new Set(boxes.map(b => Math.round(b!.y))).size).toBeLessThanOrEqual(2); // legfeljebb két sorban
});
