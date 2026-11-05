import { expect, test, type Page } from '@playwright/test';

/* 5.5: Egyszerű mód – a haladó részek rejtve, a Problémák közül csak a hibák; a beállítás megmarad. */
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

test('egyszerű mód: a Fájl menüből; rejtett csíkvágás, kézi ↔ automatikus, JSON, saját alkatrész; csak a hibák; újratöltés után is', async ({ page }) => {
  await pcb(page, `pcb.preset();`);
  await page.keyboard.press('k');
  await expect(page.locator('#tools [data-tool="cut"]')).toHaveClass(/on/);
  await page.click('#bFile');
  await page.click('#bSimple');
  await expect(page.locator('#simpleBadge')).toBeVisible();
  expect(await pcb(page, `return pcb.simple();`)).toBe(true);
  await expect(page.locator('#tools [data-tool="cut"]')).toHaveCount(0);
  await expect(page.locator('#tools [data-tool="select"]')).toHaveClass(/on/); // a csíkvágásról kijelölésre váltott
  await page.keyboard.press('k');
  await expect(page.locator('#tools [data-tool="select"]')).toHaveClass(/on/);
  for (const sel of ['#bFreeze', '#bToAuto', '#bUnroute', '#bNewPart']) await expect(page.locator(sel)).toBeHidden();
  await page.click('#bFile');
  await expect(page.locator('#bJson')).toBeHidden();
  await expect(page.locator('#bSimple')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.click('[data-ltab="lib"]');
  await expect(page.locator('details[data-grp="cat:Logika"]')).toHaveCount(0);
  // a Problémák közül csak a hibák: egy lebegő (figyelmeztetés) nem látszik, egy hiba igen
  const counts = await pcb<any>(page, `const a = pcb.issues(true); return { err: a.filter(i => i.sev === 'err').length, other: a.filter(i => i.sev !== 'err').length };`);
  await page.click('#colB');
  await expect(page.locator('#issues li.c-warn, #issues li.c-info')).toHaveCount(0);
  if (counts.err) await expect(page.locator('#issues li.c-err')).toHaveCount(counts.err);
  await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
  expect(await pcb(page, `return pcb.simple();`)).toBe(true);
  await page.click('#simpleBadge'); // a jelvény kikapcsolja
  expect(await pcb(page, `return pcb.simple();`)).toBe(false);
  await expect(page.locator('#tools [data-tool="cut"]')).toHaveCount(1);
  await expect(page.locator('#bFreeze')).toBeVisible();
});
