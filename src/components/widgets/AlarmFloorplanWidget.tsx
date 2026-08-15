import { createElement } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { AlarmFloorplanWidgetConfig } from "../../types/dashboard";
import { palette } from "../../utils/theme";

type AlarmFloorplanWidgetProps = {
  config: AlarmFloorplanWidgetConfig;
  isActivePage?: boolean;
  lowPowerMode?: boolean;
};

export function AlarmFloorplanWidget({ config, isActivePage = true, lowPowerMode = false }: AlarmFloorplanWidgetProps) {
  const resolvedUrl = normalizeAlarmFloorplanUrl(config.url);

  if (!resolvedUrl) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.title}>URL fehlt</Text>
        <Text style={styles.meta}>Trage im Widget die AlarmSystem-WebUI-URL ein.</Text>
      </View>
    );
  }

  if (Platform.OS !== "web") {
    return (
      <View style={styles.fallback}>
        <Text style={styles.title}>{config.title || "AlarmSystem"}</Text>
        <Text style={styles.meta}>Diese Seite wird auf nativen Clients extern geoeffnet.</Text>
        <Pressable onPress={() => void Linking.openURL(resolvedUrl)} style={styles.openButton}>
          <Text style={styles.openButtonLabel}>URL oeffnen</Text>
        </Pressable>
      </View>
    );
  }

  if (!isActivePage || lowPowerMode) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.title}>{config.title || "AlarmSystem"}</Text>
        <Text style={styles.meta}>Wird aktiv, sobald diese Seite sichtbar ist.</Text>
      </View>
    );
  }

  return createElement(
    "div",
    { style: webFrameFillStyle },
    createElement("iframe", {
      src: resolvedUrl,
      style: webFrameFillStyle,
      allow: "fullscreen; autoplay",
      loading: "eager",
      referrerPolicy: "no-referrer",
    })
  );
}

function normalizeAlarmFloorplanUrl(value?: string) {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return "";
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.searchParams.has("embed")) {
      url.searchParams.set("embed", "1");
    }
    return url.toString();
  } catch {
    return withScheme;
  }
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    backgroundColor: "rgba(0,0,0,0.18)",
    padding: 14,
    justifyContent: "center",
    gap: 10,
  },
  title: {
    color: palette.text,
    fontSize: 16,
    fontWeight: "700",
  },
  meta: {
    color: palette.textMuted,
    lineHeight: 18,
  },
  openButton: {
    alignSelf: "flex-start",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  openButtonLabel: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "700",
  },
});

const webFrameFillStyle = {
  width: "100%",
  height: "100%",
  border: "0",
  display: "block",
};
