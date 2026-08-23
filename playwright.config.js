// @ts-check
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from 'playwright/test';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(rootDir, '.env') });

export default defineConfig({
  testDir: 'tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL:
      process.env.BOOKING_URL ||
      'https://reservation.frontdesksuite.ca/rcfs/bobmacquarrie',
    trace: 'on-first-retry',
    headless: false,
    viewport: { width: 1280, height: 1680 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 1680 },
      },
    },
  ],
});
