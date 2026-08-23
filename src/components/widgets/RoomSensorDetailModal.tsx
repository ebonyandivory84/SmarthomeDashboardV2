import { createElement, MouseEvent as ReactMouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { IoBrokerClient } from "../../services/iobroker";
import { RoomSensorEntry } from "../../types/dashboard";
import { palette } from "../../utils/theme";
import {
  ChartLayout,
  SensorHistory,
  TimeDomain,
  ValueRange,
  axisRange,
  buildChartElements,
  buildSeriesPath,
  chartHeight,
  chartWidth,
  flattenRoomSensorIds,
  interpolateSeries,
  latestValue,
  seriesForId,
  statBadge,
  temperatureAxisRange,
  valueAtTime,
  valueToY,
  webAxisLabelLayerStyle,
  webChartSvgStyle,
  webChartWrapperStyle,
  webStatsRowStyle,
} from "./roomSensorChart";

type RoomSensorDetailModalProps = {
  room: RoomSensorEntry;
  client: IoBrokerClient;
  tempColor: string;
  humidityColor: string;
  co2Color: string;
  vocColor: string;
  textColor: string;
  mutedTextColor: string;
  onClose: () => void;
};

type Period = "24h" | "7d" | "30d";

const PERIOD_MS: Record<Period, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
};

const PERIOD_LABELS: Record<Period, string> = {
  "24h": "24h",
  "7d": "7 Tage",
  "30d": "30 Tage",
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

export function RoomSensorDetailModal({
  room,
  client,
  tempColor,
  humidityColor,
  co2Color,
  vocColor,
  textColor,
  mutedTextColor,
  onClose,
}: RoomSensorDetailModalProps) {
  const [period, setPeriod] = useState<Period>("24h");
  const [pageOffset, setPageOffset] = useState(0);
  const [history, setHistory] = useState<SensorHistory | null>(null);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);

  const ids = useMemo(
    () => flattenRoomSensorIds([room]),
    [room.temperatureStateId, room.humidityStateId, room.co2StateId, room.vocStateId]
  );

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
    const periodMs = PERIOD_MS[period];

    const sync = async () => {
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      const toMs = pageOffset === 0 ? Date.now() : Date.now() - pageOffset * periodMs;
      const fromMs = toMs - periodMs;
      try {
        const payload = await client.readRoomSensorHistoryRange(ids, fromMs, toMs);
        if (active) {
          setHistory(payload);
          setRange({ from: fromMs, to: toMs });
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
    const timer = pageOffset === 0 ? setInterval(() => void sync(), REFRESH_MS) : null;

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
    const tempPoints = interpolateSeries(seriesForId(history, room.temperatureStateId));
    const humidityPoints = interpolateSeries(seriesForId(history, room.humidityStateId));
    const co2Points = interpolateSeries(seriesForId(history, room.co2StateId));
    const vocPoints = interpolateSeries(seriesForId(history, room.vocStateId));

    const hasAnyData = tempPoints.length > 0 || humidityPoints.length > 0 || co2Points.length > 0 || vocPoints.length > 0;

    const tempRange = temperatureAxisRange(tempPoints, room.temperatureMin, room.temperatureMax);
    const secondaryRange = axisRange([
      { points: humidityPoints, overrideMin: room.humidityMin, overrideMax: room.humidityMax },
      { points: co2Points, overrideMin: room.co2Min, overrideMax: room.co2Max },
      { points: vocPoints, overrideMin: room.vocMin, overrideMax: room.vocMax },
    ]);

    const tempPath = domain && tempRange ? buildSeriesPath(tempPoints, tempRange, domain, MODAL_CHART_LAYOUT) : "";
    const humidityPath = domain && secondaryRange ? buildSeriesPath(humidityPoints, secondaryRange, domain, MODAL_CHART_LAYOUT) : "";
    const co2Path = domain && secondaryRange ? buildSeriesPath(co2Points, secondaryRange, domain, MODAL_CHART_LAYOUT) : "";
    const vocPath = domain && secondaryRange ? buildSeriesPath(vocPoints, secondaryRange, domain, MODAL_CHART_LAYOUT) : "";

    const latestTemp = latestValue(tempPoints);
    const latestHumidity = latestValue(humidityPoints);
    const latestCo2 = latestValue(co2Points);
    const latestVoc = latestValue(vocPoints);
    const hasAnyLatest = latestTemp !== null || latestHumidity !== null || latestCo2 !== null || latestVoc !== null;

    const chartElements =
      domain && (tempRange || secondaryRange)
        ? buildChartElements({
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
            layout: MODAL_CHART_LAYOUT,
          })
        : null;

    return {
      tempPoints,
      humidityPoints,
      co2Points,
      vocPoints,
      hasAnyData,
      tempRange,
      secondaryRange,
      latestTemp,
      latestHumidity,
      latestCo2,
      latestVoc,
      hasAnyLatest,
      chartElements,
    };
  }, [history, room, domain, tempColor, humidityColor, co2Color, vocColor, mutedTextColor]);

  const {
    tempPoints,
    humidityPoints,
    co2Points,
    vocPoints,
    hasAnyData,
    tempRange,
    secondaryRange,
    latestTemp,
    latestHumidity,
    latestCo2,
    latestVoc,
    hasAnyLatest,
    chartElements,
  } = chartData;

  const hoverT = hoverRatio !== null && domain ? domain.minT + hoverRatio * (domain.maxT - domain.minT) : null;
  const hoverTemp = hoverT !== null ? valueAtTime(tempPoints, hoverT) : null;
  const hoverHumidity = hoverT !== null ? valueAtTime(humidityPoints, hoverT) : null;
  const hoverCo2 = hoverT !== null ? valueAtTime(co2Points, hoverT) : null;
  const hoverVoc = hoverT !== null ? valueAtTime(vocPoints, hoverT) : null;

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

    const dotSpecs: Array<{ value: number | null; color: string; range: ValueRange | null; key: string }> = [
      { value: hoverTemp, color: tempColor, range: tempRange, key: "dot-temp" },
      { value: hoverHumidity, color: humidityColor, range: secondaryRange, key: "dot-humidity" },
      { value: hoverCo2, color: co2Color, range: secondaryRange, key: "dot-co2" },
      { value: hoverVoc, color: vocColor, range: secondaryRange, key: "dot-voc" },
    ];

    for (const spec of dotSpecs) {
      if (spec.value === null || !spec.range) {
        continue;
      }
      const yPlot = valueToY(spec.value, spec.range, MODAL_CHART_LAYOUT);
      const topDotPct = ((yPlot + MODAL_CHART_LAYOUT.axisTopPadding) / chartHeight(MODAL_CHART_LAYOUT)) * 100;
      overlayChildren.push(
        createElement("div", {
          key: spec.key,
          style: {
            position: "absolute",
            left: `${leftPct}%`,
            top: `${topDotPct}%`,
            width: "8px",
            height: "8px",
            borderRadius: "999px",
            backgroundColor: spec.color,
            border: "2px solid rgba(4,8,17,0.9)",
            transform: "translate(-50%, -50%)",
          },
        })
      );
    }

    const tooltipLines: Array<{ text: string; color: string }> = [];
    if (hoverTemp !== null) tooltipLines.push({ text: `Temp ${hoverTemp.toFixed(1)}°C`, color: tempColor });
    if (hoverHumidity !== null) tooltipLines.push({ text: `Feuchte ${Math.round(hoverHumidity)}%`, color: humidityColor });
    if (hoverCo2 !== null) tooltipLines.push({ text: `CO2 ${Math.round(hoverCo2)}`, color: co2Color });
    if (hoverVoc !== null) tooltipLines.push({ text: `VOC ${Math.round(hoverVoc)}`, color: vocColor });

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

  const rangeLabel = range ? `${formatDateTime(range.from)} – ${formatDateTime(range.to)}` : "";

  return (
    <Modal animationType="fade" transparent visible>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: textColor }]}>{room.label}</Text>
            <Pressable onPress={onClose}>
              <Text style={[styles.close, { color: mutedTextColor }]}>Schliessen</Text>
            </Pressable>
          </View>

          {hasAnyLatest
            ? createElement(
                "div",
                { style: webStatsRowStyle },
                latestTemp !== null ? statBadge("Temp", `${latestTemp.toFixed(1)}°C`, tempColor, "left") : null,
                latestHumidity !== null ? statBadge("Feuchte", `${Math.round(latestHumidity)}%`, humidityColor, "right") : null,
                latestCo2 !== null ? statBadge("CO2", `${Math.round(latestCo2)}`, co2Color, "left") : null,
                latestVoc !== null ? statBadge("VOC", `${Math.round(latestVoc)}`, vocColor, "right") : null
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
            <Pressable onPress={goOlder} style={styles.pageButton}>
              <Text style={[styles.pageButtonLabel, { color: textColor }]}>{"‹ Älter"}</Text>
            </Pressable>
            <Text style={[styles.rangeLabel, { color: mutedTextColor }]} numberOfLines={1}>
              {rangeLabel}
            </Text>
            <Pressable onPress={goNewer} disabled={isLive} style={styles.pageButton}>
              <Text style={[styles.pageButtonLabel, { color: isLive ? mutedTextColor : textColor }]}>{"Neuer ›"}</Text>
            </Pressable>
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
