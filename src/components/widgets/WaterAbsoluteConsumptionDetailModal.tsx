import { createElement, MouseEvent as ReactMouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { IoBrokerClient } from "../../services/iobroker";
import { WaterMeterIntradayRangeValue, WaterMeterMonthlyValue } from "../../types/dashboard";
import { palette } from "../../utils/theme";
import {
  ChartBarSpec,
  ChartLayout,
  TimeDomain,
  axisRange,
  barValueAtTime,
  buildChartElements,
  buildMonthTicks,
  chartHeight,
  chartWidth,
  statBadge,
  timeDomain,
  valueToY,
  webAxisLabelLayerStyle,
  webChartSvgStyle,
  webChartWrapperStyle,
  webStatsRowStyle,
} from "./roomSensorChart";
import { formatDateTime, formatLiters, formatLitersAxis, formatMonthLabel, monthMidpoint, styles } from "./WaterIntradayDetailModal";

// monthMidpoint wird hier nicht direkt benötigt (Balken nutzen Monatsanfang/-ende
// statt Mittelpunkt), bleibt aber Teil des Re-Exports für Konsistenz mit dem
// Original-Modal und um ungenutzte-Import-Warnungen zu vermeiden, falls später
// eine Mittelpunkt-Darstellung ergänzt wird.
void monthMidpoint;

type WaterAbsoluteConsumptionDetailModalProps = {
  stateId: string;
  multiplier: number;
  maxFlowLitersPerMinute: number;
  timezone: string;
  client: IoBrokerClient;
  textColor: string;
  mutedTextColor: string;
  onClose: () => void;
};

type Period = "24h" | "7d" | "30d" | "year";
type RangePeriod = Exclude<Period, "year">;

const PERIOD_MS: Record<RangePeriod, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
};

// Gröbere Bucket-Auflösung als im Rate-Modal: 24h -> Stunden, 7 Tage -> Tage,
// 30 Tage -> Wochen. Die Jahresansicht nutzt ohnehin die Monatswerte aus
// /water-summary.
const PERIOD_BUCKET_MS: Record<RangePeriod, number> = {
  "24h": 3_600_000,
  "7d": 86_400_000,
  "30d": 604_800_000,
};

const PERIOD_LABELS: Record<Period, string> = {
  "24h": "24h",
  "7d": "7 Tage",
  "30d": "30 Tage",
  year: "Jahr",
};

const BAR_COLOR = "#6ddcff";

const MODAL_CHART_LAYOUT: ChartLayout = {
  plotWidth: 720,
  plotHeight: 300,
  axisLeftWidth: 46,
  axisRightWidth: 46,
  axisTopPadding: 10,
  axisBottomHeight: 24,
};

const REFRESH_MS = 60_000;

const webEmptyStateStyle = {
  fontSize: "13px",
  fontWeight: 600,
  textAlign: "center" as const,
  padding: "32px 0",
};

function monthRangeMs(month: string): { start: number; end: number } {
  const start = new Date(`${month}-01T00:00:00Z`).getTime();
  const startDate = new Date(start);
  const end = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1);
  return { start, end };
}

export function WaterAbsoluteConsumptionDetailModal({
  stateId,
  multiplier,
  maxFlowLitersPerMinute,
  timezone,
  client,
  textColor,
  mutedTextColor,
  onClose,
}: WaterAbsoluteConsumptionDetailModalProps) {
  const [period, setPeriod] = useState<Period>("24h");
  const [pageOffset, setPageOffset] = useState(0);
  const [series, setSeries] = useState<WaterMeterIntradayRangeValue[]>([]);
  const [monthly, setMonthly] = useState<WaterMeterMonthlyValue[]>([]);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);

  const selectPeriod = (next: Period) => {
    setPeriod(next);
    setPageOffset(0);
  };

  const goOlder = () => setPageOffset((current) => current + 1);
  const goNewer = () => setPageOffset((current) => Math.max(0, current - 1));
  const isLive = pageOffset === 0;

  useEffect(() => {
    let active = true;

    const syncRange = async () => {
      const periodMs = PERIOD_MS[period as RangePeriod];
      const toMs = pageOffset === 0 ? Date.now() : Date.now() - pageOffset * periodMs;
      const fromMs = toMs - periodMs;
      const payload = await client.readWaterIntradayRange({
        stateId,
        fromMs,
        toMs,
        bucketMs: PERIOD_BUCKET_MS[period as RangePeriod],
        multiplier,
        maxFlowLitersPerMinute,
      });
      if (active) {
        setSeries(payload);
        setRange({ from: fromMs, to: toMs });
        setError(null);
      }
    };

    // Monatswerte werden serverseitig 6h gecacht und ändern sich kaum, daher
    // wird die Jahresansicht einmalig geladen statt regelmäßig neu abgefragt.
    const syncYear = async () => {
      const payload = await client.readWaterSummary({ stateId, days: 7, multiplier, maxFlowLitersPerMinute, timezone });
      if (active) {
        setMonthly(payload.monthly);
        if (payload.monthly.length > 0) {
          const first = monthRangeMs(payload.monthly[0].month);
          const last = monthRangeMs(payload.monthly[payload.monthly.length - 1].month);
          setRange({ from: first.start, to: last.end });
        }
        setError(null);
      }
    };

    const sync = async () => {
      try {
        await (period === "year" ? syncYear() : syncRange());
      } catch (syncError) {
        if (active) {
          setError(syncError instanceof Error ? syncError.message : "Verlauf konnte nicht geladen werden");
        }
      }
    };

    void sync();
    const timer = period !== "year" && pageOffset === 0 ? setInterval(() => void sync(), REFRESH_MS) : null;

    return () => {
      active = false;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [client, stateId, multiplier, maxFlowLitersPerMinute, timezone, period, pageOffset]);

  const bars: ChartBarSpec[] = useMemo(() => {
    if (period === "year") {
      return monthly.map((entry) => {
        const { start, end } = monthRangeMs(entry.month);
        return { key: entry.month, tStart: start, tEnd: end, v: entry.liters, color: BAR_COLOR };
      });
    }
    return series.map((entry) => ({
      key: String(entry.t),
      tStart: entry.t,
      tEnd: entry.t + PERIOD_BUCKET_MS[period as RangePeriod],
      v: entry.liters,
      color: BAR_COLOR,
    }));
  }, [period, series, monthly]);

  const domain: TimeDomain | null = useMemo(() => {
    if (bars.length === 0) {
      return null;
    }
    const syntheticPoints = bars.flatMap((bar) => [
      { t: bar.tStart, v: 0 },
      { t: bar.tEnd, v: 0 },
    ]);
    return timeDomain(syntheticPoints);
  }, [bars]);

  const valueRange = useMemo(
    () => axisRange([{ points: bars.map((bar) => ({ t: bar.tStart, v: bar.v })), overrideMin: 0 }]),
    [bars]
  );

  const monthTicks = useMemo(
    () => (period === "year" ? buildMonthTicks(bars.map((bar) => ({ t: bar.tStart, v: bar.v }))) : undefined),
    [period, bars]
  );

  const chartElements = useMemo(
    () =>
      domain && valueRange
        ? buildChartElements({
            bars,
            mutedTextColor,
            leftRange: valueRange,
            rightRange: null,
            leftLabelFormat: (value) => `${formatLitersAxis(value)} L`,
            domain,
            layout: MODAL_CHART_LAYOUT,
            timeTicks: monthTicks,
          })
        : null,
    [domain, valueRange, bars, mutedTextColor, monthTicks]
  );

  const hasData = bars.some((bar) => bar.v !== null && (bar.v as number) > 0);
  const chartVisible = Boolean(domain) && Boolean(valueRange) && Boolean(chartElements);

  const latest = useMemo(() => {
    for (let i = bars.length - 1; i >= 0; i -= 1) {
      const v = bars[i].v;
      if (v !== null && Number.isFinite(v)) {
        return v;
      }
    }
    return null;
  }, [bars]);
  const totalLiters = useMemo(() => bars.reduce((sum, bar) => sum + (bar.v ?? 0), 0), [bars]);

  const hoverT = hoverRatio !== null && domain ? domain.minT + hoverRatio * (domain.maxT - domain.minT) : null;
  const hoverValue = hoverT !== null ? barValueAtTime(bars, hoverT) : null;

  const overlayChildren: ReactNode[] = [];
  if (hoverT !== null && hoverRatio !== null && hoverValue !== null && valueRange) {
    const leftPct =
      ((hoverRatio * MODAL_CHART_LAYOUT.plotWidth + MODAL_CHART_LAYOUT.axisLeftWidth) / chartWidth(MODAL_CHART_LAYOUT)) * 100;
    const topPct = (MODAL_CHART_LAYOUT.axisTopPadding / chartHeight(MODAL_CHART_LAYOUT)) * 100;
    const heightPct = (MODAL_CHART_LAYOUT.plotHeight / chartHeight(MODAL_CHART_LAYOUT)) * 100;

    overlayChildren.push(
      createElement("div", {
        key: "crosshair-line",
        style: {
          position: "absolute",
          left: `${leftPct}%`,
          top: `${topPct}%`,
          height: `${heightPct}%`,
          width: "1px",
          backgroundColor: "rgba(255,255,255,0.35)",
        },
      })
    );

    const yPlot = valueToY(hoverValue, valueRange, MODAL_CHART_LAYOUT);
    const topDotPct = ((yPlot + MODAL_CHART_LAYOUT.axisTopPadding) / chartHeight(MODAL_CHART_LAYOUT)) * 100;
    overlayChildren.push(
      createElement("div", {
        key: "dot",
        style: {
          position: "absolute",
          left: `${leftPct}%`,
          top: `${topDotPct}%`,
          width: "8px",
          height: "8px",
          borderRadius: "999px",
          backgroundColor: BAR_COLOR,
          border: "2px solid rgba(4,8,17,0.9)",
          transform: "translate(-50%, -50%)",
        },
      })
    );

    const alignRight = hoverRatio > 0.6;
    overlayChildren.push(
      createElement(
        "div",
        {
          key: "tooltip",
          style: {
            position: "absolute",
            left: `${leftPct}%`,
            top: `${topPct}%`,
            transform: alignRight ? "translate(calc(-100% - 8px), 0)" : "translate(8px, 0)",
            backgroundColor: "rgba(4,8,17,0.92)",
            border: `1px solid ${palette.border}`,
            borderRadius: "8px",
            padding: "6px 8px",
            fontSize: "11px",
            fontWeight: 700,
            whiteSpace: "nowrap",
          },
        },
        createElement(
          "div",
          { key: "tt-time", style: { color: mutedTextColor, marginBottom: "2px" } },
          period === "year" ? formatMonthLabel(hoverT) : formatDateTime(hoverT)
        ),
        createElement("div", { key: "tt-value", style: { color: BAR_COLOR } }, formatLiters(hoverValue))
      )
    );
  }

  const updateHoverFromClientX = (clientX: number) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      return;
    }
    setHoverRatio(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)));
  };

  const handleMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    updateHoverFromClientX(event.clientX);
  };

  const handlePointerLeave = () => {
    setHoverRatio(null);
  };

  // React attaches touch listeners passively by default, so preventDefault() in a
  // synthetic onTouchMove/onTouchStart handler is silently ignored (page keeps
  // scrolling while dragging on the chart). A native, non-passive listener is
  // required to actually suppress scroll during the crosshair drag gesture.
  useEffect(() => {
    const node = chartRef.current;
    if (!chartVisible || !node) {
      return;
    }

    const handleTouch = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      updateHoverFromClientX(touch.clientX);
    };

    node.addEventListener("touchstart", handleTouch, { passive: false });
    node.addEventListener("touchmove", handleTouch, { passive: false });

    return () => {
      node.removeEventListener("touchstart", handleTouch);
      node.removeEventListener("touchmove", handleTouch);
    };
  }, [chartVisible]);

  const rangeLabel =
    period === "year" ? "Letzte 12 Monate" : range ? `${formatDateTime(range.from)} – ${formatDateTime(range.to)}` : "";

  return (
    <Modal animationType="fade" transparent visible>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: textColor }]}>Absoluter Verbrauch</Text>
            <Pressable onPress={onClose}>
              <Text style={[styles.close, { color: mutedTextColor }]}>Schliessen</Text>
            </Pressable>
          </View>

          {createElement(
            "div",
            { style: webStatsRowStyle },
            latest !== null
              ? statBadge(period === "year" ? "letzter Monat" : "aktuell", formatLiters(latest), BAR_COLOR, "left", "latest")
              : null,
            statBadge("gesamt", formatLiters(totalLiters), mutedTextColor, "right", "total")
          )}

          <View style={styles.periodRow}>
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <Pressable
                key={p}
                onPress={() => selectPeriod(p)}
                style={[styles.periodChip, period === p ? styles.periodChipActive : null]}
              >
                <Text style={[styles.periodChipLabel, period === p ? styles.periodChipLabelActive : null]}>
                  {PERIOD_LABELS[p]}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.paginationRow}>
            {period === "year" ? null : (
              <Pressable onPress={goOlder} style={styles.pageButton}>
                <Text style={[styles.pageButtonLabel, { color: textColor }]}>{"‹ Älter"}</Text>
              </Pressable>
            )}
            <Text style={[styles.rangeLabel, { color: mutedTextColor }]} numberOfLines={1}>
              {rangeLabel}
            </Text>
            {period === "year" ? null : (
              <Pressable onPress={goNewer} disabled={isLive} style={styles.pageButton}>
                <Text style={[styles.pageButtonLabel, { color: isLive ? mutedTextColor : textColor }]}>{"Neuer ›"}</Text>
              </Pressable>
            )}
          </View>

          {error ? (
            <Text numberOfLines={1} style={styles.errorText}>
              {error}
            </Text>
          ) : null}

          <View style={styles.chartContainer}>
            {!chartVisible || !chartElements || !hasData
              ? createElement("div", { style: { ...webEmptyStateStyle, color: mutedTextColor } }, "Keine Daten")
              : createElement(
                  "div",
                  {
                    ref: chartRef,
                    style: webChartWrapperStyle,
                    onMouseMove: handleMouseMove,
                    onMouseLeave: handlePointerLeave,
                    onTouchEnd: handlePointerLeave,
                  },
                  createElement(
                    "svg",
                    {
                      viewBox: `0 0 ${chartWidth(MODAL_CHART_LAYOUT)} ${chartHeight(MODAL_CHART_LAYOUT)}`,
                      width: "100%",
                      height: "100%",
                      preserveAspectRatio: "none",
                      style: webChartSvgStyle,
                    },
                    createElement(
                      "g",
                      { transform: `translate(${MODAL_CHART_LAYOUT.axisLeftWidth}, ${MODAL_CHART_LAYOUT.axisTopPadding})` },
                      ...chartElements.children
                    )
                  ),
                  createElement("div", { style: webAxisLabelLayerStyle }, ...chartElements.labels),
                  createElement("div", { style: webAxisLabelLayerStyle }, ...overlayChildren)
                )}
          </View>
        </View>
      </View>
    </Modal>
  );
}
