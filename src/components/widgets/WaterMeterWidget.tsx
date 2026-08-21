import type { CSSProperties } from "react";
import { createElement, useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import { StateSnapshot, WaterMeterSummary, WaterMeterWidgetConfig } from "../../types/dashboard";
import { palette } from "../../utils/theme";

type WaterMeterWidgetProps = {
  config: WaterMeterWidgetConfig;
  client: IoBrokerClient;
  states: StateSnapshot;
  isActivePage?: boolean;
  lowPowerMode?: boolean;
};

const EMPTY_SUMMARY: WaterMeterSummary = {
  generatedAt: 0,
  todayLiters: 0,
  yesterdayLiters: 0,
  averageDayLiters: 0,
  averageUntilNowLiters: 0,
  comparisonPercent: null,
  trendPercent: null,
  daily: [],
};

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
  const timezone = config.timezone?.trim() || "Europe/Berlin";

  useEffect(() => {
    if (!runtimeActive || !config.meterValueStateId.trim()) {
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
          stateId: config.meterValueStateId,
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
    config.meterValueStateId,
    historyDays,
    maxFlowLitersPerMinute,
    meterValueMultiplier,
    refreshMs,
    runtimeActive,
    timezone,
  ]);

  const liveMeterValue = finiteNumber(states[config.meterValueStateId]);
  const liveFlow = config.flowRateStateId ? finiteNumber(states[config.flowRateStateId]) : null;
  const flowLitersPerMinute = liveFlow === null ? null : Math.max(0, liveFlow * flowRateMultiplier);
  const data = summary || EMPTY_SUMMARY;

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
    error,
    timezone,
    lowPowerMode,
    textColor: config.appearance?.textColor || palette.text,
    mutedTextColor: config.appearance?.mutedTextColor || palette.textMuted,
  });
}

type WaterMeterWebProps = {
  summary: WaterMeterSummary;
  meterValue: number | null;
  meterValueMultiplier: number;
  flowLitersPerMinute: number | null;
  error: string | null;
  timezone: string;
  lowPowerMode: boolean;
  textColor: string;
  mutedTextColor: string;
};

function WaterMeterWeb({
  summary,
  meterValue,
  meterValueMultiplier,
  flowLitersPerMinute,
  error,
  timezone,
  lowPowerMode,
  textColor,
  mutedTextColor,
}: WaterMeterWebProps) {
  const averageReference = Math.max(summary.averageUntilNowLiters, 1);
  const gaugeRatio = Math.max(0, Math.min(1.25, summary.todayLiters / averageReference));
  const gaugeDegrees = (gaugeRatio / 1.25) * 280;
  const barMaximum = Math.max(1, summary.averageDayLiters, ...summary.daily.map((entry) => entry.liters)) * 1.12;
  const comparison = formatPercent(summary.comparisonPercent);
  const trend = formatPercent(summary.trendPercent);
  const hasFlow = flowLitersPerMinute !== null && flowLitersPerMinute >= 0.05;
  const statusColor = error ? palette.danger : hasFlow ? "#6ddcff" : palette.success;
  const statusText = error
    ? "Verlauf nicht verfügbar"
    : flowLitersPerMinute === null
      ? "Durchfluss nicht konfiguriert"
      : hasFlow
        ? `${formatDecimal(flowLitersPerMinute, 1)} L/min`
        : "kein Durchfluss";
  const meterCubicMeters = meterValue === null ? null : (meterValue * meterValueMultiplier) / 1000;
  const counterDigits = buildCounterDigits(meterCubicMeters);
  const ringStyle: CSSProperties = {
    ...webDialStyle,
    background: `conic-gradient(from -140deg, #6ddcff 0deg, #5c7cff ${gaugeDegrees}deg, rgba(157,173,214,.11) ${gaugeDegrees}deg 280deg, transparent 280deg)`,
    boxShadow: lowPowerMode ? "none" : "0 0 22px rgba(92,124,255,.12)",
  };

  return createElement(
    "div",
    { style: { ...webRootStyle, color: textColor } },
    createElement(
      "div",
      { style: webStatusRowStyle },
      createElement("span", { style: { ...webStatusDotStyle, backgroundColor: statusColor } }),
      createElement("span", { style: { color: error ? palette.danger : mutedTextColor } }, statusText)
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
            `${comparison.arrow} ${comparison.text} vs. Ø bis jetzt`
          )
        )
      ),
      createElement(
        "div",
        { style: webChartAreaStyle },
        createElement(
          "div",
          { style: webChartHeaderStyle },
          createElement("strong", null, "Tagesverbrauch"),
          createElement("span", { style: { color: mutedTextColor } }, `Ø ${formatLiters(summary.averageDayLiters)}`)
        ),
        createElement(
          "div",
          { style: webBarsStyle },
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
        )
      )
    ),
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

function buildCounterDigits(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return ["–", "–", "–", "–", "–", "–", "–", "–"];
  }
  const fixed = Math.max(0, value).toFixed(3).replace(".", "");
  return fixed.padStart(8, "0").slice(-8).split("");
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
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 6,
  fontSize: 10,
};

const webStatusDotStyle: CSSProperties = { width: 6, height: 6, borderRadius: "50%" };

const webMainStyle: CSSProperties = {
  flex: 1,
  minHeight: 150,
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

const webChartAreaStyle: CSSProperties = { minWidth: 0, alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center" };
const webChartHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 10 };
const webBarsStyle: CSSProperties = { height: 112, display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(16px, 1fr)", alignItems: "end", gap: 5, borderBottom: `1px solid ${palette.border}` };
const webBarColumnStyle: CSSProperties = { height: "100%", minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 3 };
const webBarValueStyle: CSSProperties = { fontSize: 7, whiteSpace: "nowrap" };
const webBarStyle: CSSProperties = { width: "60%", minWidth: 8, maxWidth: 22, borderRadius: "5px 5px 1px 1px" };
const webBarLabelStyle: CSSProperties = { minHeight: 13, fontSize: 7, fontWeight: 700, whiteSpace: "nowrap" };

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
