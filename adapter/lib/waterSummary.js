const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEZONE = "Europe/Berlin";
const formatterCache = new Map();

function getFormatter(timezone) {
  const cacheKey = timezone || DEFAULT_TIMEZONE;
  if (formatterCache.has(cacheKey)) {
    return formatterCache.get(cacheKey);
  }

  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: cacheKey,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  }

  formatterCache.set(cacheKey, formatter);
  return formatter;
}

function localDateParts(timestamp, timezone) {
  const parts = getFormatter(timezone).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);
  const minute = Number(values.minute);

  return {
    date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    minuteOfDay: hour * 60 + minute,
  };
}

function shiftDateKey(dateKey, offsetDays) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

function startOfWeekDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shiftDateKey(dateKey, weekday === 0 ? -6 : 1 - weekday);
}

function shiftMonthKey(monthKey, offsetMonths) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + offsetMonths, 1)).toISOString().slice(0, 7);
}

function average(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return 0;
  }
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function round(value, decimals = 1) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function percentDifference(value, reference) {
  if (!Number.isFinite(value) || !Number.isFinite(reference) || reference <= 0) {
    return null;
  }
  return round(((value - reference) / reference) * 100, 1);
}

function buildWaterMonthlyValues(points, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const multiplier = Math.max(0.001, Math.min(1_000_000, Number(options.multiplier) || 1000));
  const maxFlowLitersPerMinute = Math.max(1, Math.min(1000, Number(options.maxFlowLitersPerMinute) || 80));
  const currentMonth = localDateParts(now, timezone).date.slice(0, 7);
  const monthKeys = Array.from({ length: 12 }, (_, index) => shiftMonthKey(currentMonth, index - 11));
  const monthLiters = new Map(monthKeys.map((key) => [key, 0]));
  const samples = (Array.isArray(points) ? points : [])
    .filter((point) => Number.isFinite(point?.t) && Number.isFinite(point?.v))
    .map((point) => ({ t: Number(point.t), v: Number(point.v) }))
    .sort((left, right) => left.t - right.t);

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const elapsedMinutes = Math.max(1, Math.min(120, (current.t - previous.t) / 60_000));
    const deltaLiters = (current.v - previous.v) * multiplier;
    const maxPlausibleDelta = maxFlowLitersPerMinute * elapsedMinutes * 1.25;
    const month = localDateParts(current.t, timezone).date.slice(0, 7);

    if (!monthLiters.has(month) || deltaLiters < 0 || deltaLiters > maxPlausibleDelta) {
      continue;
    }
    monthLiters.set(month, (monthLiters.get(month) || 0) + deltaLiters);
  }

  return monthKeys.map((month) => ({ month, liters: round(monthLiters.get(month) || 0) }));
}

function buildWaterSummary(points, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const displayDays = Math.max(3, Math.min(14, Math.round(Number(options.displayDays) || 7)));
  const multiplier = Math.max(0.001, Math.min(1_000_000, Number(options.multiplier) || 1000));
  const maxFlowLitersPerMinute = Math.max(1, Math.min(1000, Number(options.maxFlowLitersPerMinute) || 80));
  const nowLocal = localDateParts(now, timezone);
  const recentKeys = Array.from({ length: displayDays }, (_, index) =>
    shiftDateKey(nowLocal.date, index - displayDays)
  );
  const previousKeys = Array.from({ length: displayDays }, (_, index) =>
    shiftDateKey(nowLocal.date, index - displayDays * 2)
  );
  const weekStartKey = startOfWeekDateKey(nowLocal.date);
  const weekKeys = [];
  for (let date = weekStartKey; date <= nowLocal.date; date = shiftDateKey(date, 1)) {
    weekKeys.push(date);
  }
  const relevantKeys = new Set([...previousKeys, ...recentKeys, ...weekKeys, nowLocal.date]);
  const dailyLiters = new Map([...relevantKeys].map((key) => [key, 0]));
  const untilNowLiters = new Map([...recentKeys].map((key) => [key, 0]));
  const coveredDays = new Set();
  const intradayBucketMs = 30 * 60 * 1000;
  const intradayBucketCount = 24;
  const intradayStart =
    Math.floor(now / intradayBucketMs) * intradayBucketMs - (intradayBucketCount - 1) * intradayBucketMs;
  const intraday = Array.from({ length: intradayBucketCount }, (_, index) => ({
    t: intradayStart + index * intradayBucketMs,
    liters: 0,
  }));
  let recentLiters = 0;

  const samples = (Array.isArray(points) ? points : [])
    .filter((point) => Number.isFinite(point?.t) && Number.isFinite(point?.v))
    .map((point) => ({ t: Number(point.t), v: Number(point.v) }))
    .sort((left, right) => left.t - right.t);

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const elapsedMinutes = Math.max(1, Math.min(30, (current.t - previous.t) / 60_000));
    const deltaLiters = (current.v - previous.v) * multiplier;
    const maxPlausibleDelta = maxFlowLitersPerMinute * elapsedMinutes * 1.25;
    const local = localDateParts(current.t, timezone);

    if (relevantKeys.has(local.date)) {
      coveredDays.add(local.date);
    }

    if (deltaLiters < 0 || deltaLiters > maxPlausibleDelta || !relevantKeys.has(local.date)) {
      continue;
    }

    dailyLiters.set(local.date, (dailyLiters.get(local.date) || 0) + deltaLiters);
    if (untilNowLiters.has(local.date) && local.minuteOfDay <= nowLocal.minuteOfDay) {
      untilNowLiters.set(local.date, (untilNowLiters.get(local.date) || 0) + deltaLiters);
    }
    if (current.t >= intradayStart && current.t <= now) {
      const bucketIndex = Math.min(
        intradayBucketCount - 1,
        Math.floor((current.t - intradayStart) / intradayBucketMs)
      );
      if (bucketIndex >= 0) {
        intraday[bucketIndex].liters += deltaLiters;
      }
    }
    if (current.t >= now - intradayBucketMs && current.t <= now) {
      recentLiters += deltaLiters;
    }
  }

  const recentDailyValues = recentKeys.filter((key) => coveredDays.has(key)).map((key) => dailyLiters.get(key) || 0);
  const previousDailyValues = previousKeys.filter((key) => coveredDays.has(key)).map((key) => dailyLiters.get(key) || 0);
  const sameTimeValues = recentKeys.filter((key) => coveredDays.has(key)).map((key) => untilNowLiters.get(key) || 0);
  const todayLiters = dailyLiters.get(nowLocal.date) || 0;
  const averageDayLiters = average(recentDailyValues);
  const averageUntilNowLiters = average(sameTimeValues);
  const previousAverage = average(previousDailyValues);

  return {
    generatedAt: now,
    latestMeterValue: samples.length > 0 ? samples[samples.length - 1].v : null,
    todayLiters: round(todayLiters),
    yesterdayLiters: round(dailyLiters.get(shiftDateKey(nowLocal.date, -1)) || 0),
    averageDayLiters: round(averageDayLiters),
    averageUntilNowLiters: round(averageUntilNowLiters),
    comparisonPercent: percentDifference(todayLiters, averageUntilNowLiters),
    trendPercent: percentDifference(averageDayLiters, previousAverage),
    daily: [...recentKeys, nowLocal.date].map((date) => ({
      date,
      liters: round(dailyLiters.get(date) || 0),
      ...(date === nowLocal.date ? { isToday: true } : null),
    })),
    intraday: intraday.map((entry) => ({ t: entry.t, liters: round(entry.liters) })),
    monthly: Array.isArray(options.monthlyValues)
      ? options.monthlyValues
      : buildWaterMonthlyValues(samples, options),
    recentLitersPerHour: round(recentLiters * 2),
    currentWeekLiters: round(weekKeys.reduce((sum, date) => sum + (dailyLiters.get(date) || 0), 0)),
  };
}

module.exports = {
  buildWaterMonthlyValues,
  buildWaterSummary,
  localDateParts,
  shiftMonthKey,
};
