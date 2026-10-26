/**
 * Dry-run test of the real booking script (scripts/book-courts.mjs) against the live site.
 *
 * 1. Works out the target day (N days out, Eastern). The day 2 out is listed from 6pm Eastern
 *    today; before then we fall back to the latest open day.
 * 2. Scans every squash court for that day and lists open time slots.
 * 3. Runs book-courts.mjs with DRY_RUN=true for the requested time; if no court gets to
 *    the contact form, retries with the open time closest to the requested one.
 *
 * Success = the flow reached the contact form (it never fills or submits it in DRY_RUN).
 *
 * Usage: node .claude/skills/test-booking/test-booking.mjs [--days-out 2] [--time "8:00 p.m."] [--courts 1] [--wait-minutes 2]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { DateTime } from 'luxon';
import { BOOKING_URL, COURT_PRIORITY_ORDER } from '../../../scripts/booking-flow.mjs';
import { EASTERN_TZ } from '../../../src/utils/easternTime.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** The day `daysOut` ahead appears on the site at this Eastern hour. */
const OPENS_AT_HOUR = 18;
const RUN_TIMEOUT_MS = 5 * 60 * 1000;

const { values: args } = parseArgs({
  options: {
    'days-out': { type: 'string', default: '2' },
    time: { type: 'string', default: '8:00 p.m.' },
    courts: { type: 'string', default: '1' },
    'wait-minutes': { type: 'string', default: '2' },
  },
});
const daysOut = Number(args['days-out']);
const wantedTime = args.time.trim();
const courtCount = Number(args.courts) || 1;
const waitMs = Number(args['wait-minutes']) * 60 * 1000;

/** "8:00 p.m." -> minutes since midnight. */
function slotMinutes(label) {
  const m = /^(\d{1,2}):(\d{2})\s*([ap])\.m\./i.exec(label);
  if (!m) return NaN;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  return h * 60 + Number(m[2]);
}

async function openCourt(page, courtNum) {
  await page.goto(BOOKING_URL, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: `Squash - court ${courtNum}` }).click();
  await page.waitForLoadState('networkidle');
}

async function listedDates(page) {
  await openCourt(page, COURT_PRIORITY_ORDER[0]);
  const dates = await page.locator('.title .header-text').allTextContents();
  return dates.map((d) => d.trim());
}

/** Open/reserved slots per court for `dayName`. */
async function scanAvailability(page, dayName) {
  const result = [];
  for (const courtNum of COURT_PRIORITY_ORDER) {
    await openCourt(page, courtNum);
    const day = page
      .locator('summary.title')
      .filter({ has: page.locator('.header-text', { hasText: dayName }) })
      .first();
    if (!(await day.isVisible().catch(() => false))) {
      result.push({ court: courtNum, open: [], reserved: [], dayMissing: true });
      continue;
    }
    await day.click();
    await page.waitForLoadState('networkidle');
    const slots = await page
      .locator('button.time-container[aria-label]')
      .evaluateAll((els) =>
        els.map((el) => ({
          label: el.getAttribute('aria-label') || '',
          reserved:
            el.parentElement?.classList.contains('reserved') ||
            el.parentElement?.getAttribute('aria-hidden') === 'true',
        })),
      );
    // Other days may be expanded on the same page; keep only this day's slots.
    const daySlots = slots.filter((s) => s.label.includes(` ${dayName} `));
    const time = (label) => label.split(` ${dayName}`)[0];
    result.push({
      court: courtNum,
      open: daySlots.filter((s) => !s.reserved).map((s) => time(s.label)),
      reserved: daySlots.filter((s) => s.reserved).map((s) => time(s.label)),
    });
  }
  return result;
}

/** Runs the real booking script in DRY_RUN mode and parses its markers. */
function runDryBooking(day, slot) {
  return new Promise((resolve) => {
    const child = spawn('node', ['scripts/book-courts.mjs'], {
      cwd: ROOT,
      env: {
        ...process.env,
        DRY_RUN: 'true',
        DRY_RUN_CLICK_DELAY: '0',
        BOOKING_DAY: day,
        BOOKING_SLOT: slot,
        COURT_COUNT: String(courtCount),
        HEADLESS: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (c) => (output += c));
    child.stderr.on('data', (c) => (output += c));
    const timer = setTimeout(() => child.kill('SIGTERM'), RUN_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      const booked = /COURTS_BOOKED=([0-9,]*)/.exec(output)?.[1] || '';
      const formLines = output
        .split('\n')
        .filter((l) => l.includes('reached contact form'))
        .map((l) => l.replace('[book-courts] ', ''));
      resolve({
        code,
        courtsReached: booked ? booked.split(',').map(Number) : [],
        formLines,
        output,
      });
    });
  });
}

async function main() {
  const now = DateTime.now().setZone(EASTERN_TZ);
  const target = now.plus({ days: daysOut });
  const targetName = target.toFormat('cccc');
  const targetHeader = new RegExp(`^${targetName} ${target.toFormat('LLLL d')}\\D`);
  const opened = now.hour >= OPENS_AT_HOUR || daysOut < 2;

  const lines = [];
  const log = (s = '') => {
    lines.push(s);
    console.log(s);
  };

  log(`# Booking dry-run test (${now.toFormat('ccc LLL d, h:mm a')} ET)`);
  log(`Target: ${target.toFormat('cccc LLLL d')} (${daysOut} days out), ${wantedTime}, ${courtCount} court(s)`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1680 } });
  page.setDefaultTimeout(15_000);

  let testDay = targetName;
  let dates = await listedDates(page);
  let found = dates.some((d) => targetHeader.test(d));
  if (!found && opened) {
    // Should be open by now; give the site a little time before calling it a failure.
    const deadline = Date.now() + waitMs;
    while (!found && Date.now() < deadline) {
      await page.waitForTimeout(10_000);
      dates = await listedDates(page);
      found = dates.some((d) => targetHeader.test(d));
    }
  }
  log(`Dates listed on site: ${dates.join('; ') || 'none'}`);

  if (!found) {
    if (opened) {
      log(`FAIL: ${targetName} should be open (after 6pm ET) but is not listed.`);
      await browser.close();
      process.exitCode = 1;
      return;
    }
    if (!dates.length) {
      log('FAIL: no dates listed on the site at all.');
      await browser.close();
      process.exitCode = 1;
      return;
    }
    testDay = dates[dates.length - 1].split(' ')[0];
    log(`Note: ${targetName} opens at 6pm ET today; testing the latest open day (${testDay}) instead.`);
  }

  const availability = await scanAvailability(page, testDay);
  await browser.close();

  log('');
  log(`## Availability for ${testDay}`);
  for (const c of availability) {
    if (c.dayMissing) log(`- court ${c.court}: ${testDay} not listed`);
    else log(`- court ${c.court}: open ${c.open.join(', ') || 'none'} | reserved ${c.reserved.join(', ') || 'none'}`);
  }

  log('');
  log('## Runs (scripts/book-courts.mjs, DRY_RUN=true)');
  const attempts = [wantedTime];
  let run = await runDryBooking(testDay, wantedTime);
  const report = (slot, r) =>
    log(
      `- ${slot}: exit ${r.code}; ` +
        (r.formLines.length
          ? r.formLines.join(' / ')
          : 'did not reach contact form') +
        (r.code !== 0 ? `\n  last output:\n${r.output.trim().split('\n').slice(-8).map((l) => '    ' + l).join('\n')}` : ''),
    );
  report(wantedTime, run);

  if (run.code === 0 && run.courtsReached.length < courtCount) {
    const want = slotMinutes(wantedTime);
    const openTimes = [...new Set(availability.flatMap((c) => c.open))]
      .filter((t) => t !== wantedTime)
      .sort((a, b) => Math.abs(slotMinutes(a) - want) - Math.abs(slotMinutes(b) - want));
    if (openTimes.length) {
      const fallback = openTimes[0];
      attempts.push(fallback);
      log(`- ${wantedTime} not available on enough courts; falling back to closest open time ${fallback}`);
      run = await runDryBooking(testDay, fallback);
      report(fallback, run);
    } else {
      log(`- No other open times on ${testDay} to fall back to.`);
    }
  }

  const pass = run.code === 0 && run.courtsReached.length >= courtCount;
  log('');
  log(
    pass
      ? `RESULT: PASS — reached the contact form on court(s) ${run.courtsReached.join(', ')} for ${testDay} at ${attempts[attempts.length - 1]}${testDay !== targetName ? ` (fallback day; ${targetName} not open yet)` : ''}.`
      : `RESULT: FAIL — tried ${attempts.join(', ')} on ${testDay}; reached contact form on ${run.courtsReached.length}/${courtCount} court(s).`,
  );
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
