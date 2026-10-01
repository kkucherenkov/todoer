import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const port = 3010;

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for the web e2e suite`);
  return value;
};

export default defineConfig({
  testDir: 'e2e',
  // One backend, per-IP auth budgets (fixtures.ts): one worker, so the owner
  // logs in once per project, not once per file.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  // `localhost`, never 127.0.0.1: only the name is a secure context for the
  // Secure cookie in every engine that runs here.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } }, // departure 8
  ],
  webServer: {
    command: 'node ../backend/dist/main.js',
    url: `http://localhost:${port}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(port),
      WEB_ROOT: fileURLToPath(new URL('./.output/public', import.meta.url)),
      DATABASE_URL: required('DATABASE_URL'),
      JWT_SECRET: required('JWT_SECRET'),
    },
  },
});
