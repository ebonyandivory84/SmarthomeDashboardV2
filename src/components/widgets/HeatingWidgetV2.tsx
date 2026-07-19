import { MaterialCommunityIcons } from "@expo/vector-icons";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, ImageBackground, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import { HeatingWidgetV2Config, StateSnapshot } from "../../types/dashboard";
import { playConfiguredUiSound } from "../../utils/uiSounds";
import { palette } from "../../utils/theme";

type HeatingWidgetProps = {
  config: HeatingWidgetV2Config;
  client: IoBrokerClient;
  states: StateSnapshot;
  isActivePage?: boolean;
  lowPowerMode?: boolean;
};

type HeatingMode = "standby" | "dhw" | "dhwAndHeating";
type ProgramMode = "normal" | "reduced" | "comfort" | "eco";
type DhwChargeProgram = "normal" | "temp2";
type TemperatureColorStop = { temp: number; color: string };


const ROOM_TEMP_MIN = 10;
const ROOM_TEMP_MAX = 30;
const ROOM_TEMP_STEP = 0.5;
const VENTILATION_LEVEL_MIN = 1;
const VENTILATION_LEVEL_MAX = 4;
const VENTILATION_LEVEL_STEP = 1;

const DHW_TEMP_MIN = 10;
const DHW_TEMP_MAX = 60;
const DHW_TEMP_STEP = 1;
const DEFAULT_DETAILS_TICKER_SPEED_PX_PER_S = 46;
const MIN_DETAILS_TICKER_SPEED_PX_PER_S = 16;
const MAX_DETAILS_TICKER_SPEED_PX_PER_S = 160;
const DETAILS_TICKER_SEPARATOR = "\u00a0\u00a0\u00a0\u00a0•\u00a0\u00a0\u00a0\u00a0";
const DETAILS_TICKER_LOOP_SEPARATOR = "\u00a0\u00a0.\u00a0.\u00a0\u00a0";
const HEATING_V2_BASE_CONTENT_WIDTH = 560;
const HEATING_V2_BASE_CONTENT_HEIGHT = 292;
const HEATING_V2_MIN_CONTENT_SCALE = 0.72;

const ROOM_TEMP_COLOR_STOPS: TemperatureColorStop[] = [
  { temp: 16, color: "#1f49a5" },
  { temp: 19, color: "#2263d4" },
  { temp: 20, color: "#4a9ef0" },
  { temp: 22, color: "#3ec96c" },
  { temp: 24, color: "#f2b23c" },
  { temp: 25, color: "#de6940" },
  { temp: 28, color: "#a51c2e" },
];

const DHW_TEMP_COLOR_STOPS: TemperatureColorStop[] = [
  { temp: 10, color: "#1f429a" },
  { temp: 20, color: "#256edc" },
  { temp: 30, color: "#4caef2" },
  { temp: 38, color: "#eea43a" },
  { temp: 50, color: "#d45035" },
  { temp: 60, color: "#911125" },
];

const ROOM_BLINK_ALPHA = 0.92;
const DHW_BLINK_ALPHA = 0.92;
const BOOST_BLINK_COLOR = "#ea434a";
const DHW_BLINK_NORMAL_COLOR = "#f2b23c";
const DHW_BLINK_TEMP2_COLOR = "#e24647";

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
  heatingModeActive: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.modes.active.properties.value.value",
  dhwChargingActive: "viessmannapi.0.299550.0.features.heating.dhw.charging.properties.active.value",
  dhwChargingProgram: "viessmannapi.0.299550.0.features.heating.dhw.temperature.main.commands.setTargetTemperature.setValue",
  boostBlinkActive: "viessmannapi.0.299550.0.features.heating.dhw.oneTimeCharge.properties.active.value",
  ventilationAutoSetActive: "",
  ventilationAutoActive: "",
  ventilationLevelSet: "",
  ventilationLevel: "",
  roomTemp: "viessmannapi.0.299550.0.features.heating.circuits.1.temperature.properties.value.value",
  heatingTemp: "viessmannapi.0.299550.0.features.heating.circuits.1.temperature.properties.value.value",
  supplyTemp: "viessmannapi.0.299550.0.features.heating.circuits.1.sensors.temperature.supply.properties.value.value",
  outsideTemp: "viessmannapi.0.299550.0.features.heating.sensors.temperature.outside.properties.value.value",
  returnTemp: "viessmannapi.0.299550.0.features.heating.sensors.temperature.return.properties.value.value",
  dhwTemp: "viessmannapi.0.299550.0.features.heating.dhw.sensors.temperature.dhwCylinder.properties.value.value",
  compressorPower: "viessmannapi.0.299550.0.features.heating.compressors.0.power.properties.value.value",
  compressorSensorPower: "viessmannapi.0.299550.0.features.heating.compressors.0.sensors.power.properties.value.value",
} as const;

export function HeatingWidgetV2({
  config,
  client,
  states,
  isActivePage = true,
  lowPowerMode = false,
}: HeatingWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const [widgetWidth, setWidgetWidth] = useState(0);
  const [widgetHeight, setWidgetHeight] = useState(0);
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
      heatingModeActive: resolveOptionalStateId(config.heatingModeActiveStateId, DEFAULT_IDS.heatingModeActive),
      dhwChargingActive: resolveOptionalStateId(config.dhwChargingActiveStateId, DEFAULT_IDS.dhwChargingActive),
      dhwChargingProgram: resolveOptionalStateId(config.dhwChargingProgramStateId, DEFAULT_IDS.dhwChargingProgram),
      boostBlinkActive: resolveOptionalStateId(config.boostBlinkActiveStateId, DEFAULT_IDS.boostBlinkActive),
      ventilationAutoSetActive: resolveOptionalStateId(
        config.ventilationAutoSetActiveStateId,
        DEFAULT_IDS.ventilationAutoSetActive
      ),
      ventilationAutoActive: resolveOptionalStateId(
        config.ventilationAutoActiveStateId,
        DEFAULT_IDS.ventilationAutoActive
      ),
      ventilationLevelSet: resolveOptionalStateId(config.ventilationLevelSetStateId, DEFAULT_IDS.ventilationLevelSet),
      ventilationLevel: resolveOptionalStateId(config.ventilationLevelStateId, DEFAULT_IDS.ventilationLevel),
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
      config.heatingModeActiveStateId,
      config.dhwChargingActiveStateId,
      config.dhwChargingProgramStateId,
      config.boostBlinkActiveStateId,
      config.ventilationAutoSetActiveStateId,
      config.ventilationAutoActiveStateId,
      config.ventilationLevelSetStateId,
      config.ventilationLevelStateId,
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
  const [ventilationLevelDraft, setVentilationLevelDraft] = useState<number | null>(null);
  const [detailsTrackWidth, setDetailsTrackWidth] = useState(0);
  const [detailsContentWidth, setDetailsContentWidth] = useState(0);
  const detailsTickerOffset = useRef(new Animated.Value(0)).current;
  const detailsTickerAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const blinkPulse = useRef(new Animated.Value(0)).current;
  const blinkAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  const detailsTickerSpeedPxPerS = clampTickerSpeed(config.detailsTickerSpeedPxPerS);

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
  const heatingModeBlinkActive = resolveHeatingModeBlinkActive(readValue(stateIds.heatingModeActive), mode);
  const dhwChargingBlinkActive = normalizeBoolean(readValue(stateIds.dhwChargingActive)) ?? false;
  const dhwChargingProgram = resolveDhwChargeProgram(readValue(stateIds.dhwChargingProgram), dhwTarget);
  const boostBlinkActive = normalizeBoolean(readValue(stateIds.boostBlinkActive)) ?? oneTimeChargeActive;
  const ventilationAutoActive =
    normalizeBoolean(readValue(stateIds.ventilationAutoActive)) ??
    normalizeBoolean(readValue(stateIds.ventilationAutoSetActive)) ??
    false;
  const ventilationLevelActualRaw = normalizeFloat(readValue(stateIds.ventilationLevel));
  const ventilationLevelSetRaw = normalizeFloat(readValue(stateIds.ventilationLevelSet));
  const ventilationLevelActual =
    ventilationLevelActualRaw === null ? null : clampVentilationLevel(ventilationLevelActualRaw);
  const ventilationLevelSetpoint = clampVentilationLevel(
    ventilationLevelSetRaw ?? ventilationLevelActualRaw ?? VENTILATION_LEVEL_MIN
  );

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
  const ventilationSliderValue = clampVentilationLevel(ventilationLevelDraft ?? ventilationLevelSetpoint);
  const ventilationDisplayActual = ventilationLevelActual ?? ventilationLevelSetpoint;
  const ventilationAutoToggleAvailable = Boolean(stateIds.ventilationAutoSetActive);
  const ventilationSliderWritable = Boolean(stateIds.ventilationLevelSet);
  const ventilationManualControlEnabled = !ventilationAutoActive && ventilationSliderWritable;
  const writePending = Object.values(pendingWrites).some(Boolean);
  const roomTempDisplay = formatTemperature(roomTemp);
  const dhwTempDisplay = formatTemperature(dhwTemp);

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
    if (ventilationLevelDraft === null) {
      return;
    }

    if (ventilationAutoActive || !stateIds.ventilationLevelSet) {
      setVentilationLevelDraft(null);
      return;
    }

    const writePendingForVentilation = pendingWrites[stateIds.ventilationLevelSet] === true;
    const setpointReached = Math.abs(ventilationLevelSetpoint - ventilationLevelDraft) < 0.001;
    const actualReached =
      ventilationLevelActual !== null && Math.abs(ventilationLevelActual - ventilationLevelDraft) < 0.001;

    if ((!writePendingForVentilation && setpointReached) || actualReached) {
      setVentilationLevelDraft(null);
    }
  }, [
    pendingWrites,
    stateIds.ventilationLevelSet,
    ventilationAutoActive,
    ventilationLevelActual,
    ventilationLevelDraft,
    ventilationLevelSetpoint,
  ]);

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

  const toggleVentilationAuto = useCallback(() => {
    if (!stateIds.ventilationAutoSetActive) {
      return;
    }
    const nextActive = !ventilationAutoActive;
    playPressSound("ventilationAuto");
    void writeState(
      stateIds.ventilationAutoSetActive,
      nextActive,
      `ventilationAuto:${nextActive ? "on" : "off"}`
    );
  }, [playPressSound, stateIds.ventilationAutoSetActive, ventilationAutoActive, writeState]);

  const setVentilationLevel = useCallback(
    (nextValue: number, source: "slider" | "button") => {
      if (!stateIds.ventilationLevelSet || ventilationAutoActive) {
        return;
      }
      const clamped = clampVentilationLevel(nextValue);
      if (Math.abs(clamped - ventilationLevelSetpoint) < 0.001) {
        return;
      }
      setVentilationLevelDraft(clamped);
      if (source === "slider") {
        playSliderSound(`ventilation:${clamped}`);
      } else {
        playPressSound(`ventilation:${clamped}`);
      }
      void writeState(stateIds.ventilationLevelSet, clamped, `ventilation:${clamped}`);
    },
    [
      playPressSound,
      playSliderSound,
      stateIds.ventilationLevelSet,
      ventilationAutoActive,
      ventilationLevelSetpoint,
      writeState,
    ]
  );

  const textColor = config.appearance?.textColor || "#f5f8ff";
  const mutedTextColor = config.appearance?.mutedTextColor || "rgba(214, 224, 244, 0.78)";
  const cardStart = config.appearance?.widgetColor || "rgba(18, 28, 42, 0.96)";
  const cardEnd = config.appearance?.widgetColor2 || "rgba(10, 16, 27, 0.98)";
  const panelColor = config.appearance?.cardColor || "rgba(255,255,255,0.035)";
  const panelBorder = "rgba(184, 206, 242, 0.16)";
  const sliderStart = config.appearance?.iconColor || "#79b5ff";
  const sliderEnd = config.appearance?.iconColor2 || "#5a85ef";
  const sliderThumbColor = config.appearance?.activeWidgetColor || "#f6c869";
  const oneTimeColor = config.appearance?.statColor || "rgba(246, 97, 98, 0.42)";
  const backgroundBlur = lowPowerMode ? 0 : Math.min(24, clampInt(config.backgroundImageBlur, 8, 0));
  const oneTimeChargeIcon = normalizeOneTimeChargeIcon(config.oneTimeChargeIcon);

  const modeButtons: Array<{
    mode: HeatingMode;
    label: string;
    icon: string;
    color: string;
  }> = [
    {
      mode: "standby",
      label: "Standby",
      icon: normalizeIcon(config.standbyIcon, "power-standby"),
      color: "rgba(178, 188, 205, 0.28)",
    },
    {
      mode: "dhw",
      label: "Nur WW",
      icon: normalizeIcon(config.dhwIcon, "water"),
      color: "rgba(116, 199, 255, 0.3)",
    },
    {
      mode: "dhwAndHeating",
      label: "Heizen + WW",
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

  const roomCardTone = resolveTemperatureColor(roomTemp, ROOM_TEMP_COLOR_STOPS, "#587197");
  const dhwCardTone = resolveTemperatureColor(dhwTemp, DHW_TEMP_COLOR_STOPS, "#587197");
  const roomCardFillStart = withAlpha(roomCardTone, 0.2);
  const roomCardFillEnd = withAlpha(mixColorWith(roomCardTone, "#08131f", 0.42), 0.34);
  const dhwCardFillStart = withAlpha(dhwCardTone, 0.2);
  const dhwCardFillEnd = withAlpha(mixColorWith(dhwCardTone, "#08131f", 0.42), 0.34);
  const roomCardBackgroundColor = withAlpha(mixColorWith(roomCardTone, "#0b1625", 0.52), 0.28);
  const dhwCardBackgroundColor = withAlpha(mixColorWith(dhwCardTone, "#0b1625", 0.52), 0.28);
  const roomCardBorderColor = withAlpha(roomCardTone, 0.5);
  const dhwCardBorderColor = withAlpha(dhwCardTone, 0.5);
  const roomCardTextColor = resolveReadableTextColor(roomCardBackgroundColor);
  const dhwCardTextColor = resolveReadableTextColor(dhwCardBackgroundColor);
  const roomCardMutedTextColor = withAlpha(roomCardTextColor, 0.82);
  const dhwCardMutedTextColor = withAlpha(dhwCardTextColor, 0.82);
  const activeRoomTarget = resolveActiveRoomTarget(activeProgram, normalTarget, reducedTarget, comfortTarget);
  const anyBlinkActive = heatingModeBlinkActive || dhwChargingBlinkActive || boostBlinkActive;
  const roomBlinkColor = withAlpha(roomCardTone, ROOM_BLINK_ALPHA);
  const dhwBlinkColor = withAlpha(
    dhwChargingProgram === "temp2" ? DHW_BLINK_TEMP2_COLOR : DHW_BLINK_NORMAL_COLOR,
    DHW_BLINK_ALPHA
  );
  const cardBlinkOpacity = blinkPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.12, 0.56],
  });
  const boostBlinkOpacity = blinkPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.16, 0.68],
  });
  const heatingBlinkStatusText = heatingModeBlinkActive ? "Heizmodus aktiv" : "Heizmodus inaktiv";
  const dhwBlinkStatusText = dhwChargingBlinkActive
    ? `WW-Aufbereitung aktiv (${formatDhwChargeProgramLabel(dhwChargingProgram)})`
    : "WW-Aufbereitung inaktiv";
  const boostBlinkStatusText = boostBlinkActive ? "Boost aktiv" : "Boost inaktiv";

  const targetValues = [`N ${formatTemperature(normalTarget)}`];
  if (reducedTarget !== null) {
    targetValues.push(`R ${formatTemperature(reducedTarget)}`);
  }
  if (comfortTarget !== null) {
    targetValues.push(`K ${formatTemperature(comfortTarget)}`);
  }
  const detailsSegments = [
    heatingBlinkStatusText,
    dhwBlinkStatusText,
    boostBlinkStatusText,
    showInfoProgram ? `Programm ${formatProgramLabel(activeProgram)}` : null,
    showInfoTargets ? `Zielwerte ${targetValues.join(" | ")}` : null,
    ventilationAutoToggleAvailable ? `Lueftungsautomatik ${ventilationAutoActive ? "ein" : "aus"}` : null,
    ventilationSliderWritable
      ? `Lueftungsstufe Soll ${formatVentilationLevel(ventilationSliderValue)} | Ist ${formatVentilationLevel(
          ventilationDisplayActual
        )}`
      : null,
    ...infoRows.filter((row) => row.value !== "-").map((row) => `${row.label} ${row.value}`),
  ].filter(Boolean) as string[];
  const showDetailsTicker = detailsSegments.length > 0;
  const detailsTickerText = showDetailsTicker ? detailsSegments.join(DETAILS_TICKER_SEPARATOR) : "";
  const detailsTickerRenderText = detailsTickerText.replace(/ /g, "\u00a0");
  const detailsTickerLoopText = `${detailsTickerRenderText}${DETAILS_TICKER_LOOP_SEPARATOR}`;
  const detailsTickerEstimatedWidthPx = Math.max(220, Math.round(detailsTickerRenderText.length * 7.2));
  const detailsTickerCssDurationMs = Math.max(8000, Math.round((detailsTickerEstimatedWidthPx / detailsTickerSpeedPxPerS) * 1000));
  const detailsTickerCssDurationResolvedMs = lowPowerMode
    ? Math.round(detailsTickerCssDurationMs * 1.35)
    : detailsTickerCssDurationMs;

  const liveBadgeText = error ? "Fehler" : writePending ? "Sync" : "";
  const footerStatusText = error ? error : writePending ? "Synchronisiere..." : "";
  const contentScale = useMemo(
    () =>
      computeBoundedContentScale(
        widgetWidth,
        widgetHeight,
        HEATING_V2_BASE_CONTENT_WIDTH,
        HEATING_V2_BASE_CONTENT_HEIGHT,
        HEATING_V2_MIN_CONTENT_SCALE
      ),
    [widgetHeight, widgetWidth]
  );

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      return;
    }
    const styleId = "smarthome-heatingv2-ticker-keyframes";
    if (document.getElementById(styleId)) {
      return;
    }
    const styleEl = document.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = `
      @keyframes smarthomeHeatingV2TickerMove {
        from { transform: translate3d(0, 0, 0); }
        to { transform: translate3d(-50%, 0, 0); }
      }
    `;
    document.head.appendChild(styleEl);
  }, []);

  useEffect(() => {
    blinkAnimationRef.current?.stop();
    blinkAnimationRef.current = null;

    if (!runtimeActive || lowPowerMode || !anyBlinkActive) {
      blinkPulse.setValue(0);
      return;
    }

    blinkPulse.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkPulse, {
          toValue: 1,
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(blinkPulse, {
          toValue: 0,
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    blinkAnimationRef.current = loop;
    loop.start();

    return () => {
      loop.stop();
    };
  }, [anyBlinkActive, blinkPulse, lowPowerMode, runtimeActive]);

  useEffect(() => {
    detailsTickerAnimationRef.current?.stop();
    detailsTickerAnimationRef.current = null;
    if (
      Platform.OS === "web" ||
      lowPowerMode ||
      !runtimeActive ||
      !showDetailsTicker ||
      detailsTrackWidth <= 0 ||
      detailsContentWidth <= 0
    ) {
      detailsTickerOffset.setValue(0);
      return;
    }

    if (detailsContentWidth <= detailsTrackWidth + 6) {
      detailsTickerOffset.setValue(0);
      return;
    }

    const durationMs = Math.max(
      8000,
      Math.round((detailsContentWidth / detailsTickerSpeedPxPerS) * 1000)
    );

    detailsTickerOffset.setValue(0);
    const tickerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(detailsTickerOffset, {
          toValue: -detailsContentWidth,
          duration: durationMs,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(detailsTickerOffset, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    detailsTickerAnimationRef.current = tickerLoop;
    tickerLoop.start();

    return () => {
      tickerLoop.stop();
    };
  }, [
    detailsContentWidth,
    detailsTickerOffset,
    detailsTrackWidth,
    detailsTickerSpeedPxPerS,
    Platform.OS,
    lowPowerMode,
    runtimeActive,
    showDetailsTicker,
  ]);

  return (
    <View
      onLayout={(event) => {
        const nextWidth = Math.max(0, Math.round(event.nativeEvent.layout.width));
        const nextHeight = Math.max(0, Math.round(event.nativeEvent.layout.height));
        setWidgetWidth((current) => (current === nextWidth ? current : nextWidth));
        setWidgetHeight((current) => (current === nextHeight ? current : nextHeight));
      }}
      style={styles.container}
    >
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

        <View style={[styles.scaledContent, { transform: [{ scale: contentScale }] }]}>
          <View style={styles.header}>
          {config.showTitle !== false ? (
            <Text numberOfLines={1} style={[styles.title, { color: textColor }]}>
              {(config.title || "Heizung").trim() || "Heizung"}
            </Text>
          ) : null}
          <View style={styles.headerMeta}>
            {writePending ? (
              <View style={[styles.syncDot, { backgroundColor: sliderStart }]} />
            ) : null}
            {liveBadgeText ? (
              <View style={[styles.liveBadge, { borderColor: panelBorder, backgroundColor: panelColor }]}>
                <Text style={[styles.liveBadgeText, { color: error ? palette.danger : mutedTextColor }]}>
                  {liveBadgeText}
                </Text>
              </View>
            ) : null}
          </View>
          </View>

        {config.showStatusSubtitle !== false ? (
          <Text numberOfLines={2} style={[styles.subtitle, { color: mutedTextColor }]}>
            {summaryText}
          </Text>
        ) : null}

        <View style={styles.kpiRow}>
          <View style={[styles.kpiCard, { borderColor: roomCardBorderColor, backgroundColor: roomCardBackgroundColor }]}>
            {Platform.OS === "web"
              ? createElement("div", {
                  style: {
                    ...webGradientLayerStyle,
                    borderRadius: 12,
                    background: `linear-gradient(145deg, ${roomCardFillStart} 0%, ${roomCardFillEnd} 100%)`,
                  },
                })
              : <View style={[StyleSheet.absoluteFillObject, { borderRadius: 12, backgroundColor: roomCardFillEnd, opacity: 0.86 }]} />}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.cardBlinkOverlay,
                {
                  backgroundColor: roomBlinkColor,
                  opacity: heatingModeBlinkActive ? cardBlinkOpacity : 0,
                },
              ]}
            />
            <Text style={[styles.kpiLabel, { color: roomCardMutedTextColor }]}>Raum</Text>
            <Text style={[styles.kpiPrimary, { color: roomCardTextColor }]}>{roomTempDisplay}</Text>
            <Text style={[styles.kpiSecondary, { color: roomCardMutedTextColor }]}>Soll {formatTemperature(activeRoomTarget)}</Text>
          </View>
          <View style={[styles.kpiCard, { borderColor: dhwCardBorderColor, backgroundColor: dhwCardBackgroundColor }]}>
            {Platform.OS === "web"
              ? createElement("div", {
                  style: {
                    ...webGradientLayerStyle,
                    borderRadius: 12,
                    background: `linear-gradient(145deg, ${dhwCardFillStart} 0%, ${dhwCardFillEnd} 100%)`,
                  },
                })
              : <View style={[StyleSheet.absoluteFillObject, { borderRadius: 12, backgroundColor: dhwCardFillEnd, opacity: 0.86 }]} />}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.cardBlinkOverlay,
                {
                  backgroundColor: dhwBlinkColor,
                  opacity: dhwChargingBlinkActive ? cardBlinkOpacity : 0,
                },
              ]}
            />
            <Text style={[styles.kpiLabel, { color: dhwCardMutedTextColor }]}>Warmwasser</Text>
            <Text style={[styles.kpiPrimary, { color: dhwCardTextColor }]}>{dhwTempDisplay}</Text>
            <Text style={[styles.kpiSecondary, { color: dhwCardMutedTextColor }]}>Soll {formatTemperature(dhwTarget)}</Text>
          </View>
        </View>

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
                  <View style={styles.modeButtonContent}>
                    <MaterialCommunityIcons color={textColor} name={item.icon as never} size={16} />
                    <Text numberOfLines={1} style={[styles.modeButtonText, { color: textColor }]}>
                      {item.label}
                    </Text>
                  </View>
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
                ? boostBlinkActive
                  ? (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.modeButtonBlinkOverlay,
                        {
                          backgroundColor: BOOST_BLINK_COLOR,
                          opacity: boostBlinkOpacity,
                        },
                      ]}
                    />
                  )
                  : Platform.OS === "web"
                    ? createElement("div", {
                        style: {
                          ...webGradientLayerStyle,
                          borderRadius: 11,
                          background: `linear-gradient(135deg, ${oneTimeColor} 0%, rgba(255,255,255,0.08) 100%)`,
                        },
                      })
                    : <View style={[StyleSheet.absoluteFillObject, { borderRadius: 11, backgroundColor: oneTimeColor }]} />
                : null}
              <View style={styles.modeButtonContent}>
                <MaterialCommunityIcons color={textColor} name={oneTimeChargeIcon as never} size={16} />
                <Text numberOfLines={1} style={[styles.modeButtonText, { color: textColor }]}>
                  Boost
                </Text>
              </View>
            </Pressable>
          </View>
        </View>

        <View style={styles.controlGrid}>
          <View style={[styles.controlCard, { borderColor: panelBorder, backgroundColor: panelColor }]}>
            <View style={styles.blockHeaderInline}>
              <Text style={[styles.blockLabel, { color: mutedTextColor }]}>Raum Soll</Text>
              <Text style={[styles.valueText, { color: textColor }]}>{formatTemperature(normalSliderValue)}</Text>
            </View>
            <View style={styles.sliderShell}>
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
                        accentColor: sliderThumbColor,
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
          </View>

          <View style={[styles.controlCard, { borderColor: panelBorder, backgroundColor: panelColor }]}>
            <View style={styles.blockHeaderInline}>
              <Text style={[styles.blockLabel, { color: mutedTextColor }]}>Warmwasser Soll</Text>
              <Text style={[styles.valueText, { color: textColor }]}>{formatTemperature(dhwSliderValue)}</Text>
            </View>
            <View style={styles.sliderShell}>
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
                        accentColor: sliderThumbColor,
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
          </View>

          <View style={[styles.controlCard, { borderColor: panelBorder, backgroundColor: panelColor }]}>
            <View style={styles.blockHeaderInline}>
              <Text style={[styles.blockLabel, { color: mutedTextColor }]}>Lueftung</Text>
              <Text style={[styles.valueText, { color: textColor }]}>
                {ventilationManualControlEnabled
                  ? `Soll ${formatVentilationLevel(ventilationSliderValue)} | Ist ${formatVentilationLevel(
                      ventilationDisplayActual
                    )}`
                  : `Ist ${formatVentilationLevel(ventilationDisplayActual)}`}
              </Text>
            </View>
            <Pressable
              disabled={!ventilationAutoToggleAvailable}
              onPress={toggleVentilationAuto}
              style={({ pressed }) => [
                styles.ventilationAutoButton,
                ventilationAutoActive ? styles.ventilationAutoButtonActive : styles.ventilationAutoButtonInactive,
                !ventilationAutoToggleAvailable ? styles.disabledControl : null,
                pressed ? styles.pressScale : null,
              ]}
            >
              <View style={styles.ventilationAutoButtonContent}>
                <MaterialCommunityIcons
                  color={textColor}
                  name={"fan" as never}
                  size={16}
                />
                <Text style={[styles.ventilationAutoButtonText, { color: textColor }]}>
                  {ventilationAutoActive ? "Lueftungsautomatik ein" : "Lueftungsautomatik aus"}
                </Text>
              </View>
            </Pressable>
            <View
              style={[
                styles.sliderShell,
                ventilationAutoActive ? styles.sliderShellDisabled : null,
                !ventilationSliderWritable ? styles.disabledControl : null,
              ]}
            >
              <Pressable
                disabled={!ventilationManualControlEnabled}
                onPress={() => setVentilationLevel(ventilationSliderValue - VENTILATION_LEVEL_STEP, "button")}
                style={({ pressed }) => [
                  styles.stepButton,
                  !ventilationManualControlEnabled ? styles.disabledControl : null,
                  pressed ? styles.pressScale : null,
                ]}
              >
                <Text style={[styles.stepLabel, { color: textColor }]}>-</Text>
              </Pressable>
              <View style={styles.sliderWrap}>
                {Platform.OS === "web"
                  ? createElement("input", {
                      type: "range",
                      min: VENTILATION_LEVEL_MIN,
                      max: VENTILATION_LEVEL_MAX,
                      step: VENTILATION_LEVEL_STEP,
                      value: ventilationSliderValue,
                      disabled: !ventilationManualControlEnabled,
                      onInput: (event: { target: { value: string } }) => {
                        const next = clampVentilationLevel(
                          Number.parseFloat(event.target.value) || ventilationSliderValue
                        );
                        setVentilationLevelDraft(next);
                      },
                      onChange: (event: { target: { value: string } }) => {
                        const next = clampVentilationLevel(
                          Number.parseFloat(event.target.value) || ventilationSliderValue
                        );
                        setVentilationLevelDraft(next);
                        void setVentilationLevel(next, "slider");
                      },
                      style: {
                        ...webSliderStyle,
                        accentColor: sliderThumbColor,
                        opacity: ventilationManualControlEnabled ? 1 : 0.45,
                        backgroundImage: `linear-gradient(90deg, ${sliderStart} 0%, ${sliderEnd} 100%)`,
                      },
                    })
                  : null}
                <View style={styles.sliderScaleRow}>
                  <Text style={[styles.sliderScaleLabel, { color: mutedTextColor }]}>{VENTILATION_LEVEL_MIN}</Text>
                  <Text style={[styles.sliderScaleLabel, { color: mutedTextColor }]}>{VENTILATION_LEVEL_MAX}</Text>
                </View>
              </View>
              <Pressable
                disabled={!ventilationManualControlEnabled}
                onPress={() => setVentilationLevel(ventilationSliderValue + VENTILATION_LEVEL_STEP, "button")}
                style={({ pressed }) => [
                  styles.stepButton,
                  !ventilationManualControlEnabled ? styles.disabledControl : null,
                  pressed ? styles.pressScale : null,
                ]}
              >
                <Text style={[styles.stepLabel, { color: textColor }]}>+</Text>
              </Pressable>
            </View>
            <Text style={[styles.ventilationHint, { color: mutedTextColor }]}>
              {ventilationAutoActive
                ? "Automatik aktiv: manuelle Lueftungsstufe gesperrt."
                : ventilationSliderWritable
                  ? "Automatik aus: manuelle Lueftungsstufe aktiv."
                  : "Automatik aus: kein Datenpunkt fuer manuelle Lueftungsstufe gesetzt."}
            </Text>
          </View>
        </View>

        {showDetailsTicker ? (
          <View style={styles.block}>
            <View
              onLayout={(event) => {
                const nextWidth = Math.max(0, Math.round(event.nativeEvent.layout.width));
                setDetailsTrackWidth((current) => (current === nextWidth ? current : nextWidth));
              }}
              style={[styles.detailsTickerTrack, { borderColor: panelBorder, backgroundColor: panelColor }]}
            >
              {Platform.OS === "web"
                ? createElement(
                    "div",
                    {
                      style: {
                        ...webDetailsTickerMoverStyle,
                        animationDuration: `${detailsTickerCssDurationResolvedMs}ms`,
                        animationPlayState: runtimeActive ? "running" : "paused",
                      },
                    },
                    createElement(
                      "div",
                      {
                        style: webDetailsTickerInnerStyle,
                      },
                      createElement(
                        "span",
                        {
                          style: {
                            ...webDetailsTickerTextStyle,
                            color: textColor,
                          },
                        },
                        detailsTickerLoopText
                      ),
                      createElement(
                        "span",
                        {
                          style: {
                            ...webDetailsTickerTextStyle,
                            color: textColor,
                          },
                        },
                        detailsTickerLoopText
                      )
                    )
                  )
                : (
                    <Animated.View
                      style={[
                        styles.detailsTickerMover,
                        {
                          transform: [{ translateX: detailsTickerOffset }],
                        },
                      ]}
                    >
                      {lowPowerMode ? (
                        <Text
                          numberOfLines={1}
                          onLayout={(event) => {
                            const nextWidth = Math.max(0, Math.round(event.nativeEvent.layout.width));
                            setDetailsContentWidth((current) => (current === nextWidth ? current : nextWidth));
                          }}
                          style={[styles.detailsTickerText, { color: textColor }]}
                        >
                          {detailsTickerRenderText}
                        </Text>
                      ) : (
                        <>
                          <Text
                            numberOfLines={1}
                            onLayout={(event) => {
                              const nextWidth = Math.max(0, Math.round(event.nativeEvent.layout.width));
                              setDetailsContentWidth((current) => (current === nextWidth ? current : nextWidth));
                            }}
                            style={[styles.detailsTickerText, { color: textColor }]}
                          >
                            {detailsTickerLoopText}
                          </Text>
                          <Text numberOfLines={1} style={[styles.detailsTickerText, { color: textColor }]}>
                            {detailsTickerLoopText}
                          </Text>
                        </>
                      )}
                    </Animated.View>
                  )}
            </View>
          </View>
        ) : null}

          {footerStatusText ? (
            <Text numberOfLines={1} style={[styles.footer, { color: error ? palette.danger : mutedTextColor }]}>
              {footerStatusText}
            </Text>
          ) : null}
        </View>
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

function clampTickerSpeed(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_DETAILS_TICKER_SPEED_PX_PER_S;
  }
  return Math.max(
    MIN_DETAILS_TICKER_SPEED_PX_PER_S,
    Math.min(MAX_DETAILS_TICKER_SPEED_PX_PER_S, Math.round(value))
  );
}

function computeBoundedContentScale(
  width: number,
  height: number,
  baseWidth: number,
  baseHeight: number,
  minScale: number
) {
  if (width <= 0 || height <= 0 || baseWidth <= 0 || baseHeight <= 0) {
    return 1;
  }
  const widthScale = width / baseWidth;
  const heightScale = height / baseHeight;
  const raw = Math.min(widthScale, heightScale);
  return Math.max(minScale, Math.min(1, raw));
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

function resolveHeatingModeBlinkActive(value: unknown, fallbackMode: HeatingMode) {
  const asBoolean = normalizeBoolean(value);
  if (asBoolean !== null) {
    return asBoolean;
  }
  const normalizedMode = normalizeMode(value);
  if (normalizedMode) {
    return normalizedMode === "dhwAndHeating";
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallbackMode === "dhwAndHeating";
  }
  if (["active", "heating", "on", "normal", "temp-2", "temp2", "reduced", "comfort", "eco"].includes(normalized)) {
    return true;
  }
  if (["inactive", "off", "standby", "dhw"].includes(normalized)) {
    return false;
  }
  return fallbackMode === "dhwAndHeating";
}

function resolveDhwChargeProgram(value: unknown, fallbackDhwTarget: number): DhwChargeProgram {
  const normalized = String(value ?? "").trim().toLowerCase().replace(",", ".");
  if (normalized.includes("temp-2") || normalized.includes("temp2") || normalized.includes("reduced")) {
    return "temp2";
  }
  if (normalized.includes("normal")) {
    return "normal";
  }
  const numeric = Number.parseFloat(normalized);
  if (Number.isFinite(numeric)) {
    return numeric >= 55 ? "temp2" : "normal";
  }
  return fallbackDhwTarget >= 55 ? "temp2" : "normal";
}

function resolveActiveRoomTarget(
  activeProgram: ProgramMode | null,
  normalTarget: number,
  reducedTarget: number | null,
  comfortTarget: number | null
) {
  if (activeProgram === "reduced" && reducedTarget !== null) {
    return clampTemperature(reducedTarget, ROOM_TEMP_MIN, ROOM_TEMP_MAX, ROOM_TEMP_STEP);
  }
  if (activeProgram === "comfort" && comfortTarget !== null) {
    return clampTemperature(comfortTarget, ROOM_TEMP_MIN, ROOM_TEMP_MAX, ROOM_TEMP_STEP);
  }
  return normalTarget;
}

function formatDhwChargeProgramLabel(program: DhwChargeProgram) {
  return program === "temp2" ? "temp-2" : "normal";
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

function clampVentilationLevel(value: number) {
  if (!Number.isFinite(value)) {
    return VENTILATION_LEVEL_MIN;
  }
  const rounded = Math.round(value / VENTILATION_LEVEL_STEP) * VENTILATION_LEVEL_STEP;
  return Math.max(VENTILATION_LEVEL_MIN, Math.min(VENTILATION_LEVEL_MAX, rounded));
}

function formatVentilationLevel(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return String(clampVentilationLevel(value));
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

function resolveTemperatureColor(value: number | null, stops: TemperatureColorStop[], fallback: string) {
  if (value === null || !Number.isFinite(value) || stops.length < 2) {
    return fallback;
  }

  const sortedStops = [...stops].sort((a, b) => a.temp - b.temp);
  if (value <= sortedStops[0].temp) {
    return sortedStops[0].color;
  }
  if (value >= sortedStops[sortedStops.length - 1].temp) {
    return sortedStops[sortedStops.length - 1].color;
  }

  for (let index = 0; index < sortedStops.length - 1; index += 1) {
    const start = sortedStops[index];
    const end = sortedStops[index + 1];
    if (value >= start.temp && value <= end.temp) {
      const range = end.temp - start.temp;
      const ratio = range <= 0 ? 0 : (value - start.temp) / range;
      return interpolateHexColor(start.color, end.color, ratio);
    }
  }

  return fallback;
}

function mixColorWith(baseColor: string, mixColor: string, mixRatio: number) {
  return interpolateHexColor(baseColor, mixColor, mixRatio);
}

function withAlpha(color: string, alpha: number) {
  const { r, g, b } = parseHexColor(color);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}

function resolveReadableTextColor(backgroundColor: string) {
  const { r, g, b } = parseHexColor(backgroundColor);
  const relativeLuma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return relativeLuma > 0.57 ? "#08111f" : "#f4f8ff";
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
  const normalized = hex.trim().toLowerCase();
  const rgbMatch = normalized.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (rgbMatch) {
    return {
      r: Math.max(0, Math.min(255, Number(rgbMatch[1]))),
      g: Math.max(0, Math.min(255, Number(rgbMatch[2]))),
      b: Math.max(0, Math.min(255, Number(rgbMatch[3]))),
    };
  }

  const withoutHash = normalized.replace("#", "");
  const expanded = withoutHash.length === 3
    ? withoutHash
        .split("")
        .map((part) => `${part}${part}`)
        .join("")
    : withoutHash;

  if (expanded.length !== 6) {
    return { r: 111, g: 130, b: 162 };
  }

  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) {
    return { r: 111, g: 130, b: 162 };
  }
  return { r, g, b };
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
  scaledContent: {
    flex: 1,
    gap: 10,
    zIndex: 2,
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
  headerMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  syncDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
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
  kpiRow: {
    position: "relative",
    zIndex: 2,
    flexDirection: "row",
    gap: 8,
  },
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  cardBlinkOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    textAlign: "center",
  },
  kpiPrimary: {
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  kpiSecondary: {
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
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
  modeButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: "100%",
    minWidth: 0,
  },
  modeButtonText: {
    fontSize: 10,
    fontWeight: "700",
    flexShrink: 1,
  },
  modeButtonActive: {
    borderColor: "rgba(173, 204, 246, 0.45)",
  },
  modeButtonBlinkOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 11,
  },
  controlGrid: {
    position: "relative",
    zIndex: 2,
    gap: 8,
  },
  controlCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 7,
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
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(10, 18, 30, 0.38)",
  },
  sliderShellDisabled: {
    backgroundColor: "rgba(90, 102, 124, 0.26)",
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
  ventilationAutoButton: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  ventilationAutoButtonActive: {
    borderColor: "rgba(104, 231, 142, 0.72)",
    backgroundColor: "rgba(52, 172, 97, 0.32)",
  },
  ventilationAutoButtonInactive: {
    borderColor: "rgba(156, 170, 194, 0.35)",
    backgroundColor: "rgba(112, 124, 142, 0.2)",
  },
  ventilationAutoButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ventilationAutoButtonText: {
    fontSize: 12,
    fontWeight: "700",
    flexShrink: 1,
  },
  ventilationHint: {
    fontSize: 10,
    fontWeight: "600",
    lineHeight: 14,
  },
  detailsTickerTrack: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 38,
    overflow: "hidden",
    position: "relative",
    justifyContent: "center",
  },
  detailsTickerMover: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  detailsTickerText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    paddingHorizontal: 0,
    alignSelf: "center",
    flexShrink: 0,
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

const webDetailsTickerMoverStyle: Record<string, string | number> = {
  position: "absolute",
  left: 0,
  top: 0,
  bottom: 0,
  display: "flex",
  alignItems: "center",
  willChange: "transform",
  animationName: "smarthomeHeatingV2TickerMove",
  animationTimingFunction: "linear",
  animationIterationCount: "infinite",
  animationFillMode: "both",
  transform: "translate3d(0, 0, 0)",
};

const webDetailsTickerInnerStyle: Record<string, string | number> = {
  display: "flex",
  alignItems: "center",
  whiteSpace: "pre",
  transform: "translateZ(0)",
  backfaceVisibility: "hidden",
};

const webDetailsTickerTextStyle: Record<string, string | number> = {
  fontSize: "12px",
  lineHeight: "16px",
  fontWeight: 700,
  whiteSpace: "pre",
  flexShrink: 0,
};
