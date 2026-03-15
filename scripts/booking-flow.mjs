/**
 * Shared booking flow used by both the app (book-courts.mjs) and the Playwright UI test.
 * Edit this file to implement your site-specific booking steps.
 *
 * 1. Set BOOKING_URL and any login/selectors below
 * 2. Implement login if required
 * 3. Navigate to booking, select date/time, and book courtCount courts
 */

const BOOKING_URL =
  process.env.BOOKING_URL ||
  'https://reservation.frontdesksuite.ca/rcfs/bobmacquarrie';

/**
 * Runs the booking flow on the given page. Used by the Discord bot script and by the UI test.
 * @param {import('playwright').Page} page - Playwright page (from script or test)
 * @param {number} courtCount - Number of courts to book
 */
export async function runBookingFlow(page, courtCount) {
  await page.goto(BOOKING_URL, { waitUntil: 'networkidle' });

  // Example: if your site has a login form
  // await page.fill('#username', process.env.BOOKING_USER);
  // await page.fill('#password', process.env.BOOKING_PASSWORD);
  // await page.click('button[type="submit"]');
  // await page.waitForURL(/dashboard|book/);

  // Example: select number of courts (adjust selectors to your site)
  // await page.selectOption('#courts', String(courtCount));
  // await page.click('button:has-text("Book")');

  console.log(
    `[book-courts] Would book ${courtCount} court(s) at ${BOOKING_URL}`,
  );
  console.log(
    '[book-courts] Edit scripts/booking-flow.mjs with your real booking steps.',
  );
}
