import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Animated, Easing, ImageBackground, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import { HeatingWidgetV2Config, StateSnapshot } from "../../types/dashboard";
import { playConfiguredUiSound } from "../../utils/uiSounds";
import { palette } from "../../utils/theme";
import { AutoFitContent } from "../AutoFitContent";

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
const ROOM_TEMP_DIAL_LABEL_STEP = 5;
const VENTILATION_LEVEL_MIN = 1;
const VENTILATION_LEVEL_MAX = 4;
const VENTILATION_LEVEL_STEP = 1;
const VENTILATION_LEVEL_DIAL_LABEL_STEP = VENTILATION_LEVEL_STEP;

const DHW_TEMP_MIN = 10;
const DHW_TEMP_MAX = 60;
const DHW_TEMP_STEP = 1;
const DHW_TEMP_DIAL_LABEL_STEP = 10;
const DEFAULT_DETAILS_TICKER_SPEED_PX_PER_S = 46;
const MIN_DETAILS_TICKER_SPEED_PX_PER_S = 16;
const MAX_DETAILS_TICKER_SPEED_PX_PER_S = 160;
const DETAILS_FADE_DURATION_MS = 260;
const HEATING_V2_BASE_CONTENT_WIDTH = 560;

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

const VENTILATION_COLOR_STOPS: TemperatureColorStop[] = [
  { temp: VENTILATION_LEVEL_MIN, color: "#2b5065" },
  { temp: VENTILATION_LEVEL_MAX, color: "#5fd0ff" },
];

const RADIAL_DIAL_VIEWBOX_SIZE = 168;
const RADIAL_DIAL_CENTER = 84;
const RADIAL_DIAL_RADIUS = 54;
const RADIAL_DIAL_SWEEP = 270;
const RADIAL_DIAL_GAP = 360 - RADIAL_DIAL_SWEEP;
const RADIAL_DIAL_START_ANGLE = 180 + RADIAL_DIAL_GAP / 2;
const RADIAL_DIAL_STROKE = 8;
const RADIAL_DIAL_ACTUAL_STROKE = Math.max(2, RADIAL_DIAL_STROKE - 5);
const RADIAL_DIAL_ACTUAL_COLOR = "rgba(245, 248, 255, 0.32)";
const RADIAL_DIAL_HANDLE_RADIUS = RADIAL_DIAL_STROKE * 0.52;
const RADIAL_DIAL_HANDLE_GLOW_RADIUS = RADIAL_DIAL_STROKE * 0.9;
const RADIAL_DIAL_TICK_INNER_RADIUS = 60;
const RADIAL_DIAL_TICK_MAJOR_LENGTH = 7;
const RADIAL_DIAL_TICK_MINOR_LENGTH = 4;
const RADIAL_DIAL_LABEL_RADIUS = 74;
const RADIAL_DIAL_LABEL_FONT_SIZE = 11;
const RADIAL_DIAL_SIZE = 112;
const RADIAL_DIAL_CENTER_BUTTON_SIZE = RADIAL_DIAL_SIZE * (42 / 152);
const RADIAL_DIAL_FAN_SPIN_KEYFRAMES_ID = "smarthome-v2-heating-fan-spin-keyframes";
const RADIAL_DIAL_FAN_SPIN_ANIMATION_NAME = "smarthomeV2HeatingFanSpin";

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
  const [detailsSegmentIndex, setDetailsSegmentIndex] = useState(0);
  const [detailsSegmentVisible, setDetailsSegmentVisible] = useState(true);
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

  const ventilationSliderValue = clampVentilationLevel(ventilationLevelDraft ?? ventilationLevelSetpoint);
  const ventilationDisplayActual = ventilationLevelActual ?? ventilationLevelSetpoint;
  const ventilationAutoToggleAvailable = Boolean(stateIds.ventilationAutoSetActive);
  const ventilationSliderWritable = Boolean(stateIds.ventilationLevelSet);
  const ventilationManualControlEnabled = !ventilationAutoActive && ventilationSliderWritable;
  const writePending = Object.values(pendingWrites).some(Boolean);

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
  const detailsRotationIntervalMs = resolveDetailsRotationInterval(detailsTickerSpeedPxPerS);
  const activeDetailsSegment = showDetailsTicker
    ? detailsSegments[detailsSegmentIndex % detailsSegments.length]
    : "";

  const liveBadgeText = error ? "Fehler" : writePending ? "Sync" : "";
  const footerStatusText = error ? error : writePending ? "Synchronisiere..." : "";
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
    setDetailsSegmentIndex((current) => (detailsSegments.length > 0 ? current % detailsSegments.length : 0));
    setDetailsSegmentVisible(true);
  }, [detailsSegments.length]);

  useEffect(() => {
    if (!runtimeActive || detailsSegments.length <= 1) {
      setDetailsSegmentVisible(true);
      return;
    }

    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    const rotationTimer = setInterval(() => {
      setDetailsSegmentVisible(false);
      fadeTimer = setTimeout(() => {
        setDetailsSegmentIndex((current) => (current + 1) % detailsSegments.length);
        setDetailsSegmentVisible(true);
        fadeTimer = null;
      }, DETAILS_FADE_DURATION_MS);
    }, detailsRotationIntervalMs);

    return () => {
      clearInterval(rotationTimer);
      if (fadeTimer) {
        clearTimeout(fadeTimer);
      }
    };
  }, [detailsRotationIntervalMs, detailsSegments.length, runtimeActive]);

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

        <AutoFitContent
          contentStyle={styles.scaledContent}
          designWidth={HEATING_V2_BASE_CONTENT_WIDTH}
          style={styles.fitViewport}
        >
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
          <View style={styles.subtitleSlot}>
            <Text
              numberOfLines={2}
              style={[styles.subtitle, { color: mutedTextColor }]}
            >
              {summaryText}
            </Text>
          </View>
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

        <View style={styles.radialDialRow}>
          <RadialDial
            label="Raum Soll"
            icon="home-thermometer-outline"
            min={ROOM_TEMP_MIN}
            max={ROOM_TEMP_MAX}
            step={ROOM_TEMP_STEP}
            labelStep={ROOM_TEMP_DIAL_LABEL_STEP}
            committedValue={normalTarget}
            draftValue={normalDraft}
            actualValue={roomTemp}
            colorStops={ROOM_TEMP_COLOR_STOPS}
            accentFallback="#587197"
            formatValue={formatTemperature}
            onDraftChange={setNormalDraft}
            onCommit={setNormalTemperature}
            textColor={textColor}
            mutedTextColor={mutedTextColor}
            blinkColor={roomBlinkColor}
            blinkOpacity={heatingModeBlinkActive ? cardBlinkOpacity : 0}
          />
          <RadialDial
            label="Warmwasser Soll"
            icon="water-boiler"
            min={DHW_TEMP_MIN}
            max={DHW_TEMP_MAX}
            step={DHW_TEMP_STEP}
            labelStep={DHW_TEMP_DIAL_LABEL_STEP}
            committedValue={dhwTarget}
            draftValue={dhwDraft}
            actualValue={dhwTemp}
            colorStops={DHW_TEMP_COLOR_STOPS}
            accentFallback="#587197"
            formatValue={formatTemperature}
            onDraftChange={setDhwDraft}
            onCommit={setDhwTemperature}
            textColor={textColor}
            mutedTextColor={mutedTextColor}
            blinkColor={dhwBlinkColor}
            blinkOpacity={dhwChargingBlinkActive ? cardBlinkOpacity : 0}
          />
          <RadialDial
            label="Lueftung"
            icon="fan"
            min={VENTILATION_LEVEL_MIN}
            max={VENTILATION_LEVEL_MAX}
            step={VENTILATION_LEVEL_STEP}
            labelStep={VENTILATION_LEVEL_DIAL_LABEL_STEP}
            committedValue={ventilationLevelSetpoint}
            draftValue={ventilationLevelDraft}
            actualValue={ventilationLevelActual}
            colorStops={VENTILATION_COLOR_STOPS}
            accentFallback="#2b5065"
            formatValue={formatVentilationLevel}
            belowUnitLabel="Stufe"
            centerValueOverride={ventilationAutoActive ? "AUTO" : undefined}
            onDraftChange={setVentilationLevelDraft}
            onCommit={setVentilationLevel}
            disabled={!ventilationManualControlEnabled}
            hint={
              ventilationAutoActive
                ? "Automatik aktiv: manuelle Lueftungsstufe gesperrt."
                : ventilationSliderWritable
                  ? "Automatik aus: manuelle Lueftungsstufe aktiv."
                  : "Automatik aus: kein Datenpunkt fuer manuelle Lueftungsstufe gesetzt."
            }
            onCenterTap={ventilationAutoToggleAvailable ? toggleVentilationAuto : undefined}
            spinning={(ventilationAutoActive || ventilationDisplayActual > 0) && runtimeActive && !lowPowerMode}
            spinDurationS={ventilationAutoActive ? 2.2 : Math.max(1.1, 4.6 - ventilationDisplayActual * 0.9)}
            textColor={textColor}
            mutedTextColor={mutedTextColor}
          />
        </View>

        <View style={styles.detailsTickerSlot}>
          {showDetailsTicker ? (
            <View
              style={[styles.detailsTickerTrack, { borderColor: panelBorder, backgroundColor: panelColor }]}
            >
              {Platform.OS === "web"
                ? createElement("div", {
                    style: {
                      ...webDetailsFadeTextStyle,
                      color: textColor,
                      opacity: detailsSegmentVisible ? 1 : 0,
                      transform: detailsSegmentVisible ? "translate3d(0, 0, 0)" : "translate3d(0, 3px, 0)",
                    },
                    title: activeDetailsSegment,
                  }, activeDetailsSegment)
                : (
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.detailsTickerText,
                        {
                          color: textColor,
                          opacity: detailsSegmentVisible ? 1 : 0,
                          transform: [{ translateY: detailsSegmentVisible ? 0 : 3 }],
                        },
                      ]}
                    >
                      {activeDetailsSegment}
                    </Text>
                  )}
            </View>
          ) : null}
        </View>

        <View style={styles.footerSlot}>
          {footerStatusText ? (
            <Text numberOfLines={1} style={[styles.footer, { color: error ? palette.danger : mutedTextColor }]}>
              {footerStatusText}
            </Text>
          ) : null}
        </View>
        </AutoFitContent>
      </View>
    </View>
  );
}

let radialDialSpinKeyframeRefCount = 0;

function ensureRadialDialSpinKeyframes() {
  radialDialSpinKeyframeRefCount += 1;
  if (typeof document === "undefined" || document.getElementById(RADIAL_DIAL_FAN_SPIN_KEYFRAMES_ID)) {
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = RADIAL_DIAL_FAN_SPIN_KEYFRAMES_ID;
  styleElement.textContent = `@keyframes ${RADIAL_DIAL_FAN_SPIN_ANIMATION_NAME} { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
  document.head.appendChild(styleElement);
}

function releaseRadialDialSpinKeyframes() {
  radialDialSpinKeyframeRefCount = Math.max(0, radialDialSpinKeyframeRefCount - 1);
  if (radialDialSpinKeyframeRefCount === 0) {
    document.getElementById(RADIAL_DIAL_FAN_SPIN_KEYFRAMES_ID)?.remove();
  }
}

function dialPolarPoint(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: RADIAL_DIAL_CENTER + radius * Math.sin(rad),
    y: RADIAL_DIAL_CENTER - radius * Math.cos(rad),
  };
}

function dialArcPath(radius: number, fractionStart: number, fractionEnd: number) {
  const clampedStart = Math.max(0, Math.min(1, fractionStart));
  const clampedEnd = Math.max(0, Math.min(1, fractionEnd));
  const startAngle = RADIAL_DIAL_START_ANGLE + clampedStart * RADIAL_DIAL_SWEEP;
  const endAngle = RADIAL_DIAL_START_ANGLE + clampedEnd * RADIAL_DIAL_SWEEP;
  const from = dialPolarPoint(startAngle, radius);
  const to = dialPolarPoint(endAngle, radius);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${to.x} ${to.y}`;
}

function dialValueFraction(value: number, min: number, max: number) {
  if (max <= min) {
    return 0;
  }
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function dialLabelValues(min: number, max: number, labelStep: number) {
  const values: number[] = [];
  for (let value = min; value <= max + 1e-6; value += labelStep) {
    values.push(Number(value.toFixed(2)));
  }
  return values;
}

function dialTickAngle(value: number, min: number, max: number) {
  return RADIAL_DIAL_START_ANGLE + dialValueFraction(value, min, max) * RADIAL_DIAL_SWEEP;
}

function formatDialTickLabel(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function dialPointerAngle(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number }
) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return angle < 0 ? angle + 360 : angle;
}

function dialAngleFraction(angleDeg: number) {
  const relative = (((angleDeg - RADIAL_DIAL_START_ANGLE) % 360) + 360) % 360;
  if (relative > RADIAL_DIAL_SWEEP) {
    const distanceToEnd = relative - RADIAL_DIAL_SWEEP;
    const distanceToStart = 360 - relative;
    return distanceToStart < distanceToEnd ? 0 : 1;
  }
  return relative / RADIAL_DIAL_SWEEP;
}

const RADIAL_DIAL_TRACK_PATH = dialArcPath(RADIAL_DIAL_RADIUS, 0, 1);
const RADIAL_DIAL_ACTUAL_RADIUS = RADIAL_DIAL_RADIUS - RADIAL_DIAL_STROKE;

type RadialDialProps = {
  label: string;
  icon: string;
  min: number;
  max: number;
  step: number;
  labelStep: number;
  committedValue: number;
  draftValue: number | null;
  actualValue: number | null;
  colorStops: TemperatureColorStop[];
  accentFallback: string;
  formatValue: (value: number | null) => string;
  onDraftChange: (value: number | null) => void;
  onCommit: (value: number, source: "slider" | "button") => void;
  textColor: string;
  mutedTextColor: string;
  disabled?: boolean;
  hint?: string;
  belowUnitLabel?: string;
  centerValueOverride?: string;
  onCenterTap?: () => void;
  spinning?: boolean;
  spinDurationS?: number;
  blinkColor?: string;
  blinkOpacity?: Animated.AnimatedInterpolation<number> | number;
};

function RadialDial({
  label,
  icon,
  min,
  max,
  step,
  labelStep,
  committedValue,
  draftValue,
  actualValue,
  colorStops,
  accentFallback,
  formatValue,
  onDraftChange,
  onCommit,
  textColor,
  mutedTextColor,
  disabled = false,
  hint,
  belowUnitLabel,
  centerValueOverride,
  onCenterTap,
  spinning = false,
  spinDurationS = 3,
  blinkColor,
  blinkOpacity,
}: RadialDialProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const progressPathRef = useRef<SVGPathElement | null>(null);
  const handleRef = useRef<SVGCircleElement | null>(null);
  const handleGlowRef = useRef<SVGCircleElement | null>(null);
  const valueTextRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const pendingFractionRef = useRef<number | null>(null);

  const sliderValue = draftValue ?? committedValue;

  const majorTickValues = useMemo(() => dialLabelValues(min, max, labelStep), [min, max, labelStep]);
  const minorTickValues = useMemo(() => {
    if (labelStep <= step) {
      return [];
    }
    const minors: number[] = [];
    for (let i = 0; i < majorTickValues.length - 1; i += 1) {
      minors.push((majorTickValues[i] + majorTickValues[i + 1]) / 2);
    }
    return minors;
  }, [majorTickValues, labelStep, step]);

  const applyVisual = useCallback(
    (nextFraction: number) => {
      const clamped = Math.max(0, Math.min(1, nextFraction));
      if (progressPathRef.current) {
        progressPathRef.current.setAttribute("d", dialArcPath(RADIAL_DIAL_RADIUS, 0, clamped));
      }
      const angle = RADIAL_DIAL_START_ANGLE + clamped * RADIAL_DIAL_SWEEP;
      const point = dialPolarPoint(angle, RADIAL_DIAL_RADIUS);
      if (handleRef.current) {
        handleRef.current.setAttribute("cx", String(point.x));
        handleRef.current.setAttribute("cy", String(point.y));
      }
      if (handleGlowRef.current) {
        handleGlowRef.current.setAttribute("cx", String(point.x));
        handleGlowRef.current.setAttribute("cy", String(point.y));
      }
      if (valueTextRef.current && !centerValueOverride) {
        const rawValue = min + clamped * (max - min);
        valueTextRef.current.textContent = formatValue(clampTemperature(rawValue, min, max, step));
      }
    },
    [centerValueOverride, formatValue, max, min, step]
  );

  const commitValue = useCallback(
    (nextFraction: number, source: "slider" | "button") => {
      const rawValue = min + Math.max(0, Math.min(1, nextFraction)) * (max - min);
      const clamped = clampTemperature(rawValue, min, max, step);
      onDraftChange(clamped);
      onCommit(clamped, source);
    },
    [max, min, onCommit, onDraftChange, step]
  );

  const scheduleVisualUpdate = useCallback(
    (nextFraction: number) => {
      pendingFractionRef.current = nextFraction;
      if (rafIdRef.current !== null) {
        return;
      }
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (pendingFractionRef.current !== null) {
          applyVisual(pendingFractionRef.current);
        }
      });
    },
    [applyVisual]
  );

  const stopDragging = useCallback(() => {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (pendingFractionRef.current !== null) {
      commitValue(pendingFractionRef.current, "slider");
      pendingFractionRef.current = null;
    }
  }, [commitValue]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || !containerRef.current) {
        return;
      }
      containerRef.current.setPointerCapture?.(event.pointerId);
      draggingRef.current = true;
      const rect = containerRef.current.getBoundingClientRect();
      const nextFraction = dialAngleFraction(dialPointerAngle(event.clientX, event.clientY, rect));
      pendingFractionRef.current = nextFraction;
      applyVisual(nextFraction);
    },
    [applyVisual, disabled]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current || !containerRef.current) {
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      const nextFraction = dialAngleFraction(dialPointerAngle(event.clientX, event.clientY, rect));
      scheduleVisualUpdate(nextFraction);
    },
    [scheduleVisualUpdate]
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (disabled) {
        return;
      }
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      const next = clampTemperature(sliderValue + direction * step, min, max, step);
      onDraftChange(next);
      onCommit(next, "slider");
    },
    [disabled, max, min, onCommit, onDraftChange, sliderValue, step]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (disabled) {
        return;
      }
      let direction = 0;
      if (event.key === "ArrowUp" || event.key === "ArrowRight") {
        direction = 1;
      } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
        direction = -1;
      } else {
        return;
      }
      event.preventDefault();
      const next = clampTemperature(sliderValue + direction * step, min, max, step);
      onDraftChange(next);
      onCommit(next, "button");
    },
    [disabled, max, min, onCommit, onDraftChange, sliderValue, step]
  );

  const handleCenterTap = useCallback(() => {
    onCenterTap?.();
  }, [onCenterTap]);

  useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }
    ensureRadialDialSpinKeyframes();
    return () => {
      releaseRadialDialSpinKeyframes();
    };
  }, []);

  if (Platform.OS !== "web") {
    return (
      <View style={styles.radialDial}>
        <View style={[styles.radialDialRing, styles.radialDialNativeFallback]}>
          <MaterialCommunityIcons color={mutedTextColor} name={icon as never} size={18} />
          <Text style={[styles.radialDialValue, { color: textColor }]}>
            {centerValueOverride ?? formatValue(sliderValue)}
          </Text>
        </View>
        <Text numberOfLines={1} style={[styles.radialDialLabel, { color: mutedTextColor }]}>
          {label}
        </Text>
      </View>
    );
  }

  const fraction = dialValueFraction(sliderValue, min, max);
  const actualFraction = actualValue === null ? null : dialValueFraction(actualValue, min, max);
  const accentColor = resolveTemperatureColor(sliderValue, colorStops, accentFallback);
  const handlePoint = dialPolarPoint(RADIAL_DIAL_START_ANGLE + fraction * RADIAL_DIAL_SWEEP, RADIAL_DIAL_RADIUS);

  return (
    <View style={styles.radialDial}>
      <View style={styles.radialDialRing}>
        {createElement(
          "div",
          {
            ref: containerRef,
            role: "slider",
            tabIndex: disabled ? -1 : 0,
            "aria-label": label,
            "aria-valuemin": min,
            "aria-valuemax": max,
            "aria-valuenow": committedValue,
            "aria-valuetext": centerValueOverride ?? formatValue(committedValue),
            "aria-disabled": disabled,
            onPointerDown: handlePointerDown,
            onPointerMove: handlePointerMove,
            onPointerUp: stopDragging,
            onPointerCancel: stopDragging,
            onWheel: handleWheel,
            onKeyDown: handleKeyDown,
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              width: RADIAL_DIAL_SIZE,
              height: RADIAL_DIAL_SIZE,
              touchAction: "none",
              cursor: disabled ? "default" : "grab",
              opacity: disabled ? 0.48 : 1,
              outline: "none",
            },
          },
          createElement(
            "svg",
            {
              viewBox: `0 0 ${RADIAL_DIAL_VIEWBOX_SIZE} ${RADIAL_DIAL_VIEWBOX_SIZE}`,
              width: RADIAL_DIAL_SIZE,
              height: RADIAL_DIAL_SIZE,
              style: { overflow: "visible" },
            },
            createElement("path", {
              d: RADIAL_DIAL_TRACK_PATH,
              fill: "none",
              stroke: "rgba(255, 255, 255, 0.1)",
              strokeWidth: RADIAL_DIAL_STROKE,
              strokeLinecap: "round",
            }),
            minorTickValues.map((value) => {
              const angle = dialTickAngle(value, min, max);
              const inner = dialPolarPoint(angle, RADIAL_DIAL_TICK_INNER_RADIUS);
              const outer = dialPolarPoint(angle, RADIAL_DIAL_TICK_INNER_RADIUS + RADIAL_DIAL_TICK_MINOR_LENGTH);
              return createElement("line", {
                key: `minor-${value}`,
                x1: inner.x,
                y1: inner.y,
                x2: outer.x,
                y2: outer.y,
                stroke: withAlpha(mutedTextColor, 0.35),
                strokeWidth: 1,
                strokeLinecap: "round",
              });
            }),
            majorTickValues.map((value) => {
              const angle = dialTickAngle(value, min, max);
              const inner = dialPolarPoint(angle, RADIAL_DIAL_TICK_INNER_RADIUS);
              const outer = dialPolarPoint(angle, RADIAL_DIAL_TICK_INNER_RADIUS + RADIAL_DIAL_TICK_MAJOR_LENGTH);
              return createElement("line", {
                key: `major-${value}`,
                x1: inner.x,
                y1: inner.y,
                x2: outer.x,
                y2: outer.y,
                stroke: mutedTextColor,
                strokeWidth: 1.5,
                strokeLinecap: "round",
              });
            }),
            majorTickValues.map((value) => {
              const point = dialPolarPoint(dialTickAngle(value, min, max), RADIAL_DIAL_LABEL_RADIUS);
              const dx = point.x - RADIAL_DIAL_CENTER;
              const textAnchor = Math.abs(dx) < 4 ? "middle" : dx > 0 ? "start" : "end";
              return createElement(
                "text",
                {
                  key: `label-${value}`,
                  x: point.x,
                  y: point.y,
                  fontSize: RADIAL_DIAL_LABEL_FONT_SIZE,
                  fill: mutedTextColor,
                  dominantBaseline: "central",
                  textAnchor,
                },
                formatDialTickLabel(value)
              );
            }),
            actualFraction === null
              ? null
              : createElement("path", {
                  d: dialArcPath(RADIAL_DIAL_ACTUAL_RADIUS, 0, actualFraction),
                  fill: "none",
                  stroke: RADIAL_DIAL_ACTUAL_COLOR,
                  strokeWidth: RADIAL_DIAL_ACTUAL_STROKE,
                  strokeLinecap: "round",
                }),
            createElement("path", {
              ref: progressPathRef,
              d: dialArcPath(RADIAL_DIAL_RADIUS, 0, fraction),
              fill: "none",
              stroke: accentColor,
              strokeWidth: RADIAL_DIAL_STROKE,
              strokeLinecap: "round",
            }),
            createElement("circle", {
              ref: handleGlowRef,
              cx: handlePoint.x,
              cy: handlePoint.y,
              r: RADIAL_DIAL_HANDLE_GLOW_RADIUS,
              fill: accentColor,
              opacity: 0.35,
            }),
            createElement("circle", {
              ref: handleRef,
              cx: handlePoint.x,
              cy: handlePoint.y,
              r: RADIAL_DIAL_HANDLE_RADIUS,
              fill: "#f5f8ff",
            })
          )
        )}
        {createElement(
          "div",
          {
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              width: RADIAL_DIAL_SIZE,
              height: RADIAL_DIAL_SIZE,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              pointerEvents: "none",
            },
          },
          createElement(
            "div",
            {
              onClick: onCenterTap ? handleCenterTap : undefined,
              style: {
                width: RADIAL_DIAL_CENTER_BUTTON_SIZE,
                height: RADIAL_DIAL_CENTER_BUTTON_SIZE,
                borderRadius: RADIAL_DIAL_CENTER_BUTTON_SIZE / 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: onCenterTap ? "auto" : "none",
                cursor: onCenterTap ? "pointer" : "default",
                animationName: spinning ? RADIAL_DIAL_FAN_SPIN_ANIMATION_NAME : "none",
                animationDuration: `${spinDurationS}s`,
                animationTimingFunction: "linear",
                animationIterationCount: "infinite",
              },
            },
            createElement(MaterialCommunityIcons, { color: textColor, name: icon as never, size: 18 })
          ),
          createElement(
            "div",
            {
              ref: valueTextRef,
              style: { fontSize: 15, fontWeight: 800, color: textColor, lineHeight: "18px" },
            },
            centerValueOverride ?? formatValue(sliderValue)
          ),
          belowUnitLabel && !centerValueOverride
            ? createElement(
                "div",
                {
                  style: {
                    fontSize: 9,
                    fontWeight: 700,
                    color: mutedTextColor,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  },
                },
                belowUnitLabel
              )
            : null
        )}
        {blinkColor && blinkOpacity ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.radialDialBlinkOverlay, { backgroundColor: blinkColor, opacity: blinkOpacity }]}
          />
        ) : null}
      </View>
      <Text numberOfLines={1} style={[styles.radialDialLabel, { color: mutedTextColor }]}>
        {label}
      </Text>
      {hint ? (
        <Text numberOfLines={2} style={[styles.radialDialHint, { color: mutedTextColor }]}>
          {hint}
        </Text>
      ) : null}
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

function resolveDetailsRotationInterval(speedPxPerS: number) {
  return Math.max(3200, Math.min(8000, Math.round(250000 / speedPxPerS)));
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

function withAlpha(color: string, alpha: number) {
  const { r, g, b } = parseHexColor(color);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
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
  fitViewport: {
    zIndex: 2,
  },
  scaledContent: {
    gap: 10,
    zIndex: 2,
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
  subtitleSlot: {
    height: 34,
    justifyContent: "center",
    overflow: "hidden",
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
  radialDialRow: {
    position: "relative",
    zIndex: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
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
  radialDial: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  radialDialRing: {
    position: "relative",
    width: RADIAL_DIAL_SIZE,
    height: RADIAL_DIAL_SIZE,
  },
  radialDialNativeFallback: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  radialDialValue: {
    fontSize: 15,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  radialDialLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    textAlign: "center",
  },
  radialDialHint: {
    fontSize: 9,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 12,
  },
  radialDialBlinkOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADIAL_DIAL_SIZE / 2,
  },
  detailsTickerTrack: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 38,
    overflow: "hidden",
    position: "relative",
    justifyContent: "center",
  },
  detailsTickerSlot: {
    height: 38,
  },
  detailsTickerText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    width: "100%",
    paddingHorizontal: 12,
    alignSelf: "center",
    textAlign: "center",
  },
  footer: {
    position: "relative",
    zIndex: 2,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
  },
  footerSlot: {
    height: 16,
    justifyContent: "center",
    overflow: "hidden",
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

const webDetailsFadeTextStyle: Record<string, string | number> = {
  position: "absolute",
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 12px",
  fontSize: "12px",
  lineHeight: "16px",
  fontWeight: 700,
  textAlign: "center",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  transition: `opacity ${DETAILS_FADE_DURATION_MS}ms ease, transform ${DETAILS_FADE_DURATION_MS}ms ease`,
};
