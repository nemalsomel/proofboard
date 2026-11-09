import { expect, test, type Page } from '@playwright/test';

/* Tömörség: rögzített hely (lakat) alkatrészenként és csoportra, a foglalt terület az állapotsorban és az API-ban. */
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

test('rögzített hely: a tulajdonságoknál kapcsolható, visszavonható, mentődik; csoportra is', async ({ page }) => {
  await pcb(page, `pcb.preset(); pcb.select(['K1']);`);
  const fx = page.locator('#pFixed:visible');
  await expect(fx).not.toBeChecked();
  await fx.check();
  expect(await pcb(page, `return pcb.get().parts.find(p => p.label === 'K1').fixed;`)).toBe(true);
  expect(await pcb(page, `return pcb.layoutStats().fixed;`)).toBe(1);
  await page.click('#bUndo');
  expect(await pcb(page, `return pcb.get().parts.find(p => p.label === 'K1').fixed;`)).toBeUndefined();
  await page.click('#bRedo');
  await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
  expect(await pcb(page, `return pcb.get().parts.find(p => p.label === 'K1').fixed;`)).toBe(true);
  // csoport: mind rögzítve, majd mind feloldva
  await pcb(page, `pcb.select(['K1', 'K2']);`);
  await page.locator('#gFixed:visible').click();
  expect(await pcb(page, `return pcb.get().parts.filter(p => p.fixed).map(p => p.label).sort();`)).toEqual(['K1', 'K2']);
  await page.locator('#gFixed:visible').click();
  expect(await pcb(page, `return pcb.get().parts.filter(p => p.fixed).length;`)).toBe(0);
});

test('foglalt terület: az állapotsorban és az API-ban; üres tervnél nincs', async ({ page }) => {
  await pcb(page, `pcb.preset();`);
  const s = await pcb<{ rows: number; cols: number; fill: number; area: number }>(page, `return pcb.layoutStats();`);
  expect(s.rows).toBeGreaterThan(0);
  await expect(page.locator('#sbFoot')).toHaveText(`Terület: ${s.rows}×${s.cols} · ${Math.round(s.fill * 100)}%`);
  await expect(page.locator('#sbFoot')).toHaveAttribute('title', new RegExp(`${s.rows}×${s.cols} lyuk`));
  await pcb(page, `pcb.load({ ...pcb.get(), parts: [], links: [], bridges: [], wires: [], auto: { bridges: [], wires: [] } });`);
  expect(await pcb(page, `return pcb.layoutStats().box;`)).toBeNull();
  await expect(page.locator('#sbFoot')).toBeHidden();
});
