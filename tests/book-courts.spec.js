/**
 * Playwright test that runs the same booking flow as the app (scripts/booking-flow.mjs).
 * Use npm run book:ui to test in the Playwright UI what the app will run.
 * Set COURT_COUNT in env to simulate different numbers of courts.
 */
import { test, expect } from 'playwright/test';
import { runBookingFlow } from '../scripts/booking-flow.mjs';

const COURT_COUNT = parseInt(process.env.COURT_COUNT || '1', 10) || 1;

test.describe('Court booking (same flow as app)', () => {
  test(`book ${COURT_COUNT} court(s)`, async ({ page }) => {
    await runBookingFlow(page, COURT_COUNT);
    await expect(page.getByText('Select an activity')).toBeVisible();
  });
});
