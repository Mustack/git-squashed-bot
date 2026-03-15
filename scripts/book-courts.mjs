/**
 * User-editable Playwright script to book courts on your squash website.
 * Receives COURT_COUNT from the Discord bot (number of people who reacted).
 *
 * Customize this script for your booking site:
 * 1. Set BOOKING_URL and any login/selectors below
 * 2. Implement login if required
 * 3. Navigate to booking, select date/time, and book COURT_COUNT courts
 */
import { chromium } from 'playwright';

const COURT_COUNT = parseInt(process.env.COURT_COUNT || '1', 10) || 1;

// --- Bob MacQuarrie Recreation Complex (Ottawa) ---
const BOOKING_URL = process.env.BOOKING_URL || 'https://reservation.frontdesksuite.ca/rcfs/bobmacquarrie';
const HEADLESS = process.env.HEADLESS !== 'false';

async function main() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(BOOKING_URL, { waitUntil: 'networkidle' });

    // Example: if your site has a login form
    // await page.fill('#username', process.env.BOOKING_USER);
    // await page.fill('#password', process.env.BOOKING_PASSWORD);
    // await page.click('button[type="submit"]');
    // await page.waitForURL(/dashboard|book/);

    // Example: select number of courts (adjust selectors to your site)
    // await page.selectOption('#courts', String(COURT_COUNT));
    // await page.click('button:has-text("Book")');

    console.log(`[book-courts] Would book ${COURT_COUNT} court(s) at ${BOOKING_URL}`);
    console.log('[book-courts] Replace this script with your real booking steps.');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
