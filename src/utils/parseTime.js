/**
 * Parses a time string like "12:35pm", "9:00am", "6pm", or "18:00" (24h).
 * @param {string} input - Time string (e.g. "12:35pm", "9am", "18:00")
 * @returns {{ hour: number, minute: number }} 24-hour format (hour 0-23, minute 0-59)
 * @throws {Error} if input cannot be parsed
 */
export function parseTime(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) throw new Error('Empty time string');

  // 24h: "18:00", "18:30", "9:00"
  const twentyFour = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (twentyFour) {
    const hour = parseInt(twentyFour[1], 10);
    const minute = parseInt(twentyFour[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  // 12h with optional :mm: "12:35pm", "9:00am", "6pm", "12am"
  const twelve = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(s);
  if (twelve) {
    let hour = parseInt(twelve[1], 10);
    const minute = twelve[2] != null ? parseInt(twelve[2], 10) : 0;
    const ampm = twelve[3];
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      throw new Error(`Invalid 12h time: ${input}`);
    }
    if (ampm === 'am') {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }
    return { hour, minute };
  }

  throw new Error(`Could not parse time: ${input}. Use e.g. "12:35pm", "9am", or "18:00"`);
}

/**
 * Formats hour/minute as a readable string (e.g. "12:35 PM").
 * @param {{ hour: number, minute: number }}
 */
export function formatTime({ hour, minute }) {
  const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const ampm = hour < 12 ? 'AM' : 'PM';
  const m = String(minute).padStart(2, '0');
  return `${h}:${m} ${ampm}`;
}
