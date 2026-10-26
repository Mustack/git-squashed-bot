/**
 * Script the app runs to book courts (via src/run-booking.js).
 * Receives COURT_COUNT from the Discord bot (number of people who reacted).
 * The actual flow lives in booking-flow.mjs so the same logic runs in the UI test.
 */
import { chromium } from 'playwright';
import { runBookingFlow } from './booking-flow.mjs';

const COURT_COUNT = parseInt(process.env.COURT_COUNT || '1', 10) || 1;
const HEADLESS = process.env.HEADLESS !== 'false';
const RECORD_BOOKING_VIDEO = Boolean(
  (process.env.DISCORD_VIDEO_CHANNEL_ID || '').trim(),
);

async function main() {
  const browser = await chromium.launch({ headless: HEADLESS });

  /** @type {import('playwright').Page | null} */
  let page = null;
  /** Opens a new context/page, discarding the previous one and its recording. */
  async function openPage() {
    const previous = page;
    if (previous) {
      await previous.context().close();
      // Keep only the latest attempt's video; an hour of retries is far too big to upload to Discord.
      await previous.video()?.delete();
    }
    const context = await browser.newContext(
      RECORD_BOOKING_VIDEO
        ? {
            viewport: { width: 1280, height: 1680 },
            recordVideo: {
              dir: 'test-results/discord-videos',
              size: { width: 1280, height: 720 },
            },
          }
        : {
            viewport: { width: 1280, height: 1680 },
          },
    );
    page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(30_000);
    return page;
  }

  await openPage();

  try {
    await runBookingFlow(page, COURT_COUNT, { freshPage: openPage });
  } finally {
    const recordedVideo = page.video();
    await browser.close();
    if (recordedVideo) {
      try {
        const videoPath = await recordedVideo.path();
        console.log(`[book-courts] VIDEO_PATH=${videoPath}`);
      } catch (e) {
        console.error('[book-courts] could not finalize run video:', e);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
