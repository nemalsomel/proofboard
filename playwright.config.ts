import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: 'http://localhost:4173/proofboard/', viewport: { width: 1500, height: 1000 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1500, height: 1000 } } }],
  webServer: { command: 'npm run preview', url: 'http://localhost:4173/proofboard/', reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
