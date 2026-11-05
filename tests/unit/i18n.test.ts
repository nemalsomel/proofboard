import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../../src/i18n/en';
import { detectLang, getLang, onLang, setLang, t } from '../../src/i18n/i18n';

const files = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []; });

describe('fordítás', () => {
  it('magyarul a forrásszöveg, angolul a szótár; ami hiányzik, magyar marad; {paraméter}', () => {
    expect(t('Napló', undefined, 'hu')).toBe('Napló');
    expect(t('Napló', undefined, 'en')).toBe('Log');
    expect(t('Ilyen nincs a szótárban', undefined, 'en')).toBe('Ilyen nincs a szótárban');
    expect(t('Verzió: {v} · {d}', { v: '1.0', d: '2026-11-05' }, 'en')).toBe('Version: 1.0 · 2026-11-05');
    expect(t('{x} és {y}', { x: 1 }, 'hu')).toBe('1 és {y}'); // hiányzó paraméter: a jel marad
  });
  it('nyelvváltás értesít; a kezdő nyelv a mentett, különben a böngészőé, végül magyar', () => {
    const seen: string[] = [], off = onLang(l => seen.push(l));
    setLang('en'); setLang('en'); setLang('hu'); off(); setLang('en'); setLang('hu');
    expect(seen).toEqual(['en', 'hu']);
    expect(getLang()).toBe('hu');
    expect(detectLang('en')).toBe('en');
    expect(detectLang(null, ['de-DE', 'en-GB'])).toBe('en');
    expect(detectLang('xx', ['fr'])).toBe('hu');
  });
  it('a statikus HTML és a kódbeli t(…) szövegek mind benne vannak az angol szótárban, a paraméterek egyeznek', () => {
    const keys = new Set<string>();
    const html = readFileSync('index.html', 'utf8').replace(/<(script|style|svg|textarea|code|pre|kbd)\b[\s\S]*?<\/\1>/g, '\u0000')
      .replace(/<([a-z]+)[^>]*data-i18n-skip[^>]*>[\s\S]*?<\/\1>/g, '\u0000');
    for (const m of html.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]*\p{L}[^"]*)"/gu)) keys.add(m[1].replace(/\s+/g, ' ').trim());
    for (const m of html.replace(/<[^>]+>/g, '\u0000').split('\u0000')) { const s = m.replace(/\s+/g, ' ').trim(); if (/\p{L}/u.test(s)) keys.add(s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')); }
    for (const f of files('src')) { if (f.includes('i18n')) continue; for (const m of readFileSync(f, 'utf8').matchAll(/\b(?:t|tr|N_)\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'")); }
    const miss = [...keys].filter(k => !(k in EN));
    expect(miss).toEqual([]);
    for (const [k, v] of Object.entries(EN)) expect([...v.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), k).toEqual([...k.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort());
  });
});
