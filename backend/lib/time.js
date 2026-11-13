/**
 * Local date-time helpers.
 *
 * Planning times are stored as local wall-clock text 'YYYY-MM-DD HH:MM:SS' in
 * the company's time zone. These helpers do arithmetic on that format without
 * depending on the server's own time zone (cloud servers run in UTC).
 */
const DEFAULT_TZ = process.env.APP_TIMEZONE || 'Europe/Berlin';

const pad = (n) => String(n).padStart(2, '0');

/** Parses 'YYYY-MM-DD HH:MM[:SS]' (or with 'T') as a naive wall-clock value (ms). */
function parseLocal(str) {
  if (!str) return NaN;
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

/** Formats a wall-clock ms value back to 'YYYY-MM-DD HH:MM:SS'. */
function formatLocal(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Adds minutes to a local date-time string. */
function addMinutes(str, minutes) {
  const ms = parseLocal(str);
  if (Number.isNaN(ms)) return str;
  return formatLocal(ms + Math.round(minutes) * 60000);
}

/** Minutes between two local date-time strings. */
function diffMinutes(later, earlier) {
  return (parseLocal(later) - parseLocal(earlier)) / 60000;
}

/** Current wall-clock time in the given time zone as 'YYYY-MM-DD HH:MM:SS'. */
function nowLocal(timeZone = DEFAULT_TZ) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function todayLocal(timeZone = DEFAULT_TZ) {
  return nowLocal(timeZone).slice(0, 10);
}

module.exports = { parseLocal, formatLocal, addMinutes, diffMinutes, nowLocal, todayLocal, DEFAULT_TZ };
