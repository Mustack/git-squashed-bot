---
name: test-booking
description: Dry-run the court booking flow against the live Bob MacQuarrie site with Playwright and report the results. Use when asked to test the booking, check the booking script works, or see what's available. Never submits a booking.
---

# Test the booking flow (dry run)

Runs the real `scripts/book-courts.mjs` with `DRY_RUN=true` against the live site. A run
**passes** when it reaches the contact-details form (phone / email / name) for a court; in
DRY_RUN the flow stops there and never fills or confirms the form.

## Run it

```bash
node .claude/skills/test-booking/test-booking.mjs
```

Options (defaults shown): `--days-out 2 --time "8:00 p.m." --courts 1 --wait-minutes 2`.
Times use the site's format: `8:00 p.m.`, `7:00 a.m.`. It takes ~1–2 minutes; run with a
timeout of at least 10 minutes.

What it does:

1. **Target day** = today + `--days-out` in Eastern time. The day 2 out appears on the site at
   **6pm Eastern** today. Before 6pm it isn't listed, so the script tests the latest open day
   instead and says so. After 6pm, a missing day is a real failure (it re-checks for
   `--wait-minutes` first).
2. **Availability**: scans every squash court (priority order 1, 2, 3, 5, 7, 9) and lists open
   and reserved slots for the day.
3. **Runs**: dry-runs `book-courts.mjs` for `--time`. If no court reaches the contact form at
   that time, retries once with the open time closest to it.

Exit code 0 = PASS, 1 = FAIL.

## Report back

Summarise from the script's output:

- Target day and whether it was open (or which fallback day was tested and why).
- Whether the requested time was available, and on which courts.
- If it fell back, which time and why.
- Result: PASS (court(s) + time the contact form was reached) or FAIL with the relevant
  output lines.

## Safety

- Always run through this script (it forces `DRY_RUN=true`). Never run
  `scripts/book-courts.mjs` without `DRY_RUN=true` for a test — it would book a real court.
- Don't fill in or click **Confirm** on the contact form.
