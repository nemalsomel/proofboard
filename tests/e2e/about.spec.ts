import { expect, test } from '@playwright/test';

/* Bemutató oldal (about/ angol, about/hu/ magyar): betöltődik, a képek megvannak, a gombok az appra mutatnak, a nyelvek egymásra. */

for (const [path, lang, h1, open] of [['about/hu/', 'hu', 'Tervezd meg a próbapanelt', 'Proofboard megnyitása'], ['about/', 'en', 'Plan your perfboard', 'Open Proofboard']] as const) {
  test(`bemutató oldal (${lang}): cím, képek, linkek, keresőadatok`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errors.push('FAIL ' + r.url()); });
    await page.goto('./' + path);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.locator('h1')).toContainText(h1);
    // minden kép betölthető (a lustán töltöttek is)
    const imgs = await page.locator('img').evaluateAll(els => els.map(e => (e as HTMLImageElement).currentSrc || (e as HTMLImageElement).src));
    expect(imgs.length).toBeGreaterThanOrEqual(6);
    for (const src of imgs) expect((await page.request.get(src)).status(), src).toBe(200);
    // a képek linkjei is a képre mutatnak (nem a domain gyökerére), kattintásra nagyítóban nyílnak
    const links = await page.locator('a[href$=".jpg"]').evaluateAll(els => els.map(e => (e as HTMLAnchorElement).href));
    expect(links.length).toBeGreaterThanOrEqual(7);
    for (const href of links) { expect(href).toContain('/proofboard/about/img/'); expect((await page.request.get(href)).status(), href).toBe(200); }
    await page.locator('.shot-hero a').click();
    await expect(page.locator('dialog.zoom')).toBeVisible();
    await expect(page.locator('dialog.zoom img')).toHaveAttribute('src', links[0]);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog.zoom')).toBeHidden();
    // a megnyitás gomb az appra visz
    const href = await page.getByRole('link', { name: open }).first().getAttribute('href');
    expect(new URL(href!, page.url()).pathname).toBe('/proofboard/');
    // a másik nyelv
    const other = page.locator('.langsw a[hreflang]');
    expect(new URL((await other.getAttribute('href'))!, page.url()).pathname).toBe(lang === 'hu' ? '/proofboard/about/' : '/proofboard/about/hu/');
    await expect(page.locator('.langsw a[aria-current]')).toHaveText(lang.toUpperCase());
    // keresőadatok
    expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toMatch(/about\/img\/og-(hu|en)\.jpg$/);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
    expect(ld['@type']).toBe('SoftwareApplication');
    // a GYIK nyitható
    await page.locator('.faq summary').first().click();
    await expect(page.locator('.faq details').first()).toHaveAttribute('open', '');
    expect(errors).toEqual([]);
  });
}

test('az app Névjegyéből elérhető, a nyelvnek megfelelően', async ({ page }) => {
  await page.goto('./'); await page.waitForFunction(() => !!(window as any).pcb);
  await page.click('#bFile'); await page.click('#bAbout');
  expect(await page.locator('#aboutPage').getAttribute('href')).toBe('about/hu/');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as any).pcb.lang('en'));
  await page.click('#bFile'); await page.click('#bAbout');
  expect(await page.locator('#aboutPage').getAttribute('href')).toBe('about/');
});
