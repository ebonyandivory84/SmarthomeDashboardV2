import { MaterialCommunityIcons } from "@expo/vector-icons";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, ImageBackground, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import { HeatingWidgetConfig, StateSnapshot } from "../../types/dashboard";
import { playConfiguredUiSound } from "../../utils/uiSounds";
import { palette } from "../../utils/theme";

type HeatingWidgetProps = {
  config: HeatingWidgetConfig;
  client: IoBrokerClient;
  states: StateSnapshot;
  isActivePage?: boolean;
  lowPowerMode?: boolean;
};

type HeatingMode = "standby" | "dhw" | "dhwAndHeating";
type ProgramMode = "normal" | "reduced" | "comfort" | "eco";


const ROOM_TEMP_MIN = 10;
const ROOM_TEMP_MAX = 30;
const ROOM_TEMP_STEP = 0.5;
const ROOM_TEMP_BAR_MIN = 15;
const ROOM_TEMP_BAR_MAX = 40;

const DHW_TEMP_MIN = 10;
const DHW_TEMP_MAX = 60;
const DHW_TEMP_STEP = 1;
const DHW_TEMP_BAR_MIN = 15;
const DHW_TEMP_BAR_MAX = 60;
const TEMP_BAR_GLOW_CYCLE_MS = 2000;
const TEMP_BAR_ACTIVE_POWER_THRESHOLD_W = 400;

const DEFAULT_IDS = {
  modeSet: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.modes.active.commands.setMode.setValue",
  modeValue: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.modes.active.properties.value.value",
  activeProgram: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.active.properties.value.value",
  normalSetTemp:
    "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.normal.commands.setTemperature.setValue",
  reducedSetTemp:
    "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.reduced.commands.setTemperature.setValue",
  comfortSetTemp:
    "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.comfort.commands.setTemperature.setValue",
  dhwSetTemp: "viessmannapi.0.299550.0.features.heating.dhw.temperature.main.commands.setTargetTemperature.setValue",
  comfortActivate:
    "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.comfort.commands.activate.setValue",
  comfortDeactivate:
    "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.comfort.commands.deactivate.setValue",
  ecoSetActive: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.eco.commands.setActive.setValue",
  oneTimeChargeSetActive: "viessmannapi.0.299550.0.features.heating.dhw.oneTimeCharge.commands.setActive.setValue",
  oneTimeChargeActive: "viessmannapi.0.299550.0.features.heating.dhw.oneTimeCharge.properties.active.value",
  roomTemp: "viessmannapi.0.299550.0.features.heating.circuits.1.temperature.properties.value.value",
  heatingTemp: "viessmannapi.0.299550.0.features.heating.circuits.1.temperature.properties.value.value",
  supplyTemp: "viessmannapi.0.299550.0.features.heating.circuits.1.sensors.temperature.supply.properties.value.value",
  outsideTemp: "viessmannapi.0.299550.0.features.heating.sensors.temperature.outside.properties.value.value",
  returnTemp: "viessmannapi.0.299550.0.features.heating.sensors.temperature.return.properties.value.value",
  dhwTemp: "viessmannapi.0.299550.0.features.heating.dhw.sensors.temperature.dhwCylinder.properties.value.value",
  compressorPower: "viessmannapi.0.299550.0.features.heating.compressors.0.power.properties.value.value",
  compressorSensorPower: "viessmannapi.0.299550.0.features.heating.compressors.0.sensors.power.properties.value.value",
} as const;

export function HeatingWidget({ config, client, states, isActivePage = true, lowPowerMode = false }: HeatingWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const stateIds = useMemo(
    () => ({
      modeSet: resolveStateId(config.modeSetStateId, DEFAULT_IDS.modeSet),
      modeValue: resolveStateId(config.modeValueStateId, DEFAULT_IDS.modeValue),
      activeProgram: resolveStateId(config.activeProgramStateId, DEFAULT_IDS.activeProgram),
      normalSetTemp: resolveStateId(config.normalSetTempStateId, DEFAULT_IDS.normalSetTemp),
      reducedSetTemp: resolveOptionalStateId(config.reducedSetTempStateId, DEFAULT_IDS.reducedSetTemp),
      comfortSetTemp: resolveOptionalStateId(config.comfortSetTempStateId, DEFAULT_IDS.comfortSetTemp),
      dhwSetTemp: resolveStateId(config.dhwSetTempStateId, DEFAULT_IDS.dhwSetTemp),
      comfortActivate: resolveOptionalStateId(config.comfortActivateStateId, DEFAULT_IDS.comfortActivate),
      comfortDeactivate: resolveOptionalStateId(config.comfortDeactivateStateId, DEFAULT_IDS.comfortDeactivate),
      ecoSetActive: resolveOptionalStateId(config.ecoSetActiveStateId, DEFAULT_IDS.ecoSetActive),
      oneTimeChargeSetActive: resolveOptionalStateId(config.oneTimeChargeSetActiveStateId, DEFAULT_IDS.oneTimeChargeSetActive),
      oneTimeChargeActive: resolveOptionalStateId(config.oneTimeChargeActiveStateId, DEFAULT_IDS.oneTimeChargeActive),
      roomTemp: resolveOptionalStateId(config.roomTempStateId, DEFAULT_IDS.roomTemp),
      heatingTemp: resolveOptionalStateId(config.heatingTempStateId, DEFAULT_IDS.heatingTemp),
      supplyTemp: resolveOptionalStateId(config.supplyTempStateId, DEFAULT_IDS.supplyTemp),
      outsideTemp: resolveOptionalStateId(config.outsideTempStateId, DEFAULT_IDS.outsideTemp),
      returnTemp: resolveOptionalStateId(config.returnTempStateId, DEFAULT_IDS.returnTemp),
      dhwTemp: resolveOptionalStateId(config.dhwTempStateId, DEFAULT_IDS.dhwTemp),
      compressorPower: resolveOptionalStateId(config.compressorPowerStateId, DEFAULT_IDS.compressorPower),
      compressorSensorPower: resolveOptionalStateId(config.compressorSensorPowerStateId, DEFAULT_IDS.compressorSensorPower),
    }),
    [
      config.modeSetStateId,
      config.modeValueStateId,
      config.activeProgramStateId,
      config.normalSetTempStateId,
      config.reducedSetTempStateId,
      config.comfortSetTempStateId,
      config.dhwSetTempStateId,
      config.comfortActivateStateId,
      config.comfortDeactivateStateId,
      config.ecoSetActiveStateId,
      config.oneTimeChargeSetActiveStateId,
      config.oneTimeChargeActiveStateId,
      config.roomTempStateId,
      config.heatingTempStateId,
      config.supplyTempStateId,
      config.outsideTempStateId,
      config.returnTempStateId,
      config.dhwTempStateId,
      config.compressorPowerStateId,
      config.compressorSensorPowerStateId,
    ]
  );

  const [optimisticStates, setOptimisticStates] = useState<StateSnapshot>({});
  const [pendingWrites, setPendingWrites] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [normalDraft, setNormalDraft] = useState<number | null>(null);
  const [dhwDraft, setDhwDraft] = useState<number | null>(null);
  const [dhwBarTrackWidth, setDhwBarTrackWidth] = useState(0);
  const tempBarGlowAnim = useRef(new Animated.Value(0)).current;

  const effectiveSnapshot = useMemo(
    () => ({
      ...states,
      ...optimisticStates,
    }),
    [optimisticStates, states]
  );

  const readValue = useCallback(
    (stateId: string) => {
      if (!stateId) {
        return undefined;
      }
      return effectiveSnapshot[stateId];
    },
    [effectiveSnapshot]
  );

  useEffect(() => {
    setOptimisticStates((current) => {
      const keys = Object.keys(current);
      if (!keys.length) {
        return current;
      }
      let changed = false;
      const next: StateSnapshot = { ...current };
      for (const stateId of keys) {
        if (pendingWrites[stateId]) {
          continue;
        }
        delete next[stateId];
        changed = true;
      }
      return changed ? next : current;
    });
  }, [pendingWrites, states]);

  const mode =
    normalizeMode(readValue(stateIds.modeValue)) ||
    normalizeMode(readValue(stateIds.modeSet)) ||
    "standby";
  const activeProgram = normalizeProgram(readValue(stateIds.activeProgram));
  const normalTarget = clampTemperature(
    normalizeFloat(readValue(stateIds.normalSetTemp)) ?? 21,
    ROOM_TEMP_MIN,
    ROOM_TEMP_MAX,
    ROOM_TEMP_STEP
  );
  const reducedTarget = normalizeFloat(readValue(stateIds.reducedSetTemp));
  const comfortTarget = normalizeFloat(readValue(stateIds.comfortSetTemp));
  const dhwTarget = clampTemperature(
    normalizeFloat(readValue(stateIds.dhwSetTemp)) ?? 50,
    DHW_TEMP_MIN,
    DHW_TEMP_MAX,
    DHW_TEMP_STEP
  );
  const oneTimeChargeActive = normalizeBoolean(readValue(stateIds.oneTimeChargeActive)) ?? false;

  const roomTemp = normalizeFloat(readValue(stateIds.roomTemp));
  const outsideTemp = normalizeFloat(readValue(stateIds.outsideTemp));
  const supplyTemp = normalizeFloat(readValue(stateIds.supplyTemp));
  const returnTemp = normalizeFloat(readValue(stateIds.returnTemp));
  const heatingTemp = normalizeFloat(readValue(stateIds.heatingTemp));
  const dhwTemp = normalizeFloat(readValue(stateIds.dhwTemp));
  const compressorPowerW =
    normalizePowerToWatts(readValue(stateIds.compressorPower)) ||
    normalizePowerToWatts(readValue(stateIds.compressorSensorPower));

  const normalSliderValue = normalDraft ?? normalTarget;
  const dhwSliderValue = dhwDraft ?? dhwTarget;
  const writePending = Object.values(pendingWrites).some(Boolean);
  const roomTempPercent = mapValueToPercent(roomTemp, ROOM_TEMP_BAR_MIN, ROOM_TEMP_BAR_MAX);
  const dhwTempPercent = mapValueToPercent(dhwTemp, DHW_TEMP_BAR_MIN, DHW_TEMP_BAR_MAX);
  const roomTempDisplay = formatTemperature(roomTemp);
  const dhwTempDisplay = formatTemperature(dhwTemp);
  const dhwHeatingActive =
    oneTimeChargeActive ||
    mode === "dhw" ||
    (dhwTemp !== null &&
      dhwTemp + 0.5 < dhwTarget &&
      (compressorPowerW ?? 0) > TEMP_BAR_ACTIVE_POWER_THRESHOLD_W);

  useEffect(() => {
    if (!pendingWrites[stateIds.normalSetTemp]) {
      setNormalDraft(null);
    }
  }, [normalTarget, pendingWrites, stateIds.normalSetTemp]);

  useEffect(() => {
    if (!pendingWrites[stateIds.dhwSetTemp]) {
      setDhwDraft(null);
    }
  }, [dhwTarget, pendingWrites, stateIds.dhwSetTemp]);

  useEffect(() => {
    tempBarGlowAnim.setValue(0);
    if (!runtimeActive) {
      return;
    }
    const glowLoop = Animated.loop(
      Animated.timing(tempBarGlowAnim, {
        toValue: 1,
        duration: TEMP_BAR_GLOW_CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    glowLoop.start();
    return () => {
      glowLoop.stop();
    };
  }, [runtimeActive, tempBarGlowAnim]);

  const playPressSound = useCallback(
    (key: string) => {
      playConfiguredUiSound(config.interactionSounds?.press, "tap", `${config.id}:press:${key}`);
    },
    [config.id, config.interactionSounds?.press]
  );

  const playConfirmSound = useCallback(
    (key: string) => {
      playConfiguredUiSound(config.interactionSounds?.confirm, "toggle", `${config.id}:confirm:${key}`);
    },
    [config.id, config.interactionSounds?.confirm]
  );

  const playSliderSound = useCallback(
    (key: string) => {
      playConfiguredUiSound(config.interactionSounds?.slider, "swipe", `${config.id}:slider:${key}`);
    },
    [config.id, config.interactionSounds?.slider]
  );

  const writeState = useCallback(
    async (stateId: string, value: unknown, key: string) => {
      if (!stateId) {
        return;
      }
      setPendingWrites((current) => ({ ...current, [stateId]: true }));
      setOptimisticStates((current) => ({
        ...current,
        [stateId]: value,
      }));
      setError(null);
      try {
        await client.writeState(stateId, value);
        playConfirmSound(key);
      } catch (writeError) {
        setError(writeError instanceof Error ? writeError.message : "State konnte nicht geschrieben werden");
      } finally {
        setPendingWrites((current) => ({ ...current, [stateId]: false }));
      }
    },
    [client, playConfirmSound]
  );

  const setMode = useCallback(
    (nextMode: HeatingMode) => {
      if (nextMode === mode) {
        return;
      }
      playPressSound(`mode:${nextMode}`);
      void writeState(stateIds.modeSet, nextMode, `mode:${nextMode}`);
    },
    [mode, playPressSound, stateIds.modeSet, writeState]
  );

  const setNormalTemperature = useCallback(
    (nextValue: number, source: "slider" | "button") => {
      const clamped = clampTemperature(nextValue, ROOM_TEMP_MIN, ROOM_TEMP_MAX, ROOM_TEMP_STEP);
      if (Math.abs(clamped - normalTarget) < 0.001) {
        return;
      }
      if (source === "slider") {
        playSliderSound(`normal:${clamped}`);
      } else {
        playPressSound(`normal:${clamped}`);
      }
      void writeState(stateIds.normalSetTemp, clamped, `normal:${clamped}`);
    },
    [normalTarget, playPressSound, playSliderSound, stateIds.normalSetTemp, writeState]
  );

  const setDhwTemperature = useCallback(
    (nextValue: number, source: "slider" | "button") => {
      const clamped = clampTemperature(nextValue, DHW_TEMP_MIN, DHW_TEMP_MAX, DHW_TEMP_STEP);
      if (Math.abs(clamped - dhwTarget) < 0.001) {
        return;
      }
      if (source === "slider") {
        playSliderSound(`dhw:${clamped}`);
      } else {
        playPressSound(`dhw:${clamped}`);
      }
      void writeState(stateIds.dhwSetTemp, clamped, `dhw:${clamped}`);
    },
    [dhwTarget, playPressSound, playSliderSound, stateIds.dhwSetTemp, writeState]
  );

  const toggleOneTimeCharge = useCallback(() => {
    if (!stateIds.oneTimeChargeSetActive) {
      return;
    }
    const nextActive = !oneTimeChargeActive;
    playPressSound("oneTimeCharge");
    void writeState(stateIds.oneTimeChargeSetActive, nextActive, `oneTimeCharge:${nextActive ? "on" : "off"}`);
  }, [oneTimeChargeActive, playPressSound, stateIds.oneTimeChargeSetActive, writeState]);

  const textColor = config.appearance?.textColor || "#f5f8ff";
  const mutedTextColor = config.appearance?.mutedTextColor || "rgba(214, 224, 244, 0.78)";
  const cardStart = config.appearance?.widgetColor || "rgba(18, 28, 42, 0.96)";
  const cardEnd = config.appearance?.widgetColor2 || "rgba(10, 16, 27, 0.98)";
  const panelColor = config.appearance?.cardColor || "rgba(255,255,255,0.035)";
  const panelBorder = "rgba(184, 206, 242, 0.16)";
  const sliderStart = config.appearance?.iconColor || "#79b5ff";
  const sliderEnd = config.appearance?.iconColor2 || "#5a85ef";
  const oneTimeColor = config.appearance?.statColor || "rgba(246, 97, 98, 0.42)";
  const backgroundBlur = lowPowerMode ? 0 : Math.min(24, clampInt(config.backgroundImageBlur, 8, 0));
  const oneTimeChargeIcon = normalizeOneTimeChargeIcon(config.oneTimeChargeIcon);

  const modeButtons: Array<{
    mode: HeatingMode;
    icon: string;
    color: string;
  }> = [
    {
      mode: "standby",
      icon: normalizeIcon(config.standbyIcon, "power-standby"),
      color: "rgba(178, 188, 205, 0.28)",
    },
    {
      mode: "dhw",
      icon: normalizeIcon(config.dhwIcon, "water"),
      color: "rgba(116, 199, 255, 0.3)",
    },
    {
      mode: "dhwAndHeating",
      icon: normalizeIcon(config.heatingIcon, "radiator"),
      color: "rgba(255, 183, 106, 0.32)",
    },
  ];

  const summaryText = buildStatusText({
    mode,
    activeProgram,
    outsideTemp,
    oneTimeChargeActive,
  });

  const showInfoProgram = config.showInfoProgram !== false;
  const showInfoTargets = config.showInfoTargets !== false;
  const infoRows = [
    config.showInfoOutsideTemp !== false ? { label: "Aussen", value: formatTemperature(outsideTemp) } : null,
    config.showInfoSupplyTemp !== false ? { label: "Vorlauf", value: formatTemperature(supplyTemp) } : null,
    config.showInfoReturnTemp !== false ? { label: "Ruecklauf", value: formatTemperature(returnTemp) } : null,
    config.showInfoHeatingTemp !== false ? { label: "Heizkreis", value: formatTemperature(heatingTemp) } : null,
    config.showInfoCompressorPower !== false ? { label: "Verdichter", value: formatPower(compressorPowerW) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const liveBadgeText = error ? "Fehler" : writePending ? "Sync" : "";
  const footerStatusText = error ? error : writePending ? "Synchronisiere..." : "";
  const roomFillRatio = (roomTempPercent ?? 0) / 100;
  const dhwFillRatio = (dhwTempPercent ?? 0) / 100;
  const dhwFillWidthPx = dhwBarTrackWidth * dhwFillRatio;
  const dhwGlowWidthPx = Math.max(34, Math.min(80, dhwFillWidthPx * 0.44));
  const dhwGlowTranslateX = tempBarGlowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-dhwGlowWidthPx, Math.max(0, dhwFillWidthPx)],
  });
  const roomBarTintColor = interpolateTriColor(roomFillRatio, "#1a4c9f", "#33c786", "#cc4c4c", 0.24);
  const dhwBarTintColor = interpolateBiColor(dhwFillRatio, "#1049a2", "#7d1212");
  const roomFillWidth = `${Number((roomTempPercent ?? 0).toFixed(2))}%` as `${number}%`;
  const dhwFillWidth = `${Number((dhwTempPercent ?? 0).toFixed(2))}%` as `${number}%`;
  const roomScaleTicks = buildTemperatureTicks(ROOM_TEMP_BAR_MIN, ROOM_TEMP_BAR_MAX, 5);
  const dhwScaleTicks = buildTemperatureTicks(DHW_TEMP_BAR_MIN, DHW_TEMP_BAR_MAX, 10);
  const showInfoPanel = showInfoProgram || showInfoTargets || infoRows.length > 0;

  return (
    <View style={styles.container}>
      <View style={[styles.card, { backgroundColor: cardStart }]}>
        {config.backgroundImage ? (
          Platform.OS === "web" ? (
            <>
              {createElement("div", {
                style: buildBlurredWidgetBackgroundStyle(config.backgroundImage, backgroundBlur),
              })}
              <View style={styles.backgroundOverlay} />
            </>
          ) : (
            <ImageBackground
              blurRadius={backgroundBlur}
              imageStyle={styles.widgetBackgroundImage}
              source={{ uri: `/smarthome-dashboard-v2/widget-assets/${encodeURIComponent(config.backgroundImage)}` }}
              style={styles.widgetBackground}
            >
              <View style={styles.backgroundOverlay} />
            </ImageBackground>
          )
        ) : null}

        {Platform.OS === "web"
          ? createElement("div", {
              style: {
                ...webGradientLayerStyle,
                background: `linear-gradient(145deg, ${cardStart} 0%, ${cardEnd} 100%)`,
              },
            })
          : null}

        <View style={styles.header}>
          {config.showTitle !== false ? (
            <Text numberOfLines={1} style={[styles.title, { color: textColor }]}>
              {(config.title || "Heizung").trim() || "Heizung"}
            </Text>
          ) : null}
          {liveBadgeText ? (
            <View style={[styles.liveBadge, { borderColor: panelBorder, backgroundColor: panelColor }]}>
              <Text style={[styles.liveBadgeText, { color: error ? palette.danger : mutedTextColor }]}>
                {liveBadgeText}
              </Text>
            </View>
          ) : null}
        </View>

        {config.showStatusSubtitle !== false ? (
          <Text numberOfLines={2} style={[styles.subtitle, { color: mutedTextColor }]}>
            {summaryText}
          </Text>
        ) : null}

        <View style={styles.block}>
          <Text style={[styles.blockLabel, { color: mutedTextColor }]}>Betriebsart</Text>
          <View style={[styles.modeRow, { borderColor: panelBorder, backgroundColor: panelColor }]}>
            {modeButtons.map((item) => {
              const isActive = item.mode === mode;
              return (
                <Pressable
                  key={`mode-${item.mode}`}
                  onPress={() => setMode(item.mode)}
                  style={({ pressed }) => [
                    styles.modeButton,
                    isActive ? styles.modeButtonActive : null,
                    pressed ? styles.pressScale : null,
                  ]}
                >
                  {isActive
                    ? Platform.OS === "web"
                      ? createElement("div", {
                          style: {
                            ...webGradientLayerStyle,
                            borderRadius: 11,
                            background: `linear-gradient(135deg, ${item.color} 0%, rgba(255,255,255,0.08) 100%)`,
                          },
                        })
                      : <View style={[StyleSheet.absoluteFillObject, { borderRadius: 11, backgroundColor: item.color }]} />
                    : null}
                  <MaterialCommunityIcons color={textColor} name={item.icon as never} size={18} />
                </Pressable>
              );
            })}
            <Pressable
              disabled={!stateIds.oneTimeChargeSetActive}
              onPress={toggleOneTimeCharge}
              style={({ pressed }) => [
                styles.modeButton,
                oneTimeChargeActive ? styles.modeButtonActive : null,
                !stateIds.oneTimeChargeSetActive ? styles.disabledControl : null,
                pressed ? styles.pressScale : null,
              ]}
            >
              {oneTimeChargeActive
                ? Platform.OS === "web"
                  ? createElement("div", {
                      style: {
                        ...webGradientLayerStyle,
                        borderRadius: 11,
                        background: `linear-gradient(135deg, ${oneTimeColor} 0%, rgba(255,255,255,0.08) 100%)`,
                      },
                    })
                  : <View style={[StyleSheet.absoluteFillObject, { borderRadius: 11, backgroundColor: oneTimeColor }]} />
                : null}
              <MaterialCommunityIcons color={textColor} name={oneTimeChargeIcon as never} size={18} />
            </Pressable>
          </View>
        </View>

        <View style={styles.block}>
          <View style={styles.blockHeaderInline}>
            <Text style={[styles.blockLabel, { color: mutedTextColor }]}>Innentemperatur Soll</Text>
            <Text style={[styles.valueText, { color: textColor }]}>{formatTemperature(normalSliderValue)}</Text>
          </View>
          <View style={[styles.sliderShell, { borderColor: panelBorder, backgroundColor: panelColor }]}>
            <Pressable
              onPress={() => setNormalTemperature(normalSliderValue - ROOM_TEMP_STEP, "button")}
              style={({ pressed }) => [styles.stepButton, pressed ? styles.pressScale : null]}
            >
              <Text style={[styles.stepLabel, { color: textColor }]}>-</Text>
            </Pressable>
            <View style={styles.sliderWrap}>
              {Platform.OS === "web"
                ? createElement("input", {
                    type: "range",
                    min: ROOM_TEMP_MIN,
                    max: ROOM_TEMP_MAX,
                    step: ROOM_TEMP_STEP,
                    value: normalSliderValue,
                    onInput: (event: { target: { value: string } }) => {
                      const next = clampTemperature(Number.parseFloat(event.target.value) || normalTarget, ROOM_TEMP_MIN, ROOM_TEMP_MAX, ROOM_TEMP_STEP);
                      setNormalDraft(next);
                    },
                    onChange: (event: { target: { value: string } }) => {
                      const next = clampTemperature(Number.parseFloat(event.target.value) || normalTarget, ROOM_TEMP_MIN, ROOM_TEMP_MAX, ROOM_TEMP_STEP);
                      setNormalDraft(next);
                      void setNormalTemperature(next, "slider");
                    },
                    style: {
                      ...webSliderStyle,
                      accentColor: sliderStart,
                      backgroundImage: `linear-gradient(90deg, ${sliderStart} 0%, ${sliderEnd} 100%)`,
                    },
                  })
                : null}
              <View style={styles.sliderScaleRow}>
                <Text style={[styles.sliderScaleLabel, { color: mutedTextColor }]}>{ROOM_TEMP_MIN}°</Text>
                <Text style={[styles.sliderScaleLabel, { color: mutedTextColor }]}>{ROOM_TEMP_MAX}°</Text>
              </View>
            </View>
            <Pressable
              onPress={() => setNormalTemperature(normalSliderValue + ROOM_TEMP_STEP, "button")}
              style={({ pressed }) => [styles.stepButton, pressed ? styles.pressScale : null]}
            >
              <Text style={[styles.stepLabel, { color: textColor }]}>+</Text>
            </Pressable>
          </View>

          <View style={[styles.temperatureBarPanel, { borderColor: panelBorder, backgroundColor: panelColor }]}>
            <View style={styles.temperatureBarHeader}>
              <Text numberOfLines={1} style={[styles.temperatureBarLabel, { color: mutedTextColor }]}>
                Innentemperatur Ist
              </Text>
              <Text numberOfLines={1} style={[styles.temperatureBarValue, { color: textColor }]}>
                {roomTempDisplay}
              </Text>
            </View>
            <View style={styles.temperatureBarTrack}>
              <View style={[styles.temperatureBarFill, { width: roomFillWidth }]}>
                {Platform.OS === "web"
                  ? createElement("div", {
                      style: {
                        ...webGradientLayerStyle,
                        borderRadius: 999,
                        background: `linear-gradient(90deg, #174a9f 0%, ${roomBarTintColor} 100%)`,
                      },
                    })
                  : <View style={[StyleSheet.absoluteFillObject, { borderRadius: 999, backgroundColor: roomBarTintColor }]} />}
              </View>
            </View>
            <View style={styles.temperatureBarScaleTicks}>
              {roomScaleTicks.map((tick, index) => (
                <Text
                  key={`room-tick-${tick.value}`}
                  style={[
                    styles.temperatureBarScaleLabel,
                    {
                      color: mutedTextColor,
                      left: `${tick.position}%`,
                      marginLeft: index === 0 ? 0 : index === roomScaleTicks.length - 1 ? -34 : -17,
                    },
                  ]}
                >
                  {`${Math.round(tick.value)}°`}
                </Text>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.block}>
          <View style={styles.blockHeaderInline}>
            <Text style={[styles.blockLabel, { color: mutedTextColor }]}>Warmwasser Soll</Text>
            <Text style={[styles.valueText, { color: textColor }]}>{formatTemperature(dhwSliderValue)}</Text>
          </View>
          <View style={[styles.sliderShell, { borderColor: panelBorder, backgroundColor: panelColor }]}>
            <Pressable
              onPress={() => setDhwTemperature(dhwSliderValue - DHW_TEMP_STEP, "button")}
              style={({ pressed }) => [styles.stepButton, pressed ? styles.pressScale : null]}
            >
              <Text style={[styles.stepLabel, { color: textColor }]}>-</Text>
            </Pressable>
            <View style={styles.sliderWrap}>
              {Platform.OS === "web"
                ? createElement("input", {
                    type: "range",
                    min: DHW_TEMP_MIN,
                    max: DHW_TEMP_MAX,
                    step: DHW_TEMP_STEP,
                    value: dhwSliderValue,
                    onInput: (event: { target: { value: string } }) => {
                      const next = clampTemperature(Number.parseFloat(event.target.value) || dhwTarget, DHW_TEMP_MIN, DHW_TEMP_MAX, DHW_TEMP_STEP);
                      setDhwDraft(next);
                    },
                    onChange: (event: { target: { value: string } }) => {
                      const next = clampTemperature(Number.parseFloat(event.target.value) || dhwTarget, DHW_TEMP_MIN, DHW_TEMP_MAX, DHW_TEMP_STEP);
                      setDhwDraft(next);
                      void setDhwTemperature(next, "slider");
                    },
                    style: {
                      ...webSliderStyle,
                      accentColor: sliderStart,
                      backgroundImage: `linear-gradient(90deg, ${sliderStart} 0%, ${sliderEnd} 100%)`,
                    },
                  })
                : null}
              <View style={styles.sliderScaleRow}>
                <Text style={[styles.sliderScaleLabel, { color: mutedTextColor }]}>{DHW_TEMP_MIN}°</Text>
                <Text style={[styles.sliderScaleLabel, { color: mutedTextColor }]}>{DHW_TEMP_MAX}°</Text>
              </View>
            </View>
            <Pressable
              onPress={() => setDhwTemperature(dhwSliderValue + DHW_TEMP_STEP, "button")}
              style={({ pressed }) => [styles.stepButton, pressed ? styles.pressScale : null]}
            >
              <Text style={[styles.stepLabel, { color: textColor }]}>+</Text>
            </Pressable>
          </View>

          <View style={[styles.temperatureBarPanel, { borderColor: panelBorder, backgroundColor: panelColor }]}>
            <View style={styles.temperatureBarHeader}>
              <Text numberOfLines={1} style={[styles.temperatureBarLabel, { color: mutedTextColor }]}>
                Warmwasser Ist
              </Text>
              <Text numberOfLines={1} style={[styles.temperatureBarValue, { color: textColor }]}>
                {dhwTempDisplay}
              </Text>
            </View>
            <View
              onLayout={(event) => {
                const nextWidth = Math.max(0, Math.round(event.nativeEvent.layout.width));
                setDhwBarTrackWidth((current) => (current === nextWidth ? current : nextWidth));
              }}
              style={styles.temperatureBarTrack}
            >
              <View style={[styles.temperatureBarFill, { width: dhwFillWidth }]}>
                {Platform.OS === "web"
                  ? createElement("div", {
                      style: {
                        ...webGradientLayerStyle,
                        borderRadius: 999,
                        background: `linear-gradient(90deg, #0f4aa5 0%, ${dhwBarTintColor} 100%)`,
                      },
                    })
                  : <View style={[StyleSheet.absoluteFillObject, { borderRadius: 999, backgroundColor: dhwBarTintColor }]} />}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.temperatureBarGlow,
                    {
                      width: dhwGlowWidthPx,
                      transform: [{ translateX: dhwGlowTranslateX }],
                      opacity: dhwHeatingActive && dhwFillRatio > 0.01 ? 1 : 0,
                    },
                  ]}
                />
              </View>
            </View>
            <View style={styles.temperatureBarScaleTicks}>
              {dhwScaleTicks.map((tick, index) => (
                <Text
                  key={`dhw-tick-${tick.value}`}
                  style={[
                    styles.temperatureBarScaleLabel,
                    {
                      color: mutedTextColor,
                      left: `${tick.position}%`,
                      marginLeft: index === 0 ? 0 : index === dhwScaleTicks.length - 1 ? -34 : -17,
                    },
                  ]}
                >
                  {`${Math.round(tick.value)}°`}
                </Text>
              ))}
            </View>
          </View>
        </View>

        {showInfoPanel ? (
          <View style={[styles.infoPanel, { borderColor: panelBorder, backgroundColor: panelColor }]}>
            {showInfoProgram ? (
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: mutedTextColor }]}>Programm</Text>
                <Text style={[styles.infoValue, { color: textColor }]}>{formatProgramLabel(activeProgram)}</Text>
              </View>
            ) : null}
            {showInfoTargets ? (
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: mutedTextColor }]}>Zielwerte</Text>
                <Text style={[styles.infoValue, { color: textColor }]}>
                  N {formatTemperature(normalTarget)} | R {formatTemperature(reducedTarget)} | K {formatTemperature(comfortTarget)}
                </Text>
              </View>
            ) : null}
            {infoRows.map((row) => (
              <View key={row.label} style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: mutedTextColor }]}>{row.label}</Text>
                <Text style={[styles.infoValue, { color: textColor }]}>{row.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {footerStatusText ? (
          <Text numberOfLines={1} style={[styles.footer, { color: error ? palette.danger : mutedTextColor }]}>
            {footerStatusText}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function resolveStateId(candidate: string | undefined, fallback: string) {
  const trimmed = String(candidate || "").trim();
  return trimmed || fallback;
}

function resolveOptionalStateId(candidate: string | undefined, fallback?: string) {
  const trimmed = String(candidate || "").trim();
  if (trimmed) {
    return trimmed;
  }
  return fallback || "";
}

function normalizeIcon(value: string | undefined, fallback: string) {
  const trimmed = (value || "").trim();
  return trimmed || fallback;
}

function normalizeOneTimeChargeIcon(value: string | undefined) {
  const icon = normalizeIcon(value, "shower-head");
  if (icon === "flash" || icon === "flash-outline") {
    return "shower-head";
  }
  return icon;
}

function clampInt(value: number | undefined, fallback: number, min: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.round(value));
}

function normalizeMode(value: unknown): HeatingMode | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "standby") {
    return "standby";
  }
  if (normalized === "dhw") {
    return "dhw";
  }
  if (normalized === "dhwandheating") {
    return "dhwAndHeating";
  }
  return null;
}

function normalizeProgram(value: unknown): ProgramMode | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "normal" || normalized === "reduced" || normalized === "comfort" || normalized === "eco") {
    return normalized;
  }
  return null;
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "on", "yes"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "off", "no"].includes(normalized)) {
    return false;
  }
  return null;
}

function normalizeFloat(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) {
    return null;
  }
  const numeric = Number.parseFloat(normalized);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function clampTemperature(value: number, min: number, max: number, step: number) {
  const clamped = Math.max(min, Math.min(max, value));
  const rounded = Math.round(clamped / step) * step;
  return Number(rounded.toFixed(2));
}

function formatTemperature(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  const hasFraction = Math.abs(value % 1) > 0.001;
  return `${hasFraction ? value.toFixed(1) : value.toFixed(0)} °C`;
}

function formatProgramLabel(value: ProgramMode | null) {
  if (value === "normal") {
    return "Normal";
  }
  if (value === "reduced") {
    return "Reduziert";
  }
  if (value === "comfort") {
    return "Komfort";
  }
  if (value === "eco") {
    return "Eco";
  }
  return "-";
}

function normalizePowerToWatts(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) > 80 ? value : value * 1000;
  }
  const normalized = String(value ?? "").trim().toLowerCase().replace(",", ".");
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/-?\d+(\.\d+)?/);
  if (!match) {
    return null;
  }
  const numeric = Number(match[0]);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (normalized.includes("kw")) {
    return numeric * 1000;
  }
  if (normalized.includes("w")) {
    return numeric;
  }
  return Math.abs(numeric) > 80 ? numeric : numeric * 1000;
}

function formatPower(valueW: number | null) {
  if (valueW === null || !Number.isFinite(valueW)) {
    return "-";
  }
  const abs = Math.abs(valueW);
  if (abs < 1000) {
    return `${valueW.toFixed(0)} W`;
  }
  return `${(valueW / 1000).toFixed(2)} kW`;
}

function mapValueToPercent(value: number | null, min: number, max: number) {
  if (value === null || !Number.isFinite(value) || max <= min) {
    return null;
  }
  const clamped = Math.max(min, Math.min(max, value));
  return ((clamped - min) / (max - min)) * 100;
}

function interpolateBiColor(ratio: number, startHex: string, endHex: string) {
  return interpolateHexColor(startHex, endHex, clamp01(ratio));
}

function interpolateTriColor(
  ratio: number,
  startHex: string,
  midHex: string,
  endHex: string,
  midPosition: number
) {
  const normalized = clamp01(ratio);
  const split = clamp01(midPosition);
  if (normalized <= split) {
    return interpolateHexColor(startHex, midHex, split <= 0 ? 0 : normalized / split);
  }
  return interpolateHexColor(midHex, endHex, split >= 1 ? 1 : (normalized - split) / (1 - split));
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function interpolateHexColor(startHex: string, endHex: string, ratio: number) {
  const a = parseHexColor(startHex);
  const b = parseHexColor(endHex);
  const t = clamp01(ratio);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bValue = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${bValue})`;
}

function parseHexColor(hex: string) {
  const normalized = hex.replace("#", "").trim();
  if (normalized.length !== 6) {
    return { r: 127, g: 127, b: 127 };
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) {
    return { r: 127, g: 127, b: 127 };
  }
  return { r, g, b };
}

function buildTemperatureTicks(min: number, max: number, step: number) {
  if (!(max > min) || !(step > 0)) {
    return [{ value: min, position: 0 }, { value: max, position: 100 }];
  }

  const values: number[] = [min];
  let cursor = min + step;
  while (cursor < max - 0.0001) {
    values.push(Number(cursor.toFixed(3)));
    cursor += step;
  }
  if (Math.abs(values[values.length - 1] - max) > 0.0001) {
    values.push(max);
  }

  return values.map((value) => ({
    value,
    position: ((value - min) / (max - min)) * 100,
  }));
}

function buildStatusText(input: {
  mode: HeatingMode;
  activeProgram: ProgramMode | null;
  outsideTemp: number | null;
  oneTimeChargeActive: boolean;
}) {
  const modeLabel =
    input.mode === "standby"
      ? "Standby"
      : input.mode === "dhw"
        ? "Nur Warmwasser"
        : "Heizen + Warmwasser";
  const parts = [modeLabel];

  if (input.activeProgram) {
    parts.push(`Programm ${formatProgramLabel(input.activeProgram)}`);
  }
  if (input.outsideTemp !== null) {
    parts.push(`Aussen ${formatTemperature(input.outsideTemp)}`);
  }
  if (input.oneTimeChargeActive) {
    parts.push("Einmalladung aktiv");
  }

  return parts.join(" | ");
}

function buildBlurredWidgetBackgroundStyle(imageName: string, blurPx: number): Record<string, string | number> {
  const encoded = encodeURIComponent(imageName);
  return {
    position: "absolute",
    top: "-12%",
    left: "-12%",
    right: "-12%",
    bottom: "-12%",
    backgroundImage: `url(/smarthome-dashboard-v2/widget-assets/${encoded})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    filter: `blur(${Math.max(0, blurPx)}px)`,
    transform: "scale(1.08)",
    pointerEvents: "none",
    zIndex: 0,
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  card: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(157, 186, 231, 0.2)",
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 10,
    position: "relative",
  },
  widgetBackground: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  widgetBackgroundImage: {
    resizeMode: "cover",
  },
  backgroundOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6, 11, 18, 0.48)",
    zIndex: 1,
  },
  header: {
    position: "relative",
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
    flex: 1,
  },
  liveBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  liveBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  subtitle: {
    position: "relative",
    zIndex: 2,
    fontSize: 12,
    lineHeight: 17,
  },
  block: {
    position: "relative",
    zIndex: 2,
    gap: 6,
  },
  blockLabel: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  modeRow: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 6,
    gap: 6,
    flexDirection: "row",
  },
  modeButton: {
    flex: 1,
    minWidth: 0,
    borderRadius: 11,
    minHeight: 36,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    position: "relative",
    overflow: "hidden",
  },
  modeButtonActive: {
    borderColor: "rgba(173, 204, 246, 0.45)",
  },
  blockHeaderInline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  valueText: {
    fontSize: 15,
    fontWeight: "800",
  },
  sliderShell: {
    borderWidth: 1,
    borderRadius: 13,
    minHeight: 44,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stepButton: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  stepLabel: {
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 18,
  },
  sliderWrap: {
    flex: 1,
    minWidth: 120,
  },
  sliderScaleRow: {
    marginTop: 2,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sliderScaleLabel: {
    fontSize: 10,
    fontWeight: "600",
  },
  temperatureBarPanel: {
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  temperatureBarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  temperatureBarLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  temperatureBarValue: {
    fontSize: 12,
    fontWeight: "700",
  },
  temperatureBarTrack: {
    height: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(184, 206, 242, 0.23)",
    overflow: "hidden",
    backgroundColor: "rgba(15, 24, 38, 0.72)",
  },
  temperatureBarFill: {
    height: "100%",
    borderRadius: 999,
    minWidth: 0,
    overflow: "hidden",
    position: "relative",
  },
  temperatureBarGlow: {
    position: "absolute",
    left: 0,
    top: -5,
    bottom: -5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.52)",
    shadowColor: "#ffffff",
    shadowOpacity: 0.42,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  temperatureBarScaleTicks: {
    position: "relative",
    minHeight: 12,
    marginTop: 1,
  },
  temperatureBarScaleLabel: {
    position: "absolute",
    width: 34,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "600",
  },
  infoPanel: {
    position: "relative",
    zIndex: 2,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 4,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  infoValue: {
    fontSize: 11,
    fontWeight: "700",
    flexShrink: 1,
    textAlign: "right",
  },
  footer: {
    position: "relative",
    zIndex: 2,
    fontSize: 11,
    fontWeight: "700",
  },
  disabledControl: {
    opacity: 0.48,
  },
  pressScale: {
    transform: [{ scale: 0.98 }],
  },
});

const webGradientLayerStyle: Record<string, string | number> = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  pointerEvents: "none",
  zIndex: 0,
};

const webSliderStyle: Record<string, string | number> = {
  width: "100%",
  margin: 0,
  height: 18,
  appearance: "none",
  backgroundColor: "rgba(255,255,255,0.08)",
  borderRadius: 999,
};
