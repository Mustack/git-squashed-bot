/**
 * Shared booking flow used by both the app (book-courts.mjs) and the Playwright UI test.
 * Tries courts in priority order; fills contact details from env; confirms booking.
 */

const BOOKING_URL =
  process.env.BOOKING_URL ||
  'https://reservation.frontdesksuite.ca/rcfs/bobmacquarrie';

/** Court numbers to try in order (squash courts at Bob MacQuarrie). */
const COURT_PRIORITY_ORDER = [1, 2, 3, 5, 7, 9];

/** Day of week to book (e.g. "Tuesday"). Override with BOOKING_DAY in .env. */
const BOOKING_DAY = process.env.BOOKING_DAY || 'Monday';

/** Time slot label to click (e.g. "8:00 p.m."). Override with BOOKING_TIME in .env. */
const BOOKING_TIME = process.env.BOOKING_TIME || '3:00 p.m.';

/** How long to keep retrying when the day isn't available yet (ms). */
const DAY_RETRY_DEADLINE_MS = 5 * 60 * 1000;

/** Wait and refresh when the day link is missing (ms). */
const DAY_RETRY_WAIT_MS = 3000;

/**
 * Runs the booking flow on the given page. Tries courts in priority order until one has the time slot available.
 * If the day of the week isn't on the page yet, waits 3s, refreshes, and retries for up to 5 minutes.
 * @param {import('playwright').Page} page - Playwright page (from script or test)
 * @param {number} courtCount - Number of courts to book (currently one booking per run; order is still used to pick which court to try first)
 */
export async function runBookingFlow(page, courtCount) {
  const deadline = Date.now() + DAY_RETRY_DEADLINE_MS;
  const courtsToTry = COURT_PRIORITY_ORDER.slice(0, Math.max(1, courtCount));
  const dayRegex = new RegExp(`${BOOKING_DAY}.*\\d{4}`);

  while (Date.now() < deadline) {
    await page.goto(BOOKING_URL, { waitUntil: 'networkidle' });

    let dayNotVisible = false;

    for (const courtNum of courtsToTry) {
      const courtLabel = `Squash - court ${courtNum}`;
      const courtLink = page.getByRole('link', { name: courtLabel });

      await courtLink.click();
      await page.waitForLoadState('networkidle');

      // If the day isn't on the page yet (reservations not open), wait 3s, refresh, and restart
      const dayOption = page.getByRole('link', { name: dayRegex }).first();
      const dayVisible = await dayOption.isVisible().catch(() => false);
      if (!dayVisible) {
        console.log(
          `[book-courts] ${BOOKING_DAY} not yet available, waiting ${DAY_RETRY_WAIT_MS / 1000}s and retrying...`,
        );
        await page.waitForTimeout(DAY_RETRY_WAIT_MS);
        dayNotVisible = true;
        break;
      }

      await dayOption.click();
      await page.waitForLoadState('networkidle');

      // Click time slot; label starts with the time but may have more text
      const timeLabelRegex = new RegExp(
        `^${BOOKING_TIME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      );
      const timeSlot = page.getByRole('link', { name: timeLabelRegex }).first();
      const isDisabled = await timeSlot
        .evaluate(
          (el) =>
            el.hasAttribute('disabled') ||
            el.getAttribute('aria-disabled') === 'true',
        )
        .catch(() => false);
      if (isDisabled) {
        console.log(
          `[book-courts] Court ${courtNum}: ${BOOKING_TIME} is taken, trying next court.`,
        );
        await page.goto(BOOKING_URL, { waitUntil: 'networkidle' });
        continue;
      }
      await timeSlot.click();
      await page.waitForLoadState('networkidle');

      // Contact details from env
      const phone = process.env.BOOKING_PHONE ?? '';
      const email = process.env.BOOKING_EMAIL ?? '';
      const name = process.env.BOOKING_NAME ?? '';
      if (!phone || !email || !name) {
        throw new Error(
          'Set BOOKING_PHONE, BOOKING_EMAIL, and BOOKING_NAME in .env for the booking form.',
        );
      }

      await page.getByLabel(/phone number/i).fill(phone);
      await page.getByLabel(/email address/i).fill(email);
      await page.getByLabel(/name/i).fill(name);

      await page.getByRole('button', { name: /confirm/i }).click();
      await page.getByRole('button', { name: /final confirmation/i }).click();

      console.log(
        `[book-courts] Booked Squash - court ${courtNum} at ${BOOKING_TIME}`,
      );
      return;
    }

    // Exited court loop: if day wasn't visible we retry the while; otherwise we tried all courts
    if (!dayNotVisible) {
      break;
    }
  }

  if (Date.now() >= deadline) {
    console.log(
      `[book-courts] ${BOOKING_DAY} did not appear within 5 minutes; reservations may not be open yet.`,
    );
  } else {
    console.log(
      `[book-courts] No court had ${BOOKING_TIME} available in priority order.`,
    );
  }
}
