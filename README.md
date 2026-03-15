# git-squashed-bot

Sponsored by Royal Oak.

A Discord bot for the "git squashed" squash group: run a weekly "who's in?" poll with a reaction, then at 6pm that day run a Playwright script to book the right number of courts.

## What it does

1. **Poll** – The bot posts _"Who's in for squash this week?"_ every **Sunday at 9:00 AM** in your configured channel (and adds a 👍 reaction). You can also run `!squash` or `!poll` anytime to post manually.
2. **Count** – The bot counts how many people (excluding itself) reacted.
3. **Book** – At 6pm the same day it runs your Playwright script with `COURT_COUNT` set to **1 court per 2 attendees** (e.g. 4 attendees → 2 courts). The bot’s own reaction is not counted.

## Setup

### 1. Discord bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → New Application.
2. Under **Bot**, create a bot and copy the **Token**.
3. Enable **Message Content Intent** under Bot → Privileged Gateway Intents.
4. Invite the bot to your server (OAuth2 → URL Generator → scopes: `bot`; permissions: Send Messages, Read Message History, Add Reactions, Use Slash Commands if you add them later).

### 2. Environment

```bash
cp .env.example .env
# Edit .env and set DISCORD_BOT_TOKEN=your_bot_token
```

Required for the weekly auto-post:

- `DISCORD_POLL_CHANNEL_ID` – channel where the Sunday 9am poll is posted (right‑click the channel → Copy channel ID; enable Developer Mode in Discord settings if needed).

Optional in `.env`:

- `COMMAND_PREFIX` – default `!` (e.g. `!squash`).
- `BOOKING_HOUR` – hour (0–23) to run booking; default `18` (6pm).
- `BOOKING_URL`, `BOOKING_USER`, `BOOKING_PASSWORD`, `HEADLESS` – used by your booking script if you need them.

### 3. Install and run

```bash
npm install
npx playwright install chromium   # first time only, for the booking script
npm start
```

### 4. Your booking script

Edit **`scripts/book-courts.mjs`** to match your squash booking website. The script receives:

- **`COURT_COUNT`** (env) – number of people who reacted (courts to book).

Use Playwright to log in (if needed), go to the booking page, choose date/time, and book `COURT_COUNT` courts. The repo includes a stub that only logs; replace it with your real flow.

Test it manually:

```bash
COURT_COUNT=2 node scripts/book-courts.mjs
```

Use `HEADLESS=false` to watch the browser while developing.

## Usage

1. **Sunday 9am** – If `DISCORD_POLL_CHANNEL_ID` is set, the bot posts the poll in that channel automatically. Otherwise post manually with **`!squash`** or **`!poll`**.
2. The bot adds a 👍 reaction. Everyone clicks the reaction to say they’re in.
3. At 6pm the same day (or the hour in `BOOKING_HOUR`), the bot runs `scripts/book-courts.mjs` with `COURT_COUNT` set to the number of people who reacted, then posts a short confirmation in the same channel.

**Note:** The 6pm job is scheduled when the poll is posted (Sunday 9am or when you run `!squash`). If the bot restarts before 6pm, that day’s run is lost; post the poll again to reschedule.

## Hosting

- **Always-on:** Run on a VPS or a small cloud VM (`npm start` or use a process manager like `pm2`).
- **Serverless:** Not ideal here because the 6pm job is in-memory; you’d need to move scheduling to a cron service and persist the poll message ID.

---

Sponsored by Royal Oak.
