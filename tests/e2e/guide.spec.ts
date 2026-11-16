import { expect, test } from '@playwright/test';

/* Kézikönyv (guide/ angol, guide/hu/ magyar): minden oldal betöltődik, a belső linkek és a képek élnek, a horgonyok léteznek,
   a keresés talál, a nyelvváltó a másik nyelv ugyanazon oldalára visz; az appból a Fájl menü és a Névjegy elviszi ide. */

test('kézikönyv: minden oldal, link, kép és horgony él (mindkét nyelven)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errors.push('FAIL ' + r.url()); });
  const seen = new Set<string>(), queue = ['/proofboard/guide/', '/proofboard/guide/hu/'], checked = new Set<string>();
  let pages = 0;
  while (queue.length) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    pages++;
    await expect(page.locator('h1')).toHaveCount(1);
    const lang = path.includes('/guide/hu/') ? 'hu' : 'en';
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    // a kezdőlapon és a fejezetekben nincs kifejtetlen helyőrző
    expect(await page.locator('main').innerText()).not.toMatch(/\{\{|img:/);
    const links = await page.locator('a[href]').evaluateAll(els => els.map(e => (e as HTMLAnchorElement).href));
    for (const href of links) {
      const u = new URL(href);
      if (u.host !== 'localhost:4173' || !u.pathname.startsWith('/proofboard/')) continue;
      if (u.pathname.startsWith('/proofboard/guide/') && !u.pathname.endsWith('.jpg')) {
        // horgony: a céloldalon léteznie kell
        if (u.hash) {
          if (u.pathname === path) expect(await page.locator(u.hash).count(), href).toBe(1);
          else if (!checked.has(href)) { checked.add(href); queue.push(u.pathname); const p2 = await page.context().newPage(); await p2.goto(href); expect(await p2.locator(decodeURIComponent(u.hash)).count(), href).toBe(1); await p2.close(); }
        }
        queue.push(u.pathname);
      } else if (!checked.has(u.pathname)) {
        checked.add(u.pathname);
        expect((await page.request.get(u.pathname)).status(), href).toBe(200);
      }
    }
    for (const src of await page.locator('main img').evaluateAll(els => els.map(e => (e as HTMLImageElement).src))) {
      if (checked.has(src)) continue;
      checked.add(src);
      expect((await page.request.get(src)).status(), src).toBe(200);
    }
  }
  expect(pages).toBeGreaterThanOrEqual(24);
  expect(errors).toEqual([]);
});

test('kézikönyv: keresés, nyelvváltó, képnagyító', async ({ page }) => {
  await page.goto('./guide/hu/wiring/');
  await expect(page.locator('h1')).toHaveText('Bekötés és útvonalkeresés');
  // ékezet nélkül is talál, és kiemeli a szót
  await page.keyboard.press('/');
  await page.keyboard.type('csikvagas');
  const hits = page.locator('#hits a');
  await expect(hits.first()).toBeVisible();
  await expect(page.locator('#hits mark').first()).toHaveText(/csíkvágás/i);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#/);
  // a nyelvváltó ugyanarra a fejezetre visz
  await page.goto('./guide/hu/simulation/');
  await page.locator('.langsw a[hreflang="en"]').click();
  await expect(page).toHaveURL(/\/proofboard\/guide\/simulation\/$/);
  await expect(page.locator('h1')).toHaveText('Simulation and measurement');
  // képnagyító
  await page.locator('.shot a').first().click();
  await expect(page.locator('dialog.zoom')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.zoom')).toBeHidden();
  // a gyorsbillentyű-táblázat a valódi parancslistából készült
  await page.goto('./guide/shortcuts/');
  await expect(page.locator('table.keys').first()).toBeVisible();
  expect(await page.locator('table.keys tbody tr').count()).toBeGreaterThan(30);
});

test('az appból: Fájl › Kézikönyv és a Névjegy a felület nyelvén nyitja', async ({ page, context }) => {
  await page.goto('./');
  await page.waitForFunction(() => !!(window as unknown as { pcb?: unknown }).pcb);
  const [hu] = await Promise.all([context.waitForEvent('page'), page.evaluate(() => (window as unknown as { pcb: { run(id: string): boolean } }).pcb.run('bGuide'))]);
  await hu.waitForLoadState();
  expect(new URL(hu.url()).pathname).toBe('/proofboard/guide/hu/');
  await hu.close();
  await page.evaluate(() => (window as unknown as { pcb: { lang(l: string): void } }).pcb.lang('en'));
  await page.evaluate(() => (window as unknown as { pcb: { run(id: string): boolean } }).pcb.run('bAbout'));
  await expect(page.locator('#guidePage')).toHaveAttribute('href', 'guide/');
});
