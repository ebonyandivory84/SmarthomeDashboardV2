import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
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

export function WeatherWidget({ config, isActivePage = true }: WeatherWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const [data, setData] = useState<WeatherPayload | null>(null);
  const [resolvedCoords, setResolvedCoords] = useState<{ latitude: number; longitude: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textColor = config.appearance?.textColor || palette.text;
  const mutedTextColor = config.appearance?.mutedTextColor || palette.textMuted;
  const locationQuery = config.locationQuery?.trim() || "";

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
  const displayLatitude = resolvedCoords?.latitude ?? config.latitude;
  const displayLongitude = resolvedCoords?.longitude ?? config.longitude;

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.heroGlow} />
        <View style={styles.heroTop}>
          <View style={styles.heroMeta}>
            <Text numberOfLines={1} style={[styles.location, { color: textColor }]}>
              {displayLabel}
            </Text>
            <Text style={[styles.summary, { color: textColor }]}>
              {current ? describeWeather(current.weathercode) : error || "Lade Wetter..."}
            </Text>
            <Text style={[styles.rangeText, { color: mutedTextColor }]}>
              T: {forecastDays[0]?.max !== undefined ? `${Math.round(forecastDays[0].max)}°` : "—"}
            </Text>
          </View>
          <Text style={[styles.temp, { color: textColor }]}>
            {current ? `${Math.round(current.temperature)}°` : "—"}
          </Text>
        </View>

        <View style={styles.sunWrap}>
          <View style={styles.sunHalo} />
          <MaterialCommunityIcons
            color={iconColorForCode(current?.weathercode, currentIsDay)}
            name={iconForCode(current?.weathercode, currentIsDay)}
            size={76}
          />
        </View>
      </View>

      <View style={styles.metaRow}>
        <Text style={[styles.meta, { color: mutedTextColor }]}>
          Wind {current ? `${Math.round(current.windspeed)} km/h` : "—"}
        </Text>
        <Text style={[styles.meta, { color: mutedTextColor }]}>
          {displayLatitude.toFixed(2)}, {displayLongitude.toFixed(2)}
        </Text>
      </View>

      <View style={styles.forecastRow}>
        {forecastDays.map((day) => (
          <View key={day.date} style={styles.dayCard}>
            <Text style={[styles.dayLabel, { color: textColor }]}>{weekday(day.date)}</Text>
            <MaterialCommunityIcons color={iconColorForCode(day.code, true)} name={iconForCode(day.code, true)} size={22} />
            <Text style={[styles.dayTemp, { color: textColor }]}>
              {day.max !== undefined ? `${Math.round(day.max)}°` : "—"}
            </Text>
            <Text style={[styles.dayTempMin, { color: mutedTextColor }]}>
              {day.min !== undefined ? `${Math.round(day.min)}°` : "—"}
            </Text>
          </View>
        ))}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 10,
  },
  hero: {
    position: "relative",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    overflow: "hidden",
    backgroundColor: "rgba(70, 98, 150, 0.32)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  heroGlow: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(133, 170, 233, 0.12)",
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  heroMeta: {
    flex: 1,
    paddingRight: 92,
  },
  location: {
    fontSize: 16,
    lineHeight: 19,
    fontWeight: "800",
  },
  summary: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: "700",
  },
  rangeText: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "700",
  },
  temp: {
    fontSize: 54,
    fontWeight: "800",
    lineHeight: 56,
  },
  sunWrap: {
    position: "absolute",
    left: "50%",
    top: 18,
    marginLeft: -38,
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
  },
  sunHalo: {
    position: "absolute",
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: "rgba(255, 205, 72, 0.20)",
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  meta: {
    fontSize: 12,
    fontWeight: "600",
  },
  forecastRow: {
    flexDirection: "row",
    gap: 0,
    flexWrap: "nowrap",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(38, 60, 104, 0.28)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  dayCard: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.04)",
  },
  dayLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  dayTemp: {
    fontSize: 16,
    fontWeight: "800",
  },
  dayTempMin: {
    fontSize: 12,
    fontWeight: "700",
  },
});
