// Claude Desktop-bővítmény (.mcpb) a proofboard-mcp-ből: egy kattintással telepíthető (Node.js-t a Claude adja).
// Kimenet: mcp/dist/proofboard.mcpb, és ha van webes build, a dist/proofboard.mcpb (az app innen kínálja letöltésre).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { packExtension } from '@anthropic-ai/mcpb';
const here = p => fileURLToPath(new URL(p, import.meta.url));
const pkg = JSON.parse(readFileSync(here('./package.json'), 'utf8'));
const tools = JSON.parse(readFileSync(here('./dist/tools.json'), 'utf8'));
const stage = here('./dist/mcpb'), out = here('./dist/proofboard.mcpb');
rmSync(stage, { recursive: true, force: true }); mkdirSync(stage + '/server', { recursive: true });
copyFileSync(here('./dist/proofboard-mcp.mjs'), stage + '/server/index.mjs');
copyFileSync(here('../public/icon-512.png'), stage + '/icon.png');
cpSync(here('./README.md'), stage + '/README.md');
const first = s => (s.match(/^.*?[.!?](\s|$)/) || [s])[0].trim();
const manifest = {
  $schema: 'https://raw.githubusercontent.com/anthropics/mcpb/main/schemas/mcpb-manifest-v0.3.schema.json',
  manifest_version: '0.3',
  name: 'proofboard',
  display_name: 'Proofboard',
  version: pkg.version,
  description: 'Design and check perfboard / stripboard circuits with Claude – live in the Proofboard web app.',
  long_description: 'Claude places parts, connects pins (wiring is routed automatically), compacts the layout, simulates, checks problems and generates firmware code. Open https://nemalsomel.github.io/proofboard/ and choose File › Claude connection… › Connect to see the changes live (each working session is one undo step); without the app Claude works on an in-memory design that it can save to a file.',
  author: { name: 'nemalsomel', url: 'https://github.com/nemalsomel' },
  repository: { type: 'git', url: 'https://github.com/nemalsomel/proofboard' },
  homepage: 'https://nemalsomel.github.io/proofboard/',
  documentation: 'https://github.com/nemalsomel/proofboard/tree/main/mcp#readme',
  support: 'https://github.com/nemalsomel/proofboard/issues',
  icon: 'icon.png',
  server: {
    type: 'node',
    entry_point: 'server/index.mjs',
    mcp_config: { command: 'node', args: ['${__dirname}/server/index.mjs', '--port', '${user_config.port}'] },
  },
  tools: tools.map(t => ({ name: t.name, description: first(t.description) })),
  keywords: ['electronics', 'perfboard', 'stripboard', 'circuit', 'raspberry pi pico', 'esp32', 'simulation'],
  license: 'MIT',
  compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=18.0.0' } },
  user_config: {
    port: { type: 'number', title: 'Bridge port', description: 'Local port the Proofboard app connects to (File › Claude connection… › Advanced). Change only if 47615 is taken.', default: 47615, min: 1024, max: 65535, required: false },
  },
};
writeFileSync(stage + '/manifest.json', JSON.stringify(manifest, null, 2));
rmSync(out, { force: true });
const ok = await packExtension({ extensionPath: stage, outputPath: out, silent: true });
if (!ok || !existsSync(out)) { console.error('mcpb pack FAILED'); process.exit(1); }
if (existsSync(here('../dist/index.html'))) copyFileSync(out, here('../dist/proofboard.mcpb'));
console.log('packed', out, existsSync(here('../dist/index.html')) ? '(+ dist/proofboard.mcpb)' : '');
