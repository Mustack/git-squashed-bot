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
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(30_000);

  try {
    await runBookingFlow(page, COURT_COUNT);
    if (RECORD_BOOKING_VIDEO) {
      const video = await page.video();
      if (video) {
        const videoPath = await video.path();
        console.log(`[book-courts] VIDEO_PATH=${videoPath}`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
