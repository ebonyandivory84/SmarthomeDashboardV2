import { createElement, MouseEvent as ReactMouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { IoBrokerClient } from "../../services/iobroker";
import { HistoryChartSeriesEntry } from "../../types/dashboard";
import { palette } from "../../utils/theme";
import {
  ChartLayout,
  DEFAULT_SERIES_COLORS,
  SensorHistory,
  TimeDomain,
  axisRange,
  buildChartElements,
  buildMonthTicks,
  buildSeriesPath,
  chartHeight,
  chartWidth,
  flattenSeriesIds,
  interpolateSeries,
  latestValue,
  seriesForId,
  statBadge,
  valueAtTime,
  valueToY,
  webAxisLabelLayerStyle,
  webChartSvgStyle,
  webChartWrapperStyle,
  webStatsRowStyle,
} from "./roomSensorChart";

type HistoryChartDetailModalProps = {
  series: HistoryChartSeriesEntry[];
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

const PERIOD_LABELS: Record<Period, string> = {
  "24h": "24h",
  "7d": "7 Tage",
  "30d": "30 Tage",
  year: "Jahr",
};

const MODAL_CHART_LAYOUT: ChartLayout = {
  plotWidth: 720,
  plotHeight: 300,
  axisLeftWidth: 46,
  axisRightWidth: 46,
  axisTopPadding: 10,
  axisBottomHeight: 24,
};

const REFRESH_MS = 60_000;

export function HistoryChartDetailModal({ series, client, textColor, mutedTextColor, onClose }: HistoryChartDetailModalProps) {
  const [period, setPeriod] = useState<Period>("24h");
  const [pageOffset, setPageOffset] = useState(0);
  const [history, setHistory] = useState<SensorHistory | null>(null);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);

  const seriesKey = useMemo(() => flattenSeriesIds(series).sort().join(","), [series]);
  const ids = useMemo(() => flattenSeriesIds(series), [seriesKey]);

  const selectPeriod = (next: Period) => {
    setPeriod(next);
    setPageOffset(0);
  };

  const goOlder = () => setPageOffset((current) => current + 1);
  const goNewer = () => setPageOffset((current) => Math.max(0, current - 1));
  const isLive = pageOffset === 0;

  useEffect(() => {
    if (ids.length === 0) {
      return;
    }
    let active = true;
    let inFlight = false;
    let pending = false;

    const syncRange = async () => {
      const periodMs = PERIOD_MS[period as RangePeriod];
      const toMs = pageOffset === 0 ? Date.now() : Date.now() - pageOffset * periodMs;
      const fromMs = toMs - periodMs;
      const payload = await client.readRoomSensorHistoryRange(ids, fromMs, toMs);
      if (active) {
        setHistory(payload);
        setRange({ from: fromMs, to: toMs });
        setError(null);
      }
    };

    // Monthly averages are cheap to cache server-side and barely change within
    // a session, so the year view is fetched once on demand instead of polled.
    const syncYear = async () => {
      const payload = await client.readRoomSensorHistoryYear(ids);
      if (active) {
        setHistory(payload);
        const points = Object.values(payload).find((entrySeries) => entrySeries.length > 0);
        if (points && points.length > 0) {
          setRange({ from: points[0].t, to: points[points.length - 1].t });
        }
        setError(null);
      }
    };

    const sync = async () => {
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      try {
        await (period === "year" ? syncYear() : syncRange());
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
    const timer = period !== "year" && pageOffset === 0 ? setInterval(() => void sync(), REFRESH_MS) : null;

    return () => {
      active = false;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [client, ids, period, pageOffset]);

  const domain: TimeDomain | null = useMemo(
    () => (range ? { minT: range.from, maxT: range.to } : null),
    [range?.from, range?.to]
  );

  const chartData = useMemo(() => {
    const seriesData = series.map((entry, index) => ({
      entry,
      color: entry.color || DEFAULT_SERIES_COLORS[index % DEFAULT_SERIES_COLORS.length],
      points: interpolateSeries(seriesForId(history, entry.stateId)),
    }));

    const hasAnyData = seriesData.some((item) => item.points.length > 0);

    const leftSeries = seriesData.filter((item) => item.entry.axis === "left");
    const rightSeries = seriesData.filter((item) => item.entry.axis === "right");
    const leftRange = axisRange(
      leftSeries.map((item) => ({ points: item.points, overrideMin: item.entry.axisMin, overrideMax: item.entry.axisMax }))
    );
    const rightRange = axisRange(
      rightSeries.map((item) => ({ points: item.points, overrideMin: item.entry.axisMin, overrideMax: item.entry.axisMax }))
    );

    const chartSeries = seriesData.map((item) => {
      const seriesRange = item.entry.axis === "left" ? leftRange : rightRange;
      return {
        key: item.entry.stateId || item.entry.label,
        path: domain && seriesRange ? buildSeriesPath(item.points, seriesRange, domain, MODAL_CHART_LAYOUT) : "",
        color: item.color,
        dashed: item.entry.axis === "right",
      };
    });

    const hasAnyLatest = seriesData.some((item) => latestValue(item.points) !== null);

    const monthTicks =
      period === "year" ? buildMonthTicks(seriesData.find((item) => item.points.length > 0)?.points || []) : undefined;

    const chartElements =
      domain && (leftRange || rightRange)
        ? buildChartElements({
            series: chartSeries,
            mutedTextColor,
            leftRange,
            rightRange,
            domain,
            layout: MODAL_CHART_LAYOUT,
            timeTicks: monthTicks,
          })
        : null;

    return { seriesData, hasAnyData, leftRange, rightRange, hasAnyLatest, chartElements };
  }, [history, series, domain, mutedTextColor, period]);

  const { seriesData, hasAnyData, leftRange, rightRange, hasAnyLatest, chartElements } = chartData;

  const hoverT = hoverRatio !== null && domain ? domain.minT + hoverRatio * (domain.maxT - domain.minT) : null;
  const hoverValues = useMemo(
    () =>
      hoverT !== null
        ? seriesData.map((item) => ({
            entry: item.entry,
            color: item.color,
            axis: item.entry.axis,
            value: valueAtTime(item.points, hoverT),
          }))
        : [],
    [hoverT, seriesData]
  );

  const overlayChildren: ReactNode[] = [];
  if (hoverT !== null && hoverRatio !== null) {
    const leftPct = ((hoverRatio * MODAL_CHART_LAYOUT.plotWidth + MODAL_CHART_LAYOUT.axisLeftWidth) / chartWidth(MODAL_CHART_LAYOUT)) * 100;
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

    for (const item of hoverValues) {
      if (item.value === null) {
        continue;
      }
      const seriesRange = item.axis === "left" ? leftRange : rightRange;
      if (!seriesRange) {
        continue;
      }
      const yPlot = valueToY(item.value, seriesRange, MODAL_CHART_LAYOUT);
      const topDotPct = ((yPlot + MODAL_CHART_LAYOUT.axisTopPadding) / chartHeight(MODAL_CHART_LAYOUT)) * 100;
      overlayChildren.push(
        createElement("div", {
          key: `dot-${item.entry.stateId || item.entry.label}`,
          style: {
            position: "absolute",
            left: `${leftPct}%`,
            top: `${topDotPct}%`,
            width: "8px",
            height: "8px",
            borderRadius: "999px",
            backgroundColor: item.color,
            border: "2px solid rgba(4,8,17,0.9)",
            transform: "translate(-50%, -50%)",
          },
        })
      );
    }

    const tooltipLines = hoverValues
      .filter((item) => item.value !== null)
      .map((item) => {
        const decimals = item.entry.decimals ?? 1;
        const unit = item.entry.unit || "";
        return { text: `${item.entry.label} ${(item.value as number).toFixed(decimals)}${unit}`, color: item.color };
      });

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
        createElement("div", { key: "tt-time", style: { color: mutedTextColor, marginBottom: "2px" } }, formatDateTime(hoverT)),
        ...tooltipLines.map((line) => createElement("div", { key: line.text, style: { color: line.color } }, line.text))
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

  const chartVisible = hasAnyData && Boolean(domain) && Boolean(chartElements);

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
            <Text style={[styles.title, { color: textColor }]}>Verlauf</Text>
            <Pressable onPress={onClose}>
              <Text style={[styles.close, { color: mutedTextColor }]}>Schliessen</Text>
            </Pressable>
          </View>

          {hasAnyLatest
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
                  const key = item.entry.stateId || item.entry.label;
                  return statBadge(item.entry.label, valueText, item.color, index % 2 === 0 ? "left" : "right", key);
                })
              )
            : null}

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
            {!chartVisible || !chartElements
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

function formatDateTime(t: number) {
  const date = new Date(t);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}. ${hh}:${min}`;
}

const webEmptyStateStyle = {
  fontSize: "13px",
  fontWeight: 600,
  textAlign: "center" as const,
  padding: "32px 0",
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.74)",
    padding: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    width: "100%",
    maxWidth: 860,
    borderRadius: 22,
    backgroundColor: palette.panelStrong,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 18,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontWeight: "800",
    fontSize: 20,
  },
  close: {
    fontWeight: "700",
  },
  periodRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  periodChip: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
  },
  periodChipActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  periodChipLabel: {
    color: palette.text,
    fontWeight: "700",
    fontSize: 13,
  },
  periodChipLabelActive: {
    color: "#041019",
  },
  paginationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  pageButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: palette.border,
  },
  pageButtonLabel: {
    fontWeight: "700",
    fontSize: 13,
  },
  rangeLabel: {
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  errorText: {
    fontSize: 11,
    fontWeight: "700",
    color: palette.danger,
  },
  chartContainer: {
    minHeight: 340,
  },
});
