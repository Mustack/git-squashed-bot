/**
 * Shared booking flow used by both the app (book-courts.mjs) and the Playwright UI test.
 * Tries courts in priority order; fills contact details from env; confirms booking.
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
});

export const BOOKING_URL =
  process.env.BOOKING_URL ||
  'https://reservation.frontdesksuite.ca/rcfs/bobmacquarrie';

/** Court numbers to try in order (squash courts at Bob MacQuarrie). */
export const COURT_PRIORITY_ORDER = [1, 2, 3, 5, 7, 9];

/** Day of week to book (e.g. "Tuesday"). Override with BOOKING_DAY in .env. Also used by the bot's messages. */
export const BOOKING_DAY =
  (process.env.BOOKING_DAY || 'Tuesday').trim() || 'Tuesday';

/**
 * Time slot label to click (e.g. "8:00 p.m."). Override with BOOKING_SLOT in .env.
 * (Not BOOKING_TIME: the bot uses that for when to run the booking.)
 */
const BOOKING_SLOT = process.env.BOOKING_SLOT || '8:00 p.m.';

/** When true, don't submit the form; just navigate as if booking succeeded. */
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
/** Optional extra delay after clicks in DRY_RUN mode (ms). Default: 2000. */
const DRY_RUN_CLICK_DELAY_MS =
  Number(process.env.DRY_RUN_CLICK_DELAY || '2000') || 0;

/** How long to keep retrying when the day isn't available yet (ms). */
const DAY_RETRY_DEADLINE_MS = 60 * 60 * 1000;

/** Wait and refresh when the day link is missing (ms). */
const DAY_RETRY_WAIT_MS = 3000;

/**
 * Runs the booking flow on the given page. Tries to book up to courtCount courts in priority order.
 * The site hides a day on a court once that court is fully booked for it, so a court missing the day is skipped.
 * If no court lists the day yet, waits 3s, refreshes, and retries for up to 1 hour.
 * @param {import('playwright').Page} page - Playwright page (from script or test)
 * @param {number} courtCount - Number of courts to book. Courts are tried in COURT_PRIORITY_ORDER; after each successful booking, continues to the next until courtCount is reached.
 * @param {{ freshPage?: () => Promise<import('playwright').Page> }} [options] - freshPage, if given, is called before each retry and the returned page is used instead (e.g. so a recording only covers the last attempt).
 * @returns {Promise<{ dayUnavailable: boolean }>}
 */
export async function runBookingFlow(page, courtCount, { freshPage } = {}) {
  const deadline = Date.now() + DAY_RETRY_DEADLINE_MS;
  const courtsToTry = [...COURT_PRIORITY_ORDER];
  const dayEscaped = BOOKING_DAY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let bookedCount = 0;
  /** @type {number[]} */
  const bookedCourts = [];
  let dayNotVisible = false;
  let attempt = 0;

  while (Date.now() < deadline) {
    if (attempt++ > 0 && freshPage) {
      page = await freshPage();
    }
    console.log(
      `[book-courts] Starting booking loop. BOOKING_DAY=${BOOKING_DAY}, BOOKING_SLOT=${BOOKING_SLOT}, DRY_RUN=${DRY_RUN}, courtCount=${courtCount}, alreadyBooked=${bookedCount}`
    );
    await page.goto(BOOKING_URL, { waitUntil: 'networkidle' });
    console.log(`[book-courts] Landed on booking URL: ${BOOKING_URL}`);

    let dayFoundThisPass = false;

    let courtIdx = 0;
    while (courtIdx < courtsToTry.length) {
      if (bookedCount >= courtCount) break;
      const courtNum = courtsToTry[courtIdx];
      const courtLabel = `Squash - court ${courtNum}`;
      const courtLink = page.getByRole('link', { name: courtLabel });

      console.log(`[book-courts] Trying court ${courtNum} (${courtLabel})`);
      await courtLink.click();
      if (DRY_RUN) {
        await page.waitForTimeout(DRY_RUN_CLICK_DELAY_MS);
      }
      await page.waitForLoadState('networkidle');

      // Date headers are <button class="title"> with .header-text like
      // "Monday August 24ᵗʰ, 2026". A regex on getByRole name does not match
      // that full accessible name; match the visible header text instead.
      // isVisible() doesn't wait, so first give the date headers time to render,
      // then match on the button's own text (case-insensitive) rather than a nested element.
      await page
        .locator('button.title')
        .first()
        .waitFor({ state: 'attached', timeout: 5000 })
        .catch(() => {});
      const dayRegex = new RegExp(`\\b${dayEscaped}\\b`, 'i');
      const dayOption = page
        .locator('button.title')
        .filter({ hasText: dayRegex })
        .first();
      const dayVisible = await dayOption
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (!dayVisible) {
        const shownDates = await page
          .locator('button.title .header-text')
          .allTextContents()
          .catch(() => []);
        console.log(
          `[book-courts] ${BOOKING_DAY} not listed for court ${courtNum} (site shows: ${
            shownDates.map((d) => d.trim()).join('; ') || 'no dates'
          }); trying next court.`
        );
        await page.goto(BOOKING_URL, { waitUntil: 'networkidle' });
        courtIdx++;
        continue;
      }
      dayFoundThisPass = true;

      console.log(
        `[book-courts] Found ${BOOKING_DAY} date button, clicking it…`
      );
      await dayOption.click();
      if (DRY_RUN) {
        await page.waitForTimeout(DRY_RUN_CLICK_DELAY_MS);
      }
      await page.waitForLoadState('networkidle');

      // Time slots are buttons whose aria-label starts with the time and includes the day,
      // e.g. aria-label="8:00 p.m. Monday August 24ᵗʰ, 2026"
      const timeEscaped = BOOKING_SLOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const timeLabelRegex = new RegExp(`^${timeEscaped}\\s+${dayEscaped}`);
      console.log(
        `[book-courts] Looking for time slot starting with "${BOOKING_SLOT}"…`
      );
      const allTimeSlots = page.locator(
        'button.time-container[aria-label], a[aria-label]'
      );
      const slotCount = await allTimeSlots.count();
      let timeSlot = null;
      for (let i = 0; i < slotCount; i++) {
        const candidate = allTimeSlots.nth(i);
        const label = (await candidate.getAttribute('aria-label')) || '';
        if (timeLabelRegex.test(label)) {
          timeSlot = candidate;
          console.log(
            `[book-courts] Matched time slot aria-label="${label}" on slot index ${i}.`
          );
          break;
        }
      }
      if (!timeSlot) {
        console.log(
          `[book-courts] No time slot with aria-label matching ${timeLabelRegex} found for court ${courtNum}; trying next court.`
        );
        await page.goto(BOOKING_URL, { waitUntil: 'networkidle' });
        courtIdx++;
        continue;
      }
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
          `[book-courts] Court ${courtNum}: ${BOOKING_SLOT} is taken, trying next court.`
        );
        await page.goto(BOOKING_URL, { waitUntil: 'networkidle' });
        courtIdx++;
        continue;
      }
      console.log(
        `[book-courts] Time slot appears available on court ${courtNum}, clicking it…`
      );
      await timeSlot.click();
      if (DRY_RUN) {
        await page.waitForTimeout(DRY_RUN_CLICK_DELAY_MS);
      }
      await page.waitForLoadState('networkidle');

      if (DRY_RUN) {
        // Stop at the contact form: reaching it is a successful dry run.
        await page.getByLabel(/phone number/i).waitFor();
        const slotHeading = await page
          .getByRole('heading', { name: /^Time:/ })
          .first()
          .innerText()
          .catch(() => '');
        console.log(
          `[book-courts] DRY_RUN=true: reached contact form for Squash - court ${courtNum} (${slotHeading.trim()}); not submitting.`
        );
      } else {
        console.log('[book-courts] Filling contact form with env values…');
        // Contact details from env
        const phone = process.env.BOOKING_PHONE ?? '';
        const email = process.env.BOOKING_EMAIL ?? '';
        const name = process.env.BOOKING_NAME ?? '';
        if (!phone || !email || !name) {
          throw new Error(
            'Set BOOKING_PHONE, BOOKING_EMAIL, and BOOKING_NAME in .env for the booking form.'
          );
        }

        await page.getByLabel(/phone number/i).fill(phone);
        await page.getByLabel(/email address/i).fill(email);
        await page.getByLabel(/name/i).fill(name);

        console.log('[book-courts] Submitting confirmation buttons…');
        await page.getByRole('button', { name: /confirm/i }).click();
        if (DRY_RUN) {
          await page.waitForTimeout(DRY_RUN_CLICK_DELAY_MS);
        }
        await page.getByRole('button', { name: /final confirmation/i }).click();
        if (DRY_RUN) {
          await page.waitForTimeout(DRY_RUN_CLICK_DELAY_MS);
        }

        console.log(
          `[book-courts] Booked Squash - court ${courtNum} at ${BOOKING_SLOT}`
        );
      }
      bookedCount++;
      bookedCourts.push(courtNum);

      if (bookedCount === 1) {
        const i2 = courtsToTry.indexOf(2);
        if (i2 !== -1) {
          courtsToTry.splice(i2, 1);
          courtsToTry.push(2);
          console.log(
            `[book-courts] First court booked; moved court 2 to end: [${courtsToTry.join(
              ', '
            )}]`
          );
        }
      }

      console.log(
        `[book-courts] Finished booking attempt for court ${courtNum}. bookedCount=${bookedCount}/${courtCount}`
      );
      if (bookedCount >= courtCount) {
        console.log('[book-courts] Reached requested courtCount, stopping.');
        if (DRY_RUN) {
          console.log(
            '[book-courts] DRY_RUN=true: refreshing back to start page after final booking attempt.'
          );
          await page.goto(BOOKING_URL, { waitUntil: 'networkidle' });
        }
        console.log(`[book-courts] COURTS_BOOKED=${bookedCourts.join(',')}`);
        return { dayUnavailable: false };
      }
      console.log('[book-courts] Returning to start page to try next court…');
      await page.goto(BOOKING_URL, { waitUntil: 'networkidle' });
      courtIdx++;
    }

    // Exited court loop: if no court listed the day we retry the while; otherwise we tried all courts
    dayNotVisible = !dayFoundThisPass;
    if (!dayNotVisible) {
      break;
    }
    console.log(
      `[book-courts] ${BOOKING_DAY} not listed on any court yet, waiting ${
        DAY_RETRY_WAIT_MS / 1000
      }s and retrying...`
    );
    await page.waitForTimeout(DAY_RETRY_WAIT_MS);
  }

  const dayUnavailable = dayNotVisible;
  if (dayUnavailable) {
    console.log(
      `[book-courts] ${BOOKING_DAY} did not appear within 1 hour; reservations may not be open yet.`
    );
    console.log('[book-courts] DAY_UNAVAILABLE=1');
  } else if (bookedCount === 0) {
    console.log(
      `[book-courts] No court had ${BOOKING_SLOT} available in priority order.`
    );
  } else {
    console.log(
      `[book-courts] Booked ${bookedCount} court(s); no more had ${BOOKING_SLOT} available.`
    );
  }
  console.log(`[book-courts] COURTS_BOOKED=${bookedCourts.join(',')}`);
  return { dayUnavailable };
}
