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
const BOOKING_DAY = process.env.BOOKING_DAY || 'Tuesday';

/** Time slot label to click (e.g. "8:00 p.m."). Override with BOOKING_TIME in .env. */
const BOOKING_TIME = process.env.BOOKING_TIME || '8:00 p.m.';

/** When true, don't submit the form; just navigate as if booking succeeded. */
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';

/** How long to keep retrying when the day isn't available yet (ms). */
const DAY_RETRY_DEADLINE_MS = 5 * 60 * 1000;

/** Wait and refresh when the day link is missing (ms). */
const DAY_RETRY_WAIT_MS = 3000;

/**
 * Runs the booking flow on the given page. Tries to book up to courtCount courts in priority order.
 * If the day of the week isn't on the page yet, waits 3s, refreshes, and retries for up to 5 minutes.
 * @param {import('playwright').Page} page - Playwright page (from script or test)
 * @param {number} courtCount - Number of courts to book. Courts are tried in COURT_PRIORITY_ORDER; after each successful booking, continues to the next until courtCount is reached.
 */
export async function runBookingFlow(page, courtCount) {
  const deadline = Date.now() + DAY_RETRY_DEADLINE_MS;
  const courtsToTry = COURT_PRIORITY_ORDER;
  const dayRegex = new RegExp(`${BOOKING_DAY}.*\\d{4}`);
  let bookedCount = 0;

  while (Date.now() < deadline) {
    console.log(
      `[book-courts] Starting booking loop. DRY_RUN=${DRY_RUN}, courtCount=${courtCount}, alreadyBooked=${bookedCount}`,
    );
    await page.goto(BOOKING_URL, { waitUntil: 'networkidle' });
    console.log(`[book-courts] Landed on booking URL: ${BOOKING_URL}`);

    let dayNotVisible = false;

    for (const courtNum of courtsToTry) {
      if (bookedCount >= courtCount) break;
      const courtLabel = `Squash - court ${courtNum}`;
      const courtLink = page.getByRole('link', { name: courtLabel });

      console.log(`[book-courts] Trying court ${courtNum} (${courtLabel})`);
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

      console.log(
        `[book-courts] Found day link matching /${BOOKING_DAY}.*\\d{4}/, clicking it…`,
      );
      await dayOption.click();
      await page.waitForLoadState('networkidle');

      // Find time slot: text may be in a child (e.g. <a><span>3:00 p.m.</span></a>), so find by text then get the link
      const timeLabelRegex = new RegExp(
        `^${BOOKING_TIME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      );
      console.log(
        `[book-courts] Looking for time slot starting with "${BOOKING_TIME}"…`,
      );
      const timeSlot = page
        .getByText(timeLabelRegex)
        .locator('xpath=ancestor::a[1]')
        .first();
      const isUnavailable = await timeSlot
        .evaluate((el) => {
          const parent = el.parentElement;
          if (!parent) return false;
          return (
            parent.classList.contains('reserved') ||
            parent.getAttribute('aria-hidden') === 'true'
          );
        })
        .catch(() => false);
      if (isUnavailable) {
        console.log(
          `[book-courts] Court ${courtNum}: ${BOOKING_TIME} is taken, trying next court.`,
        );
        await page.goto(BOOKING_URL, { waitUntil: 'networkidle' });
        continue;
      }
      console.log(
        `[book-courts] Time slot appears available on court ${courtNum}, clicking it…`,
      );
      // Click via getByRole (works when slot is available and not aria-hidden)
      await page.getByRole('link', { name: timeLabelRegex }).first().click();
      await page.waitForLoadState('networkidle');

      if (DRY_RUN) {
        console.log(
          `[book-courts] DRY_RUN=true: would book Squash - court ${courtNum} at ${BOOKING_TIME} (skipping contact details and confirmation).`,
        );
      } else {
        console.log('[book-courts] Filling contact form with env values…');
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

        console.log('[book-courts] Submitting confirmation buttons…');
        await page.getByRole('button', { name: /confirm/i }).click();
        await page.getByRole('button', { name: /final confirmation/i }).click();

        console.log(
          `[book-courts] Booked Squash - court ${courtNum} at ${BOOKING_TIME}`,
        );
      }
      bookedCount++;
      console.log(
        `[book-courts] Finished booking attempt for court ${courtNum}. bookedCount=${bookedCount}/${courtCount}`,
      );
      if (bookedCount >= courtCount) {
        console.log('[book-courts] Reached requested courtCount, stopping.');
        return;
      }
      console.log('[book-courts] Returning to start page to try next court…');
      await page.goto(BOOKING_URL, { waitUntil: 'networkidle' });
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
  } else if (bookedCount === 0) {
    console.log(
      `[book-courts] No court had ${BOOKING_TIME} available in priority order.`,
    );
  } else {
    console.log(
      `[book-courts] Booked ${bookedCount} court(s); no more had ${BOOKING_TIME} available.`,
    );
  }
}
