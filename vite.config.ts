import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json' with { type: 'json' };

const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
const version = pkg.version + (sha ? '+' + sha : '');

// Normál build: GitHub Pages alá (https://<user>.github.io/proofboard/).
// `--mode single`: egyetlen önálló HTML-fájl (artifact-előnézethez, offline használatra).
export default defineConfig(({ mode }) => ({
  base: mode === 'single' ? './' : process.env.PAGES_BASE ?? '/proofboard/',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist', target: 'es2022' },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
}));
