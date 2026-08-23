import { createElement, ReactNode } from "react";
import { RoomSensorEntry } from "../../types/dashboard";

export type SensorPoint = { t: number; v: number | null };
export type SensorHistory = Record<string, SensorPoint[]>;
export type ValueRange = { min: number; max: number };
export type TimeDomain = { minT: number; maxT: number };

export type ChartLayout = {
  plotWidth: number;
  plotHeight: number;
  axisLeftWidth: number;
  axisRightWidth: number;
  axisTopPadding: number;
  axisBottomHeight: number;
};

export const TEMP_AXIS_MIN = 15;
export const TEMP_AXIS_MAX = 35;

const HOUR_LABEL_STEP_CANDIDATES = [2, 3, 4, 6, 12, 24];
const DAY_STEP_CANDIDATES = [1, 2, 3, 5, 7, 10, 15, 30];
const MAX_LABEL_TICKS = 8;

export function chartWidth(layout: ChartLayout) {
  return layout.axisLeftWidth + layout.plotWidth + layout.axisRightWidth;
}

export function chartHeight(layout: ChartLayout) {
  return layout.axisTopPadding + layout.plotHeight + layout.axisBottomHeight;
}

export function flattenRoomSensorIds(rooms: RoomSensorEntry[]) {
  const ids = new Set<string>();
  for (const room of rooms) {
    if (room.temperatureStateId) ids.add(room.temperatureStateId);
    if (room.humidityStateId) ids.add(room.humidityStateId);
    if (room.co2StateId) ids.add(room.co2StateId);
    if (room.vocStateId) ids.add(room.vocStateId);
  }
  return Array.from(ids);
}

export function flattenSeriesIds(entries: Array<{ stateId?: string }>) {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.stateId) {
      ids.add(entry.stateId);
    }
  }
  return Array.from(ids);
}

export const DEFAULT_SERIES_COLORS = [
  "#ff9152",
  "#4dd0e1",
  "#6ce8b4",
  "#c77dff",
  "#ffd166",
  "#f26d9b",
  "#7fb3ff",
  "#a3e635",
];

export function seriesForId(history: SensorHistory | null, id?: string): SensorPoint[] {
  if (!id || !history) {
    return [];
  }
  return history[id] || [];
}

export function interpolateSeries(points: SensorPoint[]): SensorPoint[] {
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

export function combinedRange(...seriesList: SensorPoint[][]): ValueRange | null {
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

export function temperatureAxisRange(points: SensorPoint[], overrideMin?: number, overrideMax?: number): ValueRange | null {
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

export function seriesBoundRange(points: SensorPoint[], overrideMin?: number, overrideMax?: number): ValueRange | null {
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

export function axisRange(entries: Array<{ points: SensorPoint[]; overrideMin?: number; overrideMax?: number }>): ValueRange | null {
  const fixedEntries = entries.filter((item) => item.overrideMin !== undefined && item.overrideMax !== undefined);
  const relevant = fixedEntries.length > 0 ? fixedEntries : entries;
  return unionRanges(relevant.map((item) => seriesBoundRange(item.points, item.overrideMin, item.overrideMax)));
}

export function unionRanges(ranges: Array<ValueRange | null>): ValueRange | null {
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

export function timeDomain(...seriesList: SensorPoint[][]): TimeDomain | null {
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

export function xForT(t: number, domain: TimeDomain, layout: ChartLayout) {
  const span = domain.maxT - domain.minT || 1;
  return ((t - domain.minT) / span) * layout.plotWidth;
}

export function buildSeriesPath(points: SensorPoint[], range: ValueRange, domain: TimeDomain, layout: ChartLayout) {
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
    const x = xForT(point.t, domain, layout);
    if (point.v === null || !Number.isFinite(point.v)) {
      drawing = false;
      continue;
    }
    const y = layout.plotHeight - ((point.v - range.min) / valueSpan) * layout.plotHeight;
    path += `${drawing ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    drawing = true;
  }

  return path.trim();
}

export type TimeTick = { t: number; label: string | null };

export function buildTimeTicks(domain: TimeDomain): TimeTick[] {
  const spanHours = (domain.maxT - domain.minT) / 3_600_000;
  return spanHours <= 48 ? buildHourTicks(domain) : buildDayTicks(domain);
}

function buildHourTicks(domain: TimeDomain): TimeTick[] {
  const spanHours = (domain.maxT - domain.minT) / 3_600_000;
  let labelStepHours = HOUR_LABEL_STEP_CANDIDATES[HOUR_LABEL_STEP_CANDIDATES.length - 1];
  for (const candidate of HOUR_LABEL_STEP_CANDIDATES) {
    if (spanHours / candidate <= MAX_LABEL_TICKS) {
      labelStepHours = candidate;
      break;
    }
  }

  const firstTickT = startOfNextHour(domain.minT);
  const ticks: TimeTick[] = [];
  for (let t = firstTickT; t <= domain.maxT; t += 3_600_000) {
    const hour = new Date(t).getHours();
    ticks.push({ t, label: hour % labelStepHours === 0 ? formatHourLabel(t) : null });
  }
  return ticks;
}

function buildDayTicks(domain: TimeDomain): TimeTick[] {
  const spanDays = (domain.maxT - domain.minT) / 86_400_000;
  let stepDays = DAY_STEP_CANDIDATES[DAY_STEP_CANDIDATES.length - 1];
  for (const candidate of DAY_STEP_CANDIDATES) {
    if (spanDays / candidate <= MAX_LABEL_TICKS) {
      stepDays = candidate;
      break;
    }
  }

  const firstTickT = startOfNextDay(domain.minT);
  const ticks: TimeTick[] = [];
  let dayIndex = 0;
  for (let t = firstTickT; t <= domain.maxT; t += 86_400_000) {
    ticks.push({ t, label: dayIndex % stepDays === 0 ? formatDayLabel(t) : null });
    dayIndex += 1;
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

function startOfNextDay(t: number) {
  const date = new Date(t);
  date.setHours(0, 0, 0, 0);
  if (date.getTime() < t) {
    date.setDate(date.getDate() + 1);
  }
  return date.getTime();
}

function formatHourLabel(t: number) {
  return `${new Date(t).getHours()}h`;
}

function formatDayLabel(t: number) {
  const date = new Date(t);
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.`;
}

const MONTH_LABELS_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export function buildMonthTicks(points: SensorPoint[]): TimeTick[] {
  return points
    .filter((point) => Number.isFinite(point.t))
    .map((point) => ({ t: point.t, label: MONTH_LABELS_DE[new Date(point.t).getMonth()] }));
}

export function latestValue(points: SensorPoint[]) {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].v !== null && Number.isFinite(points[i].v)) {
      return points[i].v as number;
    }
  }
  return null;
}

export function valueAtTime(points: SensorPoint[], t: number): number | null {
  if (points.length === 0) {
    return null;
  }
  if (t <= points[0].t) {
    return points[0].v;
  }
  const last = points[points.length - 1];
  if (t >= last.t) {
    return last.v;
  }
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].t >= t) {
      const a = points[i - 1];
      const b = points[i];
      if (a.v === null || b.v === null) {
        return null;
      }
      const ratio = (t - a.t) / (b.t - a.t || 1);
      return a.v + (b.v - a.v) * ratio;
    }
  }
  return last.v;
}

export function valueToY(value: number, range: ValueRange, layout: ChartLayout) {
  const valueSpan = range.max - range.min || 1;
  return layout.plotHeight - ((value - range.min) / valueSpan) * layout.plotHeight;
}

export function axisLabel(
  key: string,
  text: string,
  x: number,
  y: number,
  align: "left" | "center" | "right",
  color: string,
  layout: ChartLayout,
  fontSize = 10
) {
  const translateX = align === "center" ? "-50%" : align === "right" ? "-100%" : "0%";
  return createElement(
    "span",
    {
      key,
      style: {
        position: "absolute" as const,
        left: `${(x / chartWidth(layout)) * 100}%`,
        top: `${(y / chartHeight(layout)) * 100}%`,
        transform: `translate(${translateX}, -50%)`,
        color,
        fontSize: `${fontSize}px`,
        fontWeight: 700,
        whiteSpace: "nowrap" as const,
      },
    },
    text
  );
}

export type ChartSeriesSpec = {
  key: string;
  path: string;
  color: string;
  dashed?: boolean;
};

export type BuildChartElementsParams = {
  series: ChartSeriesSpec[];
  mutedTextColor: string;
  leftRange: ValueRange | null;
  rightRange: ValueRange | null;
  leftLabelColor?: string;
  rightLabelColor?: string;
  leftLabelFormat?: (value: number) => string;
  rightLabelFormat?: (value: number) => string;
  domain: TimeDomain;
  layout: ChartLayout;
  timeTicks?: TimeTick[];
};

export function buildChartElements({
  series,
  mutedTextColor,
  leftRange,
  rightRange,
  leftLabelColor,
  rightLabelColor,
  leftLabelFormat,
  rightLabelFormat,
  domain,
  layout,
  timeTicks: timeTicksOverride,
}: BuildChartElementsParams): { children: ReactNode[]; labels: ReactNode[] } {
  const timeTicks = timeTicksOverride ?? buildTimeTicks(domain);
  const children: ReactNode[] = [];
  const labels: ReactNode[] = [];

  children.push(
    createElement("rect", {
      key: "plot-border",
      x: 0,
      y: 0,
      width: layout.plotWidth,
      height: layout.plotHeight,
      fill: "none",
      stroke: "rgba(255,255,255,0.12)",
      strokeWidth: 1,
    })
  );
  children.push(
    createElement("line", {
      key: "mid-guide",
      x1: 0,
      y1: layout.plotHeight / 2,
      x2: layout.plotWidth,
      y2: layout.plotHeight / 2,
      stroke: "rgba(255,255,255,0.06)",
      strokeWidth: 1,
      strokeDasharray: "2,2",
    })
  );

  timeTicks.forEach((tick) => {
    const x = xForT(tick.t, domain, layout);
    children.push(
      createElement("line", {
        key: `xtick-${tick.t}`,
        x1: x,
        y1: layout.plotHeight,
        x2: x,
        y2: layout.plotHeight + 3,
        stroke: mutedTextColor,
        strokeWidth: 1,
      })
    );
    if (tick.label !== null) {
      labels.push(
        axisLabel(
          `xlabel-${tick.t}`,
          tick.label,
          x + layout.axisLeftWidth,
          layout.plotHeight + 11 + layout.axisTopPadding,
          "center",
          mutedTextColor,
          layout
        )
      );
    }
  });

  const formatLeft = leftLabelFormat ?? ((value: number) => value.toFixed(1));
  const formatRight = rightLabelFormat ?? ((value: number) => value.toFixed(1));
  const leftColor = leftLabelColor ?? mutedTextColor;
  const rightColor = rightLabelColor ?? mutedTextColor;

  if (leftRange) {
    labels.push(axisLabel("l-top", formatLeft(leftRange.max), layout.axisLeftWidth - 4, 5 + layout.axisTopPadding, "right", leftColor, layout));
    labels.push(
      axisLabel("l-bottom", formatLeft(leftRange.min), layout.axisLeftWidth - 4, layout.plotHeight + layout.axisTopPadding, "right", leftColor, layout)
    );
  }
  if (rightRange) {
    labels.push(
      axisLabel(
        "r-top",
        formatRight(rightRange.max),
        layout.axisLeftWidth + layout.plotWidth + 4,
        5 + layout.axisTopPadding,
        "left",
        rightColor,
        layout
      )
    );
    labels.push(
      axisLabel(
        "r-bottom",
        formatRight(rightRange.min),
        layout.axisLeftWidth + layout.plotWidth + 4,
        layout.plotHeight + layout.axisTopPadding,
        "left",
        rightColor,
        layout
      )
    );
  }

  series.forEach((item) => {
    if (!item.path) {
      return;
    }
    children.push(
      createElement("path", {
        key: item.key,
        d: item.path,
        fill: "none",
        stroke: item.color,
        strokeWidth: item.dashed ? 1.5 : 2,
        ...(item.dashed ? { strokeDasharray: "3,2" } : null),
      })
    );
  });

  return { children, labels };
}

export function renderChartCard(params: BuildChartElementsParams) {
  const { children, labels } = buildChartElements(params);
  const { layout } = params;

  return createElement(
    "div",
    { style: webChartWrapperStyle },
    createElement(
      "svg",
      {
        viewBox: `0 0 ${chartWidth(layout)} ${chartHeight(layout)}`,
        width: "100%",
        height: "100%",
        preserveAspectRatio: "none",
        style: webChartSvgStyle,
      },
      createElement("g", { transform: `translate(${layout.axisLeftWidth}, ${layout.axisTopPadding})` }, ...children)
    ),
    createElement("div", { style: webAxisLabelLayerStyle }, ...labels)
  );
}

export const webChartWrapperStyle = {
  position: "relative" as const,
  flex: 1,
  minHeight: 0,
  width: "100%",
};

export const webChartSvgStyle = {
  display: "block",
};

export const webAxisLabelLayerStyle = {
  position: "absolute" as const,
  inset: 0,
  pointerEvents: "none" as const,
};

export function clampIntRange(raw: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(raw as number)));
}

export const webStatsRowStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "4px 8px",
};

export const webStatBadgeStyle = {
  fontSize: "11px",
};

export function statBadge(
  label: string,
  valueText: string,
  color: string,
  align: "left" | "right",
  key: string | number = label
) {
  return createElement(
    "span",
    { style: { ...webStatBadgeStyle, justifySelf: align, textAlign: align }, key },
    createElement("span", { style: { color, fontWeight: 800 } }, `${label} ${valueText}`)
  );
}
