// Browser tests (Playwright): `npm run build && npm run test:e2e`
const { defineConfig } = require('@playwright/test');

const PORT = process.env.E2E_PORT || '3101';

module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1, // one shared demo database: run the specs one after another
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', locale: 'de-DE' },
  webServer: {
    command: 'node e2e/start-server.js',
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { E2E_PORT: PORT },
  },
});
