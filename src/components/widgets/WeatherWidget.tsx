import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { createElement, useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { AutoFitContent } from "../AutoFitContent";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { WeatherWidgetConfig } from "../../types/dashboard";
import { palette } from "../../utils/theme";

type WeatherPayload = {
  current_weather?: {
    temperature: number;
    weathercode: number;
    windspeed: number;
    is_day?: number;
  };
  daily?: {
    time: string[];
    weathercode: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
  };
};

type GeocodingPayload = {
  results?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    admin1?: string;
  }>;
};

type WeatherWidgetProps = {
  config: WeatherWidgetConfig;
  isActivePage?: boolean;
};

const WEATHER_CONTENT_WIDTH = 280;

export function WeatherWidget({ config, isActivePage = true }: WeatherWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const [data, setData] = useState<WeatherPayload | null>(null);
  const [resolvedCoords, setResolvedCoords] = useState<{ latitude: number; longitude: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textColor = config.appearance?.textColor || palette.text;
  const mutedTextColor = config.appearance?.mutedTextColor || palette.textMuted;
  const locationQuery = config.locationQuery?.trim() || "";
  const cardStart = config.appearance?.widgetColor || "rgba(32, 48, 76, 0.55)";
  const cardEnd = config.appearance?.widgetColor2 || "rgba(16, 24, 40, 0.68)";
  const panelColor = config.appearance?.cardColor || "rgba(255, 255, 255, 0.06)";
  const panelBorder = "rgba(255, 255, 255, 0.12)";

  useEffect(() => {
    if (!runtimeActive) {
      return;
    }
    let active = true;

    const load = async () => {
      try {
        let latitude = config.latitude;
        let longitude = config.longitude;
        let resolvedLabel = config.locationName || config.title;

        if (locationQuery) {
          const geocodingParams = new URLSearchParams({
            name: locationQuery,
            count: "1",
            language: "de",
            format: "json",
          });
          const geocodingResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${geocodingParams.toString()}`);
          if (!geocodingResponse.ok) {
            throw new Error(`Ortsabfrage fehlgeschlagen (${geocodingResponse.status})`);
          }

          const geocodingPayload = (await geocodingResponse.json()) as GeocodingPayload;
          const match = geocodingPayload.results?.[0];
          if (!match) {
            throw new Error("Ort nicht gefunden");
          }

          latitude = match.latitude;
          longitude = match.longitude;
          resolvedLabel = [match.name, match.admin1, match.country].filter(Boolean).join(", ");
        }

        const params = new URLSearchParams({
          latitude: String(latitude),
          longitude: String(longitude),
          current_weather: "true",
          daily: "weathercode,temperature_2m_max,temperature_2m_min",
          forecast_days: "5",
          timezone: config.timezone || "auto",
        });
        const endpoint = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
        const response = await fetch(endpoint);
        if (!response.ok) {
          throw new Error(`Weather request failed (${response.status})`);
        }

        const payload = (await response.json()) as WeatherPayload;
        if (active) {
          setData(payload);
          setResolvedCoords({ latitude, longitude, label: resolvedLabel });
          setError(null);
        }
      } catch (loadError) {
        if (active) {
          setResolvedCoords(null);
          setError(loadError instanceof Error ? loadError.message : "Wetter konnte nicht geladen werden");
        }
      }
    };

    load();
    const timer = setInterval(load, Math.max(60000, config.refreshMs || 300000));

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [config.latitude, config.locationName, config.refreshMs, config.timezone, config.title, config.longitude, locationQuery, runtimeActive]);

  const current = data?.current_weather;
  const forecastDays = (data?.daily?.time || []).slice(0, 5).map((date, index) => ({
    date,
    code: data?.daily?.weathercode?.[index],
    max: data?.daily?.temperature_2m_max?.[index],
    min: data?.daily?.temperature_2m_min?.[index],
  }));

  const currentIsDay = current?.is_day !== 0;
  const displayLabel = config.locationName || resolvedCoords?.label || locationQuery || config.title;
  const todayMax = forecastDays[0]?.max;
  const todayMin = forecastDays[0]?.min;

  return (
    <View style={styles.container}>
      <View style={[styles.card, { backgroundColor: cardStart, borderColor: panelBorder }]}>
        {Platform.OS === "web"
          ? createElement("div", {
              style: {
                ...webGradientLayerStyle,
                background: `linear-gradient(150deg, ${cardStart} 0%, ${cardEnd} 100%)`,
              },
            })
          : null}
        <View style={styles.sheen} />

        <AutoFitContent contentStyle={styles.scaledContent} designWidth={WEATHER_CONTENT_WIDTH} style={styles.fitViewport}>
          <View style={styles.headerRow}>
            <View style={styles.headerMeta}>
              {config.showTitle !== false ? (
                <Text numberOfLines={1} style={[styles.location, { color: textColor }]}>
                  {displayLabel}
                </Text>
              ) : null}
              <Text numberOfLines={1} style={[styles.summary, { color: mutedTextColor }]}>
                {current ? describeWeather(current.weathercode) : error || "Lade Wetter..."}
              </Text>
            </View>
            <View style={styles.currentGroup}>
              <MaterialCommunityIcons
                color={iconColorForCode(current?.weathercode, currentIsDay)}
                name={iconForCode(current?.weathercode, currentIsDay)}
                size={30}
              />
              <Text style={[styles.temp, { color: textColor }]}>
                {current ? `${Math.round(current.temperature)}°` : "—"}
              </Text>
            </View>
          </View>

          <View style={styles.metaRow}>
            <View style={[styles.chip, { backgroundColor: panelColor, borderColor: panelBorder }]}>
              <MaterialCommunityIcons color={mutedTextColor} name="weather-windy" size={12} />
              <Text style={[styles.chipText, { color: mutedTextColor }]}>
                {current ? `${Math.round(current.windspeed)} km/h` : "—"}
              </Text>
            </View>
            <View style={[styles.chip, { backgroundColor: panelColor, borderColor: panelBorder }]}>
              <MaterialCommunityIcons color={mutedTextColor} name="arrow-up-thin" size={12} />
              <Text style={[styles.chipText, { color: textColor }]}>
                {todayMax !== undefined ? `${Math.round(todayMax)}°` : "—"}
              </Text>
              <MaterialCommunityIcons color={mutedTextColor} name="arrow-down-thin" size={12} />
              <Text style={[styles.chipText, { color: mutedTextColor }]}>
                {todayMin !== undefined ? `${Math.round(todayMin)}°` : "—"}
              </Text>
            </View>
          </View>

          <View style={[styles.forecastRow, { backgroundColor: panelColor, borderColor: panelBorder }]}>
            {forecastDays.map((day) => (
              <View key={day.date} style={styles.dayCard}>
                <Text style={[styles.dayLabel, { color: mutedTextColor }]}>{weekday(day.date)}</Text>
                <MaterialCommunityIcons color={iconColorForCode(day.code, true)} name={iconForCode(day.code, true)} size={16} />
                <Text style={[styles.dayTemp, { color: textColor }]}>
                  {day.max !== undefined ? `${Math.round(day.max)}°` : "—"}
                </Text>
                <Text style={[styles.dayTempMin, { color: mutedTextColor }]}>
                  {day.min !== undefined ? `${Math.round(day.min)}°` : "—"}
                </Text>
              </View>
            ))}
          </View>
        </AutoFitContent>
      </View>
    </View>
  );
}

function weekday(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString("de-DE", { weekday: "short" });
}

function iconForCode(code?: number, isDay = true) {
  if (code === undefined) {
    return "weather-cloudy-alert";
  }
  if (code === 0) {
    return isDay ? "weather-sunny" : "weather-night";
  }
  if ([1, 2].includes(code)) {
    return isDay ? "weather-partly-cloudy" : "weather-night-partly-cloudy";
  }
  if (code === 3) {
    return "weather-cloudy";
  }
  if ([45, 48].includes(code)) {
    return "weather-fog";
  }
  if ([51, 53, 55, 56, 57].includes(code)) {
    return "weather-rainy";
  }
  if ([61, 63, 65, 80, 81, 82].includes(code)) {
    return "weather-pouring";
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return "weather-snowy";
  }
  if ([95, 96, 99].includes(code)) {
    return "weather-lightning-rainy";
  }
  return "weather-cloudy";
}

function iconColorForCode(code?: number, isDay = true) {
  if (code === 0) {
    return isDay ? "#ffd166" : "#b7c4ff";
  }
  if (code !== undefined && [95, 96, 99].includes(code)) {
    return "#c9a0ff";
  }
  return "#8fd3ff";
}

function describeWeather(code?: number) {
  if (code === undefined) {
    return "Keine Daten";
  }
  if (code === 0) {
    return "Klar";
  }
  if ([1, 2].includes(code)) {
    return "Leicht bewölkt";
  }
  if (code === 3) {
    return "Bewölkt";
  }
  if ([45, 48].includes(code)) {
    return "Nebel";
  }
  if ([51, 53, 55, 56, 57, 61, 63, 65, 80, 81, 82].includes(code)) {
    return "Regen";
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return "Schnee";
  }
  if ([95, 96, 99].includes(code)) {
    return "Gewitter";
  }
  return "Wetter";
}

const webGradientLayerStyle = {
  position: "absolute",
  inset: 0,
  zIndex: 0,
  pointerEvents: "none",
} as const;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  card: {
    flex: 1,
    position: "relative",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sheen: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: "45%",
    backgroundColor: "rgba(255,255,255,0.05)",
    zIndex: 0,
  },
  fitViewport: {
    zIndex: 1,
  },
  scaledContent: {
    gap: 8,
    zIndex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  location: {
    fontSize: 14,
    fontWeight: "800",
  },
  summary: {
    fontSize: 12,
    fontWeight: "600",
  },
  currentGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  temp: {
    fontSize: 28,
    fontWeight: "800",
  },
  metaRow: {
    flexDirection: "row",
    gap: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "700",
  },
  forecastRow: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  dayCard: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 4,
    alignItems: "center",
    gap: 3,
  },
  dayLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  dayTemp: {
    fontSize: 13,
    fontWeight: "800",
  },
  dayTempMin: {
    fontSize: 10,
    fontWeight: "700",
  },
});
