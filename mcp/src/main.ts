/** Belépési pont: `proofboard-mcp [--port N] [--no-bridge] [--allow-origin URL]` – stdio MCP-szerver, a naplót a stderr-re írja. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BRIDGE_PORT } from '../../src/agent/bridge';
import { createProofboardServer } from './server';

declare const __MCP_VERSION__: string;
const args = process.argv.slice(2), arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes('--help') || args.includes('-h')) {
  process.stderr.write('proofboard-mcp [--port 47615] [--no-bridge] [--allow-origin https://example.org]\n');
  process.exit(0);
}
const port = args.includes('--no-bridge') ? null : Number(arg('--port') || process.env.PROOFBOARD_PORT || BRIDGE_PORT);
const origins = args.flatMap((a, i) => (a === '--allow-origin' && args[i + 1] ? [args[i + 1]] : []));
const S = createProofboardServer({ version: typeof __MCP_VERSION__ === 'string' ? __MCP_VERSION__ : 'dev', port, origins, log: s => process.stderr.write(`[proofboard] ${s}\n`) });
await S.listen();
await S.mcp.connect(new StdioServerTransport());
const bye = () => { void S.close().finally(() => process.exit(0)); };
process.on('SIGINT', bye); process.on('SIGTERM', bye); process.stdin.on('close', bye);
