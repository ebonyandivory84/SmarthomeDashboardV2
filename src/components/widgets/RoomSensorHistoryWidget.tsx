import { createElement, ReactNode, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import { RoomSensorEntry, RoomSensorHistoryWidgetConfig } from "../../types/dashboard";
import { palette } from "../../utils/theme";

type RoomSensorHistoryWidgetProps = {
  config: RoomSensorHistoryWidgetConfig;
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
const LABEL_STEP_CANDIDATES = [2, 3, 4, 6, 12, 24];
const MAX_LABEL_TICKS = 8;
const TEMP_AXIS_MIN = 15;
const TEMP_AXIS_MAX = 35;

export function RoomSensorHistoryWidget({ config, client, isActivePage = true }: RoomSensorHistoryWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const [history, setHistory] = useState<SensorHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hours = clampIntRange(config.historyHours, 6, 1, 48);
  const refreshMs = clampIntRange(config.refreshMs, 120000, 15000, 3600000);

  const rooms = config.rooms || [];
  const roomsKey = useMemo(() => JSON.stringify(rooms), [rooms]);
  const ids = useMemo(() => flattenRoomSensorIds(rooms), [roomsKey]);

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
  const tempColor = config.appearance?.cardColor || "#ff9152";
  const humidityColor = config.appearance?.cardColor2 || "#4dd0e1";
  const co2Color = config.appearance?.pvCardColor || "#6ce8b4";
  const vocColor = config.appearance?.homeCardColor || "#c77dff";

  if (Platform.OS !== "web") {
    return (
      <View style={styles.fallback}>
        <Text style={[styles.fallbackTitle, { color: textColor }]}>Raumsensoren-Verlauf ist aktuell nur im Web verfuegbar.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {createElement(
        "div",
        { style: webGridStyle },
        rooms.map((room, index) =>
          createElement(RoomSensorPanel, {
            key: `${room.label}-${index}`,
            room,
            history,
            tempColor,
            humidityColor,
            co2Color,
            vocColor,
            textColor,
            mutedTextColor,
          })
        )
      )}
      {error ? (
        <Text numberOfLines={1} style={[styles.footerText, { color: palette.danger }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

type RoomSensorPanelProps = {
  room: RoomSensorEntry;
  history: SensorHistory | null;
  tempColor: string;
  humidityColor: string;
  co2Color: string;
  vocColor: string;
  textColor: string;
  mutedTextColor: string;
};

function RoomSensorPanel({
  room,
  history,
  tempColor,
  humidityColor,
  co2Color,
  vocColor,
  textColor,
  mutedTextColor,
}: RoomSensorPanelProps) {
  const tempPoints = interpolateSeries(seriesForId(history, room.temperatureStateId));
  const humidityPoints = interpolateSeries(seriesForId(history, room.humidityStateId));
  const co2Points = interpolateSeries(seriesForId(history, room.co2StateId));
  const vocPoints = interpolateSeries(seriesForId(history, room.vocStateId));

  const hasTempData = tempPoints.length > 0;
  const hasSecondaryData = humidityPoints.length > 0 || co2Points.length > 0 || vocPoints.length > 0;
  const hasAnyData = hasTempData || hasSecondaryData;

  const domain = timeDomain(tempPoints, humidityPoints, co2Points, vocPoints);
  const tempRange = temperatureAxisRange(tempPoints, room.temperatureMin, room.temperatureMax);
  const secondaryRange = axisRange([
    { points: humidityPoints, overrideMin: room.humidityMin, overrideMax: room.humidityMax },
    { points: co2Points, overrideMin: room.co2Min, overrideMax: room.co2Max },
    { points: vocPoints, overrideMin: room.vocMin, overrideMax: room.vocMax },
  ]);

  const tempPath = domain && tempRange ? buildSeriesPath(tempPoints, tempRange, domain) : "";
  const humidityPath = domain && secondaryRange ? buildSeriesPath(humidityPoints, secondaryRange, domain) : "";
  const co2Path = domain && secondaryRange ? buildSeriesPath(co2Points, secondaryRange, domain) : "";
  const vocPath = domain && secondaryRange ? buildSeriesPath(vocPoints, secondaryRange, domain) : "";

  const latestTemp = latestValue(tempPoints);
  const latestHumidity = latestValue(humidityPoints);
  const latestCo2 = latestValue(co2Points);
  const latestVoc = latestValue(vocPoints);
  const hasAnyLatest = latestTemp !== null || latestHumidity !== null || latestCo2 !== null || latestVoc !== null;

  return createElement(
    "div",
    { style: webPanelStyle },
    createElement(
      "div",
      { style: webPanelHeaderStyle },
      createElement("span", { style: { ...webRoomLabelStyle, color: textColor } }, room.label)
    ),
    hasAnyLatest
      ? createElement(
          "div",
          { style: webStatsRowStyle },
          latestTemp !== null ? statBadge("Temp", `${latestTemp.toFixed(1)}°C`, tempColor, "left") : null,
          latestHumidity !== null ? statBadge("Feuchte", `${Math.round(latestHumidity)}%`, humidityColor, "right") : null,
          latestCo2 !== null ? statBadge("CO2", `${Math.round(latestCo2)}`, co2Color, "left") : null,
          latestVoc !== null ? statBadge("VOC", `${Math.round(latestVoc)}`, vocColor, "right") : null
        )
      : null,
    !hasAnyData || !domain
      ? createElement("div", { style: { ...webEmptyStateStyle, color: mutedTextColor } }, "Keine Daten")
      : renderChart({
          tempPath,
          humidityPath,
          co2Path,
          vocPath,
          tempColor,
          humidityColor,
          co2Color,
          vocColor,
          mutedTextColor,
          tempRange,
          secondaryRange,
          domain,
        })
  );
}

function statBadge(label: string, valueText: string, color: string, align: "left" | "right") {
  return createElement(
    "span",
    { style: { ...webStatBadgeStyle, justifySelf: align, textAlign: align }, key: label },
    createElement("span", { style: { color, fontWeight: 800 } }, `${label} ${valueText}`)
  );
}

type RenderChartParams = {
  tempPath: string;
  humidityPath: string;
  co2Path: string;
  vocPath: string;
  tempColor: string;
  humidityColor: string;
  co2Color: string;
  vocColor: string;
  mutedTextColor: string;
  tempRange: ValueRange | null;
  secondaryRange: ValueRange | null;
  domain: TimeDomain;
};

function renderChart({
  tempPath,
  humidityPath,
  co2Path,
  vocPath,
  tempColor,
  humidityColor,
  co2Color,
  vocColor,
  mutedTextColor,
  tempRange,
  secondaryRange,
  domain,
}: RenderChartParams) {
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
    if (tick.label !== null) {
      labels.push(
        axisLabel(`xlabel-${tick.t}`, tick.label, x + AXIS_LEFT_WIDTH, PLOT_HEIGHT + 11 + AXIS_TOP_PADDING, "center", mutedTextColor)
      );
    }
  });

  if (tempRange) {
    labels.push(axisLabel("t-top", tempRange.max.toFixed(1), AXIS_LEFT_WIDTH - 4, 5 + AXIS_TOP_PADDING, "right", tempColor));
    labels.push(
      axisLabel("t-bottom", tempRange.min.toFixed(1), AXIS_LEFT_WIDTH - 4, PLOT_HEIGHT + AXIS_TOP_PADDING, "right", tempColor)
    );
  }
  if (secondaryRange) {
    labels.push(
      axisLabel(
        "s-top",
        `${Math.round(secondaryRange.max)}`,
        AXIS_LEFT_WIDTH + PLOT_WIDTH + 4,
        5 + AXIS_TOP_PADDING,
        "left",
        mutedTextColor
      )
    );
    labels.push(
      axisLabel(
        "s-bottom",
        `${Math.round(secondaryRange.min)}`,
        AXIS_LEFT_WIDTH + PLOT_WIDTH + 4,
        PLOT_HEIGHT + AXIS_TOP_PADDING,
        "left",
        mutedTextColor
      )
    );
  }

  if (tempPath) {
    children.push(createElement("path", { key: "temp", d: tempPath, fill: "none", stroke: tempColor, strokeWidth: 2 }));
  }
  if (humidityPath) {
    children.push(
      createElement("path", { key: "humidity", d: humidityPath, fill: "none", stroke: humidityColor, strokeWidth: 1.5, strokeDasharray: "3,2" })
    );
  }
  if (co2Path) {
    children.push(createElement("path", { key: "co2", d: co2Path, fill: "none", stroke: co2Color, strokeWidth: 1.5, strokeDasharray: "3,2" }));
  }
  if (vocPath) {
    children.push(createElement("path", { key: "voc", d: vocPath, fill: "none", stroke: vocColor, strokeWidth: 1.5, strokeDasharray: "3,2" }));
  }

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

function flattenRoomSensorIds(rooms: RoomSensorEntry[]) {
  const ids = new Set<string>();
  for (const room of rooms) {
    if (room.temperatureStateId) ids.add(room.temperatureStateId);
    if (room.humidityStateId) ids.add(room.humidityStateId);
    if (room.co2StateId) ids.add(room.co2StateId);
    if (room.vocStateId) ids.add(room.vocStateId);
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
  for (const series of seriesList) {
    for (const point of series) {
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

function temperatureAxisRange(points: SensorPoint[], overrideMin?: number, overrideMax?: number): ValueRange | null {
  if (overrideMin !== undefined || overrideMax !== undefined) {
    return seriesBoundRange(points, overrideMin, overrideMax);
  }
  const dataRange = combinedRange(points);
  if (!dataRange) {
    return null;
  }
  return {
    min: Math.min(TEMP_AXIS_MIN, dataRange.min),
    max: Math.max(TEMP_AXIS_MAX, dataRange.max),
  };
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

function axisRange(entries: Array<{ points: SensorPoint[]; overrideMin?: number; overrideMax?: number }>): ValueRange | null {
  const fixedEntries = entries.filter((item) => item.overrideMin !== undefined && item.overrideMax !== undefined);
  const relevant = fixedEntries.length > 0 ? fixedEntries : entries;
  return unionRanges(relevant.map((item) => seriesBoundRange(item.points, item.overrideMin, item.overrideMax)));
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
  for (const series of seriesList) {
    for (const point of series) {
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
  let labelStepHours = LABEL_STEP_CANDIDATES[LABEL_STEP_CANDIDATES.length - 1];
  for (const candidate of LABEL_STEP_CANDIDATES) {
    if (spanHours / candidate <= MAX_LABEL_TICKS) {
      labelStepHours = candidate;
      break;
    }
  }

  const firstTickT = startOfNextHour(domain.minT);
  const ticks: { t: number; label: string | null }[] = [];
  for (let t = firstTickT; t <= domain.maxT; t += 3_600_000) {
    const hour = new Date(t).getHours();
    ticks.push({ t, label: hour % labelStepHours === 0 ? formatHourLabel(t) : null });
  }
  return ticks;
}

function startOfNextHour(t: number) {
  const date = new Date(t);
  date.setMinutes(0, 0, 0);
  if (date.getTime() < t) {
    date.setHours(date.getHours() + 1);
  }
  return date.getTime();
}

function formatHourLabel(t: number) {
  return `${new Date(t).getHours()}h`;
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

const webGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gridAutoRows: "1fr",
  gap: "8px",
  width: "100%",
  flex: 1,
  minHeight: 0,
};

const webPanelStyle = {
  borderRadius: "12px",
  border: "1px solid rgba(255,255,255,0.08)",
  backgroundColor: "rgba(255,255,255,0.03)",
  padding: "10px",
  display: "flex",
  flexDirection: "column" as const,
  gap: "6px",
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

const webPanelHeaderStyle = {
  display: "flex",
  flexDirection: "row" as const,
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "6px",
};

const webRoomLabelStyle = {
  fontSize: "13px",
  fontWeight: 800,
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
