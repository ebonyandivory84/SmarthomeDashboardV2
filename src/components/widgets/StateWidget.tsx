import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect, useState } from "react";
import { Image, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { StateWidgetConfig } from "../../types/dashboard";
import { playConfiguredUiSound } from "../../utils/uiSounds";
import { palette } from "../../utils/theme";

type StateWidgetProps = {
  config: StateWidgetConfig;
  value: unknown;
  addonValue?: unknown;
  onToggle: () => void;
  interactionState?: "idle" | "pending" | "confirmed" | "error";
};

export function StateWidget({ config, value, addonValue, onToggle, interactionState = "idle" }: StateWidgetProps) {
  const [tileLayout, setTileLayout] = useState({ width: 0, height: 0 });
  const [showConfirmedPulse, setShowConfirmedPulse] = useState(false);
  // Angenommener Zustand direkt nach dem Druck. Der echte Wert braucht den Weg
  // ueber ioBroker und den 100-ms-Sammelpuffer zurueck; ohne diese Annahme
  // steht die Kachel bis dahin unveraendert da und der Druck wirkt verschluckt.
  const [assumedActive, setAssumedActive] = useState<boolean | null>(null);
  const hasValue = value !== null && value !== undefined;
  const hasTitle = config.showTitle !== false && Boolean(config.title?.trim());
  const halfTile = config.tileSize === "half";
  const optimistic = config.optimisticFeedback !== false;
  const actualActive = resolveStateActive(config, value);
  // Ohne optimistische Rueckmeldung zaehlt ausschliesslich der zurueckgemeldete Wert.
  const active = optimistic ? assumedActive ?? actualActive : actualActive;
  const iconName = resolveIconName(config, value, active);
  const mutedTextColor = config.appearance?.mutedTextColor || palette.textMuted;
  const iconColor = active
    ? config.appearance?.iconColor || palette.accent
    : config.appearance?.iconColor2 || palette.textMuted;
  // Vorgabefarben, wenn die Kachel keine eigenen gesetzt hat. Das fahle Grau
  // von frueher liess "an" nur heller wirken statt eingeschaltet.
  const activeBackground = config.appearance?.activeWidgetColor || "rgba(86, 150, 214, 0.96)";
  const inactiveBackground = config.appearance?.inactiveWidgetColor || "rgba(44, 48, 62, 0.96)";
  const tileBackground = active ? activeBackground : inactiveBackground;
  const resolvedAddonValue = resolveAddonValue(config, value, addonValue, active);
  const compactTile = tileLayout.width > 0 && (tileLayout.width < 220 || tileLayout.height < 180);
  const veryCompactTile = tileLayout.width > 0 && (tileLayout.width < 170 || tileLayout.height < 140);
  // Die halbe Kachel skaliert mit ihrer gemessenen Hoehe statt mit festen
  // Werten: sie faellt je nach Rasterbreite sehr unterschiedlich aus, und
  // feste Groessen wirken mal winzig, mal ueberfuellt. 135 px ist die
  // Bezugshoehe, bei der die Werte unten genau passen.
  const halfScale = clampNumber((tileLayout.height || HALF_TILE_REFERENCE_HEIGHT) / HALF_TILE_REFERENCE_HEIGHT, 0.6, 1.35);
  const halfIconSize = Math.round(clampNumber(40 * halfScale, 22, 54));
  const halfIconBox = Math.round(clampNumber(56 * halfScale, 32, 74));
  const halfTitleSize = Math.round(clampNumber(22 * halfScale, 13, 30));
  const halfValueSize = Math.round(clampNumber(17 * halfScale, 11, 24));
  const halfSoloSize = Math.round(clampNumber(24 * halfScale, 14, 32));
  const halfTitleOnlySize = Math.round(clampNumber(26 * halfScale, 15, 34));
  const halfTextLeft = 12 + halfIconBox + 8;
  const addonMetrics = resolveAddonMetrics(config, resolvedAddonValue, halfTile, halfScale);
  // Das generische "Ein"/"Aus" sagt nichts, was die Kachelfarbe nicht schon
  // zeigt, und kostet in der halben Kachel die Zeile, die dem Titel fehlt.
  // Eigene Beschriftungen, Wertzuordnungen und echte Messwerte bleiben.
  const stateLabelMode =
    config.stateLabelMode === "always" || config.stateLabelMode === "never" ? config.stateLabelMode : "auto";
  const showValueText =
    !hasValue ||
    (stateLabelMode === "always"
      ? true
      : stateLabelMode === "never"
        ? false
        : !hasTitle || !isGenericStateLabel(config, value));
  const iconSize = halfTile ? halfIconSize : veryCompactTile ? 34 : compactTile ? 38 : 44;
  const showStatus = interactionState === "pending" || interactionState === "error" || showConfirmedPulse;
  const iconImageUri = config.iconImage
    ? `/smarthome-dashboard-v2/widget-assets/${encodeURIComponent(config.iconImage)}`
    : null;
  const iconImageCrop = normalizeIconImageCrop(config.iconImageCrop);
  const iconImageSizeMode = normalizeIconImageSizeMode(config.iconImageSizeMode);
  const iconImageBorderless = config.iconImageBorderless === true;
  const showMaximizedImage = Boolean(iconImageUri && iconImageSizeMode === "maximized");
  const iconImageResizeMode = iconImageCrop === "circle" ? "cover" : "contain";
  // Der Statusrahmen muss die Rundung der Kachel treffen, sonst steht er ab.
  const tileCornerRadius = showMaximizedImage && iconImageBorderless ? 0 : halfTile ? 18 : 22;

  useEffect(() => {
    if (assumedActive === null) {
      return;
    }

    // Annahme faellt, sobald der echte Wert nachgezogen hat oder der Schreib-
    // vorgang abgeschlossen ist. Bei einem Fehler springt die Kachel damit
    // sichtbar zurueck, statt eine Aenderung vorzutaeuschen.
    if (actualActive === assumedActive || interactionState === "confirmed" || interactionState === "error") {
      setAssumedActive(null);
      return;
    }

    // Notbremse, falls gar keine Rueckmeldung kommt.
    const timer = setTimeout(() => setAssumedActive(null), 5000);
    return () => clearTimeout(timer);
  }, [actualActive, assumedActive, interactionState]);

  useEffect(() => {
    if (interactionState !== "confirmed") {
      return;
    }

    playConfiguredUiSound(config.interactionSounds?.confirm, "tap", `${config.id}:confirm`);
    setShowConfirmedPulse(true);
    const timer = setTimeout(() => setShowConfirmedPulse(false), 1600);

    return () => clearTimeout(timer);
  }, [config.id, config.interactionSounds?.confirm, interactionState]);

  const content = (
    <View
      onLayout={(event: LayoutChangeEvent) => setTileLayout(event.nativeEvent.layout)}
      style={[
        styles.tile,
        showMaximizedImage && iconImageBorderless ? styles.tileImageMaximized : null,
        halfTile ? styles.tileHalf : null,
        !halfTile && compactTile ? styles.tileCompact : null,
        !halfTile && veryCompactTile ? styles.tileVeryCompact : null,
        { backgroundColor: tileBackground },
      ]}
    >
      {showMaximizedImage && iconImageUri ? (
        <Image
          resizeMode="cover"
          source={{ uri: iconImageUri }}
          style={[
            styles.maximizedImage,
            showMaximizedImage && iconImageBorderless ? styles.maximizedImageBorderless : null,
            iconImageCrop === "rounded" ? styles.maximizedImageRounded : null,
            iconImageCrop === "circle" ? styles.maximizedImageCircle : null,
          ]}
        />
      ) : null}
      <AddonChip config={config} half={halfTile} metrics={addonMetrics} value={resolvedAddonValue} />
      {showStatus ? (
        <InteractionStatusRing
          radius={tileCornerRadius}
          state={interactionState === "confirmed" ? "confirmed" : interactionState}
        />
      ) : null}
      {!showMaximizedImage ? (
        <>
          <View
            style={[
              styles.iconWrap,
              halfTile ? styles.iconWrapHalf : null,
              halfTile
                ? { width: halfIconBox, height: halfIconBox, transform: [{ translateY: -halfIconBox / 2 }] }
                : null,
              !halfTile && compactTile ? styles.iconWrapCompact : null,
              !halfTile && veryCompactTile ? styles.iconWrapVeryCompact : null,
              iconImageCrop === "rounded" ? styles.iconWrapRounded : null,
              iconImageCrop === "circle" ? styles.iconWrapCircle : null,
            ]}
          >
            {iconImageUri ? (
              <Image
                resizeMode={iconImageResizeMode}
                source={{ uri: iconImageUri }}
                style={styles.iconImage}
              />
            ) : (
              <MaterialCommunityIcons
                color={iconColor}
                name={(iconName || "toggle-switch-outline") as never}
                size={iconSize}
              />
            )}
          </View>
          <View
            style={[
              styles.textBlock,
              halfTile ? styles.textBlockHalf : null,
              halfTile ? { left: halfTextLeft, right: addonMetrics.reserve } : null,
              !halfTile && compactTile ? styles.textBlockCompact : null,
              !halfTile && veryCompactTile ? styles.textBlockVeryCompact : null,
            ]}
          >
            {halfTile && hasTitle ? (
              <Text
                ellipsizeMode="tail"
                numberOfLines={1}
                style={[
                  styles.titleHalf,
                  (() => {
                    const size = showValueText ? halfTitleSize : halfTitleOnlySize;
                    return { fontSize: size, lineHeight: Math.round(size * 1.18) };
                  })(),
                  { color: config.appearance?.textColor || palette.text },
                ]}
              >
                {config.title}
              </Text>
            ) : null}
            {showValueText ? (
            <Text
              ellipsizeMode="tail"
              numberOfLines={halfTile ? 1 : 3}
              style={[
                styles.value,
                halfTile ? styles.valueHalf : null,
                halfTile && !hasTitle ? styles.valueHalfSolo : null,
                halfTile
                  ? (() => {
                      const size = hasTitle ? halfValueSize : halfSoloSize;
                      return { fontSize: size, lineHeight: Math.round(size * 1.2) };
                    })()
                  : null,
                {
                  color:
                    halfTile && !hasTitle
                      ? config.appearance?.textColor || palette.text
                      : mutedTextColor,
                },
              ]}
            >
              {hasValue ? resolveStateLabel(config, value, active) : "Keine Daten"}
            </Text>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.container, hasTitle && !halfTile ? styles.containerWithTitle : null]}>
      {config.writeable ? (
        <Pressable
          onPress={() => {
            playConfiguredUiSound(config.interactionSounds?.press, "toggle", `${config.id}:press`);
            if (optimistic) {
              setAssumedActive(!actualActive);
            }
            onToggle();
          }}
          style={({ pressed }) => [styles.tapArea, pressed ? styles.tapAreaPressed : null]}
        >
          {content}
        </Pressable>
      ) : (
        content
      )}
    </View>
  );
}

/**
 * Schreibstatus als Rahmen um die ganze Kachel. Ein Chip in einer Ecke
 * kollidierte je nach Ecke mit dem Symbol oder dem Addon-Wert, und in der
 * halben Kachel war fuer ihn ohnehin kein Platz. Der Rahmen gehoert sichtbar
 * zur gesamten Kachel, verdeckt nichts und ist aus der Entfernung lesbar.
 */
function InteractionStatusRing({
  state,
  radius,
}: {
  state: "pending" | "confirmed" | "error" | "idle";
  radius: number;
}) {
  if (state === "idle") {
    return null;
  }

  const borderColor =
    state === "pending"
      ? "rgba(247, 181, 74, 0.95)"
      : state === "confirmed"
        ? "rgba(52, 211, 153, 0.95)"
        : "rgba(239, 68, 68, 0.95)";

  return (
    <View
      pointerEvents="none"
      style={[styles.statusRing, { borderColor, borderRadius: radius, borderWidth: state === "error" ? 4 : 3 }]}
    />
  );
}

/**
 * Groessen des Addon-Elements. Titel und Wert der halben Kachel skalieren mit
 * ihrer Hoehe, das Addon blieb dagegen auf festen 14 px stehen und wirkte
 * daneben winzig. `reserve` haelt den Textblock genau so weit vom Rand weg,
 * wie das Addon wirklich braucht - vorher war das eine feste Zahl, unter der
 * ein laengeres Wort wie "Glass" mit dem Titel kollidieren konnte.
 */
function resolveAddonMetrics(
  config: StateWidgetConfig,
  value: string | null,
  half: boolean,
  scale: number,
) {
  const s = half ? clampNumber(scale, 0.6, 1.35) : 1;
  const textSize = half ? Math.round(clampNumber(17 * s, 12, 24)) : 16;
  const circleSize = half ? Math.round(clampNumber(30 * s, 22, 40)) : 34;
  const circleLabelSize = half ? Math.round(clampNumber(14 * s, 11, 19)) : 14;
  const iconSize = half ? Math.round(clampNumber(20 * s, 14, 28)) : 16;
  const barsHeight = half ? Math.round(clampNumber(24 * s, 18, 32)) : 32;
  const barWidth = half ? Math.round(clampNumber(5 * s, 4, 7)) : 5;
  const edge = half ? 12 : 10;

  const mode = config.addonMode;
  let contentWidth = 0;
  if (mode && mode !== "none" && value) {
    if (mode === "circle") {
      contentWidth = Math.max(circleSize, value.length * circleLabelSize * 0.62 + 14);
    } else if (mode === "text") {
      contentWidth = Math.min(value.length * textSize * 0.62, 140);
    } else if (mode === "icon") {
      contentWidth = iconSize;
    } else {
      contentWidth = barWidth * 4 + 9;
    }
  }

  return {
    textSize,
    circleSize,
    circleLabelSize,
    iconSize,
    barsHeight,
    barWidth,
    reserve: contentWidth > 0 ? Math.round(edge + contentWidth + 10) : edge + 4,
  };
}

type AddonMetrics = ReturnType<typeof resolveAddonMetrics>;

function AddonChip({
  config,
  value,
  half = false,
  metrics,
}: {
  config: StateWidgetConfig;
  value: string | null;
  half?: boolean;
  metrics: AddonMetrics;
}) {
  if (!config.addonMode || config.addonMode === "none" || !value) {
    return null;
  }

  const color = config.addonColor || "#8b5cf6";

  if (config.addonMode === "circle") {
    return (
      <View
        style={[
          styles.addonCircle,
          half ? styles.addonCircleHalf : null,
          half
            ? {
                minWidth: metrics.circleSize,
                height: metrics.circleSize,
                transform: [{ translateY: -metrics.circleSize / 2 }],
              }
            : null,
          { backgroundColor: color },
        ]}
      >
        <Text
          style={[
            styles.addonCircleLabel,
            half ? styles.addonCircleLabelHalf : null,
            { fontSize: metrics.circleLabelSize },
          ]}
        >
          {value}
        </Text>
      </View>
    );
  }

  if (config.addonMode === "text") {
    return (
      <Text
        numberOfLines={1}
        style={[
          styles.addonText,
          half ? styles.addonTextHalf : null,
          half
            ? {
                fontSize: metrics.textSize,
                lineHeight: Math.round(metrics.textSize * 1.2),
                transform: [{ translateY: -Math.round(metrics.textSize * 0.6) }],
              }
            : null,
          { color },
        ]}
      >
        {value}
      </Text>
    );
  }

  if (config.addonMode === "icon") {
    return (
      <View
        style={[
          styles.addonIconWrap,
          half ? styles.addonIconWrapHalf : null,
          half ? { transform: [{ translateY: -metrics.iconSize / 2 }] } : null,
        ]}
      >
        <MaterialCommunityIcons color={color} name={(config.addonIcon || "lock") as never} size={metrics.iconSize} />
      </View>
    );
  }

  const bars = Math.max(1, Math.min(4, Number.parseInt(value, 10) || 1));
  const barScale = metrics.barsHeight / 32;
  return (
    <View
      style={[
        styles.addonBars,
        half ? styles.addonBarsHalf : null,
        half ? { height: metrics.barsHeight, transform: [{ translateY: -metrics.barsHeight / 2 }] } : null,
      ]}
    >
      {Array.from({ length: 4 }).map((_, index) => (
        <View
          key={`bar-${index}`}
          style={[
            styles.addonBar,
            {
              backgroundColor: index < bars ? color : "rgba(255,255,255,0.12)",
              width: metrics.barWidth,
              height: Math.round((7 + index * 3) * barScale),
            },
          ]}
        />
      ))}
    </View>
  );
}

export function resolveStateActive(config: StateWidgetConfig, value: unknown) {
  const normalizedCurrent = normalizeStateComparisonValue(config, value);
  const activeMatch = normalizeStateComparisonValue(config, config.activeValue);
  const inactiveMatch = normalizeStateComparisonValue(config, config.inactiveValue);

  if (activeMatch !== undefined && normalizedCurrent === activeMatch) {
    return true;
  }

  if (inactiveMatch !== undefined && normalizedCurrent === inactiveMatch) {
    return false;
  }

  if (config.format === "number" || config.format === "text") {
    return false;
  }

  return Boolean(value);
}

export function resolveStateNextValue(config: StateWidgetConfig, currentValue: unknown) {
  const nextActive = !resolveStateActive(config, currentValue);

  if (nextActive) {
    return parseStateValue(config, config.activeValue ?? defaultStateValue(config, true));
  }

  return parseStateValue(config, config.inactiveValue ?? defaultStateValue(config, false));
}

const HALF_TILE_REFERENCE_HEIGHT = 135;

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolveIconName(config: StateWidgetConfig, value: unknown, assumedActive?: boolean) {
  // assumedActive erlaubt es, das Symbol schon vor der Rueckmeldung umzustellen.
  const active = assumedActive ?? resolveStateActive(config, value);
  const numericValue = asNumber(value);
  const activeIcon = config.iconPair?.active || "toggle-switch";
  const inactiveIcon = config.iconPair?.inactive || "toggle-switch-off-outline";

  if (numericValue !== null && shouldUseBatteryScale(config)) {
    return resolveBatteryIcon(numericValue);
  }

  return active ? activeIcon : inactiveIcon;
}

function resolveStateLabel(config: StateWidgetConfig, value: unknown, active: boolean) {
  const mappedLabel = resolveMappedLabel(config, value);
  if (mappedLabel) {
    return mappedLabel;
  }

  if (active && config.onLabel) {
    return config.onLabel;
  }
  if (!active && config.offLabel) {
    return config.offLabel;
  }

  if (config.format === "number" || config.format === "text") {
    return String(value);
  }

  return active ? "Ein" : "Aus";
}

/**
 * Wahr, wenn der Zustandstext nur der Notbehelf "Ein"/"Aus" waere - also weder
 * eine eigene Beschriftung noch eine Wertzuordnung noch ein echter Messwert.
 */
function isGenericStateLabel(config: StateWidgetConfig, value: unknown) {
  if (config.format === "number" || config.format === "text") {
    return false;
  }
  if (config.onLabel || config.offLabel) {
    return false;
  }
  return !resolveMappedLabel(config, value);
}

function resolveMappedLabel(config: StateWidgetConfig, value: unknown) {
  if (!config.valueLabels || value === null || value === undefined) {
    return null;
  }

  const key = config.format === "number" ? String(asNumber(value)) : String(value);
  return config.valueLabels[key] || null;
}

function resolveAddonValue(config: StateWidgetConfig, value: unknown, addonValue: unknown, active: boolean) {
  if (config.addonUseStateValue) {
    const sourceValue = addonValue !== undefined ? addonValue : value;
    if (sourceValue === null || sourceValue === undefined) {
      return null;
    }
    if (typeof sourceValue === "string" || typeof sourceValue === "number" || typeof sourceValue === "boolean") {
      return String(sourceValue);
    }
    return resolveStateLabel(config, sourceValue, active);
  }

  const explicit = (config.addonValue || "").trim();
  return explicit || null;
}

function shouldUseBatteryScale(config: StateWidgetConfig) {
  const iconNames = `${config.iconPair?.active || ""} ${config.iconPair?.inactive || ""}`.toLowerCase();
  const descriptor = `${config.title} ${config.stateId}`.toLowerCase();
  return (
    iconNames.includes("battery") ||
    descriptor.includes("akku") ||
    descriptor.includes("battery") ||
    descriptor.includes("soc")
  );
}

function resolveBatteryIcon(value: number): keyof typeof MaterialCommunityIcons.glyphMap {
  const percent = Math.max(0, Math.min(100, Math.round(value)));

  if (percent >= 95) {
    return "battery";
  }
  if (percent >= 75) {
    return "battery-80";
  }
  if (percent >= 50) {
    return "battery-50";
  }
  if (percent >= 25) {
    return "battery-30";
  }
  if (percent > 0) {
    return "battery-10";
  }
  return "battery-outline";
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.replace(",", ".");
    const match = normalized.match(/-?\d+(\.\d+)?/);
    if (!match) {
      return null;
    }

    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeStateComparisonValue(config: StateWidgetConfig, value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return "null";
  }

  if (config.format === "number") {
    const numeric = asNumber(value);
    return numeric === null ? undefined : String(numeric);
  }

  if (config.format === "text") {
    return String(value);
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "on") {
      return "true";
    }
    if (normalized === "false" || normalized === "0" || normalized === "off") {
      return "false";
    }
  }

  return String(Boolean(value));
}

function parseStateValue(config: StateWidgetConfig, raw: string) {
  if (config.format === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (config.format === "text") {
    return raw;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "off") {
    return false;
  }
  return raw;
}

function defaultStateValue(config: StateWidgetConfig, active: boolean) {
  if (config.format === "number") {
    return active ? "1" : "0";
  }
  if (config.format === "text") {
    return active ? "on" : "off";
  }
  return active ? "true" : "false";
}

function normalizeIconImageCrop(value: StateWidgetConfig["iconImageCrop"]) {
  if (value === "rounded" || value === "circle") {
    return value;
  }
  return "none";
}

function normalizeIconImageSizeMode(value: StateWidgetConfig["iconImageSizeMode"]) {
  if (value === "maximized") {
    return value;
  }
  return "standard";
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  containerWithTitle: {
    paddingTop: 24,
  },
  tapArea: {
    flex: 1,
    width: "100%",
  },
  tapAreaPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.97 }],
  },
  tile: {
    width: "100%",
    height: "100%",
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    position: "relative",
  },
  tileImageMaximized: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    borderRadius: 0,
    overflow: "hidden",
  },
  maximizedImage: {
    ...StyleSheet.absoluteFillObject,
    width: undefined,
    height: undefined,
  },
  maximizedImageBorderless: {
    borderRadius: 0,
  },
  maximizedImageRounded: {
    borderRadius: 12,
  },
  maximizedImageCircle: {
    borderRadius: 999,
  },
  tileCompact: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
  },
  tileVeryCompact: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 9,
  },
  iconWrap: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    position: "absolute",
    top: 10,
    left: 10,
  },
  iconWrapCompact: {
    width: 48,
    height: 48,
    top: 8,
    left: 8,
  },
  iconWrapVeryCompact: {
    width: 42,
    height: 42,
    top: 7,
    left: 7,
  },
  iconWrapRounded: {
    borderRadius: 12,
    overflow: "hidden",
  },
  iconWrapCircle: {
    borderRadius: 999,
    overflow: "hidden",
  },
  iconImage: {
    width: "100%",
    height: "100%",
  },
  textBlock: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 12,
    alignItems: "flex-start",
    justifyContent: "flex-end",
  },
  textBlockCompact: {
    left: 12,
    right: 12,
    bottom: 10,
  },
  textBlockVeryCompact: {
    left: 10,
    right: 10,
    bottom: 9,
  },
  value: {
    color: palette.textMuted,
    fontSize: 14,
    lineHeight: 17,
    textAlign: "left",
    fontWeight: "700",
    alignSelf: "stretch",
  },
  addonCircle: {
    position: "absolute",
    top: 10,
    right: 10,
    minWidth: 34,
    height: 34,
    borderRadius: 999,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  addonCircleLabel: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  addonText: {
    position: "absolute",
    top: 12,
    right: 10,
    fontSize: 16,
    fontWeight: "800",
  },
  addonIconWrap: {
    position: "absolute",
    top: 10,
    right: 10,
  },
  addonBars: {
    position: "absolute",
    top: 10,
    right: 10,
    height: 32,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
  },
  addonBar: {
    width: 5,
    borderRadius: 2,
  },
  tileHalf: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 6,
    borderRadius: 18,
  },
  iconWrapHalf: {
    width: 44,
    height: 44,
    top: "50%",
    left: 12,
    transform: [{ translateY: -22 }],
  },
  textBlockHalf: {
    left: 62,
    right: 46,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  titleHalf: {
    fontSize: 16,
    lineHeight: 19,
    fontWeight: "800",
    alignSelf: "stretch",
  },
  valueHalf: {
    fontSize: 14,
    lineHeight: 17,
  },
  valueHalfSolo: {
    fontSize: 18,
    lineHeight: 21,
    fontWeight: "800",
  },
  addonCircleHalf: {
    top: "50%",
    right: 12,
    minWidth: 26,
    height: 26,
    paddingHorizontal: 7,
    transform: [{ translateY: -13 }],
  },
  addonCircleLabelHalf: {
    fontSize: 12,
  },
  addonTextHalf: {
    top: "50%",
    right: 12,
    fontSize: 14,
    transform: [{ translateY: -9 }],
  },
  addonIconWrapHalf: {
    top: "50%",
    right: 12,
    transform: [{ translateY: -10 }],
  },
  addonBarsHalf: {
    top: "50%",
    right: 12,
    height: 24,
    transform: [{ translateY: -12 }],
  },
  statusRing: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
  },
});
