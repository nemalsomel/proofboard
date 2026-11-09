import { describe, expect, it } from 'vitest';
import { API_URL, errorOf, repairHistory, runAgent, type AgentEvent, type Message } from '../../src/agent/client';
import { emptyDesign } from '../../src/engine/design';
import { engineCtx, runTool, toolSpecs } from '../../src/agent/tools';

/** Hamis API: a forgatókönyv válaszait adja sorban, a kéréseket megjegyzi. */
function fakeApi(replies: Array<object | ((body: Record<string, unknown>) => object) | { status: number; body: string }>) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(JSON.stringify(body)) });
    const r = replies.shift(); if (!r) throw new Error('no more replies');
    if ('status' in r && typeof (r as { status: unknown }).status === 'number') { const x = r as { status: number; body: string }; return new Response(x.body, { status: x.status }); }
    const j = typeof r === 'function' ? r(body) : r;
    return new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const toolUse = (id: string, name: string, input: object) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 20 } });
const text = (t: string) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 10 } });

describe('agent-ciklus (Messages API)', () => {
  it('eszközhívások a végéig: a kérés fejlécei, a terv módosul, a beszélgetés bővül', async () => {
    const ctx = engineCtx(emptyDesign());
    const { f, calls } = fakeApi([
      { content: [{ type: 'text', text: 'Lerakom.' }, { type: 'tool_use', id: 't1', name: 'place_part', input: { type: 'res', row: 10, col: 10 } }], stop_reason: 'tool_use' },
      toolUse('t2', 'place_part', { type: 'led', row: 10, col: 20 }),
      text('Kész: R1 és LED1.'),
    ]);
    const msgs: Message[] = [{ role: 'user', content: 'Tegyél le egy ellenállást és egy LED-et.' }], ev: AgentEvent[] = [];
    const r = await runAgent({ apiKey: 'sk-test', model: 'm', system: 'S', tools: toolSpecs('build'), messages: msgs, exec: (n, i) => runTool(ctx, n, i), onEvent: e => ev.push(e), fetch: f });
    expect(r).toEqual({ ok: true, reason: 'end_turn' });
    expect(calls.length).toBe(3);
    expect(calls[0].url).toBe(API_URL);
    expect(calls[0].headers['x-api-key']).toBe('sk-test');
    expect(calls[0].headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect((calls[0].body.system as Array<{ cache_control?: object }>)[0].cache_control).toEqual({ type: 'ephemeral' });
    const tl = calls[0].body.tools as Array<{ cache_control?: object }>; expect(tl[tl.length - 1].cache_control).toEqual({ type: 'ephemeral' });
    // a második kérésben ott az első eszköz eredménye
    const m2 = calls[1].body.messages as Message[];
    expect(m2.length).toBe(3);
    expect(JSON.stringify(m2[2])).toMatch(/"tool_use_id":"t1".*Placed R1/);
    expect(ctx.D().parts.map(p => p.label)).toEqual(['R1', 'LED1']);
    expect(msgs.length).toBe(6); // user, asst, results, asst, results, asst
    expect(ev.filter(e => e.kind === 'text').map(e => (e as { text: string }).text)).toEqual(['Lerakom.', 'Kész: R1 és LED1.']);
    expect(ev.filter(e => e.kind === 'tool').length).toBe(2);
    expect(ev[ev.length - 1]).toEqual({ kind: 'done', reason: 'end_turn' });
  });

  it('hibás eszközhívás: a modell hibaüzenetet kap (is_error), a ciklus folytatódik', async () => {
    const ctx = engineCtx(emptyDesign());
    const { f, calls } = fakeApi([toolUse('t1', 'place_part', { type: 'nincs' }), text('Nincs ilyen alkatrész.')]);
    await runAgent({ apiKey: 'k', model: 'm', system: 'S', tools: toolSpecs('build'), messages: [{ role: 'user', content: 'x' }], exec: (n, i) => runTool(ctx, n, i), fetch: f });
    const res = (calls[1].body.messages as Message[])[2].content as Array<{ is_error?: boolean }>;
    expect(res[0].is_error).toBe(true);
  });

  it('panelkép: a kép blokkként megy vissza', async () => {
    const ctx = engineCtx(emptyDesign(), { snapshot: () => 'iVBORw0KGgo=' });
    const { f, calls } = fakeApi([toolUse('t1', 'get_board_image', {}), text('Látom.')]);
    await runAgent({ apiKey: 'k', model: 'm', system: 'S', tools: toolSpecs('build'), messages: [{ role: 'user', content: 'x' }], exec: (n, i) => runTool(ctx, n, i), fetch: f });
    const c = ((calls[1].body.messages as Message[])[2].content as Array<{ content: Array<{ type: string; source?: { data: string } }> }>)[0].content;
    expect(c.map(x => x.type)).toEqual(['text', 'image']);
    expect(c[1].source!.data).toBe('iVBORw0KGgo=');
  });

  it('HTTP-hibák érthető kóddal; hálózati hiba; lépéskorlát; megszakítás', async () => {
    expect(errorOf(401, '{"error":{"type":"authentication_error","message":"invalid x-api-key"}}')).toEqual({ code: 'auth', message: 'invalid x-api-key', status: 401 });
    expect(errorOf(429, '').code).toBe('rate');
    expect(errorOf(529, '').code).toBe('overloaded');
    expect(errorOf(400, '{"error":{"message":"Your credit balance is too low"}}').code).toBe('billing');
    expect(errorOf(400, '{"error":{"message":"messages: bad"}}').code).toBe('api');
    const ev: AgentEvent[] = [];
    let r = await runAgent({ apiKey: 'k', model: 'm', system: 'S', tools: [], messages: [{ role: 'user', content: 'x' }], exec: async () => ({ text: '' }), onEvent: e => ev.push(e), fetch: fakeApi([{ status: 401, body: '{"error":{"message":"invalid x-api-key"}}' }]).f });
    expect(r.reason).toBe('auth');
    r = await runAgent({ apiKey: 'k', model: 'm', system: 'S', tools: [], messages: [{ role: 'user', content: 'x' }], exec: async () => ({ text: '' }), fetch: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch });
    expect(r.reason).toBe('network');
    const loop = fakeApi(Array.from({ length: 5 }, (_, i) => toolUse('t' + i, 'get_design', {})));
    r = await runAgent({ apiKey: 'k', model: 'm', system: 'S', tools: toolSpecs(), messages: [{ role: 'user', content: 'x' }], exec: async () => ({ text: 'ok' }), maxSteps: 3, fetch: loop.f });
    expect(r.reason).toBe('steps'); expect(loop.calls.length).toBe(3);
    const ac = new AbortController(), ab = fakeApi([toolUse('t1', 'get_design', {}), text('x')]), msgs: Message[] = [{ role: 'user', content: 'x' }];
    r = await runAgent({ apiKey: 'k', model: 'm', system: 'S', tools: toolSpecs(), messages: msgs, exec: async () => { ac.abort(); return { text: 'ok' }; }, signal: ac.signal, fetch: ab.f });
    expect(r.reason).toBe('aborted'); expect(ab.calls.length).toBe(1);
    expect(msgs[msgs.length - 1].role).toBe('user'); // az eszközeredmény bekerült, a beszélgetés folytatható
  });

  it('a félbeszakadt eszközhívás pótlása, hogy a beszélgetés folytatható legyen', () => {
    const msgs: Message[] = [{ role: 'user', content: 'x' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'get_design', input: {} }] }];
    repairHistory(msgs);
    expect(msgs.length).toBe(3);
    expect(JSON.stringify(msgs[2])).toMatch(/"tool_use_id":"a".*"is_error":true/);
    repairHistory(msgs); expect(msgs.length).toBe(3);
  });
});
