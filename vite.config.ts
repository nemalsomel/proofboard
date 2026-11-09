import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
const version = pkg.version + (sha ? '+' + sha : '');

/**
 * Telepíthető, offline is működő alkalmazás (PWA). A service workert az app maga regisztrálja (`src/ui/pwa.ts`),
 * új verziónál értesítést ad, és csak a felhasználó kérésére frissül (a nyitott munka nem vész el).
 */
const pwa = VitePWA({
  registerType: 'prompt',
  injectRegister: false,
  includeAssets: ['icon.svg', 'apple-touch-icon.png'],
  manifest: {
    name: 'Proofboard – próbanyák-tervező',
    short_name: 'Proofboard',
    description: pkg.description,
    lang: 'hu',
    start_url: './',
    scope: './',
    display: 'standalone',
    theme_color: '#0f5c66',
    background_color: '#e9ece6',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
    cleanupOutdatedCaches: true,
    // a Claude Desktop-bővítmény letöltése a hálózatról menjen, ne az app oldala jöjjön helyette
    navigateFallbackDenylist: [/\.mcpb$/],
    // a betűtípusok a Google Fonts-ról: első használat után offline is megvannak
    runtimeCaching: [
      { urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/, handler: 'StaleWhileRevalidate', options: { cacheName: 'google-fonts-css' } },
      { urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/, handler: 'CacheFirst', options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } } },
    ],
  },
});

// Normál build: GitHub Pages alá (https://<user>.github.io/proofboard/), PWA-val.
// `--mode single`: egyetlen önálló HTML-fájl (artifact-előnézethez, offline használatra), service worker nélkül.
export default defineConfig(({ mode }) => ({
  base: mode === 'single' ? './' : process.env.PAGES_BASE ?? '/proofboard/',
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
  plugins: mode === 'single' ? [viteSingleFile()] : [pwa],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist', target: 'es2022' },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
}));
