import { createElement, ReactNode, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import { HistoryChartSeriesEntry, HistoryChartWidgetConfig } from "../../types/dashboard";
import { palette } from "../../utils/theme";

type HistoryChartWidgetProps = {
  config: HistoryChartWidgetConfig;
  client: IoBrokerClient;
  isActivePage?: boolean;
};

type SensorPoint = { t: number; v: number | null };
type SensorHistory = Record<string, SensorPoint[]>;
type ValueRange = { min: number; max: number };
type TimeDomain = { minT: number; maxT: number };

const PLOT_WIDTH = 220;
const PLOT_HEIGHT = 100;
const AXIS_LEFT_WIDTH = 30;
const AXIS_RIGHT_WIDTH = 30;
const AXIS_TOP_PADDING = 4;
const AXIS_BOTTOM_HEIGHT = 14;
const CHART_WIDTH = AXIS_LEFT_WIDTH + PLOT_WIDTH + AXIS_RIGHT_WIDTH;
const CHART_HEIGHT = AXIS_TOP_PADDING + PLOT_HEIGHT + AXIS_BOTTOM_HEIGHT;
const HOUR_STEP_CANDIDATES = [1, 2, 3, 4, 6, 12, 24];
const MAX_HOUR_TICKS = 8;

const DEFAULT_SERIES_COLORS = [
  "#ff9152",
  "#4dd0e1",
  "#6ce8b4",
  "#c77dff",
  "#ffd166",
  "#f26d9b",
  "#7fb3ff",
  "#a3e635",
];

export function HistoryChartWidget({ config, client, isActivePage = true }: HistoryChartWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const [history, setHistory] = useState<SensorHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hours = clampIntRange(config.historyHours, 12, 1, 48);
  const refreshMs = clampIntRange(config.refreshMs, 120000, 15000, 3600000);

  const series = config.series || [];
  const seriesKey = useMemo(() => JSON.stringify(series), [series]);
  const ids = useMemo(() => flattenSeriesIds(series), [seriesKey]);

  useEffect(() => {
    if (!runtimeActive || ids.length === 0) {
      return;
    }
    let active = true;
    let inFlight = false;
    let pending = false;

    const sync = async () => {
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      try {
        const payload = await client.readRoomSensorHistory(ids, hours);
        if (active) {
          setHistory(payload);
          setError(null);
        }
      } catch (syncError) {
        if (active) {
          setError(syncError instanceof Error ? syncError.message : "Verlauf konnte nicht geladen werden");
        }
      } finally {
        inFlight = false;
        if (active && pending) {
          pending = false;
          void sync();
        }
      }
    };

    void sync();
    const timer = setInterval(() => {
      void sync();
    }, refreshMs);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [client, ids, hours, refreshMs, runtimeActive]);

  const textColor = config.appearance?.textColor || palette.text;
  const mutedTextColor = config.appearance?.mutedTextColor || palette.textMuted;

  if (Platform.OS !== "web") {
    return (
      <View style={styles.fallback}>
        <Text style={[styles.fallbackTitle, { color: textColor }]}>Verlauf ist aktuell nur im Web verfuegbar.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <HistoryChartPanel series={series} history={history} textColor={textColor} mutedTextColor={mutedTextColor} />
      {error ? (
        <Text numberOfLines={1} style={[styles.footerText, { color: palette.danger }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

type SeriesData = {
  entry: HistoryChartSeriesEntry;
  color: string;
  points: SensorPoint[];
};

type HistoryChartPanelProps = {
  series: HistoryChartSeriesEntry[];
  history: SensorHistory | null;
  textColor: string;
  mutedTextColor: string;
};

function HistoryChartPanel({ series, history, mutedTextColor }: HistoryChartPanelProps) {
  const seriesData: SeriesData[] = series.map((entry, index) => ({
    entry,
    color: entry.color || DEFAULT_SERIES_COLORS[index % DEFAULT_SERIES_COLORS.length],
    points: interpolateSeries(seriesForId(history, entry.stateId)),
  }));

  const hasAnyData = seriesData.some((item) => item.points.length > 0);
  const domain = timeDomain(...seriesData.map((item) => item.points));

  const leftSeries = seriesData.filter((item) => item.entry.axis === "left");
  const rightSeries = seriesData.filter((item) => item.entry.axis === "right");
  const leftRange = axisRange(leftSeries);
  const rightRange = axisRange(rightSeries);

  const paths = seriesData.map((item) => {
    const range = item.entry.axis === "left" ? leftRange : rightRange;
    return {
      color: item.color,
      d: domain && range ? buildSeriesPath(item.points, range, domain) : "",
    };
  });

  const hasAnyLatest = seriesData.some((item) => latestValue(item.points) !== null);

  return createElement(
    "div",
    { style: webPanelStyle },
    hasAnyLatest
      ? createElement(
          "div",
          { style: webStatsRowStyle },
          seriesData.map((item, index) => {
            const value = latestValue(item.points);
            if (value === null) {
              return null;
            }
            const decimals = item.entry.decimals ?? 1;
            const valueText = `${value.toFixed(decimals)}${item.entry.unit ? item.entry.unit : ""}`;
            return statBadge(item.entry.label, valueText, item.color, index % 2 === 0 ? "left" : "right", index);
          })
        )
      : null,
    !hasAnyData || !domain
      ? createElement("div", { style: { ...webEmptyStateStyle, color: mutedTextColor } }, "Keine Daten")
      : renderChart({ paths, mutedTextColor, leftRange, rightRange, domain })
  );
}

function statBadge(label: string, valueText: string, color: string, align: "left" | "right", key: number) {
  return createElement(
    "span",
    { style: { ...webStatBadgeStyle, justifySelf: align, textAlign: align }, key },
    createElement("span", { style: { color, fontWeight: 800 } }, `${label} ${valueText}`)
  );
}

type RenderChartParams = {
  paths: Array<{ color: string; d: string }>;
  mutedTextColor: string;
  leftRange: ValueRange | null;
  rightRange: ValueRange | null;
  domain: TimeDomain;
};

function renderChart({ paths, mutedTextColor, leftRange, rightRange, domain }: RenderChartParams) {
  const hourTicks = buildHourTicks(domain);
  const children: ReactNode[] = [];
  const labels: ReactNode[] = [];

  children.push(
    createElement("rect", {
      key: "plot-border",
      x: 0,
      y: 0,
      width: PLOT_WIDTH,
      height: PLOT_HEIGHT,
      fill: "none",
      stroke: "rgba(255,255,255,0.12)",
      strokeWidth: 1,
    })
  );
  children.push(
    createElement("line", {
      key: "mid-guide",
      x1: 0,
      y1: PLOT_HEIGHT / 2,
      x2: PLOT_WIDTH,
      y2: PLOT_HEIGHT / 2,
      stroke: "rgba(255,255,255,0.06)",
      strokeWidth: 1,
      strokeDasharray: "2,2",
    })
  );

  hourTicks.forEach((tick) => {
    const x = xForT(tick.t, domain);
    children.push(
      createElement("line", {
        key: `xtick-${tick.t}`,
        x1: x,
        y1: PLOT_HEIGHT,
        x2: x,
        y2: PLOT_HEIGHT + 3,
        stroke: mutedTextColor,
        strokeWidth: 1,
      })
    );
    labels.push(
      axisLabel(`xlabel-${tick.t}`, tick.label, x + AXIS_LEFT_WIDTH, PLOT_HEIGHT + 11 + AXIS_TOP_PADDING, "center", mutedTextColor)
    );
  });

  if (leftRange) {
    labels.push(axisLabel("l-top", leftRange.max.toFixed(1), AXIS_LEFT_WIDTH - 4, 5 + AXIS_TOP_PADDING, "right", mutedTextColor));
    labels.push(
      axisLabel("l-bottom", leftRange.min.toFixed(1), AXIS_LEFT_WIDTH - 4, PLOT_HEIGHT + AXIS_TOP_PADDING, "right", mutedTextColor)
    );
  }
  if (rightRange) {
    labels.push(
      axisLabel("r-top", rightRange.max.toFixed(1), AXIS_LEFT_WIDTH + PLOT_WIDTH + 4, 5 + AXIS_TOP_PADDING, "left", mutedTextColor)
    );
    labels.push(
      axisLabel(
        "r-bottom",
        rightRange.min.toFixed(1),
        AXIS_LEFT_WIDTH + PLOT_WIDTH + 4,
        PLOT_HEIGHT + AXIS_TOP_PADDING,
        "left",
        mutedTextColor
      )
    );
  }

  paths.forEach((path, index) => {
    if (!path.d) {
      return;
    }
    children.push(
      createElement("path", { key: `series-${index}`, d: path.d, fill: "none", stroke: path.color, strokeWidth: 2 })
    );
  });

  return createElement(
    "div",
    { style: webChartWrapperStyle },
    createElement(
      "svg",
      {
        viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
        width: "100%",
        height: "100%",
        preserveAspectRatio: "none",
        style: webChartSvgStyle,
      },
      createElement("g", { transform: `translate(${AXIS_LEFT_WIDTH}, ${AXIS_TOP_PADDING})` }, ...children)
    ),
    createElement("div", { style: webAxisLabelLayerStyle }, ...labels)
  );
}

function axisLabel(key: string, text: string, x: number, y: number, align: "left" | "center" | "right", color: string) {
  const translateX = align === "center" ? "-50%" : align === "right" ? "-100%" : "0%";
  return createElement(
    "span",
    {
      key,
      style: {
        position: "absolute" as const,
        left: `${(x / CHART_WIDTH) * 100}%`,
        top: `${(y / CHART_HEIGHT) * 100}%`,
        transform: `translate(${translateX}, -50%)`,
        color,
        fontSize: "10px",
        fontWeight: 700,
        whiteSpace: "nowrap" as const,
      },
    },
    text
  );
}

function flattenSeriesIds(series: HistoryChartSeriesEntry[]) {
  const ids = new Set<string>();
  for (const entry of series) {
    if (entry.stateId) {
      ids.add(entry.stateId);
    }
  }
  return Array.from(ids);
}

function seriesForId(history: SensorHistory | null, id?: string): SensorPoint[] {
  if (!id || !history) {
    return [];
  }
  return history[id] || [];
}

function interpolateSeries(points: SensorPoint[]): SensorPoint[] {
  const result = points.map((point) => ({ ...point }));
  let lastKnownIndex = -1;
  for (let i = 0; i < result.length; i += 1) {
    const v = result[i].v;
    if (v === null || !Number.isFinite(v)) {
      continue;
    }
    if (lastKnownIndex !== -1 && i - lastKnownIndex > 1) {
      const start = result[lastKnownIndex];
      const end = result[i];
      const timeSpan = end.t - start.t || 1;
      const valueSpan = (end.v as number) - (start.v as number);
      for (let j = lastKnownIndex + 1; j < i; j += 1) {
        const ratio = (result[j].t - start.t) / timeSpan;
        result[j].v = (start.v as number) + valueSpan * ratio;
      }
    }
    lastKnownIndex = i;
  }
  return result;
}

function combinedRange(...seriesList: SensorPoint[][]): ValueRange | null {
  let min = Infinity;
  let max = -Infinity;
  for (const points of seriesList) {
    for (const point of points) {
      if (point.v === null || !Number.isFinite(point.v)) {
        continue;
      }
      min = Math.min(min, point.v);
      max = Math.max(max, point.v);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }
  return { min, max };
}

function seriesBoundRange(points: SensorPoint[], overrideMin?: number, overrideMax?: number): ValueRange | null {
  const dataRange = combinedRange(points);
  if (overrideMin === undefined && overrideMax === undefined) {
    return dataRange;
  }
  const min = overrideMin !== undefined ? overrideMin : dataRange ? dataRange.min : (overrideMax as number) - 1;
  const max = overrideMax !== undefined ? overrideMax : dataRange ? dataRange.max : (overrideMin as number) + 1;
  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

function axisRange(entries: SeriesData[]): ValueRange | null {
  const fixedEntries = entries.filter((item) => item.entry.axisMin !== undefined && item.entry.axisMax !== undefined);
  const relevant = fixedEntries.length > 0 ? fixedEntries : entries;
  return unionRanges(relevant.map((item) => seriesBoundRange(item.points, item.entry.axisMin, item.entry.axisMax)));
}

function unionRanges(ranges: Array<ValueRange | null>): ValueRange | null {
  let min = Infinity;
  let max = -Infinity;
  for (const range of ranges) {
    if (!range) {
      continue;
    }
    min = Math.min(min, range.min);
    max = Math.max(max, range.max);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }
  return { min, max };
}

function timeDomain(...seriesList: SensorPoint[][]): TimeDomain | null {
  let minT = Infinity;
  let maxT = -Infinity;
  for (const points of seriesList) {
    for (const point of points) {
      if (!Number.isFinite(point.t)) {
        continue;
      }
      minT = Math.min(minT, point.t);
      maxT = Math.max(maxT, point.t);
    }
  }
  if (!Number.isFinite(minT) || !Number.isFinite(maxT)) {
    return null;
  }
  if (minT === maxT) {
    return { minT: minT - 1, maxT: maxT + 1 };
  }
  return { minT, maxT };
}

function xForT(t: number, domain: TimeDomain) {
  const span = domain.maxT - domain.minT || 1;
  return ((t - domain.minT) / span) * PLOT_WIDTH;
}

function buildSeriesPath(points: SensorPoint[], range: ValueRange, domain: TimeDomain) {
  if (points.length === 0) {
    return "";
  }
  const valueSpan = range.max - range.min || 1;
  let path = "";
  let drawing = false;

  for (const point of points) {
    if (!Number.isFinite(point.t)) {
      continue;
    }
    const x = xForT(point.t, domain);
    if (point.v === null || !Number.isFinite(point.v)) {
      drawing = false;
      continue;
    }
    const y = PLOT_HEIGHT - ((point.v - range.min) / valueSpan) * PLOT_HEIGHT;
    path += `${drawing ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    drawing = true;
  }

  return path.trim();
}

function buildHourTicks(domain: TimeDomain) {
  const spanHours = (domain.maxT - domain.minT) / 3_600_000;
  let stepHours = HOUR_STEP_CANDIDATES[HOUR_STEP_CANDIDATES.length - 1];
  for (const candidate of HOUR_STEP_CANDIDATES) {
    if (spanHours / candidate <= MAX_HOUR_TICKS) {
      stepHours = candidate;
      break;
    }
  }

  const stepMs = stepHours * 3_600_000;
  const firstTickT = Math.ceil(domain.minT / stepMs) * stepMs;
  const ticks: { t: number; label: string }[] = [];
  for (let t = firstTickT; t <= domain.maxT; t += stepMs) {
    ticks.push({ t, label: formatHourLabel(t) });
  }
  return ticks;
}

function formatHourLabel(t: number) {
  const date = new Date(t);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function latestValue(points: SensorPoint[]) {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].v !== null && Number.isFinite(points[i].v)) {
      return points[i].v as number;
    }
  }
  return null;
}

function clampIntRange(raw: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(raw as number)));
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 8,
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  fallbackTitle: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  footerText: {
    fontSize: 10,
    fontWeight: "700",
    marginTop: 6,
  },
});

const webPanelStyle = {
  borderRadius: "12px",
  border: "1px solid rgba(255,255,255,0.08)",
  backgroundColor: "rgba(255,255,255,0.03)",
  padding: "10px",
  display: "flex",
  flexDirection: "column" as const,
  gap: "6px",
  flex: 1,
  minHeight: 0,
};

const webChartWrapperStyle = {
  position: "relative" as const,
  flex: 1,
  minHeight: 0,
  width: "100%",
};

const webChartSvgStyle = {
  display: "block",
};

const webAxisLabelLayerStyle = {
  position: "absolute" as const,
  inset: 0,
  pointerEvents: "none" as const,
};

const webStatsRowStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "4px 8px",
};

const webStatBadgeStyle = {
  fontSize: "11px",
};

const webEmptyStateStyle = {
  fontSize: "12px",
  fontWeight: 600,
  textAlign: "center" as const,
  padding: "16px 0",
};
