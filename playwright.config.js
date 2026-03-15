// @ts-check
import { defineConfig, devices } from 'playwright/test';

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
    viewport: { width: 1280, height: 3600 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 2400 },
      },
    },
  ],
});
