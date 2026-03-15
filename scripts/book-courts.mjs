/**
 * Script the app runs to book courts (via src/run-booking.js).
 * Receives COURT_COUNT from the Discord bot (number of people who reacted).
 * The actual flow lives in booking-flow.mjs so the same logic runs in the UI test.
 */
import { chromium } from 'playwright';
import { runBookingFlow } from './booking-flow.mjs';

const COURT_COUNT = parseInt(process.env.COURT_COUNT || '1', 10) || 1;
const HEADLESS = process.env.HEADLESS !== 'false';

async function main() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await runBookingFlow(page, COURT_COUNT);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
