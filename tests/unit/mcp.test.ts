import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createProofboardServer } from '../../mcp/src/server';
import { connectBridge, type BridgeState } from '../../src/agent/bridge';
import type { ToolResult } from '../../src/agent/tools';

const until = async (f: () => boolean, ms = 3000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 10)); } };
const closers: Array<() => unknown> = [];
afterEach(async () => { for (const c of closers.splice(0)) await c(); });

async function server(o: Partial<Parameters<typeof createProofboardServer>[0]> = {}) {
  const S = createProofboardServer({ version: 'test', port: 0, ...o });
  const port = await S.listen(); closers.push(() => S.close());
  return { S, port: port! };
}
function app(port: number, exec: (n: string, i: Record<string, unknown>) => Promise<ToolResult>) {
  const states: BridgeState[] = [];
  const c = connectBridge(`ws://127.0.0.1:${port}`, { exec, hello: () => ({ version: '9.9', design: 'teszt' }), onState: s => states.push(s) }, { retryMs: 50 });
  closers.push(() => c.close());
  return { c, states };
}

describe('MCP-szerver', () => {
  it('felület nélkül: memóriabeli terven dolgozik; eszközlista; fájlba mentés és megnyitás', async () => {
    const { S } = await server();
    expect(S.tools()).toEqual(expect.arrayContaining(['bridge_status', 'open_design_file', 'save_design_file', 'place_part', 'compact_layout']));
    expect((await S.call('bridge_status', {})).text).toMatch(/not connected: you are working on an in-memory design/);
    expect((await S.call('place_part', { type: 'led', row: 5, col: 5 })).text).toMatch(/^Placed LED1/);
    const dir = mkdtempSync(join(tmpdir(), 'pb-')), f = join(dir, 'a.json');
    expect((await S.call('save_design_file', { path: f })).text).toMatch(/^Saved to/);
    expect(JSON.parse(readFileSync(f, 'utf8')).parts[0].label).toBe('LED1');
    await S.call('new_design', {});
    expect(S.headless.D().parts.length).toBe(0);
    expect((await S.call('open_design_file', { path: f })).text).toMatch(/1 parts/);
    expect(S.headless.D().parts[0].label).toBe('LED1');
    expect((await S.call('open_design_file', { path: join(dir, 'nincs.json') })).isError).toBe(true);
  });

  it('élő híd: a hívás az appban fut; az app leválasztásakor visszaáll felület nélkülire', async () => {
    const { S, port } = await server();
    const calls: string[] = [];
    const a = app(port, async (n, i) => { calls.push(n + JSON.stringify(i)); return { text: 'app: ' + n, changed: n === 'place_part' }; });
    await until(() => S.connected() && a.c.state() === 'connected');
    expect((await S.call('bridge_status', {})).text).toMatch(/Connected to the Proofboard app \(Proofboard 9\.9, design: teszt\)/);
    expect((await S.call('place_part', { type: 'res' })).text).toBe('app: place_part');
    expect(calls).toEqual(['place_part{"type":"res"}']);
    expect(S.headless.D().parts.length).toBe(0); // nem a memóriabeli terven
    a.c.close();
    await until(() => !S.connected());
    expect((await S.call('place_part', { type: 'res', row: 9, col: 9 })).text).toMatch(/^Placed R1/);
  });

  it('a hívások sorban futnak; az app hibája hibaként jön vissza; lassú app: időtúllépés', async () => {
    const { S, port } = await server({ callTimeout: 300 });
    const order: string[] = [];
    const a = app(port, async n => {
      if (n === 'boom') throw new Error('kaboom');
      if (n === 'slow') await new Promise(r => setTimeout(r, 600));
      order.push(n); return { text: n };
    });
    await until(() => S.connected() && a.c.state() === 'connected');
    const [x, y] = await Promise.all([S.call('get_design', {}), S.call('get_problems', {})]);
    expect([x.text, y.text]).toEqual(['get_design', 'get_problems']);
    expect(order).toEqual(['get_design', 'get_problems']);
    const b = await S.call('boom', {});
    expect(b.isError).toBe(true); expect(b.text).toMatch(/kaboom/);
    const s = await S.call('slow', {});
    expect(s.isError).toBe(true); expect(s.text).toMatch(/did not answer in time/);
  });

  it('idegen oldal nem kapcsolódhat; új lap átveszi a kapcsolatot', async () => {
    const { S, port } = await server();
    const bad = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'https://evil.example' });
    const res = await new Promise<string>(r => { bad.on('open', () => r('open')); bad.on('error', () => r('error')); bad.on('unexpected-response', () => r('rejected')); });
    expect(res).not.toBe('open');
    const ok = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'https://nemalsomel.github.io' });
    await new Promise(r => ok.on('open', r)); ok.close();
    const a1 = app(port, async () => ({ text: 'egy' }));
    await until(() => a1.c.state() === 'connected');
    const a2 = app(port, async () => ({ text: 'kettő' }));
    await until(() => a2.c.state() === 'connected' && a1.c.state() === 'off');
    expect((await S.call('get_design', {})).text).toBe('kettő');
  });

  it('MCP-protokollon: eszközlista, hívás szöveggel; az app kép-eredménye képként megy', async () => {
    const { S, port } = await server();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'teszt-kliens', version: '1' });
    await Promise.all([S.mcp.connect(st), client.connect(ct)]);
    closers.push(() => client.close());
    const { tools } = await client.listTools();
    expect(tools.find(t => t.name === 'place_part')!.inputSchema.required).toEqual(['type']);
    let r = await client.callTool({ name: 'place_part', arguments: { type: 'led', row: 3, col: 3 } });
    expect((r.content as Array<{ text: string }>)[0].text).toMatch(/^Placed LED1/);
    // az app megkapja a kliens nevét
    let info: { client?: string } = {};
    const c = connectBridge(`ws://127.0.0.1:${port}`, { exec: async () => ({ text: 'kép', image: 'AAAA' }), hello: () => ({ version: '1', design: 'x' }), onState: (_, i) => { info = i; } }, { retryMs: 50 });
    closers.push(() => c.close());
    await until(() => info.client === 'teszt-kliens');
    r = await client.callTool({ name: 'get_board_image', arguments: {} });
    expect((r.content as Array<{ type: string }>).map(x => x.type)).toEqual(['text', 'image']);
  });
});
