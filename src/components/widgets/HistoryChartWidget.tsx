import { createElement, KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import { HistoryChartSeriesEntry, HistoryChartWidgetConfig } from "../../types/dashboard";
import { palette } from "../../utils/theme";
import { HistoryChartDetailModal } from "./HistoryChartDetailModal";
import {
  ChartLayout,
  DEFAULT_SERIES_COLORS,
  SensorHistory,
  axisRange,
  buildSeriesPath,
  clampIntRange,
  flattenSeriesIds,
  interpolateSeries,
  latestValue,
  renderChartCard,
  seriesForId,
  statBadge,
  timeDomain,
  webStatsRowStyle,
} from "./roomSensorChart";

type HistoryChartWidgetProps = {
  config: HistoryChartWidgetConfig;
  client: IoBrokerClient;
  isActivePage?: boolean;
};

const CARD_CHART_LAYOUT: ChartLayout = {
  plotWidth: 220,
  plotHeight: 100,
  axisLeftWidth: 30,
  axisRightWidth: 30,
  axisTopPadding: 4,
  axisBottomHeight: 14,
};

export function HistoryChartWidget({ config, client, isActivePage = true }: HistoryChartWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const [history, setHistory] = useState<SensorHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
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
      <HistoryChartPanel series={series} history={history} mutedTextColor={mutedTextColor} onOpen={() => setDetailOpen(true)} />
      {error ? (
        <Text numberOfLines={1} style={[styles.footerText, { color: palette.danger }]}>
          {error}
        </Text>
      ) : null}
      {detailOpen ? (
        <HistoryChartDetailModal
          series={series}
          client={client}
          textColor={textColor}
          mutedTextColor={mutedTextColor}
          onClose={() => setDetailOpen(false)}
        />
      ) : null}
    </View>
  );
}

type HistoryChartPanelProps = {
  series: HistoryChartSeriesEntry[];
  history: SensorHistory | null;
  mutedTextColor: string;
  onOpen: () => void;
};

function HistoryChartPanel({ series, history, mutedTextColor, onOpen }: HistoryChartPanelProps) {
  const seriesData = series.map((entry, index) => ({
    entry,
    color: entry.color || DEFAULT_SERIES_COLORS[index % DEFAULT_SERIES_COLORS.length],
    points: interpolateSeries(seriesForId(history, entry.stateId)),
  }));

  const hasAnyData = seriesData.some((item) => item.points.length > 0);
  const domain = timeDomain(...seriesData.map((item) => item.points));

  const leftSeries = seriesData.filter((item) => item.entry.axis === "left");
  const rightSeries = seriesData.filter((item) => item.entry.axis === "right");
  const leftRange = axisRange(leftSeries.map((item) => ({ points: item.points, overrideMin: item.entry.axisMin, overrideMax: item.entry.axisMax })));
  const rightRange = axisRange(
    rightSeries.map((item) => ({ points: item.points, overrideMin: item.entry.axisMin, overrideMax: item.entry.axisMax }))
  );

  const chartSeries = seriesData.map((item) => {
    const range = item.entry.axis === "left" ? leftRange : rightRange;
    return {
      key: item.entry.stateId || item.entry.label,
      path: domain && range ? buildSeriesPath(item.points, range, domain, CARD_CHART_LAYOUT) : "",
      color: item.color,
      dashed: item.entry.axis === "right",
    };
  });

  const hasAnyLatest = seriesData.some((item) => latestValue(item.points) !== null);

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
      "aria-label": "Verlauf oeffnen",
      style: webPanelStyle,
    },
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
            const key = item.entry.stateId || item.entry.label;
            return statBadge(item.entry.label, valueText, item.color, index % 2 === 0 ? "left" : "right", key);
          })
        )
      : null,
    !hasAnyData || !domain
      ? createElement("div", { style: { ...webEmptyStateStyle, color: mutedTextColor } }, "Keine Daten")
      : renderChartCard({
          series: chartSeries,
          mutedTextColor,
          leftRange,
          rightRange,
          domain,
          layout: CARD_CHART_LAYOUT,
        })
  );
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
  display: "flex" as const,
  flexDirection: "column" as const,
  gap: "6px",
  flex: 1,
  minHeight: 0,
  cursor: "pointer" as const,
};

const webEmptyStateStyle = {
  fontSize: "12px",
  fontWeight: 600,
  textAlign: "center" as const,
  padding: "16px 0",
};
