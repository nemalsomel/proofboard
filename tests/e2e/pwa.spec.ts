import { expect, test, type Page } from '@playwright/test';

/* Névjegy ablak és telepíthető alkalmazás (PWA): manifest, service worker, offline indulás. */

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message + ' @ ' + (e.stack || '').split('\n')[1]));
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

test('Névjegy: verzió, leírás, GitHub-link a Fájl menüből', async ({ page }) => {
  await page.goto('./'); await page.waitForFunction(() => !!(window as any).pcb);
  await page.click('#bFile');
  await page.click('#bAbout');
  const dlg = page.locator('#dlgAbout');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('#aboutVer')).toHaveText(/^Verzió: \d+\.\d+\.\d+.* · \d{4}-\d{2}-\d{2}$/);
  const gh = dlg.locator('a', { hasText: 'GitHub' });
  await expect(gh).toHaveAttribute('href', 'https://github.com/nemalsomel/proofboard');
  await expect(gh).toHaveAttribute('target', '_blank');
  await expect(dlg.locator('a[href$="/issues"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});

test.describe('PWA', () => {
  test.use({ serviceWorkers: 'allow' });
  test('manifest és ikonok; a service worker eltárolja az appot, és offline is elindul', async ({ page, context }) => {
    await page.goto('./'); await page.waitForFunction(() => !!(window as any).pcb);
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const man = await page.evaluate(async h => (await fetch(h!)).json(), href);
    expect(man).toMatchObject({ short_name: 'Proofboard', lang: 'hu', display: 'standalone', start_url: './' });
    expect(man.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(man.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const i of man.icons) expect((await page.request.get(i.src)).ok(), i.src).toBe(true);
    // a service worker átveszi az oldalt (az első betöltés után); utána a hálózat nélkül is betölt
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await pcb(page, `pcb.example('led-auto');`);
    await context.setOffline(true);
    await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
    expect(await pcb(page, `return pcb.issues().length >= 0 && document.title;`)).toMatch(/Proofboard/);
    await page.click('#bFile'); await page.click('#bAbout');
    await expect(page.locator('#aboutOffline')).toContainText(/internet nélkül/i);
    await context.setOffline(false);
  });
});

const pcb = <T>(page: Page, body: string): Promise<T> => page.evaluate(`(() => { const pcb = window.pcb; ${body} })()`) as Promise<T>;
