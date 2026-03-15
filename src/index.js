import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import schedule from 'node-schedule';
import { parseTime, formatTime } from './utils/parseTime.js';

const REACTION_EMOJI = '👍';
const POLL_TEXT = "Who's in for squash this week? React below 👇";

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

function getBookingHour() {
  const hour = parseInt(process.env.BOOKING_HOUR || '18', 10);
  return Number.isNaN(hour) ? 18 : Math.max(0, Math.min(23, hour));
}

/** Channel ID where the weekly poll is posted (required for Sunday auto-post). */
function getPollChannelId() {
  return (process.env.DISCORD_POLL_CHANNEL_ID || '').trim();
}

/** Poll time from env (e.g. "12:35pm"). Default 12:35pm. */
function getPollTime() {
  const raw = (process.env.POLL_TIME || '12:35pm').trim();
  try {
    return parseTime(raw);
  } catch (e) {
    console.warn(`Invalid POLL_TIME "${raw}", using 12:35pm. ${e.message}`);
    return parseTime('12:35pm');
  }
}

async function countReactions(message) {
  try {
    const reaction = message.reactions.cache.find(
      (r) => r.emoji.name === REACTION_EMOJI
    );
    if (!reaction) return 0;
    await reaction.users.fetch();
    const users = reaction.users.cache.filter((u) => !u.bot);
    return users.size;
  } catch (e) {
    console.error('Failed to count reactions:', e);
    return 0;
  }
}

async function runBooking(count) {
  console.log(`Running booking for ${count} court(s)...`);
  const { spawn } = await import('child_process');
  const env = { ...process.env, COURT_COUNT: String(count) };
  const child = spawn('node', ['src/run-booking.js'], {
    env,
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  child.on('close', (code) => {
    if (code !== 0) console.error(`Booking script exited with code ${code}`);
  });
}

function scheduleBookingForToday(channelId, messageId) {
  const hour = getBookingHour();
  const now = new Date();
  let runAt = new Date(now);
  runAt.setHours(hour, 0, 0, 0);
  if (runAt <= now) {
    runAt.setDate(runAt.getDate() + 1);
  }

  if (bookingJob) bookingJob.cancel();
  scheduledPoll = { channelId, messageId };

  bookingJob = schedule.scheduleJob(runAt, async () => {
    console.log(`Scheduled booking job running at ${new Date().toISOString()}`);
    try {
      const channel = await client.channels.fetch(channelId);
      const message = await channel.messages.fetch(messageId);
      const attendees = await countReactions(message); // excludes bot
      const courts = Math.max(1, Math.ceil(attendees / 2)); // 1 court per 2 attendees
      await runBooking(courts);
      const reply = await channel.send(
        `Booked **${courts}** court(s) for ${attendees} attendee(s). Check the booking site to confirm.`
      );
      setTimeout(() => reply.delete().catch(() => {}), 30_000);
    } catch (e) {
      console.error('Booking job failed:', e);
    } finally {
      scheduledPoll = null;
      bookingJob = null;
    }
  });

  console.log(`Booking scheduled for ${runAt.toISOString()}`);
}

client.on('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);

  const pollChannelId = getPollChannelId();
  if (pollChannelId) {
    const { hour, minute } = getPollTime();
    const cron = `0 ${minute} ${hour} * * 0`; // Sunday
    schedule.scheduleJob(cron, async () => {
      console.log(
        `Sunday ${formatTime({ hour, minute })}: posting squash poll`
      );
      try {
        const channel = await client.channels.fetch(pollChannelId);
        const pollMessage = await channel.send(POLL_TEXT);
        await pollMessage.react(REACTION_EMOJI);
        scheduleBookingForToday(channel.id, pollMessage.id);
        await channel.send(
          `React with ${REACTION_EMOJI} if you're in. Booking will run at **${getBookingHour()}:00** today.`
        );
      } catch (e) {
        console.error('Sunday poll failed:', e);
      }
    });
    console.log(
      `Scheduled weekly poll for Sundays at ${formatTime({ hour, minute })}`
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
      `Poll posted. React with ${REACTION_EMOJI} if you're in. Booking will run at **${getBookingHour()}:00** today.`
    );
  }
});

client.login(process.env.DISCORD_BOT_TOKEN).catch((e) => {
  console.error('Login failed:', e.message);
  if (/disallowed intents/i.test(e.message)) {
    console.error(
      '\nEnable the required intents in the Discord Developer Portal:'
    );
    console.error('  1. Go to https://discord.com/developers/applications');
    console.error('  2. Select your application → Bot (left sidebar)');
    console.error(
      '  3. Under "Privileged Gateway Intents", turn ON "Message Content Intent"'
    );
    console.error('  4. Save and restart the bot.\n');
  }
  process.exit(1);
});
