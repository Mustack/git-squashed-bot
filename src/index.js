import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import schedule from 'node-schedule';
import { parseTime, formatTime } from './utils/parseTime.js';
import { EASTERN_TZ, nextEasternWallTime } from './utils/easternTime.js';

const REACTION_EMOJI = '✋';
const POLL_TEXT = "Who's in for squash this week? React below 👇";

/** Default time to post the weekly poll on Sundays (e.g. "12:35pm"). Eastern Time; override with POLL_TIME env. */
const DEFAULT_POLL_TIME = '9:00am';
/** Default time to run the booking script the same day (e.g. "12:45pm"). Eastern Time; override with BOOKING_TIME env. */
const DEFAULT_BOOKING_TIME = '6:00pm';

/** When true, speed up timings for local testing (poll 1 min from start, booking 2 min from start). */
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
/** When true, record and upload Playwright booking videos. */
const IS_VIDEO_RECORDING_ENABLED =
  String(process.env.IS_VIDEO_RECORDING_ENABLED || '').toLowerCase() === 'true';

/** @type {{ messageId: string, channelId: string } | null} */
let scheduledPoll = null;

/** @type {schedule.Job | null} */
let bookingJob = null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

function getCommandPrefix() {
  return (process.env.COMMAND_PREFIX || '!').trim();
}

/** Booking time from env. Uses DEFAULT_BOOKING_TIME if unset. */
function getBookingTime() {
  const raw = (process.env.BOOKING_TIME || DEFAULT_BOOKING_TIME).trim();
  try {
    return parseTime(raw);
  } catch (e) {
    console.warn(
      `Invalid BOOKING_TIME "${raw}", using ${DEFAULT_BOOKING_TIME}. ${e.message}`,
    );
    return parseTime(DEFAULT_BOOKING_TIME);
  }
}

/** Channel ID where the weekly poll is posted (required for Sunday auto-post). */
function getPollChannelId() {
  return (process.env.DISCORD_POLL_CHANNEL_ID || '').trim();
}

/** Poll time from env. Uses DEFAULT_POLL_TIME if unset. */
function getPollTime() {
  const raw = (process.env.POLL_TIME || DEFAULT_POLL_TIME).trim();
  try {
    return parseTime(raw);
  } catch (e) {
    console.warn(
      `Invalid POLL_TIME "${raw}", using ${DEFAULT_POLL_TIME}. ${e.message}`,
    );
    return parseTime(DEFAULT_POLL_TIME);
  }
}

/** Unicode poll reaction only (not custom emoji). */
function matchesPollEmoji(reaction) {
  const e = reaction.emoji;
  if (e.id) return false;
  return e.name === REACTION_EMOJI;
}

function isPollMessage(message) {
  return message.content === POLL_TEXT;
}

async function countReactions(message) {
  try {
    const reaction = message.reactions.cache.find((r) => matchesPollEmoji(r));
    if (!reaction) return 0;
    await reaction.users.fetch();
    const users = reaction.users.cache.filter((u) => !u.bot);

    return users.size;
  } catch (e) {
    console.error('Failed to count reactions:', e);
    return 0;
  }
}

/**
 * Runs the booking script.
 * Returns an object { ok: boolean, videoPath: string | null }.
 */
async function runBooking(count) {
  const { spawn } = await import('child_process');
  return new Promise((resolve) => {
    console.log(`Running booking for ${count} court(s)...`);
    const env = { ...process.env, COURT_COUNT: String(count) };
    const child = spawn('node', ['src/run-booking.js'], {
      env,
      cwd: process.cwd(),
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let videoPath = null;
    /** @type {number[] | null} */
    let courtsBooked = null;

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      process.stdout.write(chunk);
      const videoMatch = text.match(/VIDEO_PATH=(.+)\s*$/m);
      if (videoMatch) {
        videoPath = videoMatch[1].trim();
      }
      const courtsMatch = text.match(/COURTS_BOOKED=([0-9,\s]+)/m);
      if (courtsMatch) {
        const raw = courtsMatch[1].trim();
        courtsBooked = raw
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !Number.isNaN(n));
      }
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });

    child.on('close', (code) => {
      if (code !== 0) console.error(`Booking script exited with code ${code}`);
      resolve({ ok: code === 0, videoPath, courtsBooked: courtsBooked || [] });
    });
  });
}

function scheduleBookingForToday(channelId, messageId) {
  let runAt;
  if (DRY_RUN) {
    // In DRY_RUN, always book 5 seconds from poll being sent
    runAt = new Date(Date.now() + 5 * 1000);
  } else {
    const { hour, minute } = getBookingTime();
    runAt = nextEasternWallTime(hour, minute);
  }

  if (bookingJob) bookingJob.cancel();
  scheduledPoll = { channelId, messageId };

  bookingJob = schedule.scheduleJob(runAt, async () => {
    console.log(`Scheduled booking job running at ${new Date().toISOString()}`);
    try {
      const channel = await client.channels.fetch(channelId);
      const message = await channel.messages.fetch(messageId);
      const attendees = await countReactions(message); // excludes bot
      // Pairs per court: floor(attendees/2), min 1 court (e.g. 5 → 2, 4 → 2, 6 → 3)
      const baseCourts = Math.floor(attendees / 2);
      const courts = DRY_RUN ? attendees * 2 + 1 : baseCourts;

      if (courts < 1) {
        await channel.send('Not enough attendees to book courts');
        return;
      }

      const { ok, videoPath, courtsBooked } = await runBooking(courts);
      if (ok) {
        let bookedMsg;
        if (courtsBooked && courtsBooked.length) {
          const list = courtsBooked.join(', ');
          if (courtsBooked.length === courts) {
            bookedMsg = `Booked court${courtsBooked.length > 1 ? 's' : ''}: ${list}! Enjoy your nachos!`;
          } else {
            bookedMsg = `I could only get court${courtsBooked.length > 1 ? 's' : ''}: ${list}. You needed ${courts} court${courts > 1 ? 's' : ''}. Keep an eye on the booking site to see if any courts become available: https://reservation.frontdesksuite.ca/rcfs/bobmacquarrie`;
          }
        } else {
          bookedMsg = `I could not get any courts. You needed ${courts} court${courts > 1 ? 's' : ''}. Keep an eye on the booking site to see if any courts become available: https://reservation.frontdesksuite.ca/rcfs/bobmacquarrie`;
        }
        await channel.send(bookedMsg);
        if (IS_VIDEO_RECORDING_ENABLED && videoPath) {
          await channel.send({
            content: 'Here is the booking run video:',
            files: [videoPath],
          });
        }
      } else {
        await channel.send(
          `⚠️ The booking script failed for **${courts}** court(s). Check the server logs and try booking manually.`,
        );
      }
    } catch (e) {
      console.error('Booking job failed:', e);
    } finally {
      scheduledPoll = null;
      bookingJob = null;
    }
  });
}

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }
    if (!matchesPollEmoji(reaction)) return;

    const message = reaction.message.partial
      ? await reaction.message.fetch()
      : reaction.message;
    if (!isPollMessage(message)) return;

    await reaction.users.fetch();
    if (reaction.users.cache.has(client.user.id)) {
      await reaction.users.remove(client.user);
    }
  } catch (e) {
    console.error('messageReactionAdd (poll emoji):', e);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }
    if (!matchesPollEmoji(reaction)) return;

    const message = reaction.message.partial
      ? await reaction.message.fetch()
      : reaction.message;
    if (!isPollMessage(message)) return;

    const fresh = await message.channel.messages.fetch(message.id);
    const r = fresh.reactions.cache.find((x) => matchesPollEmoji(x));
    if (r && r.count > 0) return;
    await fresh.react(REACTION_EMOJI);
  } catch (e) {
    console.error('messageReactionRemove (poll emoji):', e);
  }
});

client.on('messageReactionRemoveAll', async (message) => {
  try {
    if (message.partial) await message.fetch();
    if (!isPollMessage(message)) return;
    await message.react(REACTION_EMOJI);
  } catch (e) {
    console.error('messageReactionRemoveAll (poll):', e);
  }
});

client.on('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);

  const pollChannelId = getPollChannelId();
  if (pollChannelId) {
    if (DRY_RUN) {
      // In DRY_RUN, post a one-off poll 5 seconds from now instead of a weekly Sunday cron
      const runAt = new Date(Date.now() + 50);
      schedule.scheduleJob(runAt, async () => {
        console.log(`DRY_RUN: posting squash poll at ${runAt}`);
        try {
          const channel = await client.channels.fetch(pollChannelId);
          const pollMessage = await channel.send(POLL_TEXT);
          await pollMessage.react(REACTION_EMOJI);
          scheduleBookingForToday(channel.id, pollMessage.id);
        } catch (e) {
          console.error('DRY_RUN poll failed:', e.message);
        }
      });
      const rawBooking = (
        process.env.BOOKING_TIME || DEFAULT_BOOKING_TIME
      ).trim();
      console.log(
        `[config] DRY_RUN=true; test timings enabled (poll offset=50ms, booking offset=5000ms). BOOKING_TIME_RAW="${rawBooking}"`,
      );
    } else {
      const { hour, minute } = getPollTime();
      const pollRule = new schedule.RecurrenceRule();
      pollRule.dayOfWeek = 0; // Sunday
      pollRule.hour = hour;
      pollRule.minute = minute;
      pollRule.second = 0;
      pollRule.tz = EASTERN_TZ;
      schedule.scheduleJob(pollRule, async () => {
        console.log(
          `Sunday ${formatTime({ hour, minute })} ${EASTERN_TZ}: posting squash poll`,
        );
        try {
          const channel = await client.channels.fetch(pollChannelId);
          const pollMessage = await channel.send(POLL_TEXT);
          await pollMessage.react(REACTION_EMOJI);
          scheduleBookingForToday(channel.id, pollMessage.id);
        } catch (e) {
          console.error('Sunday poll failed:', e.message);
          if (e.code === 50001) {
            console.error(
              '\nMissing Access (50001): The bot cannot see or use that channel. Fix:',
            );
            console.error(
              '  • Re-invite the bot with "View Channel", "Send Messages", "Read Message History", "Add Reactions".',
            );
            console.error(
              '  • In the channel, ensure the bot’s role is allowed to view and send messages.\n',
            );
          }
        }
      });
      const rawPoll = (process.env.POLL_TIME || DEFAULT_POLL_TIME).trim();
      const rawBooking = (
        process.env.BOOKING_TIME || DEFAULT_BOOKING_TIME
      ).trim();
      console.log(
        `[config] DRY_RUN=false; poll schedule=Sun ${hour}:${String(minute).padStart(2, '0')} ${EASTERN_TZ}, POLL_TIME_RAW="${rawPoll}", BOOKING_TIME_RAW="${rawBooking}"`,
      );
    }
  } else {
    console.log(
      'No DISCORD_POLL_CHANNEL_ID set; no weekly poll is currently scheduled.',
    );
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const prefix = getCommandPrefix();
  const text = (message.content || '').trim();
  if (!text.startsWith(prefix)) return;

  const args = text.slice(prefix.length).split(/\s+/);
  const cmd = (args[0] || '').toLowerCase();

  if (cmd === 'squash' || cmd === 'poll') {
    const pollMessage = await message.channel.send(POLL_TEXT);
    await pollMessage.react(REACTION_EMOJI);
    scheduleBookingForToday(message.channel.id, pollMessage.id);
    await message.channel.send(
      `Poll posted. React with ${REACTION_EMOJI} if you're in. Booking will run at **${formatTime(
        getBookingTime(),
      )} US Eastern** today.`,
    );
  }
});

client.login(process.env.DISCORD_BOT_TOKEN).catch((e) => {
  console.error('Login failed:', e.message);
  if (/disallowed intents/i.test(e.message)) {
    console.error(
      '\nEnable the required intents in the Discord Developer Portal:',
    );
    console.error('  1. Go to https://discord.com/developers/applications');
    console.error('  2. Select your application → Bot (left sidebar)');
    console.error(
      '  3. Under "Privileged Gateway Intents", turn ON "Message Content Intent"',
    );
    console.error('  4. Save and restart the bot.\n');
  }
  process.exit(1);
});
