import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, fromB64url, shareCode, shareUrl, toB64url } from '../../src/core/share';
import { emptyDesign } from '../../src/engine/design';
import { engineCtx, runTool } from '../../src/agent/tools';

describe('megosztás linkkel', () => {
  it('base64url oda-vissza, minden bájttal', () => {
    const b = new Uint8Array(70000).map((_, i) => (i * 131) & 255);
    const s = toB64url(b);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect([...fromB64url(s)]).toEqual([...b]);
  });

  it('a terv oda-vissza változatlan; a link tömörebb a JSON-nál', async () => {
    const d = emptyDesign(); d.brief = 'Teszt – ékezetes szöveg: árvíztűrő tükörfúrógép ✓';
    for (let i = 0; i < 40; i++) d.parts.push({ id: 'p' + i, type: 'res', label: 'R' + i, r: 2 + i, c: 3, rot: 0, params: { ohm: 330 } } as never);
    const code = await encodeShare(d);
    expect(code.startsWith('1.')).toBe(true);
    expect(code.length).toBeLessThan(JSON.stringify(d).length / 3);
    expect(await decodeShare(code)).toEqual(JSON.parse(JSON.stringify(d)));
  });

  it('a link # része: más paraméterek mellett is megtalálja; hibás és ismeretlen változat hiba', async () => {
    const u = await shareUrl('https://x.test/app/#régi', { a: 1 });
    expect(u.startsWith('https://x.test/app/#d=1.')).toBe(true);
    expect(await decodeShare(shareCode(u)!)).toEqual({ a: 1 });
    expect(shareCode('#foo=1&d=1.abc')).toBe('1.abc');
    expect(shareCode('https://x.test/app/')).toBeNull();
    await expect(decodeShare('9.abc')).rejects.toThrow(/version/);
    await expect(decodeShare('1.$$')).rejects.toThrow();
    const long = await encodeShare({ text: 'x'.repeat(5000), n: [1, 2, 3] });
    await expect(decodeShare(long.slice(0, long.length - 4))).rejects.toThrow();
  });

  it('agent: get_share_link → open_share_link visszaadja ugyanazt a tervet', async () => {
    const ctx = engineCtx(emptyDesign());
    await runTool(ctx, 'place_part', { type: 'pico', row: 2, col: 2 });
    await runTool(ctx, 'place_part', { type: 'led', near_row: 40, near_col: 30 });
    const before = JSON.stringify(ctx.D().parts);
    const r = await runTool(ctx, 'get_share_link', {});
    expect(r.isError).toBeFalsy();
    const url = r.text.split('\n')[0];
    expect(url.startsWith('https://nemalsomel.github.io/proofboard/#d=1.')).toBe(true);
    const ctx2 = engineCtx(emptyDesign());
    const o = await runTool(ctx2, 'open_share_link', { url });
    expect(o.isError).toBeFalsy(); expect(o.changed).toBe(true);
    expect(JSON.stringify(ctx2.D().parts)).toBe(before);
    expect((await runTool(ctx2, 'open_share_link', { url: 'https://example.com/' })).isError).toBe(true);
  });
});
