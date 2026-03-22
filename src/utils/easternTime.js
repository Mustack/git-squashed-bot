import { DateTime } from 'luxon';

/**
 * IANA zone for US Eastern Time (EST in winter, EDT in summer).
 * Poll and booking env times are interpreted in this zone regardless of server TZ.
 */
export const EASTERN_TZ = 'America/New_York';

/**
 * Next instant when the local clock reads hour:minute in Eastern Time.
 * @param {number} hour - 0–23
 * @param {number} minute - 0–59
 * @returns {Date}
 */
export function nextEasternWallTime(hour, minute) {
  const now = DateTime.now().setZone(EASTERN_TZ);
  let target = now.set({ hour, minute, second: 0, millisecond: 0 });
  if (target <= now) {
    target = target.plus({ days: 1 });
  }
  return target.toJSDate();
}
