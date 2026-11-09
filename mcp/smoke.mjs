// A megépített proofboard-mcp füstpróbája: stdio-n inicializálás, eszközlista, egy hívás (felület nélkül, híd nélkül).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
const p = spawn(process.execPath, [fileURLToPath(new URL('./dist/proofboard-mcp.mjs', import.meta.url)), '--no-bridge'], { stdio: ['pipe', 'pipe', 'inherit'] });
const send = o => p.stdin.write(JSON.stringify(o) + '\n');
let buf = ''; const got = new Map();
p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); const m = JSON.parse(l); if (m.id) got.set(m.id, m); } });
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } });
send({ jsonrpc: '2.0', method: 'notifications/initialized' });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'place_part', arguments: { type: 'led', row: 5, col: 5 } } });
const t0 = Date.now();
while (got.size < 3 && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
p.kill();
const n = got.get(2)?.result?.tools?.length, txt = got.get(3)?.result?.content?.[0]?.text || '';
if (!(n > 20) || !/^Placed LED1/.test(txt)) { console.error('proofboard-mcp smoke FAILED', { n, txt }); process.exit(1); }
// az eszközlista a .mcpb leírásához (mcp/pack-mcpb.mjs)
writeFileSync(fileURLToPath(new URL('./dist/tools.json', import.meta.url)), JSON.stringify(got.get(2).result.tools.map(t => ({ name: t.name, description: t.description }))));
console.log(`proofboard-mcp smoke ok: ${n} tools, "${txt.slice(0, 40)}…"`);
