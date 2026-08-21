import { createElement, useEffect, useMemo, useState } from "react";
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

const CHART_WIDTH = 240;
const CHART_HEIGHT = 110;

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
  const dewColor = config.appearance?.cardColor2 || "#4dd0e1";
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
            dewColor,
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
  dewColor: string;
  co2Color: string;
  vocColor: string;
  textColor: string;
  mutedTextColor: string;
};

function RoomSensorPanel({
  room,
  history,
  tempColor,
  dewColor,
  co2Color,
  vocColor,
  textColor,
  mutedTextColor,
}: RoomSensorPanelProps) {
  const tempPoints = seriesForId(history, room.temperatureStateId);
  const dewPoints = seriesForId(history, room.dewPointStateId);
  const co2Points = seriesForId(history, room.co2StateId);
  const vocPoints = seriesForId(history, room.vocStateId);

  const hasClimateData = tempPoints.length > 0 || dewPoints.length > 0;
  const hasAirData = co2Points.length > 0 || vocPoints.length > 0;
  const climateRange = combinedRange(tempPoints, dewPoints);
  const airRange = combinedRange(co2Points, vocPoints);

  const tempPath = climateRange ? buildSeriesPath(tempPoints, climateRange.min, climateRange.max) : "";
  const dewPath = climateRange ? buildSeriesPath(dewPoints, climateRange.min, climateRange.max) : "";
  const co2Path = airRange ? buildSeriesPath(co2Points, airRange.min, airRange.max) : "";
  const vocPath = airRange ? buildSeriesPath(vocPoints, airRange.min, airRange.max) : "";

  const latestTemp = latestValue(tempPoints);
  const latestCo2 = latestValue(co2Points);
  const latestVoc = latestValue(vocPoints);

  return createElement(
    "div",
    { style: webPanelStyle },
    createElement(
      "div",
      { style: webPanelHeaderStyle },
      createElement("span", { style: { ...webRoomLabelStyle, color: textColor } }, room.label),
      latestTemp !== null
        ? createElement("span", { style: { ...webLatestValueStyle, color: mutedTextColor } }, `${latestTemp.toFixed(1)} °C`)
        : null
    ),
    hasAirData
      ? createElement(
          "div",
          { style: webAirStatsRowStyle },
          latestCo2 !== null ? airStatBadge("CO2", Math.round(latestCo2), co2Color) : null,
          latestVoc !== null ? airStatBadge("VOC", Math.round(latestVoc), vocColor) : null
        )
      : null,
    !hasClimateData && !hasAirData
      ? createElement("div", { style: { ...webEmptyStateStyle, color: mutedTextColor } }, "Keine Daten")
      : createElement(
          "svg",
          { viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`, width: "100%", height: CHART_HEIGHT, preserveAspectRatio: "none" },
          tempPath ? createElement("path", { d: tempPath, fill: "none", stroke: tempColor, strokeWidth: 2 }) : null,
          dewPath ? createElement("path", { d: dewPath, fill: "none", stroke: dewColor, strokeWidth: 2 }) : null,
          co2Path ? createElement("path", { d: co2Path, fill: "none", stroke: co2Color, strokeWidth: 1.5, strokeDasharray: "3,2" }) : null,
          vocPath ? createElement("path", { d: vocPath, fill: "none", stroke: vocColor, strokeWidth: 1.5, strokeDasharray: "3,2" }) : null
        ),
    createElement(
      "div",
      { style: webLegendStyle },
      legendEntry("Temp", tempColor, mutedTextColor),
      legendEntry("Taupunkt", dewColor, mutedTextColor),
      hasAirData ? legendEntry("CO2", co2Color, mutedTextColor) : null,
      hasAirData ? legendEntry("VOC", vocColor, mutedTextColor) : null
    )
  );
}

function legendEntry(label: string, color: string, mutedTextColor: string) {
  return createElement(
    "span",
    { style: webLegendItemStyle, key: label },
    createElement("span", { style: { ...webLegendDotStyle, backgroundColor: color } }),
    createElement("span", { style: { color: mutedTextColor } }, label)
  );
}

function airStatBadge(label: string, value: number, color: string) {
  return createElement(
    "span",
    { style: webAirStatBadgeStyle, key: label },
    createElement("span", { style: { ...webLegendDotStyle, backgroundColor: color } }),
    createElement("span", { style: { color, fontWeight: 800 } }, `${label} ${value}`)
  );
}

function flattenRoomSensorIds(rooms: RoomSensorEntry[]) {
  const ids = new Set<string>();
  for (const room of rooms) {
    if (room.temperatureStateId) ids.add(room.temperatureStateId);
    if (room.dewPointStateId) ids.add(room.dewPointStateId);
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

function combinedRange(a: SensorPoint[], b: SensorPoint[]) {
  let min = Infinity;
  let max = -Infinity;
  for (const point of [...a, ...b]) {
    if (point.v === null || !Number.isFinite(point.v)) {
      continue;
    }
    min = Math.min(min, point.v);
    max = Math.max(max, point.v);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }
  return { min, max };
}

function buildSeriesPath(points: SensorPoint[], min: number, max: number) {
  if (points.length === 0) {
    return "";
  }
  const span = max - min || 1;
  let path = "";
  let drawing = false;

  points.forEach((point, index) => {
    const x = points.length > 1 ? (index / (points.length - 1)) * CHART_WIDTH : CHART_WIDTH / 2;
    if (point.v === null || !Number.isFinite(point.v)) {
      drawing = false;
      return;
    }
    const y = CHART_HEIGHT - ((point.v - min) / span) * CHART_HEIGHT;
    path += `${drawing ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    drawing = true;
  });

  return path.trim();
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
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: "8px",
  width: "100%",
};

const webPanelStyle = {
  borderRadius: "12px",
  border: "1px solid rgba(255,255,255,0.08)",
  backgroundColor: "rgba(255,255,255,0.03)",
  padding: "10px",
  display: "flex",
  flexDirection: "column" as const,
  gap: "6px",
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

const webLatestValueStyle = {
  fontSize: "12px",
  fontWeight: 700,
};

const webAirStatsRowStyle = {
  display: "flex",
  flexDirection: "row" as const,
  flexWrap: "wrap" as const,
  gap: "8px",
};

const webAirStatBadgeStyle = {
  display: "flex",
  flexDirection: "row" as const,
  alignItems: "center",
  gap: "3px",
  fontSize: "11px",
};

const webEmptyStateStyle = {
  fontSize: "12px",
  fontWeight: 600,
  textAlign: "center" as const,
  padding: "16px 0",
};

const webLegendStyle = {
  display: "flex",
  flexDirection: "row" as const,
  flexWrap: "wrap" as const,
  gap: "8px",
};

const webLegendItemStyle = {
  display: "flex",
  flexDirection: "row" as const,
  alignItems: "center",
  gap: "3px",
  fontSize: "10px",
  fontWeight: 700,
};

const webLegendDotStyle = {
  width: "6px",
  height: "6px",
  borderRadius: "999px",
  display: "inline-block",
};
