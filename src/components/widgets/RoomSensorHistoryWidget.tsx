import { createElement, KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import { RoomSensorEntry, RoomSensorHistoryWidgetConfig } from "../../types/dashboard";
import { palette } from "../../utils/theme";
import { RoomSensorDetailModal } from "./RoomSensorDetailModal";
import {
  ChartLayout,
  SensorHistory,
  axisRange,
  buildSeriesPath,
  clampIntRange,
  flattenRoomSensorIds,
  interpolateSeries,
  latestValue,
  renderChartCard,
  seriesForId,
  statBadge,
  temperatureAxisRange,
  timeDomain,
  webStatsRowStyle,
} from "./roomSensorChart";

type RoomSensorHistoryWidgetProps = {
  config: RoomSensorHistoryWidgetConfig;
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

export function RoomSensorHistoryWidget({ config, client, isActivePage = true }: RoomSensorHistoryWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const [history, setHistory] = useState<SensorHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRoom, setOpenRoom] = useState<RoomSensorEntry | null>(null);
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
            onOpen: () => setOpenRoom(room),
          })
        )
      )}
      {error ? (
        <Text numberOfLines={1} style={[styles.footerText, { color: palette.danger }]}>
          {error}
        </Text>
      ) : null}
      {openRoom ? (
        <RoomSensorDetailModal
          room={openRoom}
          client={client}
          tempColor={tempColor}
          humidityColor={humidityColor}
          co2Color={co2Color}
          vocColor={vocColor}
          textColor={textColor}
          mutedTextColor={mutedTextColor}
          onClose={() => setOpenRoom(null)}
        />
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
  onOpen: () => void;
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
  onOpen,
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

  const tempPath = domain && tempRange ? buildSeriesPath(tempPoints, tempRange, domain, CARD_CHART_LAYOUT) : "";
  const humidityPath = domain && secondaryRange ? buildSeriesPath(humidityPoints, secondaryRange, domain, CARD_CHART_LAYOUT) : "";
  const co2Path = domain && secondaryRange ? buildSeriesPath(co2Points, secondaryRange, domain, CARD_CHART_LAYOUT) : "";
  const vocPath = domain && secondaryRange ? buildSeriesPath(vocPoints, secondaryRange, domain, CARD_CHART_LAYOUT) : "";

  const latestTemp = latestValue(tempPoints);
  const latestHumidity = latestValue(humidityPoints);
  const latestCo2 = latestValue(co2Points);
  const latestVoc = latestValue(vocPoints);
  const hasAnyLatest = latestTemp !== null || latestHumidity !== null || latestCo2 !== null || latestVoc !== null;

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
      "aria-label": `${room.label} Verlauf oeffnen`,
      style: webPanelStyle,
    },
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
      : renderChartCard({
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
  display: "flex" as const,
  flexDirection: "column" as const,
  gap: "6px",
  minHeight: 0,
  cursor: "pointer" as const,
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

const webEmptyStateStyle = {
  fontSize: "12px",
  fontWeight: 600,
  textAlign: "center" as const,
  padding: "16px 0",
};
