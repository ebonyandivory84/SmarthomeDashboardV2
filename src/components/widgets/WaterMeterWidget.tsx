import type { CSSProperties } from "react";
import { createElement, KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from "react";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import {
  StateSnapshot,
  WaterMeterIntradayRangeValue,
  WaterMeterIntradayValue,
  WaterMeterSummary,
  WaterMeterWidgetConfig,
} from "../../types/dashboard";
import { palette } from "../../utils/theme";
import { WaterAbsoluteConsumptionDetailModal } from "./WaterAbsoluteConsumptionDetailModal";
import { WaterIntradayDetailModal } from "./WaterIntradayDetailModal";

type WaterMeterWidgetProps = {
  config: WaterMeterWidgetConfig;
  client: IoBrokerClient;
  states: StateSnapshot;
  isActivePage?: boolean;
  lowPowerMode?: boolean;
};

const EMPTY_SUMMARY: WaterMeterSummary = {
  generatedAt: 0,
  latestMeterValue: null,
  todayLiters: 0,
  yesterdayLiters: 0,
  averageDayLiters: 0,
  averageUntilNowLiters: 0,
  comparisonPercent: null,
  trendPercent: null,
  daily: [],
  intraday: [],
  monthly: [],
  recentLitersPerHour: 0,
  currentWeekLiters: 0,
};

const LEGACY_METER_VALUE_STATE_ID = "mqtt.1.watermeter.main.value";
const CURRENT_METER_VALUE_STATE_ID = "mqtt.1.watermeter.main.raw";
const DEFAULT_CONNECTION_STATE_ID = "mqtt.1.watermeter.connection";

export function WaterMeterWidget({
  config,
  client,
  states,
  isActivePage = true,
  lowPowerMode = false,
}: WaterMeterWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const [summary, setSummary] = useState<WaterMeterSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const historyDays = clampInt(config.historyDays, 7, 3, 14);
  const refreshMs = clampInt(config.refreshMs, 300_000, 60_000, 3_600_000);
  const meterValueMultiplier = clampNumber(config.meterValueMultiplier, 1000, 0.001, 1_000_000);
  const flowRateMultiplier = clampNumber(config.flowRateMultiplier, 1000, 0.001, 1_000_000);
  const maxFlowLitersPerMinute = clampNumber(config.maxFlowLitersPerMinute, 80, 1, 1000);
  const drinkingWaterPrice = clampNumber(config.drinkingWaterPricePerCubicMeter, 2.01, 0, 1000);
  const wastewaterPrice = clampNumber(config.wastewaterPricePerCubicMeter, 3.57, 0, 1000);
  const connectionStateId = config.connectionStateId?.trim() || DEFAULT_CONNECTION_STATE_ID;
  const timezone = config.timezone?.trim() || "Europe/Berlin";
  const meterValueStateId =
    config.meterValueStateId.trim() === LEGACY_METER_VALUE_STATE_ID
      ? CURRENT_METER_VALUE_STATE_ID
      : config.meterValueStateId.trim();

  useEffect(() => {
    if (!runtimeActive || !meterValueStateId) {
      return;
    }

    let active = true;
    let inFlight = false;

    const sync = async () => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      try {
        const next = await client.readWaterSummary({
          stateId: meterValueStateId,
          days: historyDays,
          multiplier: meterValueMultiplier,
          maxFlowLitersPerMinute,
          timezone,
        });
        if (active) {
          setSummary(next);
          setError(null);
        }
      } catch (syncError) {
        if (active) {
          setError(syncError instanceof Error ? syncError.message : "Wasserverbrauch konnte nicht geladen werden");
        }
      } finally {
        inFlight = false;
      }
    };

    void sync();
    const timer = setInterval(() => void sync(), refreshMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [
    client,
    historyDays,
    maxFlowLitersPerMinute,
    meterValueMultiplier,
    refreshMs,
    runtimeActive,
    meterValueStateId,
    timezone,
  ]);

  const liveMeterValue = finiteNumber(states[meterValueStateId]);
  const liveFlow = config.flowRateStateId ? finiteNumber(states[config.flowRateStateId]) : null;
  const connectionValue = states[connectionStateId];
  const connectionKnown = connectionValue !== null && connectionValue !== undefined && String(connectionValue).trim() !== "";
  const connectionDisconnected =
    connectionKnown && String(connectionValue).trim().toLowerCase() !== "connected";
  const flowLitersPerMinute = liveFlow === null ? null : Math.max(0, liveFlow * flowRateMultiplier);
  const data = applyLiveMeterDelta(
    summary || EMPTY_SUMMARY,
    liveMeterValue,
    meterValueMultiplier,
    maxFlowLitersPerMinute
  );

  if (Platform.OS !== "web") {
    return (
      <View style={styles.nativeContainer}>
        <Text style={styles.nativeValue}>{formatLiters(data.todayLiters)}</Text>
        <Text style={styles.nativeLabel}>heute</Text>
        <Text style={styles.nativeMeta}>Ø {formatLiters(data.averageDayLiters)} pro Tag</Text>
      </View>
    );
  }

  return createElement(WaterMeterWeb, {
    summary: data,
    meterValue: liveMeterValue,
    meterValueMultiplier,
    flowLitersPerMinute,
    connectionDisconnected,
    totalPricePerCubicMeter: drinkingWaterPrice + wastewaterPrice,
    error,
    timezone,
    lowPowerMode,
    textColor: config.appearance?.textColor || palette.text,
    mutedTextColor: config.appearance?.mutedTextColor || palette.textMuted,
    client,
    meterValueStateId,
    maxFlowLitersPerMinute,
    runtimeActive,
  });
}

type WaterMeterWebProps = {
  summary: WaterMeterSummary;
  meterValue: number | null;
  meterValueMultiplier: number;
  flowLitersPerMinute: number | null;
  connectionDisconnected: boolean;
  totalPricePerCubicMeter: number;
  error: string | null;
  timezone: string;
  lowPowerMode: boolean;
  textColor: string;
  mutedTextColor: string;
  client: IoBrokerClient;
  meterValueStateId: string;
  maxFlowLitersPerMinute: number;
  runtimeActive: boolean;
};

function WaterMeterWeb({
  summary,
  meterValue,
  meterValueMultiplier,
  flowLitersPerMinute,
  connectionDisconnected,
  totalPricePerCubicMeter,
  error,
  timezone,
  lowPowerMode,
  textColor,
  mutedTextColor,
  client,
  meterValueStateId,
  maxFlowLitersPerMinute,
  runtimeActive,
}: WaterMeterWebProps) {
  const [chartView, setChartView] = useState<"week" | "month">("week");
  const [intradayDetailOpen, setIntradayDetailOpen] = useState(false);
  const [absoluteDetailOpen, setAbsoluteDetailOpen] = useState(false);
  const [hourlyBars, setHourlyBars] = useState<WaterMeterIntradayRangeValue[]>([]);

  useEffect(() => {
    if (!runtimeActive) {
      return;
    }
    let active = true;
    const syncHourlyBars = async () => {
      try {
        const payload = await client.readWaterIntradayRange({
          stateId: meterValueStateId,
          fromMs: Date.now() - 12 * 3_600_000,
          toMs: Date.now(),
          bucketMs: 3_600_000,
          multiplier: meterValueMultiplier,
          maxFlowLitersPerMinute,
        });
        if (active) {
          setHourlyBars(payload);
        }
      } catch {
        // Fehleranzeige übernimmt bereits der Haupt-Fetch (readWaterSummary).
      }
    };
    void syncHourlyBars();
    const timer = setInterval(() => void syncHourlyBars(), 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [client, meterValueStateId, meterValueMultiplier, maxFlowLitersPerMinute, runtimeActive]);

  const renderAbsolutePanel = () => {
    const maxLiters = Math.max(1, ...hourlyBars.map((entry) => entry.liters));
    const hourLabel = (t: number) =>
      new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(t));

    return createElement(
      "div",
      {
        style: { ...webIntradayPanelStyle, cursor: "pointer" },
        onClick: () => setAbsoluteDetailOpen(true),
        onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setAbsoluteDetailOpen(true);
          }
        },
        role: "button",
        tabIndex: 0,
        "aria-label": "Absoluter Wasserverbrauch pro Stunde oeffnen",
      },
      createElement(
        "div",
        { style: webIntradayHeaderStyle },
        createElement("span", null, "Absoluter Verbrauch pro Stunde"),
        createElement("span", { style: { ...webIntradayUnitStyle, color: mutedTextColor } }, "L")
      ),
      createElement(
        "div",
        { style: { ...webBarsStyle, display: "grid", gridTemplateColumns: `repeat(${Math.max(1, hourlyBars.length)}, 1fr)` } },
        hourlyBars.map((entry) => {
          const height = Math.max(3, (entry.liters / maxLiters) * 76);
          return createElement(
            "div",
            { key: entry.t, style: webBarColumnStyle },
            createElement("span", { style: { ...webBarValueStyle, color: mutedTextColor } }, formatCompactLiters(entry.liters)),
            createElement("span", { style: { ...webBarStyle, height, background: "rgba(109,220,255,.34)" } }),
            createElement("span", { style: { ...webBarLabelStyle, color: mutedTextColor } }, hourLabel(entry.t))
          );
        })
      )
    );
  };
  const averageReference = Math.max(summary.averageUntilNowLiters, 1);
  const gaugeRatio = Math.max(0, Math.min(1.25, summary.todayLiters / averageReference));
  const gaugeDegrees = (gaugeRatio / 1.25) * 280;
  const barMaximum = Math.max(1, summary.averageDayLiters, ...summary.daily.map((entry) => entry.liters)) * 1.12;
  const comparison = formatPercent(summary.comparisonPercent);
  const trend = formatPercent(summary.trendPercent);
  const monthlyCosts = (summary.monthly || []).map((entry) => ({
    ...entry,
    cost: (entry.liters / 1000) * totalPricePerCubicMeter,
  }));
  const monthlyBarMaximum = Math.max(0.01, ...monthlyCosts.map((entry) => entry.cost)) * 1.08;
  const trailingTwelveMonthCost = monthlyCosts.reduce((sum, entry) => sum + entry.cost, 0);
  const meterCubicMeters = meterValue === null ? null : (meterValue * meterValueMultiplier) / 1000;
  const counterDigits = buildCounterDigits(meterCubicMeters);
  const todayCost = formatEuro((summary.todayLiters / 1000) * totalPricePerCubicMeter);
  const currentWeekCost = formatEuro(((summary.currentWeekLiters || 0) / 1000) * totalPricePerCubicMeter);
  const ringStyle: CSSProperties = {
    ...webDialStyle,
    background: `conic-gradient(from -140deg, #6ddcff 0deg, #5c7cff ${gaugeDegrees}deg, rgba(157,173,214,.11) ${gaugeDegrees}deg 280deg, transparent 280deg)`,
    boxShadow: lowPowerMode ? "none" : "0 0 22px rgba(92,124,255,.12)",
  };

  return createElement(
    "div",
    { style: { ...webRootStyle, color: textColor }, title: error || undefined },
    createElement(
      "div",
      { style: webStatusRowStyle },
      connectionDisconnected
        ? createElement(MaterialCommunityIcons, { color: palette.danger, name: "wifi-off", size: 13 })
        : null,
      connectionDisconnected
        ? createElement("span", { style: { color: palette.danger } }, "keine Verbindung")
        : null
    ),
    createElement(
      "div",
      { style: webMainStyle },
      createElement(
        "div",
        { style: ringStyle },
        createElement("div", { style: webDialInnerStyle }),
        createElement("div", { style: webAverageMarkerStyle }),
        createElement(
          "div",
          { style: webDialContentStyle },
          createElement("span", { style: { ...webEyebrowStyle, color: mutedTextColor } }, "HEUTE"),
          createElement("div", { style: webTodayValueStyle }, formatNumber(summary.todayLiters, 0), createElement("small", null, " L")),
          createElement(
            "span",
            {
              style: {
                ...webComparisonStyle,
                color: comparison.color,
                backgroundColor: comparison.background,
              },
            },
            `${comparison.arrow} ${comparison.text} vs. Ø gleiche Uhrzeit`
          )
        ),
        createElement(
          "div",
          { style: webTodayCostStyle },
          createElement("span", { style: { ...webEyebrowStyle, color: mutedTextColor } }, "WASSERKOSTEN HEUTE"),
          createElement("strong", null, todayCost)
        )
      ),
      createElement(
        "div",
        { style: webChartAreaStyle },
        createElement(
          "div",
          { style: webChartContentStyle },
        createElement(
          "div",
          { style: webChartHeaderStyle },
          createElement("strong", null, chartView === "month" ? "Monatskosten" : "Tagesverbrauch"),
          createElement(
            "div",
            { style: webChartToolbarStyle },
            chartView === "week"
              ? createElement("span", { style: { color: mutedTextColor } }, `Ø ${formatLiters(summary.averageDayLiters)}`)
              : null,
            createElement(
              "button",
              {
                type: "button",
                title: chartView === "week" ? "Monatsansicht" : "Wochenansicht",
                "aria-label": chartView === "week" ? "Monatsansicht anzeigen" : "Wochenansicht anzeigen",
                "aria-pressed": chartView === "month",
                onClick: () => setChartView((current) => (current === "week" ? "month" : "week")),
                style: {
                  ...webChartToggleStyle,
                  color: chartView === "month" ? "#6ddcff" : mutedTextColor,
                  backgroundColor: chartView === "month" ? "rgba(109,220,255,.12)" : "rgba(157,173,214,.08)",
                },
              },
              createElement(MaterialCommunityIcons, {
                color: chartView === "month" ? "#6ddcff" : mutedTextColor,
                name: chartView === "month" ? "calendar-week" : "calendar-month-outline",
                size: 13,
              })
            )
          )
        ),
        createElement(
          "div",
          { style: { ...webBarsStyle, display: chartView === "week" ? "grid" : "none" } },
          summary.daily.map((entry) => {
            const height = Math.max(3, (entry.liters / barMaximum) * 76);
            return createElement(
              "div",
              { key: entry.date, style: webBarColumnStyle },
              createElement("span", { style: { ...webBarValueStyle, color: mutedTextColor } }, formatCompactLiters(entry.liters)),
              createElement("span", {
                style: {
                  ...webBarStyle,
                  height,
                  background: entry.isToday ? "linear-gradient(180deg, #6ddcff, #5c7cff)" : "rgba(109,220,255,.34)",
                  boxShadow: entry.isToday && !lowPowerMode ? "0 0 10px rgba(92,124,255,.22)" : "none",
                },
              }),
              createElement(
                "span",
                { style: { ...webBarLabelStyle, color: entry.isToday ? "#aebcff" : mutedTextColor } },
                entry.isToday ? "Heute" : weekdayLabel(entry.date, timezone)
              )
            );
          })
        ),
        createElement(
          "div",
          { style: { ...webMonthBarsStyle, display: chartView === "month" ? "grid" : "none" } },
          monthlyCosts.map((entry, index) => {
            const height = Math.max(18, (entry.cost / monthlyBarMaximum) * 84);
            const isCurrentMonth = index === monthlyCosts.length - 1;
            return createElement(
              "div",
              { key: entry.month, style: webMonthBarColumnStyle },
              createElement(
                "span",
                {
                  style: {
                    ...webMonthBarStyle,
                    height,
                    background: isCurrentMonth
                      ? "linear-gradient(180deg, #6ddcff, #5c7cff)"
                      : "rgba(109,220,255,.30)",
                  },
                },
                createElement(
                  "span",
                  { style: webMonthCostTextStyle, title: formatEuro(entry.cost) },
                  `${formatNumber(entry.cost, 0)} €`
                )
              ),
              createElement(
                "span",
                { style: { ...webBarLabelStyle, color: isCurrentMonth ? "#aebcff" : mutedTextColor } },
                monthLabel(entry.month, timezone)
              )
            );
          })
        ),
        createElement(
          "div",
          { style: webWeekCostStyle },
          createElement(
            "span",
            { style: { ...webEyebrowStyle, color: mutedTextColor } },
            chartView === "month" ? "KOSTEN LETZTE 12 MONATE" : "KOSTEN SEIT MONTAG"
          ),
          createElement("strong", null, chartView === "month" ? formatEuro(trailingTwelveMonthCost) : currentWeekCost)
        )
        )
      )
    ),
    renderIntradayPanel(
      summary.intraday,
      summary.recentLitersPerHour,
      flowLitersPerMinute,
      timezone,
      mutedTextColor,
      lowPowerMode,
      () => setIntradayDetailOpen(true)
    ),
    renderAbsolutePanel(),
    intradayDetailOpen
      ? createElement(WaterIntradayDetailModal, {
          key: "intraday-detail",
          stateId: meterValueStateId,
          multiplier: meterValueMultiplier,
          maxFlowLitersPerMinute,
          timezone,
          client,
          textColor,
          mutedTextColor,
          onClose: () => setIntradayDetailOpen(false),
        })
      : null,
    absoluteDetailOpen
      ? createElement(WaterAbsoluteConsumptionDetailModal, {
          key: "absolute-detail",
          stateId: meterValueStateId,
          multiplier: meterValueMultiplier,
          maxFlowLitersPerMinute,
          timezone,
          client,
          textColor,
          mutedTextColor,
          onClose: () => setAbsoluteDetailOpen(false),
        })
      : null,
    createElement(
      "div",
      { style: webFooterStyle },
      createElement(
        "div",
        null,
        createElement("div", { style: { ...webEyebrowStyle, color: mutedTextColor } }, "ZÄHLERSTAND · m³"),
        createElement(
          "div",
          { style: webCounterStyle },
          counterDigits.map((digit, index) =>
            createElement(
              "span",
              { key: `${index}-${digit}`, style: { ...webCounterDigitStyle, color: index >= counterDigits.length - 3 ? "#6ddcff" : textColor } },
              digit
            )
          )
        )
      ),
      createElement(
        "div",
        { style: webMetricsStyle },
        footerMetric("Gestern", formatLiters(summary.yesterdayLiters), mutedTextColor, textColor),
        footerMetric("Trend 7 Tage", `${trend.arrow} ${trend.text}`, mutedTextColor, trend.color)
      )
    )
  );
}

function footerMetric(label: string, value: string, mutedColor: string, valueColor: string) {
  return createElement(
    "div",
    { style: webMetricStyle },
    createElement("span", { style: { ...webEyebrowStyle, color: mutedColor } }, label),
    createElement("strong", { style: { color: valueColor } }, value)
  );
}

function renderIntradayPanel(
  intraday: WaterMeterIntradayValue[],
  recentLitersPerHour: number,
  flowLitersPerMinute: number | null,
  timezone: string,
  mutedTextColor: string,
  lowPowerMode: boolean,
  onOpen: () => void
) {
  const points = intraday.length >= 2 ? intraday : buildEmptyIntradayPoints();
  const axisMaximum = niceAxisMaximum(Math.max(0, ...points.map((entry) => entry.liters * 2)));
  const baseline = 48;
  const plotHeight = 40;
  const coordinates = points.map((entry, index) => ({
    ...entry,
    litersPerHour: entry.liters * 2,
    x: (index / Math.max(1, points.length - 1)) * 300,
    y: baseline - ((entry.liters * 2) / axisMaximum) * plotHeight,
  }));
  const linePath = coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `M0 ${baseline} ${linePath.replace(/^M/, "L")} L300 ${baseline} Z`;
  const peak = coordinates.reduce((highest, point) =>
    point.litersPerHour > highest.litersPerHour ? point : highest
  );
  const hasLiveFlow = flowLitersPerMinute !== null && flowLitersPerMinute >= 0.05;
  const level = usageLevel(hasLiveFlow ? flowLitersPerMinute * 60 : recentLitersPerHour);
  const timeTicks = [0, 0.25, 0.5, 0.75, 1].map(
    (ratio) => points[Math.round((points.length - 1) * ratio)]
  );

  return createElement(
    "div",
    {
      onClick: onOpen,
      onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      },
      role: "button",
      tabIndex: 0,
      "aria-label": "Wasserverbrauch Verlauf oeffnen",
      style: { ...webIntradayPanelStyle, cursor: "pointer" },
    },
    createElement(
      "div",
      { style: webIntradayHeaderStyle },
      createElement(
        "strong",
        null,
        "Verbrauch · letzte 12 Stunden",
        createElement("span", { style: { ...webIntradayUnitStyle, color: mutedTextColor } }, " · Ø L/h")
      ),
      createElement(
        "span",
        {
          style: {
            ...webUsageBadgeStyle,
            color: level.color,
            backgroundColor: level.background,
          },
        },
        hasLiveFlow ? `${formatDecimal(flowLitersPerMinute, 1)} L/min` : `jetzt ${level.label}`
      )
    ),
    createElement(
      "div",
      { style: webIntradayChartStyle },
      createElement(
        "div",
        { style: { ...webYAxisStyle, color: mutedTextColor } },
        createElement("span", { style: { ...webYAxisTickStyle, top: 0 } }, formatAxisRate(axisMaximum)),
        createElement("span", { style: { ...webYAxisTickStyle, top: 20 } }, formatAxisRate(axisMaximum / 2)),
        createElement("span", { style: { ...webYAxisTickStyle, top: 40 } }, "0")
      ),
      createElement(
        "svg",
        {
          viewBox: "0 0 300 54",
          preserveAspectRatio: "none",
          role: "img",
          "aria-label": "Durchschnittliche Wasserflussrate der letzten zwölf Stunden",
          style: webIntradaySvgStyle,
        },
        createElement("path", { d: "M0 8 H300 M0 28 H300 M0 48 H300", fill: "none", stroke: "rgba(157,173,214,.13)", strokeWidth: 1 }),
        createElement("path", {
          d: "M0 8 V48 H300",
          fill: "none",
          stroke: "rgba(157,173,214,.22)",
          strokeWidth: 1,
          vectorEffect: "non-scaling-stroke",
        }),
        createElement("path", {
          d: areaPath,
          fill: lowPowerMode ? "rgba(109,220,255,.12)" : "rgba(109,220,255,.22)",
        }),
        createElement("path", {
          d: linePath,
          fill: "none",
          stroke: "#6ddcff",
          strokeWidth: 2,
          vectorEffect: "non-scaling-stroke",
          strokeLinejoin: "round",
          strokeLinecap: "round",
        }),
        peak.litersPerHour > 0
          ? createElement("circle", {
              cx: peak.x,
              cy: peak.y,
              r: 2.7,
              fill: "#0d1424",
              stroke: "#aebcff",
              strokeWidth: 1.5,
              vectorEffect: "non-scaling-stroke",
            })
          : null
      )
    ),
    createElement(
      "div",
      { style: { ...webXAxisStyle, color: mutedTextColor } },
      createElement("span", null),
      createElement(
        "div",
        { style: webXAxisTicksStyle },
        timeTicks.map((entry, index) =>
          createElement(
            "span",
            {
              key: `${entry.t}-${index}`,
              style: index === 0 ? webXAxisFirstTickStyle : index === timeTicks.length - 1 ? webXAxisLastTickStyle : undefined,
            },
            timeLabel(entry.t, timezone)
          )
        )
      )
    ),
    createElement(
      "div",
      { style: { ...webIntradayPeakStyle, color: mutedTextColor } },
      peak.litersPerHour > 0
        ? `Spitze ${timeLabel(peak.t, timezone)} · ${formatAxisRate(peak.litersPerHour)} L/h`
        : "kein Verbrauch im Zeitraum"
    )
  );
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function formatNumber(value: number, decimals: number) {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value || 0);
}

function formatDecimal(value: number, decimals: number) {
  return formatNumber(value, decimals);
}

function formatLiters(value: number) {
  return `${formatNumber(value, value >= 100 ? 0 : 1)} L`;
}

function formatEuro(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatCompactLiters(value: number) {
  if (value >= 1000) {
    return `${formatNumber(value / 1000, 1)}k`;
  }
  return formatNumber(value, 0);
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return { arrow: "•", text: "–", color: palette.textMuted, background: "rgba(157,173,214,.08)" };
  }
  const positive = value > 0.05;
  const negative = value < -0.05;
  return {
    arrow: positive ? "▲" : negative ? "▼" : "•",
    text: `${formatNumber(Math.abs(value), 0)} %`,
    color: positive ? "#ffb46c" : negative ? palette.success : palette.textMuted,
    background: positive ? "rgba(255,180,108,.12)" : negative ? "rgba(108,255,143,.10)" : "rgba(157,173,214,.08)",
  };
}

function weekdayLabel(date: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: timezone })
      .format(new Date(`${date}T12:00:00Z`))
      .replace(".", "");
  } catch {
    return date.slice(8);
  }
}

function monthLabel(month: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat("de-DE", { month: "short", timeZone: timezone })
      .format(new Date(`${month}-15T12:00:00Z`))
      .replace(".", "");
  } catch {
    return month.slice(5);
  }
}

function buildCounterDigits(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return ["–", "–", "–", "–", "–", "–", "–", "–"];
  }
  const fixed = Math.max(0, value).toFixed(3).replace(".", "");
  return fixed.padStart(8, "0").slice(-8).split("");
}

function buildEmptyIntradayPoints(): WaterMeterIntradayValue[] {
  const bucketMs = 30 * 60 * 1000;
  const end = Math.floor(Date.now() / bucketMs) * bucketMs;
  return Array.from({ length: 24 }, (_, index) => ({
    t: end - (23 - index) * bucketMs,
    liters: 0,
  }));
}

function usageLevel(litersPerHour: number) {
  if (litersPerHour >= 120) {
    return { label: "hoch", color: "#ffb46c", background: "rgba(255,180,108,.12)" };
  }
  if (litersPerHour >= 20) {
    return { label: "normal", color: "#6ddcff", background: "rgba(109,220,255,.10)" };
  }
  return { label: "ruhig", color: palette.success, background: "rgba(108,255,143,.10)" };
}

function timeLabel(timestamp: number, timezone: string) {
  try {
    return new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(new Date(timestamp));
  } catch {
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  }
}

function niceAxisMaximum(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 10;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const rounded = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return rounded * magnitude;
}

function formatAxisRate(value: number) {
  return formatNumber(value, value > 0 && value < 10 ? 1 : 0);
}

function applyLiveMeterDelta(
  summary: WaterMeterSummary,
  liveMeterValue: number | null,
  multiplier: number,
  maxFlowLitersPerMinute: number
) {
  if (liveMeterValue === null || summary.latestMeterValue === null) {
    return summary;
  }

  const deltaLiters = (liveMeterValue - summary.latestMeterValue) * multiplier;
  const maxRecentDelta = maxFlowLitersPerMinute * 30;
  if (!Number.isFinite(deltaLiters) || deltaLiters <= 0 || deltaLiters > maxRecentDelta) {
    return summary;
  }

  const todayLiters = summary.todayLiters + deltaLiters;
  const comparisonPercent =
    summary.averageUntilNowLiters > 0
      ? ((todayLiters - summary.averageUntilNowLiters) / summary.averageUntilNowLiters) * 100
      : null;

  return {
    ...summary,
    latestMeterValue: liveMeterValue,
    todayLiters,
    comparisonPercent,
    intraday: (summary.intraday.length > 0 ? summary.intraday : buildEmptyIntradayPoints()).map((entry, index, entries) =>
      index === entries.length - 1 ? { ...entry, liters: entry.liters + deltaLiters } : entry
    ),
    recentLitersPerHour: summary.recentLitersPerHour + deltaLiters * 2,
    currentWeekLiters: (summary.currentWeekLiters || 0) + deltaLiters,
    monthly: (summary.monthly || []).map((entry, index, entries) =>
      index === entries.length - 1 ? { ...entry, liters: entry.liters + deltaLiters } : entry
    ),
    daily: summary.daily.map((entry) =>
      entry.isToday
        ? {
            ...entry,
            liters: entry.liters + deltaLiters,
          }
        : entry
    ),
  };
}

const webRootStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  gap: 8,
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontVariantNumeric: "tabular-nums",
};

const webStatusRowStyle: CSSProperties = {
  minHeight: 16,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: 6,
  fontSize: 10,
  fontWeight: 750,
};

const webMainStyle: CSSProperties = {
  flex: 1,
  minHeight: 170,
  display: "grid",
  gridTemplateColumns: "142px minmax(0, 1fr)",
  gap: 12,
  alignItems: "center",
};

const webDialStyle: CSSProperties = {
  position: "relative",
  width: 136,
  height: 136,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  marginBottom: 24,
};

const webDialInnerStyle: CSSProperties = {
  position: "absolute",
  inset: 8,
  borderRadius: "50%",
  background: "#0d1424",
  border: `1px solid ${palette.border}`,
};

const webAverageMarkerStyle: CSSProperties = {
  position: "absolute",
  zIndex: 2,
  top: 3,
  left: 65,
  width: 6,
  height: 16,
  borderRadius: 4,
  background: palette.text,
  transformOrigin: "3px 65px",
  transform: "rotate(84deg)",
};

const webDialContentStyle: CSSProperties = { position: "relative", zIndex: 3, textAlign: "center" };
const webEyebrowStyle: CSSProperties = { display: "block", fontSize: 8, letterSpacing: ".1em", textTransform: "uppercase" };
const webTodayValueStyle: CSSProperties = { marginTop: 2, fontSize: 30, lineHeight: 1, fontWeight: 850, letterSpacing: "-.04em" };
const webComparisonStyle: CSSProperties = { display: "inline-flex", marginTop: 7, padding: "3px 6px", borderRadius: 999, fontSize: 8, fontWeight: 800 };
const webTodayCostStyle: CSSProperties = { position: "absolute", top: 142, left: -3, width: 142, minHeight: 22, display: "flex", alignItems: "baseline", justifyContent: "center", gap: 5, whiteSpace: "nowrap", fontSize: 10, lineHeight: "12px" };

const webChartAreaStyle: CSSProperties = { minWidth: 0, alignSelf: "stretch", paddingLeft: 12, borderLeft: `1px solid ${palette.border}` };
const webChartContentStyle: CSSProperties = { position: "relative", top: 6, height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" };
const webChartHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 10 };
const webChartToolbarStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 6 };
const webChartToggleStyle: CSSProperties = { width: 24, height: 22, display: "grid", placeItems: "center", padding: 0, border: `1px solid ${palette.border}`, borderRadius: 6, cursor: "pointer", lineHeight: 1 };
const webBarsStyle: CSSProperties = { height: 112, display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(16px, 1fr)", alignItems: "end", gap: 5, borderBottom: `1px solid ${palette.border}` };
const webBarColumnStyle: CSSProperties = { height: "100%", minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 3 };
const webBarValueStyle: CSSProperties = { fontSize: 7, whiteSpace: "nowrap" };
const webBarStyle: CSSProperties = { width: "60%", minWidth: 8, maxWidth: 22, borderRadius: "5px 5px 1px 1px" };
const webBarLabelStyle: CSSProperties = { minHeight: 13, fontSize: 7, fontWeight: 700, whiteSpace: "nowrap" };
const webMonthBarsStyle: CSSProperties = { height: 112, display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", alignItems: "end", gap: 2, borderBottom: `1px solid ${palette.border}` };
const webMonthBarColumnStyle: CSSProperties = { height: "100%", minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 3 };
const webMonthBarStyle: CSSProperties = { position: "relative", width: "76%", minWidth: 10, maxWidth: 18, borderRadius: "4px 4px 1px 1px" };
const webMonthCostTextStyle: CSSProperties = { position: "absolute", top: "50%", left: "50%", color: "#eafcff", transform: "translate(-50%, -50%) rotate(-90deg)", transformOrigin: "center", fontSize: 6, fontWeight: 850, lineHeight: 1, whiteSpace: "nowrap" };
const webWeekCostStyle: CSSProperties = { minHeight: 22, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, paddingTop: 5, fontSize: 10, lineHeight: "12px" };

const webIntradayPanelStyle: CSSProperties = {
  minHeight: 100,
  padding: "7px 9px 5px",
  borderRadius: 9,
  border: `1px solid ${palette.border}`,
  background: "rgba(8,14,27,.52)",
};
const webIntradayHeaderStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 9 };
const webIntradayUnitStyle: CSSProperties = { fontSize: 7, fontWeight: 500, whiteSpace: "nowrap" };
const webUsageBadgeStyle: CSSProperties = { padding: "2px 6px", borderRadius: 999, fontSize: 8, fontWeight: 800, whiteSpace: "nowrap" };
const webIntradayChartStyle: CSSProperties = { display: "grid", gridTemplateColumns: "30px minmax(0, 1fr)", gap: 4, marginTop: 7 };
const webYAxisStyle: CSSProperties = { position: "relative", height: 54, fontSize: 7, textAlign: "right" };
const webYAxisTickStyle: CSSProperties = { position: "absolute", right: 0, lineHeight: "8px", transform: "translateY(-50%)", whiteSpace: "nowrap" };
const webIntradaySvgStyle: CSSProperties = { display: "block", width: "100%", height: 54, overflow: "visible" };
const webXAxisStyle: CSSProperties = { display: "grid", gridTemplateColumns: "30px minmax(0, 1fr)", gap: 4, fontSize: 7 };
const webXAxisTicksStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", textAlign: "center" };
const webXAxisFirstTickStyle: CSSProperties = { textAlign: "left" };
const webXAxisLastTickStyle: CSSProperties = { textAlign: "right" };
const webIntradayPeakStyle: CSSProperties = { marginTop: 1, textAlign: "center", fontSize: 7 };

const webFooterStyle: CSSProperties = { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, paddingTop: 8, borderTop: `1px solid ${palette.border}` };
const webCounterStyle: CSSProperties = { display: "flex", gap: 2, marginTop: 4 };
const webCounterDigitStyle: CSSProperties = { minWidth: 17, padding: "3px 4px", borderRadius: 3, background: "#060a12", border: `1px solid ${palette.border}`, textAlign: "center", font: "700 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace" };
const webMetricsStyle: CSSProperties = { display: "flex", gap: 14, textAlign: "right" };
const webMetricStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 2, fontSize: 11 };

const styles = StyleSheet.create({
  nativeContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  nativeValue: { color: palette.text, fontSize: 34, fontWeight: "800" },
  nativeLabel: { color: palette.textMuted, fontSize: 12, textTransform: "uppercase" },
  nativeMeta: { color: palette.textMuted, fontSize: 12, marginTop: 10 },
});
