/**
 * A landing oldal képernyőképei a valódi appból (magyarul és angolul).
 * Használat: npm run build && npx vite preview --port 4173 & ; node scripts/landing-shots.cjs
 * Kimenet: public/about/img/<név>-<nyelv>.jpg és az OG-kép (og-hu.jpg, og-en.jpg).
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, '..', 'public', 'about', 'img');
const URL = process.env.APP_URL || 'http://localhost:4173/proofboard/';

const SHOTS = [
  // nyitókép: program és panel egymás mellett, szimuláció fut, a LED ég
  ['hero', async p => {
    await p.evaluate(() => { const pcb = window.pcb; pcb.example('prog-toggle'); pcb.layout('prog'); pcb.work('split'); pcb.sides('l', true); });
    await p.evaluate(() => { const pcb = window.pcb; pcb.sim(true); pcb.press('SW1', true); });
    await p.waitForTimeout(400);
    await p.evaluate(() => window.pcb.press('SW1', false));
    await p.waitForTimeout(600);
  }],
  // tervezés: alkatrészek, kapcsolatok, automatikus bekötés
  ['design', async p => {
    await p.evaluate(() => { const pcb = window.pcb; pcb.example('mosfet-pwm'); pcb.layout('design'); pcb.work('board'); });
    await p.waitForTimeout(400);
  }],
  // szimuláció: szervó és potméter
  ['sim', async p => {
    await p.evaluate(() => { const pcb = window.pcb; pcb.example('nokia'); pcb.layout('sim'); pcb.sim(true); });
    await p.waitForTimeout(900);
  }],
  // csíkos panel rézoldalról, a vágásokkal
  ['strip', async p => {
    await p.evaluate(() => { const pcb = window.pcb; pcb.example('strip'); const d = pcb.get(); d.notes = []; pcb.load(d); pcb.layout('design'); pcb.work('board'); });
    await p.click('#vCu');
    await p.click('#zFit');
    await p.waitForTimeout(400);
  }],
  // program: blokkok nagyban, a panel mellette
  ['program', async p => {
    await p.evaluate(() => { const pcb = window.pcb; pcb.example('prog-dimmer'); pcb.layout('prog'); pcb.work('split'); pcb.sides('r', true); pcb.split(0.42); });
    await p.waitForTimeout(300);
    await p.click('#progView button:has-text("Mind"), #progView button:has-text("All")').catch(() => {});
    await p.waitForTimeout(400);
  }],
  // program és a generált kód
  ['code', async p => {
    await p.evaluate(() => { const pcb = window.pcb; pcb.example('prog-chase'); pcb.layout('prog'); pcb.work('prog'); pcb.pvTab('code'); });
    await p.click('#codeView [data-lang="arduino"]').catch(() => {});
    await p.waitForTimeout(500);
  }],
  // alkatrész-szerkesztő: a potméter működése
  ['editor', async p => {
    await p.evaluate(() => { const pcb = window.pcb; pcb.example('custom-xor'); pcb.openEditor(Object.keys(pcb.get().customParts)[0]); pcb.sides('l', true); pcb.sides('r', true); });
    await p.waitForTimeout(300);
    await p.click('[data-tab="func"]').catch(() => {});
    await p.waitForTimeout(500);
  }],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  for (const lang of ['hu', 'en']) {
    for (const [name, prep] of SHOTS) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: lang === 'hu' ? 'hu-HU' : 'en-GB', colorScheme: 'light', serviceWorkers: 'block' });
      const p = await ctx.newPage();
      await p.goto(URL); await p.waitForFunction(() => !!window.pcb);
      await p.evaluate(l => window.pcb.lang(l), lang);
      await prep(p);
      await p.mouse.move(1430, 890);
      await p.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.hidden = true; });
      await p.screenshot({ path: path.join(OUT, `${name}-${lang}.jpg`), type: 'jpeg', quality: 80 });
      if (name === 'hero') { await p.setViewportSize({ width: 1200, height: 630 }); await p.waitForTimeout(400); await p.screenshot({ path: path.join(OUT, `og-${lang}.jpg`), type: 'jpeg', quality: 82 }); }
      await ctx.close();
    }
  }
  await b.close();
  for (const f of fs.readdirSync(OUT)) console.log(f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' kB');
})();
