// A proofboard-mcp csomag építése: egyetlen, függőség nélküli ESM-fájl (mcp/dist/proofboard-mcp.mjs).
import { build } from 'esbuild';
import { readFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const out = fileURLToPath(new URL('./dist/proofboard-mcp.mjs', import.meta.url)); // Windowson is jó útvonal
await build({
  entryPoints: [fileURLToPath(new URL('./src/main.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', target: 'node18', outfile: out,
  define: { __MCP_VERSION__: JSON.stringify(pkg.version), __APP_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: 'none', logLevel: 'warning', minify: true,
});
chmodSync(out, 0o755);
console.log('built', out);
