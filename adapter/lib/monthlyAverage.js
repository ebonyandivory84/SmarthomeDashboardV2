const { localDateParts, shiftMonthKey } = require("./waterSummary");

const DEFAULT_TIMEZONE = "Europe/Berlin";

function monthStartMs(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return Date.UTC(year, month - 1, 1);
}

// Averages daily-bucketed Influx points into the trailing 12 calendar months
// (timezone-aware, current partial month included) so the "Jahr" view can show
// one data point per month instead of hundreds of raw samples.
function buildMonthlyAverages(points, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const currentMonth = localDateParts(now, timezone).date.slice(0, 7);
  const monthKeys = Array.from({ length: 12 }, (_, index) => shiftMonthKey(currentMonth, index - 11));
  const sums = new Map(monthKeys.map((key) => [key, 0]));
  const counts = new Map(monthKeys.map((key) => [key, 0]));

  for (const point of Array.isArray(points) ? points : []) {
    if (!Number.isFinite(point?.t) || !Number.isFinite(point?.v)) {
      continue;
    }
    const month = localDateParts(point.t, timezone).date.slice(0, 7);
    if (!sums.has(month)) {
      continue;
    }
    sums.set(month, sums.get(month) + point.v);
    counts.set(month, counts.get(month) + 1);
  }

  return monthKeys.map((key) => {
    const count = counts.get(key) || 0;
    return { t: monthStartMs(key), v: count > 0 ? sums.get(key) / count : null };
  });
}

module.exports = { buildMonthlyAverages };
