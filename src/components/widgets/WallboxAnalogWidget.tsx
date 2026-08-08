import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, ImageBackground, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import { StateSnapshot, WallboxWidgetV2Config } from "../../types/dashboard";
import { playConfiguredUiSound } from "../../utils/uiSounds";
import { palette } from "../../utils/theme";

type WallboxAnalogWidgetProps = {
  config: WallboxWidgetV2Config;
  client: IoBrokerClient;
  states: StateSnapshot;
  isActivePage?: boolean;
  lowPowerMode?: boolean;
};

type WallboxMode = "stop" | "pv" | "pvPriority" | "grid";
type PendingConfirmation = {
  pendingKey: string;
  watchStateId: string;
  confirmKey: string;
  matcher: (value: unknown) => boolean;
  timeoutAt: number;
};
type ConfigValueType = "boolean" | "number" | "string";

const AMPERE_MIN = 6;
const AMPERE_MAX = 16;
const DEFAULT_GRID_AMPERE = 10;
const DEFAULT_TARGET_SOC = 80;
const DEFAULT_TARGET_KM = 300;
const TARGET_SOC_VALUES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
const TARGET_KM_VALUES = [50, 100, 150, 200, 250, 300, 350, 400] as const;
const PHASE_VOLTAGE_V = 230;
const CHARGING_ACTIVE_THRESHOLD_W = 100;
const FAST_CHARGING_THRESHOLD_W = 5000;
const CHARGING_INDICATOR_BLINK_MS = 720;
const CHARGING_BAR_MAX_POWER_W = 11000;
const CHARGING_BAR_GLOW_CYCLE_MS = 2000;
const TABLET_GLOW_EVENT_DURATION_MS = 1100;
const TABLET_GLOW_POWER_BUCKET_W = 1000;
const AMPERE_PRESET_VALUES = [6, 10, 12, 14, 16] as const;
const CONFIRMATION_TIMEOUT_MS = 12_000;
const WALLBOX_BASE_CONTENT_WIDTH = 560;
const WALLBOX_BASE_CONTENT_HEIGHT = 292;
const WALLBOX_MIN_CONTENT_SCALE = 0.72;

const WRITE_DEFAULT_IDS = {
  stop: "go-e-gemini-adapter.0.control.allowCharging",
  emergencyStop: "go-e-gemini-adapter.0.control.emergencyStop",
  mode: "go-e-gemini-adapter.0.control.mode",
  manualCurrent: "go-e-gemini-adapter.0.control.gridManual.currentA",
  phaseCards: "go-e-gemini-adapter.0.control.gridManual.phaseMode",
  targetSocPercent: "go-e-gemini-adapter.0.control.targetSocPercent",
  targetSocAutoApi: "bmw.0.WBY11CF080CP51905.stream.vehicle.drivetrain.batteryManagement.maxEnergy.value",
  targetKm: "",
  targetSocEnabled: "go-e-gemini-adapter.0.control.targetSocEnabled",
} as const;

const STATUS_DEFAULT_IDS = {
  stop: "go-e-gemini-adapter.0.status.effectiveAllowCharging",
  mode: "go-e-gemini-adapter.0.status.activeMode",
  manualCurrent: "go-e-gemini-adapter.0.status.setCurrentA",
  ampereCards: "go-e-gemini-adapter.0.status.setCurrentA",
  phaseCards: "go-e-gemini-adapter.0.status.targetPhaseMode",
} as const;

const READ_DEFAULT_IDS = {
  actualPhaseMode: "go-e-gemini-adapter.0.status.actualPhaseMode",
  actualPhaseCount: "go-e-gemini-adapter.0.status.enabledPhases",
  liveAmpere: "go-e-gemini-adapter.0.status.setCurrentA",
  car: "go-e-gemini-adapter.0.status.carState",
  batterySoc: "go-e-gemini-adapter.0.status.carSocPercent",
  carRange: "",
  chargePower: "go-e-gemini-adapter.0.status.chargerPowerW",
  chargedEnergy: "go-e.0.eto",
} as const;

const LEGACY_WRITE_IDS = {
  stop: "go-e.0.allow_charging",
  mode: "0_userdata.0.goe.mode",
  manualCurrent: "0_userdata.0.goe.gridAmpere",
  phaseCards: "go-e.0.phaseSwitchMode",
  targetSocPercent: "0_userdata.0.goe.limit80",
  targetKm: "",
  targetSocEnabled: "go-e.0.stopChargeingAtCarSoc80",
} as const;

const LEGACY_STATUS_IDS = {
  stop: "go-e.0.allow_charging",
  mode: "0_userdata.0.goe.mode",
  manualCurrent: "go-e.0.ampere",
  ampereCards: "go-e.0.ampere",
  phaseCards: "go-e.0.phaseSwitchModeEnabled",
} as const;

const LEGACY_READ_IDS = {
  actualPhaseMode: "go-e.0.phaseSwitchMode",
  actualPhaseCount: "go-e.0.phaseSwitchModeEnabled",
  liveAmpere: "go-e.0.ampere",
  car: "go-e.0.car",
  batterySoc: "go-e.0.carBatterySoc",
  carRange: "",
  chargePower: "go-e.0.nrg.11",
  chargedEnergy: "go-e.0.eto",
} as const;

export function WallboxAnalogWidget({ config, client, states, isActivePage = true, lowPowerMode = false }: WallboxAnalogWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const [widgetWidth, setWidgetWidth] = useState(0);
  const [widgetHeight, setWidgetHeight] = useState(0);
  const stateIds = useMemo(
    () => {
      const modeWriteBase = resolveStateIdWithLegacy(config.modeStateId, WRITE_DEFAULT_IDS.mode, LEGACY_WRITE_IDS.mode);
      const stopWriteBase = resolveStateIdWithLegacy(
        config.allowChargingStateId,
        WRITE_DEFAULT_IDS.stop,
        LEGACY_WRITE_IDS.stop
      );
      const resolvedStopWriteStateId = resolveStateId(config.stopWriteStateId, stopWriteBase);
      const emergencyStopStateId = resolveOptionalStateId(
        config.emergencyStopStateId,
        resolveLegacyEmergencyStopStateId(config.stopSecondaryWriteStateId, resolvedStopWriteStateId) ||
          WRITE_DEFAULT_IDS.emergencyStop
      );
      const manualCurrentWriteBase = resolveStateIdWithLegacy(
        config.gridAmpereStateId,
        WRITE_DEFAULT_IDS.manualCurrent,
        LEGACY_WRITE_IDS.manualCurrent
      );
      const phaseCardsWriteBase = resolveStateIdWithLegacy(
        config.phaseSwitchModeStateId,
        WRITE_DEFAULT_IDS.phaseCards,
        LEGACY_WRITE_IDS.phaseCards
      );
      const manualCurrentStatusBase = resolveStateIdWithLegacy(
        config.ampereStateId,
        STATUS_DEFAULT_IDS.manualCurrent,
        LEGACY_STATUS_IDS.manualCurrent
      );

      const write = {
        stop: resolvedStopWriteStateId,
        pv: resolveStateId(config.pvWriteStateId, modeWriteBase),
        pvPriority: resolveStateId(config.pvPriorityWriteStateId, modeWriteBase),
        grid: resolveStateId(config.gridWriteStateId, modeWriteBase),
        manualCurrent: resolveStateId(config.manualCurrentWriteStateId, manualCurrentWriteBase),
        ampereCards: resolveStateId(config.ampereCardsWriteStateId, manualCurrentWriteBase),
        phaseCards: resolveStateId(config.phaseCardsWriteStateId, phaseCardsWriteBase),
        targetSocPercent: resolveStateIdWithLegacy(
          config.limit80StateId,
          WRITE_DEFAULT_IDS.targetSocPercent,
          LEGACY_WRITE_IDS.targetSocPercent
        ),
        targetKm: resolveOptionalStateId(config.targetKmStateId, WRITE_DEFAULT_IDS.targetKm),
      };

      const status = {
        stop: resolveStateIdWithLegacy(
          config.stopStateId,
          resolveMappedStatusId(write.stop, ".control.allowCharging", ".status.effectiveAllowCharging") ||
            STATUS_DEFAULT_IDS.stop,
          LEGACY_STATUS_IDS.stop
        ),
        pv: resolveStateIdWithLegacy(
          config.pvStateId,
          resolveMappedStatusId(write.pv, ".control.mode", ".status.activeMode") || STATUS_DEFAULT_IDS.mode,
          LEGACY_STATUS_IDS.mode
        ),
        pvPriority: resolveStateIdWithLegacy(
          config.pvPriorityStateId,
          resolveMappedStatusId(write.pvPriority, ".control.mode", ".status.activeMode") || STATUS_DEFAULT_IDS.mode,
          LEGACY_STATUS_IDS.mode
        ),
        grid: resolveStateIdWithLegacy(
          config.gridStateId,
          resolveMappedStatusId(write.grid, ".control.mode", ".status.activeMode") || STATUS_DEFAULT_IDS.mode,
          LEGACY_STATUS_IDS.mode
        ),
        manualCurrent: resolveStateIdWithLegacy(
          config.manualCurrentStateId,
          manualCurrentStatusBase,
          LEGACY_STATUS_IDS.manualCurrent
        ),
        ampereCards: resolveStateIdWithLegacy(
          config.ampereCardsStateId,
          manualCurrentStatusBase,
          LEGACY_STATUS_IDS.ampereCards
        ),
        phaseCards: resolveStateIdWithLegacy(
          config.phaseCardsStateId,
          resolveMappedStatusId(write.phaseCards, ".control.gridManual.phaseMode", ".status.targetPhaseMode") ||
            STATUS_DEFAULT_IDS.phaseCards,
          LEGACY_STATUS_IDS.phaseCards
        ),
      };

      const read = {
        actualPhaseMode: resolveStateIdWithLegacy(
          undefined,
          resolveMappedStatusId(write.phaseCards, ".control.gridManual.phaseMode", ".status.actualPhaseMode") ||
            READ_DEFAULT_IDS.actualPhaseMode,
          LEGACY_READ_IDS.actualPhaseMode
        ),
        actualPhaseCount: resolveStateIdWithLegacy(
          config.phaseSwitchModeEnabledStateId,
          READ_DEFAULT_IDS.actualPhaseCount,
          LEGACY_READ_IDS.actualPhaseCount
        ),
        liveAmpere: resolveStateIdWithLegacy(config.ampereStateId, READ_DEFAULT_IDS.liveAmpere, LEGACY_READ_IDS.liveAmpere),
        car: resolveStateIdWithLegacy(config.carStateId, READ_DEFAULT_IDS.car, LEGACY_READ_IDS.car),
        batterySoc: resolveStateIdWithLegacy(config.batterySocStateId, READ_DEFAULT_IDS.batterySoc, LEGACY_READ_IDS.batterySoc),
        carRange: resolveOptionalStateId(config.carRangeStateId, READ_DEFAULT_IDS.carRange),
        chargePower: resolveStateIdWithLegacy(config.chargePowerStateId, READ_DEFAULT_IDS.chargePower, LEGACY_READ_IDS.chargePower),
        chargedEnergy: resolveStateIdWithLegacy(
          config.chargedEnergyStateId,
          READ_DEFAULT_IDS.chargedEnergy,
          LEGACY_READ_IDS.chargedEnergy
        ),
      };

      return { write, status, read, emergencyStop: emergencyStopStateId };
    },
    [
      config.ampereCardsStateId,
      config.ampereCardsWriteStateId,
      config.allowChargingStateId,
      config.ampereStateId,
      config.batterySocStateId,
      config.carStateId,
      config.gridStateId,
      config.chargePowerStateId,
      config.chargedEnergyStateId,
      config.emergencyStopStateId,
      config.gridAmpereStateId,
      config.gridWriteStateId,
      config.limit80StateId,
      config.modeStateId,
      config.manualCurrentStateId,
      config.manualCurrentWriteStateId,
      config.phaseSwitchModeEnabledStateId,
      config.phaseSwitchModeStateId,
      config.phaseCardsStateId,
      config.phaseCardsWriteStateId,
      config.pvPriorityStateId,
      config.pvPriorityWriteStateId,
      config.pvStateId,
      config.pvWriteStateId,
      config.stopStateId,
      config.stopWriteStateId,
      config.stopSecondaryWriteStateId,
      config.targetKmStateId,
      config.carRangeStateId,
    ]
  );
  const [pendingWrites, setPendingWrites] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [chargingPulseOn, setChargingPulseOn] = useState(true);
  const [powerBarTrackWidth, setPowerBarTrackWidth] = useState(0);
  const [tabletGlowCycle, setTabletGlowCycle] = useState(0);
  const barGlowAnim = useRef(new Animated.Value(0)).current;
  const tabletGlowSignalRef = useRef("");
  const autoStopMarkerRef = useRef("");
  const pendingConfirmationsRef = useRef<Record<string, PendingConfirmation>>({});
  const readValue = useCallback(
    (stateId: string) => {
      if (!stateId) {
        return undefined;
      }
      return states[stateId];
    },
    [states]
  );

  const modeWriteTypes = {
    stop: normalizeConfigValueType(config.stopWriteValueType, "boolean"),
    pv: normalizeConfigValueType(config.pvWriteValueType, "number"),
    pvPriority: normalizeConfigValueType(config.pvPriorityWriteValueType, "number"),
    grid: normalizeConfigValueType(config.gridWriteValueType, "number"),
  } as const;
  const modeWriteValues = {
    stop: config.stopWriteValue,
    pv: config.pvWriteValue,
    pvPriority: config.pvPriorityWriteValue,
    grid: config.gridWriteValue,
  } as const;
  const modeStateTypes = {
    stop: normalizeConfigValueType(config.stopStateValueType, "boolean"),
    pv: normalizeConfigValueType(config.pvStateValueType, "string"),
    pvPriority: normalizeConfigValueType(config.pvPriorityStateValueType, "string"),
    grid: normalizeConfigValueType(config.gridStateValueType, "string"),
  } as const;
  const modeStateValues = {
    stop: config.stopStateValue,
    pv: config.pvStateValue,
    pvPriority: config.pvPriorityStateValue,
    grid: config.gridStateValue,
  } as const;
  const manualCurrentWriteType = normalizeConfigValueType(config.manualCurrentWriteValueType, "number");
  const manualCurrentStateType = normalizeConfigValueType(config.manualCurrentStateValueType, "number");
  const ampereCardsWriteType = normalizeConfigValueType(config.ampereCardsWriteValueType, "number");
  const ampereCardsStateType = normalizeConfigValueType(config.ampereCardsStateValueType, "number");
  const ampereWriteValuesByPreset = {
    6: config.ampere6WriteValue,
    10: config.ampere10WriteValue,
    12: config.ampere12WriteValue,
    14: config.ampere14WriteValue,
    16: config.ampere16WriteValue,
  } as const;
  const ampereStateValuesByPreset = {
    6: config.ampere6StateValue,
    10: config.ampere10StateValue,
    12: config.ampere12StateValue,
    14: config.ampere14StateValue,
    16: config.ampere16StateValue,
  } as const;
  const phaseCardsWriteType = normalizeConfigValueType(config.phaseCardsWriteValueType, "number");
  const phaseCardsStateType = normalizeConfigValueType(config.phaseCardsStateValueType, "number");
  const phaseWriteValues = {
    1: config.phase1WriteValue,
    3: config.phase3WriteValue,
  } as const;
  const phaseStateValues = {
    1: config.phase1StateValue,
    3: config.phase3StateValue,
  } as const;
  const targetChargeValueType = normalizeConfigValueType(config.targetChargeValueType, "number");
  const stopDisabledWriteValue = resolveStopDisabledValue(modeWriteValues.stop, modeWriteTypes.stop);
  const stopDisabledStateValue = resolveStopDisabledValue(modeStateValues.stop, modeStateTypes.stop);

  const rawMode =
    readValue(stateIds.status.grid) ??
    readValue(stateIds.status.pvPriority) ??
    readValue(stateIds.status.pv) ??
    readValue(stateIds.write.grid);
  const chargingAllowed = !typedValuesEqual(readValue(stateIds.status.stop), stopDisabledStateValue, modeStateTypes.stop);
  const emergencyStopActive = normalizeBoolean(readValue(stateIds.emergencyStop)) === true;
  const modePendingDisplay: WallboxMode | null = pendingWrites["mode:grid:mode"] || pendingWrites["mode:grid:allowCharging"]
    ? "grid"
    : pendingWrites["mode:pvPriority:mode"] || pendingWrites["mode:pvPriority:allowCharging"]
      ? "pvPriority"
      : pendingWrites["mode:pv:mode"] || pendingWrites["mode:pv:allowCharging"]
        ? "pv"
        : null;
  const controlAllowRaw = readValue(stateIds.write.stop);
  const controlAllowConfigured =
    controlAllowRaw === null || controlAllowRaw === undefined
      ? null
      : !typedValuesEqual(controlAllowRaw, stopDisabledWriteValue, modeWriteTypes.stop);
  const externalManualOverride = modePendingDisplay === null && chargingAllowed && controlAllowConfigured === false;
  const mode = modePendingDisplay ?? (externalManualOverride ? "grid" : normalizeMode(rawMode) ?? "pv");
  const isGridMode = mode === "grid";
  const targetMode = config.targetMode === "km" ? "km" : "soc";
  const targetSocAutoApiStateId = useMemo(
    () => resolveOptionalStateId(config.targetSocAutoApiStateId, WRITE_DEFAULT_IDS.targetSocAutoApi),
    [config.targetSocAutoApiStateId]
  );

  const gridAmpere = clampAmpere(normalizeAmpere(readValue(stateIds.status.manualCurrent)) ?? DEFAULT_GRID_AMPERE);
  const targetSocPercent = normalizeTargetSocPercent(readValue(stateIds.write.targetSocPercent)) ?? DEFAULT_TARGET_SOC;
  const targetKmValue = normalizeTargetKm(readValue(stateIds.write.targetKm)) ?? DEFAULT_TARGET_KM;

  const phaseCardRaw = readValue(stateIds.status.phaseCards);
  const actualPhaseModeRaw = readValue(stateIds.read.actualPhaseMode);
  const actualPhaseRaw = actualPhaseModeRaw ?? readValue(stateIds.read.actualPhaseCount);
  const phaseCardSelection = resolvePhaseSelection(phaseCardRaw);
  const actualPhaseSelection = resolvePhaseSelection(actualPhaseRaw) ?? phaseCardSelection;
  const displayedPhaseSelection = (isGridMode ? phaseCardSelection : actualPhaseSelection) ?? actualPhaseSelection;

  const liveAmpere = normalizeFloat(readValue(stateIds.read.liveAmpere));
  const roundedLiveAmpere = liveAmpere === null ? null : Math.max(0, Math.round(liveAmpere));
  const displayAmpere = isGridMode ? gridAmpere : roundedLiveAmpere ?? gridAmpere;

  const carCode = normalizeInteger(readValue(stateIds.read.car));
  const batterySoc = normalizeFloat(readValue(stateIds.read.batterySoc));
  const carRangeKm = normalizeFloat(readValue(stateIds.read.carRange));
  const chargedEnergyKWh = normalizeEnergyToKWh(readValue(stateIds.read.chargedEnergy));
  const directChargingPowerW = normalizePowerToWatts(readValue(stateIds.read.chargePower));
  const estimatedChargingPowerW = estimateChargingPowerW(liveAmpere, actualPhaseSelection);
  const chargingPowerW = directChargingPowerW ?? estimatedChargingPowerW;
  const liveCharging =
    carCode === 2 ||
    (carCode === null && typeof liveAmpere === "number" && liveAmpere > 0.25) ||
    chargingPowerW >= CHARGING_ACTIVE_THRESHOLD_W;
  const chargeCompleted = carCode === 4 && !liveCharging;

  const writePending = Object.values(pendingWrites).some(Boolean);
  const emergencyTogglePendingOn = pendingWrites["emergencyStop:on"] === true;
  const emergencyTogglePendingOff = pendingWrites["emergencyStop:off"] === true;
  const emergencyStopDisplay = emergencyTogglePendingOn ? true : emergencyTogglePendingOff ? false : emergencyStopActive;
  const activeTargetValue = targetMode === "km" ? targetKmValue : targetSocPercent;
  const activeTargetUnit = targetMode === "km" ? "km" : "%";
  const chargePowerCardMode: "idle" | "slow" | "fast" =
    chargingPowerW < CHARGING_ACTIVE_THRESHOLD_W
      ? "idle"
      : chargingPowerW < FAST_CHARGING_THRESHOLD_W
        ? "slow"
        : "fast";

  useEffect(() => {
    if (!runtimeActive || !liveCharging || Platform.OS === "web") {
      setChargingPulseOn(true);
      return;
    }
    const timer = setInterval(() => {
      setChargingPulseOn((current) => !current);
    }, CHARGING_INDICATOR_BLINK_MS);
    return () => clearInterval(timer);
  }, [liveCharging, runtimeActive]);

  useEffect(() => {
    barGlowAnim.setValue(0);
    if (!runtimeActive || Platform.OS === "web") {
      return;
    }
    const glowLoop = Animated.loop(
      Animated.timing(barGlowAnim, {
        toValue: 1,
        duration: CHARGING_BAR_GLOW_CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    glowLoop.start();
    return () => {
      glowLoop.stop();
    };
  }, [barGlowAnim, runtimeActive]);

  const titleText = (config.title || "Wallbox").trim() || "Wallbox";
  const subtitleText = useMemo(
    () =>
      buildStatusSubtitle({
        mode,
        carCode,
        liveAmpere,
        targetMode,
        targetValue: activeTargetValue,
      }),
    [activeTargetValue, carCode, liveAmpere, mode, targetMode]
  );

  const textColor = config.appearance?.textColor || "#f5f8ff";
  const mutedTextColor = config.appearance?.mutedTextColor || "rgba(214, 224, 244, 0.75)";
  const cardStart = config.appearance?.widgetColor || "rgba(20, 30, 44, 0.96)";
  const cardEnd = config.appearance?.widgetColor2 || "rgba(12, 18, 30, 0.98)";
  const pvStart = config.appearance?.activeWidgetColor || "#3bbd83";
  const pvEnd = config.appearance?.activeWidgetColor2 || "#2f976c";
  const pvPriorityStart = config.appearance?.inactiveWidgetColor || "#f5bd6c";
  const pvPriorityEnd = config.appearance?.inactiveWidgetColor2 || "#e69b56";
  const gridStart = config.appearance?.statColor || "#5f9eff";
  const gridEnd = config.appearance?.statColor2 || "#4578e6";
  const highlightOpacity = clampOpacity(config.highlightOpacity, 0.32);
  const targetActiveStart = withAlpha(pvPriorityStart, highlightOpacity);
  const targetActiveEnd = withAlpha(pvPriorityEnd, highlightOpacity);
  const controlActiveStart = withAlpha(gridStart, highlightOpacity);
  const controlActiveEnd = withAlpha(gridEnd, highlightOpacity);
  const panelBorderColor = "rgba(191, 209, 245, 0.18)";
  const modePanelBackground = "rgba(255,255,255,0.025)";
  const disabledOpacity = 0.5;
  const backgroundBlur = lowPowerMode ? 0 : Math.min(24, clampInt(config.backgroundImageBlur, 8, 0));

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      return;
    }
    const styleId = "smarthome-v2-wallbox-v2-glow";
    if (document.getElementById(styleId)) {
      return;
    }
    const styleElement = document.createElement("style");
    styleElement.id = styleId;
    styleElement.textContent = `
      @keyframes smarthomeV2WallboxGlow {
        from { transform: translate3d(-100%, 0, 0); }
        to { transform: translate3d(520%, 0, 0); }
      }
    `;
    document.head.appendChild(styleElement);
  }, []);

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

  const clearPending = useCallback((pendingKey: string) => {
    setPendingWrites((current) => ({ ...current, [pendingKey]: false }));
  }, []);

  const writeStateWithConfirmation = useCallback(
    async ({
      writeStateId,
      value,
      pendingKey,
      confirmStateId,
      confirmKey,
      matcher,
    }: {
      writeStateId: string;
      value: unknown;
      pendingKey: string;
      confirmStateId?: string;
      confirmKey: string;
      matcher?: (value: unknown) => boolean;
    }) => {
      if (!writeStateId) {
        return;
      }

      const hasConfirmation = Boolean(confirmStateId && matcher);
      setPendingWrites((current) => ({ ...current, [pendingKey]: true }));
      setError(null);

      if (hasConfirmation) {
        const confirmationId = `${pendingKey}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
        pendingConfirmationsRef.current[confirmationId] = {
          pendingKey,
          watchStateId: confirmStateId || "",
          confirmKey,
          matcher: matcher || (() => false),
          timeoutAt: Date.now() + CONFIRMATION_TIMEOUT_MS,
        };
      }

      try {
        await client.writeState(writeStateId, value);
      } catch (writeError) {
        setError(writeError instanceof Error ? writeError.message : "State konnte nicht geschrieben werden");
        clearPending(pendingKey);
        return;
      }

      if (!hasConfirmation) {
        playConfirmSound(confirmKey);
        clearPending(pendingKey);
      }
    },
    [clearPending, client, playConfirmSound]
  );

  useEffect(() => {
    const entries = Object.entries(pendingConfirmationsRef.current);
    if (!entries.length) {
      return;
    }

    const now = Date.now();
    const resolved: PendingConfirmation[] = [];
    const expired: PendingConfirmation[] = [];

    entries.forEach(([confirmationId, confirmation]) => {
      const currentValue = states[confirmation.watchStateId];
      if (confirmation.matcher(currentValue)) {
        resolved.push(confirmation);
        delete pendingConfirmationsRef.current[confirmationId];
        return;
      }
      if (now >= confirmation.timeoutAt) {
        expired.push(confirmation);
        delete pendingConfirmationsRef.current[confirmationId];
      }
    });

    if (!resolved.length && !expired.length) {
      return;
    }

    setPendingWrites((current) => {
      const next = { ...current };
      resolved.forEach((entry) => {
        next[entry.pendingKey] = false;
      });
      expired.forEach((entry) => {
        next[entry.pendingKey] = false;
      });
      return next;
    });

    resolved.forEach((entry) => {
      playConfirmSound(entry.confirmKey);
    });

    if (expired.length) {
      setError("Bestaetigung aus Status blieb aus");
    }
  }, [playConfirmSound, states]);

  useEffect(() => {
    if (!runtimeActive) {
      return;
    }
    const timer = setInterval(() => {
      const now = Date.now();
      const expired: PendingConfirmation[] = [];
      Object.entries(pendingConfirmationsRef.current).forEach(([confirmationId, confirmation]) => {
        if (now < confirmation.timeoutAt) {
          return;
        }
        expired.push(confirmation);
        delete pendingConfirmationsRef.current[confirmationId];
      });
      if (!expired.length) {
        return;
      }
      setPendingWrites((current) => {
        const next = { ...current };
        expired.forEach((entry) => {
          next[entry.pendingKey] = false;
        });
        return next;
      });
      setError("Bestaetigung aus Status blieb aus");
    }, 500);

    return () => {
      clearInterval(timer);
    };
  }, [runtimeActive]);

  const setMode = useCallback(
    (nextMode: WallboxMode) => {
      if (nextMode === mode) {
        return;
      }
      playPressSound(`mode:${nextMode}`);
      void (async () => {
        const stopEnabledWriteValue = deriveOppositeTypedValue(stopDisabledWriteValue, modeWriteTypes.stop);
        const stopEnabledExpectedValue = deriveOppositeTypedValue(stopDisabledStateValue, modeStateTypes.stop);
        if (nextMode === "stop") {
          await writeStateWithConfirmation({
            writeStateId: stateIds.write.stop,
            value: stopDisabledWriteValue,
            pendingKey: "mode:stop:allowCharging",
            confirmStateId: stateIds.status.stop,
            confirmKey: "mode:stop:allowCharging",
            matcher: (value) => typedValuesEqual(value, stopDisabledStateValue, modeStateTypes.stop),
          });
          return;
        }

        await writeStateWithConfirmation({
          writeStateId: stateIds.write.stop,
          value: stopEnabledWriteValue,
          pendingKey: `mode:${nextMode}:allowCharging`,
          confirmStateId: stateIds.status.stop,
          confirmKey: `mode:${nextMode}:allowCharging`,
          matcher: (value) => typedValuesEqual(value, stopEnabledExpectedValue, modeStateTypes.stop),
        });

        const modeKey = nextMode === "pv" ? "pv" : nextMode === "pvPriority" ? "pvPriority" : "grid";
        const writeStateId =
          modeKey === "pv" ? stateIds.write.pv : modeKey === "pvPriority" ? stateIds.write.pvPriority : stateIds.write.grid;
        const statusStateId =
          modeKey === "pv" ? stateIds.status.pv : modeKey === "pvPriority" ? stateIds.status.pvPriority : stateIds.status.grid;
        const fallbackModeValue = resolveModeWriteValue(readValue(writeStateId) ?? rawMode, nextMode);
        const modeValue = parseConfiguredValue(modeWriteValues[modeKey], modeWriteTypes[modeKey], fallbackModeValue);
        if (modeValue !== null && modeValue !== undefined) {
          const expectedModeValue = parseConfiguredValue(modeStateValues[modeKey], modeStateTypes[modeKey], nextMode);
          await writeStateWithConfirmation({
            writeStateId,
            value: modeValue,
            pendingKey: `mode:${nextMode}:mode`,
            confirmStateId: statusStateId,
            confirmKey: `mode:${nextMode}`,
            matcher: (value) =>
              hasConfiguredValue(modeStateValues[modeKey])
                ? typedValuesEqual(value, expectedModeValue, modeStateTypes[modeKey])
                : normalizeMode(value) === nextMode,
          });
        }
      })();
    },
    [
      mode,
      modeStateTypes.grid,
      modeStateTypes.pv,
      modeStateTypes.pvPriority,
      modeStateTypes.stop,
      modeStateValues.grid,
      modeStateValues.pv,
      modeStateValues.pvPriority,
      modeStateValues.stop,
      modeWriteTypes.grid,
      modeWriteTypes.pv,
      modeWriteTypes.pvPriority,
      modeWriteTypes.stop,
      modeWriteValues.grid,
      modeWriteValues.pv,
      modeWriteValues.pvPriority,
      modeWriteValues.stop,
      playPressSound,
      rawMode,
      readValue,
      stateIds.status,
      stateIds.write,
      stopDisabledStateValue,
      stopDisabledWriteValue,
      writeStateWithConfirmation,
    ]
  );

  const setEmergencyStop = useCallback(
    (nextActive: boolean) => {
      if (!stateIds.emergencyStop) {
        return;
      }
      const pendingKey = `emergencyStop:${nextActive ? "on" : "off"}`;
      if (pendingWrites[pendingKey]) {
        return;
      }
      playPressSound(`emergencyStop:${nextActive ? "on" : "off"}`);
      void writeStateWithConfirmation({
        writeStateId: stateIds.emergencyStop,
        value: nextActive,
        pendingKey,
        confirmStateId: stateIds.emergencyStop,
        confirmKey: `emergencyStop:${nextActive ? "on" : "off"}`,
        matcher: (value) => normalizeBoolean(value) === nextActive,
      });
    },
    [pendingWrites, playPressSound, stateIds.emergencyStop, writeStateWithConfirmation]
  );

  const setGridAmpere = useCallback(
    (nextAmpere: number) => {
      if (!isGridMode || !stateIds.write.ampereCards) {
        return;
      }
      const clamped = clampAmpere(nextAmpere);
      if (clamped === gridAmpere) {
        return;
      }
      playPressSound(`gridAmpere:${clamped}`);
      const presetKey = clamped as (typeof AMPERE_PRESET_VALUES)[number];
      const ampereWriteValue = parseConfiguredValue(
        ampereWriteValuesByPreset[presetKey],
        ampereCardsWriteType,
        clamped
      );
      const ampereExpectedValue = parseConfiguredValue(
        ampereStateValuesByPreset[presetKey],
        ampereCardsStateType,
        clamped
      );
      void writeStateWithConfirmation({
        writeStateId: stateIds.write.ampereCards,
        value: ampereWriteValue,
        pendingKey: `ampere:${clamped}`,
        confirmStateId: stateIds.status.ampereCards,
        confirmKey: `gridAmpere:${clamped}`,
        matcher: (value) =>
          hasConfiguredValue(ampereStateValuesByPreset[presetKey])
            ? typedValuesEqual(value, ampereExpectedValue, ampereCardsStateType)
            : normalizeAmpere(value) === clamped,
      });
      if (stateIds.write.manualCurrent && stateIds.write.manualCurrent !== stateIds.write.ampereCards) {
        const manualCurrentWrite = castValueToType(clamped, manualCurrentWriteType);
        const manualCurrentExpected = castValueToType(clamped, manualCurrentStateType);
        void writeStateWithConfirmation({
          writeStateId: stateIds.write.manualCurrent,
          value: manualCurrentWrite,
          pendingKey: `manualCurrent:${clamped}`,
          confirmStateId: stateIds.status.manualCurrent,
          confirmKey: `manualCurrent:${clamped}`,
          matcher: (value) => typedValuesEqual(value, manualCurrentExpected, manualCurrentStateType),
        });
      }
    },
    [
      ampereCardsStateType,
      ampereCardsWriteType,
      ampereStateValuesByPreset,
      ampereWriteValuesByPreset,
      gridAmpere,
      isGridMode,
      manualCurrentStateType,
      manualCurrentWriteType,
      playPressSound,
      stateIds.status.ampereCards,
      stateIds.status.manualCurrent,
      stateIds.write.ampereCards,
      stateIds.write.manualCurrent,
      writeStateWithConfirmation,
    ]
  );

  const setGridPhase = useCallback(
    (nextPhase: 1 | 3) => {
      if (!isGridMode || !stateIds.write.phaseCards) {
        return;
      }
      if (phaseCardSelection === nextPhase) {
        return;
      }
      const fallbackWriteValue = resolvePhaseWriteValue(readValue(stateIds.write.phaseCards), nextPhase);
      const writeValue = parseConfiguredValue(phaseWriteValues[nextPhase], phaseCardsWriteType, fallbackWriteValue);
      const expectedStateValue = parseConfiguredValue(phaseStateValues[nextPhase], phaseCardsStateType, nextPhase);
      playPressSound(`gridPhase:${nextPhase}`);
      void writeStateWithConfirmation({
        writeStateId: stateIds.write.phaseCards,
        value: writeValue,
        pendingKey: `phase:${nextPhase}`,
        confirmStateId: stateIds.status.phaseCards,
        confirmKey: `gridPhase:${nextPhase}`,
        matcher: (value) =>
          hasConfiguredValue(phaseStateValues[nextPhase])
            ? typedValuesEqual(value, expectedStateValue, phaseCardsStateType)
            : resolvePhaseSelection(value) === nextPhase,
      });
    },
    [
      isGridMode,
      phaseCardSelection,
      phaseCardsStateType,
      phaseCardsWriteType,
      phaseStateValues,
      phaseWriteValues,
      playPressSound,
      readValue,
      stateIds.status.phaseCards,
      stateIds.write.phaseCards,
      writeStateWithConfirmation,
    ]
  );

  const setTargetSoc = useCallback(
    (nextSoc: number) => {
      const normalized = normalizeTargetSocPercent(nextSoc) ?? DEFAULT_TARGET_SOC;
      const hasPrimaryTarget = Boolean(stateIds.write.targetSocPercent);
      const hasAutoApiTarget = Boolean(targetSocAutoApiStateId);
      const sameAsDisplayed = normalized === targetSocPercent;
      const needsPrimaryWrite = hasPrimaryTarget && !sameAsDisplayed;
      const needsAutoApiWrite =
        hasAutoApiTarget &&
        targetSocAutoApiStateId !== stateIds.write.targetSocPercent &&
        (!sameAsDisplayed || !hasPrimaryTarget);

      if (!needsPrimaryWrite && !needsAutoApiWrite) {
        return;
      }
      playPressSound(`targetSoc:${normalized}`);
      if (needsPrimaryWrite && stateIds.write.targetSocPercent) {
        const writeValue = castValueToType(normalized, targetChargeValueType);
        void writeStateWithConfirmation({
          writeStateId: stateIds.write.targetSocPercent,
          value: writeValue,
          pendingKey: `targetSoc:${normalized}`,
          confirmStateId: stateIds.write.targetSocPercent,
          confirmKey: `targetSoc:${normalized}`,
          matcher: (value) => typedValuesEqual(value, writeValue, targetChargeValueType),
        });
      }
      if (needsAutoApiWrite && targetSocAutoApiStateId) {
        void client.writeState(targetSocAutoApiStateId, normalized);
      }
    },
    [
      client,
      playPressSound,
      stateIds.write.targetSocPercent,
      targetChargeValueType,
      targetSocAutoApiStateId,
      targetSocPercent,
      writeStateWithConfirmation,
    ]
  );

  const setTargetKm = useCallback(
    (nextKm: number) => {
      if (!stateIds.write.targetKm) {
        return;
      }
      const normalized = normalizeTargetKm(nextKm) ?? DEFAULT_TARGET_KM;
      if (normalized === targetKmValue) {
        return;
      }
      playPressSound(`targetKm:${normalized}`);
      void writeStateWithConfirmation({
        writeStateId: stateIds.write.targetKm,
        value: normalized,
        pendingKey: `targetKm:${normalized}`,
        confirmStateId: stateIds.write.targetKm,
        confirmKey: `targetKm:${normalized}`,
        matcher: (value) => normalizeTargetKm(value) === normalized,
      });
    },
    [playPressSound, stateIds.write.targetKm, targetKmValue, writeStateWithConfirmation]
  );

  const setTargetValue = useCallback(
    (value: number) => {
      if (targetMode === "km") {
        setTargetKm(value);
        return;
      }
      setTargetSoc(value);
    },
    [setTargetKm, setTargetSoc, targetMode]
  );

  useEffect(() => {
    if (!stateIds.write.stop || chargingAllowed !== true) {
      autoStopMarkerRef.current = "";
      return;
    }
    const liveValue = targetMode === "km" ? carRangeKm : batterySoc;
    if (liveValue === null) {
      autoStopMarkerRef.current = "";
      return;
    }
    const targetValue = targetMode === "km" ? targetKmValue : targetSocPercent;
    if (liveValue + 0.01 < targetValue) {
      autoStopMarkerRef.current = "";
      return;
    }

    const marker = `${targetMode}:${Math.round(targetValue)}:${Math.round(liveValue * 10) / 10}`;
    if (autoStopMarkerRef.current === marker) {
      return;
    }
    autoStopMarkerRef.current = marker;
    const stopReason = targetMode === "km" ? "kmLimitReached" : "socLimitReached";
    void writeStateWithConfirmation({
      writeStateId: stateIds.write.stop,
      value: stopDisabledWriteValue,
      pendingKey: `${stopReason}:${Math.round(targetValue)}`,
      confirmStateId: stateIds.status.stop,
      confirmKey: `${stopReason}:${Math.round(targetValue)}`,
      matcher: (value) => typedValuesEqual(value, stopDisabledStateValue, modeStateTypes.stop),
    });
  }, [
    chargingAllowed,
    batterySoc,
    carRangeKm,
    modeStateTypes.stop,
    modeWriteTypes.stop,
    stateIds.status.stop,
    stateIds.write.stop,
    stopDisabledStateValue,
    stopDisabledWriteValue,
    targetKmValue,
    targetMode,
    targetSocPercent,
    writeStateWithConfirmation,
  ]);

  const chargingStatusText = emergencyStopDisplay
    ? "Emergency Stop aktiv"
    : liveCharging
      ? `Laden mit ${formatPowerKW(chargingPowerW)}`
      : chargeCompleted
        ? "Ladevorgang abgeschlossen"
        : "Kein aktiver Ladevorgang";
  const chargingIndicatorColor = emergencyStopDisplay
    ? "#ef5d6b"
    : liveCharging
      ? chargingPulseOn
        ? "#f8c24b"
        : "rgba(248, 194, 75, 0.28)"
      : chargeCompleted
        ? "#35d19a"
        : "rgba(197, 209, 231, 0.35)";
  const chargePowerCardAccent =
    chargePowerCardMode === "fast"
      ? "rgba(59, 203, 141, 0.95)"
      : chargePowerCardMode === "slow"
        ? "rgba(245, 198, 104, 0.96)"
        : "rgba(238, 97, 111, 0.92)";
  const chargePowerCardBackground =
    chargePowerCardMode === "idle"
      ? "rgba(224, 83, 96, 0.08)"
      : chargingPulseOn
        ? chargePowerCardMode === "fast"
          ? "rgba(53, 198, 137, 0.22)"
          : "rgba(245, 198, 104, 0.2)"
        : chargePowerCardMode === "fast"
          ? "rgba(53, 198, 137, 0.12)"
          : "rgba(245, 198, 104, 0.1)";
  const footerStatusText = error ? error : writePending ? "Synchronisiere..." : "";
  const normalizedChargingPowerW = Math.max(0, Math.min(CHARGING_BAR_MAX_POWER_W, chargingPowerW));
  const chargingPowerRatio = normalizedChargingPowerW / CHARGING_BAR_MAX_POWER_W;
  const chargingPowerPercent = chargingPowerRatio * 100;
  const chargingPowerFillWidth = `${Number(chargingPowerPercent.toFixed(2))}%` as `${number}%`;
  const webPowerBarGradientWidth = powerBarTrackWidth > 0 ? powerBarTrackWidth : "100%";
  const barFillWidthPx = powerBarTrackWidth * chargingPowerRatio;
  const barGlowWidthPx = Math.max(32, Math.min(74, barFillWidthPx * 0.42));
  const barGlowTranslateX = barGlowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-barGlowWidthPx, Math.max(0, barFillWidthPx)],
  });
  const nativeBarColor = chargingPowerRatio < 0.45 ? "#ef5d6b" : chargingPowerRatio < 0.75 ? "#f0c35f" : "#42cf8c";
  const tabletGlowSignal =
    runtimeActive && chargingPowerRatio > 0.01
      ? `${liveCharging ? "charging" : "power"}:${Math.round(normalizedChargingPowerW / TABLET_GLOW_POWER_BUCKET_W)}`
      : "idle";

  useEffect(() => {
    if (Platform.OS !== "web" || !lowPowerMode) {
      tabletGlowSignalRef.current = "";
      setTabletGlowCycle(0);
      return;
    }
    if (tabletGlowSignal === tabletGlowSignalRef.current) {
      return;
    }

    tabletGlowSignalRef.current = tabletGlowSignal;
    if (tabletGlowSignal !== "idle") {
      setTabletGlowCycle((current) => current + 1);
    }
  }, [lowPowerMode, tabletGlowSignal]);

  const phaseStatusLabel =
    displayedPhaseSelection === 1 ? "1-phasig" : displayedPhaseSelection === 3 ? "3-phasig" : "-";
  const activeAmperePreset = useMemo(
    () =>
      AMPERE_PRESET_VALUES.reduce((closest, value) =>
        Math.abs(value - displayAmpere) < Math.abs(closest - displayAmpere) ? value : closest
      ),
    [displayAmpere]
  );
  const targetValues = targetMode === "km" ? TARGET_KM_VALUES : TARGET_SOC_VALUES;
  const targetMin = targetValues[0];
  const targetMax = targetValues[targetValues.length - 1];
  const targetStep = targetMode === "km" ? 50 : 10;
  const targetLabel = targetMode === "km" ? "Ziel-km" : "Ziel-SoC";
  const contentScale = useMemo(
    () =>
      computeBoundedContentScale(
        widgetWidth,
        widgetHeight,
        WALLBOX_BASE_CONTENT_WIDTH,
        WALLBOX_BASE_CONTENT_HEIGHT,
        WALLBOX_MIN_CONTENT_SCALE
      ),
    [widgetHeight, widgetWidth]
  );

  const modeItems: Array<{
    mode: WallboxMode;
    label: string;
    start: string;
    end: string;
  }> = [
    { mode: "pv", label: "PV", start: pvStart, end: pvEnd },
    { mode: "pvPriority", label: "PV (go-e priority)", start: pvPriorityStart, end: pvPriorityEnd },
    { mode: "grid", label: "Netz", start: gridStart, end: gridEnd },
  ];

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
              <View style={styles.widgetBackgroundOverlay} />
            </>
          ) : (
            <ImageBackground
              blurRadius={backgroundBlur}
              imageStyle={styles.widgetBackgroundImage}
              source={{ uri: `/smarthome-dashboard-v2/widget-assets/${encodeURIComponent(config.backgroundImage)}` }}
              style={styles.widgetBackground}
            >
              <View style={styles.widgetBackgroundOverlay} />
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
              {titleText}
            </Text>
          ) : null}
          </View>

          <View style={[styles.allowChargingRow, { borderColor: panelBorderColor, backgroundColor: modePanelBackground }]}>
          <Text numberOfLines={1} style={[styles.allowChargingLabel, { color: mutedTextColor }]}>
            Emergency Stop (global)
          </Text>
          <Switch
            disabled={!stateIds.emergencyStop}
            onValueChange={setEmergencyStop}
            trackColor={{ false: "rgba(145, 164, 196, 0.34)", true: "rgba(239, 93, 107, 0.55)" }}
            value={emergencyStopDisplay}
          />
          </View>

          <View style={[styles.chargeStatusStrip, { borderColor: panelBorderColor, backgroundColor: modePanelBackground }]}>
          <View style={[styles.chargeStatusDot, { backgroundColor: chargingIndicatorColor }]} />
          <Text numberOfLines={1} style={[styles.chargeStatusText, { color: textColor }]}>
            {chargingStatusText}
          </Text>
          </View>

          <View style={styles.block}>
          <Text style={[styles.blockLabel, { color: mutedTextColor }]}>Betriebsart</Text>
          <View style={[styles.segmentShell, { backgroundColor: modePanelBackground, borderColor: panelBorderColor }]}>
            {modeItems.map((item) => {
              const active = mode === item.mode;
              const compactLabel = item.mode === "pvPriority";
              return (
                <Pressable
                  key={`mode-${item.mode}`}
                  onPress={() => setMode(item.mode)}
                  style={({ pressed }) => [
                    styles.segmentButton,
                    active ? styles.segmentButtonActive : null,
                    pressed ? styles.pressScale : null,
                  ]}
                >
                  {active
                    ? Platform.OS === "web"
                      ? createElement("div", {
                          style: {
                            ...webGradientLayerStyle,
                            borderRadius: 10,
                            background: `linear-gradient(135deg, ${withAlpha(item.start, highlightOpacity)}, ${withAlpha(
                              item.end,
                              highlightOpacity
                            )})`,
                          },
                        })
                      : (
                          <View
                            style={[
                              StyleSheet.absoluteFillObject,
                              { backgroundColor: withAlpha(item.start, highlightOpacity), borderRadius: 10 },
                            ]}
                          />
                        )
                    : null}
                  <Text
                    style={[
                      styles.segmentLabel,
                      compactLabel ? { fontSize: 11.5, lineHeight: 13, textAlign: "center", paddingHorizontal: 2 } : null,
                      { color: textColor },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          </View>

          <View style={styles.block}>
          <View style={styles.blockHeaderInline}>
            <Text style={[styles.blockLabel, { color: mutedTextColor }]}>{targetLabel}</Text>
            <Text style={[styles.quickControlValue, { color: textColor }]}>{`${activeTargetValue} ${activeTargetUnit}`}</Text>
          </View>
          <View
            style={[
              styles.targetSliderPanel,
              {
                borderColor: panelBorderColor,
                backgroundColor: modePanelBackground,
              },
            ]}
          >
            {Platform.OS === "web" ? (
              createElement("input", {
                type: "range",
                min: targetMin,
                max: targetMax,
                step: targetStep,
                value: activeTargetValue,
                onChange: (event: { target: { value: string } }) => setTargetValue(Number(event.target.value)),
                style: {
                  ...webSliderStyle,
                  accentColor: withAlpha(gridStart, Math.max(0.42, highlightOpacity + 0.24)),
                },
              })
            ) : (
              <View style={styles.nativeTickRow}>
                {targetValues.map((value) => {
                  const active = value <= activeTargetValue;
                  return (
                    <Pressable
                      key={`target-slider-${value}`}
                      onPress={() => setTargetValue(value)}
                      style={styles.nativeTickButton}
                    >
                      <View
                        style={[
                          styles.nativeTickBar,
                          {
                            backgroundColor: active ? withAlpha(gridStart, Math.max(0.35, highlightOpacity)) : "rgba(255,255,255,0.14)",
                          },
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </View>
            )}
            <View style={styles.targetScaleRow}>
              <Text style={[styles.targetScaleLabel, { color: mutedTextColor }]}>
                {`${targetMin}${targetMode === "km" ? " km" : "%"}`}
              </Text>
              <Text style={[styles.targetScaleLabel, { color: mutedTextColor }]}>
                {`${targetMax}${targetMode === "km" ? " km" : "%"}`}
              </Text>
            </View>
          </View>
          </View>

          <View
          style={[
            styles.quickControlPanel,
            { borderColor: panelBorderColor, backgroundColor: modePanelBackground },
            !isGridMode ? { opacity: disabledOpacity } : null,
          ]}
        >
          <View style={styles.quickControlHeader}>
            <Text numberOfLines={1} style={[styles.quickControlLabel, { color: mutedTextColor }]}>
              Wallbox-Strom {isGridMode ? "(Manuell)" : "(Ist)"}
            </Text>
            <Text numberOfLines={1} style={[styles.quickControlValue, { color: textColor }]}>
              {`${displayAmpere} A | ${phaseStatusLabel}`}
            </Text>
          </View>

          <View style={styles.quickControlGroup}>
            <Text numberOfLines={1} style={[styles.quickControlLabel, { color: mutedTextColor }]}>Ampere</Text>
            <View style={styles.quickButtonRow}>
              {AMPERE_PRESET_VALUES.map((value) => {
                const active = activeAmperePreset === value;
                return (
                  <Pressable
                    key={`amp-preset-${value}`}
                    disabled={!isGridMode}
                    onPress={() => setGridAmpere(value)}
                    style={({ pressed }) => [
                      styles.quickSelectButton,
                      active ? styles.quickSelectButtonActive : null,
                      !isGridMode ? styles.quickSelectButtonDisabled : null,
                      pressed ? styles.pressScale : null,
                    ]}
                  >
                    {active
                      ? Platform.OS === "web"
                        ? createElement("div", {
                            style: {
                              ...webGradientLayerStyle,
                              borderRadius: 10,
                              background: `linear-gradient(135deg, ${controlActiveStart}, ${controlActiveEnd})`,
                            },
                          })
                        : (
                            <View
                              style={[
                                StyleSheet.absoluteFillObject,
                                { borderRadius: 10, backgroundColor: controlActiveStart },
                              ]}
                            />
                          )
                      : null}
                    <Text style={[styles.quickSelectLabel, { color: textColor }]}>{value} A</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.quickControlGroup}>
            <Text numberOfLines={1} style={[styles.quickControlLabel, { color: mutedTextColor }]}>Phasen</Text>
            <View style={styles.quickButtonRow}>
              {(
                [
                  { value: 1 as const, label: "1-phasig" },
                  { value: 3 as const, label: "3-phasig" },
                ] as const
              ).map((item) => {
                const active = displayedPhaseSelection === item.value;
                return (
                  <Pressable
                    key={`phase-${item.value}`}
                    disabled={!isGridMode}
                    onPress={() => setGridPhase(item.value)}
                    style={({ pressed }) => [
                      styles.quickSelectButton,
                      styles.quickSelectButtonWide,
                      active ? styles.quickSelectButtonActive : null,
                      !isGridMode ? styles.quickSelectButtonDisabled : null,
                      pressed ? styles.pressScale : null,
                    ]}
                  >
                    {active
                      ? Platform.OS === "web"
                        ? createElement("div", {
                            style: {
                              ...webGradientLayerStyle,
                              borderRadius: 10,
                              background: `linear-gradient(135deg, ${controlActiveStart}, ${controlActiveEnd})`,
                            },
                          })
                        : (
                            <View
                              style={[
                                StyleSheet.absoluteFillObject,
                                { borderRadius: 10, backgroundColor: controlActiveStart },
                              ]}
                            />
                          )
                      : null}
                    <Text style={[styles.quickSelectLabel, { color: textColor }]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Text numberOfLines={1} style={[styles.quickControlHint, { color: mutedTextColor }]}>
            {externalManualOverride
              ? "Externe App steuert manuell (Ist-Werte)"
              : isGridMode
                ? "Manuell steuerbar"
                : "Automatik aktiv (Ist-Werte)"}
          </Text>
          </View>

          {config.showStatusSubtitle === true ? (
            <Text numberOfLines={2} style={[styles.subtitleBottom, { color: mutedTextColor }]}>
              {subtitleText}
            </Text>
          ) : null}

          <View style={styles.metricsRow}>
          <View
            style={[
              styles.metricCard,
              styles.metricCardPower,
              {
                borderColor: chargePowerCardAccent,
                backgroundColor: chargePowerCardBackground,
              },
            ]}
          >
            <Text numberOfLines={1} style={[styles.metricLabel, { color: mutedTextColor }]}>Ladeleistung</Text>
            <Text numberOfLines={1} style={[styles.metricValue, { color: textColor }]}>
              {formatPowerKW(chargingPowerW)}
            </Text>
          </View>
          <View style={[styles.metricCard, { borderColor: panelBorderColor, backgroundColor: modePanelBackground }]}>
            <Text numberOfLines={1} style={[styles.metricLabel, { color: mutedTextColor }]}>Gesamt (Session)</Text>
            <Text numberOfLines={1} style={[styles.metricValue, { color: textColor }]}>
              {formatEnergyKWh(chargedEnergyKWh)}
            </Text>
          </View>
          <View style={[styles.metricCard, { borderColor: panelBorderColor, backgroundColor: modePanelBackground }]}>
            <Text numberOfLines={1} style={[styles.metricLabel, { color: mutedTextColor }]}>Auto Akku</Text>
            <Text numberOfLines={1} style={[styles.metricValue, { color: textColor }]}>
              {formatPercent(batterySoc)}
            </Text>
          </View>
          </View>

          <View style={styles.powerBarBlock}>
          <View style={styles.powerBarHeader}>
            <Text numberOfLines={1} style={[styles.powerBarLabel, { color: mutedTextColor }]}>Ladeleistung 0-11 kW</Text>
            <Text numberOfLines={1} style={[styles.powerBarValue, { color: textColor }]}>
              {formatPowerKW(chargingPowerW)}
            </Text>
          </View>
          <View style={styles.gaugeFace}>
            {Platform.OS === "web" ? (
              buildPowerGaugeSvg(chargingPowerW / 1000, chargePowerCardAccent, config.id)
            ) : (
              <View style={styles.gaugeNativeFallback}>
                <Text numberOfLines={1} style={[styles.gaugeNativeValue, { color: textColor }]}>
                  {formatPowerKW(chargingPowerW)}
                </Text>
                <View
                  onLayout={(event) => {
                    const nextWidth = Math.max(0, Math.round(event.nativeEvent.layout.width));
                    setPowerBarTrackWidth((current) => (current === nextWidth ? current : nextWidth));
                  }}
                  style={styles.powerBarTrack}
                >
                  <View
                    style={[
                      styles.powerBarFillClip,
                      { width: chargingPowerFillWidth, backgroundColor: nativeBarColor },
                    ]}
                  />
                </View>
                <View style={styles.powerBarScaleRow}>
                  <Text style={[styles.powerBarScaleLabel, { color: mutedTextColor }]}>0 kW</Text>
                  <Text style={[styles.powerBarScaleLabel, { color: mutedTextColor }]}>11 kW</Text>
                </View>
              </View>
            )}
          </View>
          </View>

          {footerStatusText ? (
            <Text
              numberOfLines={1}
              style={[
                styles.footer,
                {
                  color: error ? palette.danger : mutedTextColor,
                },
              ]}
            >
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

function resolveStateIdWithLegacy(candidate: string | undefined, fallback: string, legacyFallback: string) {
  const resolved = resolveStateId(candidate, fallback);
  return resolved === legacyFallback ? fallback : resolved;
}

function resolveOptionalStateId(candidate: string | undefined, fallback = "") {
  const trimmed = String(candidate || "").trim();
  return trimmed || fallback;
}

function resolveLegacyEmergencyStopStateId(candidate: string | undefined, allowChargingStateId: string) {
  const resolved = resolveOptionalStateId(candidate, "");
  if (!resolved) {
    return "";
  }
  return resolved === allowChargingStateId ? "" : resolved;
}

function resolveMappedStatusId(sourceStateId: string, fromSegment: string, toSegment: string) {
  const normalizedSource = String(sourceStateId || "").trim();
  if (!normalizedSource) {
    return "";
  }
  if (!normalizedSource.includes(fromSegment)) {
    return "";
  }
  return normalizedSource.replace(fromSegment, toSegment);
}

function normalizeConfigValueType(value: string | undefined, fallback: ConfigValueType): ConfigValueType {
  if (value === "boolean" || value === "string") {
    return value;
  }
  if (value === "number") {
    return "number";
  }
  return fallback;
}

function hasConfiguredValue(value: string | undefined) {
  return String(value ?? "").trim().length > 0;
}

function parseConfiguredValue(raw: string | undefined, type: ConfigValueType, fallback: unknown) {
  if (!hasConfiguredValue(raw)) {
    return fallback;
  }
  return castValueToType(raw, type);
}

function isEmergencyStopStateId(stateId?: string) {
  const normalized = String(stateId || "")
    .trim()
    .toLowerCase();
  return normalized.includes("emergencystop") || normalized.includes("emergency_stop");
}

function inferStopDisabledFallback(type: ConfigValueType, stateId?: string) {
  const emergencySemantic = isEmergencyStopStateId(stateId);
  if (type === "number") {
    return emergencySemantic ? 1 : 0;
  }
  if (type === "string") {
    return emergencySemantic ? "true" : "false";
  }
  return emergencySemantic;
}

function resolveStopDisabledValue(raw: string | undefined, type: ConfigValueType, stateId?: string) {
  const fallback = inferStopDisabledFallback(type, stateId);
  if (!hasConfiguredValue(raw)) {
    return fallback;
  }
  return castValueToType(raw, type);
}

function castValueToType(value: unknown, type: ConfigValueType) {
  if (type === "string") {
    return String(value ?? "");
  }
  if (type === "number") {
    const numeric = normalizeFloat(value);
    return numeric === null ? 0 : numeric;
  }
  return normalizeBoolean(value) === true;
}

function deriveOppositeTypedValue(value: unknown, type: ConfigValueType) {
  if (type === "number") {
    const numeric = normalizeFloat(value);
    if (numeric === null) {
      return 0;
    }
    return Math.abs(numeric) < 0.0001 ? 1 : 0;
  }
  if (type === "string") {
    const normalized = String(value ?? "")
      .trim()
      .toLowerCase();
    if (["off", "false", "0", "stop", "disabled"].includes(normalized)) {
      return "on";
    }
    if (["on", "true", "1", "start", "enabled"].includes(normalized)) {
      return "off";
    }
    return String(value ?? "");
  }
  return !(normalizeBoolean(value) === true);
}

function typedValuesEqual(actual: unknown, expected: unknown, type: ConfigValueType) {
  if (type === "number") {
    const left = normalizeFloat(actual);
    const right = normalizeFloat(expected);
    if (left === null || right === null) {
      return false;
    }
    return Math.abs(left - right) < 0.0001;
  }
  if (type === "string") {
    return String(actual ?? "").trim().toLowerCase() === String(expected ?? "").trim().toLowerCase();
  }
  return normalizeBoolean(actual) === normalizeBoolean(expected);
}

function clampInt(value: number | undefined, fallback: number, min: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.round(value));
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

function clampAmpere(value: number) {
  return Math.max(AMPERE_MIN, Math.min(AMPERE_MAX, Math.round(value)));
}

function normalizeMode(value: unknown): WallboxMode | null {
  const numeric = normalizeInteger(value);
  if (numeric === 0) {
    return "stop";
  }
  if (numeric === 1) {
    return "pv";
  }
  if (numeric === 2) {
    return "pvPriority";
  }
  if (numeric === 3) {
    return "grid";
  }

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["off", "stop", "aus", "paused", "disabled"].includes(normalized)) {
    return "stop";
  }
  if (["pv", "pv only", "pv_only", "pvonly", "1"].includes(normalized)) {
    return "pv";
  }
  if (
    [
      "pv priority",
      "pv_priority",
      "pv-priority",
      "pv (go-e priority)",
      "pv only (go-e = priority)",
      "2",
    ].includes(normalized)
  ) {
    return "pvPriority";
  }
  if (["grid", "grid mode", "netz", "3"].includes(normalized)) {
    return "grid";
  }
  return null;
}

function resolveWallboxMode(rawMode: unknown, allowCharging: boolean | null) {
  if (allowCharging === false) {
    return "stop" as WallboxMode;
  }
  return normalizeMode(rawMode) ?? "stop";
}

function resolveModeWriteValue(rawMode: unknown, nextMode: WallboxMode) {
  const numeric = normalizeInteger(rawMode);
  if (numeric !== null) {
    if (nextMode === "stop") {
      return null;
    }
    if (nextMode === "pv") {
      return 1;
    }
    if (nextMode === "pvPriority") {
      return 2;
    }
    return 3;
  }

  const normalized = String(rawMode ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    if (nextMode === "stop") {
      return null;
    }
    if (nextMode === "pv") {
      return 1;
    }
    if (nextMode === "pvPriority") {
      return 2;
    }
    return 3;
  }

  if (nextMode === "stop") {
    return "off";
  }
  if (nextMode === "grid") {
    return "grid";
  }
  return "pv";
}

function normalizeAmpere(value: unknown) {
  const numeric = normalizeFloat(value);
  if (numeric === null) {
    return null;
  }
  return clampAmpere(numeric);
}

function normalizeTargetSocPercent(value: unknown) {
  const numeric = normalizeInteger(value);
  if (numeric === null) {
    return null;
  }
  const clamped = Math.max(10, Math.min(100, Math.round(numeric / 10) * 10));
  return clamped;
}

function normalizeTargetKm(value: unknown) {
  const numeric = normalizeInteger(value);
  if (numeric === null) {
    return null;
  }
  const clamped = Math.max(50, Math.min(400, Math.round(numeric / 50) * 50));
  return clamped;
}

function normalizePowerToWatts(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) > 80 ? value : value * 1000;
  }

  const normalized = String(value).trim().toLowerCase().replace(",", ".");
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

function normalizeEnergyToKWh(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) > 100 ? value / 1000 : value;
  }

  const normalized = String(value).trim().toLowerCase().replace(",", ".");
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

  if (normalized.includes("mwh")) {
    return numeric * 1000;
  }
  if (normalized.includes("kwh")) {
    return numeric;
  }
  if (normalized.includes("wh")) {
    return numeric / 1000;
  }

  return Math.abs(numeric) > 100 ? numeric / 1000 : numeric;
}

function normalizeFloat(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const numeric = Number.parseFloat(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function normalizeInteger(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 1) {
    return true;
  }
  if (value === 0) {
    return false;
  }
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["true", "1", "on", "yes", "ja", "enabled"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "off", "no", "nein", "disabled"].includes(normalized)) {
    return false;
  }
  return null;
}

function resolvePhaseSelection(raw: unknown): 1 | 3 | null {
  const numeric = normalizeInteger(raw);
  if (numeric === 1) {
    return 1;
  }
  if (numeric === 2 || numeric === 3) {
    return 3;
  }

  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized === "1p" ||
    normalized === "single" ||
    normalized === "force_1_phase" ||
    normalized === "force_1" ||
    normalized === "single_phase" ||
    normalized === "one_phase"
  ) {
    return 1;
  }
  if (
    normalized === "3p" ||
    normalized === "three" ||
    normalized === "force_3_phase" ||
    normalized === "force_3" ||
    normalized === "three_phase"
  ) {
    return 3;
  }
  return null;
}

function resolvePhaseWriteValue(raw: unknown, phase: 1 | 3) {
  const numeric = normalizeInteger(raw);
  if (numeric !== null) {
    if (numeric === 3) {
      return phase === 1 ? 1 : 3;
    }
    return phase === 1 ? 1 : 2;
  }

  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (normalized.includes("force_")) {
    return phase === 1 ? "force_1_phase" : "force_3_phase";
  }
  if (normalized === "1p" || normalized === "3p") {
    return phase === 1 ? "1p" : "3p";
  }

  return phase === 1 ? 1 : 2;
}

function estimateChargingPowerW(liveAmpere: number | null, phaseSelection: 1 | 3 | null) {
  if (liveAmpere === null || !Number.isFinite(liveAmpere) || liveAmpere <= 0) {
    return 0;
  }
  const phaseCount = phaseSelection === 3 ? 3 : 1;
  const estimated = liveAmpere * PHASE_VOLTAGE_V * phaseCount;
  if (!Number.isFinite(estimated) || estimated < 0) {
    return 0;
  }
  return estimated;
}

function formatPowerKW(powerW: number) {
  if (!Number.isFinite(powerW) || powerW <= 0) {
    return "0.00 kW";
  }
  return `${(powerW / 1000).toFixed(2)} kW`;
}

function formatEnergyKWh(energyKWh: number | null) {
  if (energyKWh === null || !Number.isFinite(energyKWh) || energyKWh < 0) {
    return "-";
  }
  if (energyKWh >= 1000) {
    return `${(energyKWh / 1000).toFixed(2)} MWh`;
  }
  return `${energyKWh.toFixed(1)} kWh`;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  const normalized = Math.max(0, Math.min(100, value));
  return `${Math.round(normalized)} %`;
}

function modeStatusLabel(mode: WallboxMode) {
  if (mode === "pv") {
    return "PV aktiv";
  }
  if (mode === "pvPriority") {
    return "PV (go-e priority) aktiv";
  }
  if (mode === "grid") {
    return "Netz-Modus aktiv";
  }
  return "Laden gestoppt";
}

function buildStatusSubtitle({
  mode,
  carCode,
  liveAmpere,
  targetMode,
  targetValue,
}: {
  mode: WallboxMode;
  carCode: number | null;
  liveAmpere: number | null;
  targetMode: "soc" | "km";
  targetValue: number;
}) {
  const parts: string[] = [];
  const hasCarSignal = carCode !== null;
  const liveCharging = carCode === 2 || (!hasCarSignal && typeof liveAmpere === "number" && liveAmpere > 0.25);
  if (liveCharging) {
    parts.push("Fahrzeug laedt");
  } else if (carCode === 4) {
    parts.push("Fahrzeug verbunden");
  } else if (carCode === 3) {
    parts.push("Warte auf Fahrzeug");
  } else if (carCode === 1) {
    parts.push("Fahrzeug bereit");
  }
  parts.push(modeStatusLabel(mode));
  parts.push(targetMode === "km" ? `Ziel ${targetValue} km` : `Ziel-SoC ${targetValue}%`);
  return parts.join(" | ");
}

function buildBlurredWidgetBackgroundStyle(imageName: string, blur: number) {
  return {
    ...webBackgroundLayerStyle,
    backgroundImage: `url("/smarthome-dashboard-v2/widget-assets/${encodeURIComponent(imageName)}")`,
    filter: `blur(${blur}px)`,
  };
}

function clampOpacity(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0.08, Math.min(0.9, value));
}

function withAlpha(color: string, alpha: number) {
  const normalized = String(color || "").trim();
  if (!normalized) {
    return `rgba(255,255,255,${alpha})`;
  }
  const safeAlpha = clampOpacity(alpha, 0.32);
  if (normalized.startsWith("#")) {
    const hex = normalized.slice(1);
    if (hex.length === 6) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      if ([r, g, b].every(Number.isFinite)) {
        return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
      }
    }
  }
  const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const channels = rgbMatch[1].split(",").map((entry) => Number.parseFloat(entry.trim()));
    if (channels.length >= 3) {
      const [r, g, b] = channels;
      if ([r, g, b].every(Number.isFinite)) {
        return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${safeAlpha})`;
      }
    }
  }
  return normalized;
}

const GAUGE_MIN_KW = 0;
const GAUGE_MAX_KW = 11;
const GAUGE_GREEN_END_KW = 6;
const GAUGE_WARN_KW = 9;
const GAUGE_START_ANGLE = -125;
const GAUGE_END_ANGLE = 125;
const GAUGE_SIZE = 224;
const GAUGE_CENTER = GAUGE_SIZE / 2;
const GAUGE_RADIUS = 76;
const GAUGE_FACE_RADIUS = GAUGE_RADIUS + 11;
const GAUGE_BEZEL_WIDTH = 12;
const GAUGE_BEZEL_MID_RADIUS = GAUGE_FACE_RADIUS + GAUGE_BEZEL_WIDTH / 2;
const GAUGE_BEZEL_TRIM_RADIUS = GAUGE_BEZEL_MID_RADIUS + GAUGE_BEZEL_WIDTH / 2 + 1;
const GAUGE_OUTER_RING_RADIUS = GAUGE_RADIUS + 8;
const GAUGE_INNER_RING_RADIUS = 38;
const GAUGE_HUB_RADIUS = 12;
const GAUGE_NEEDLE_TIP_RADIUS = 57;
const GAUGE_RING_COLOR = "#7fd9ff";
const GAUGE_TICK_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const GAUGE_LABEL_VALUES = [0, 2, 4, 6, 8, 9, 10, 11] as const;
const GAUGE_ZONE_GREEN = "#4ade80";
const GAUGE_ZONE_YELLOW = "#f5d547";
const GAUGE_ZONE_RED = "#ef5d6b";
const GAUGE_NEEDLE_COLOR = "#f7a440";
const GAUGE_LCD_DIGIT_WIDTH = 7.4;
const GAUGE_LCD_DIGIT_HEIGHT = 13;
const GAUGE_LCD_DIGIT_GAP = 2.6;
const GAUGE_LCD_DOT_WIDTH = 3.4;
const GAUGE_LCD_GHOST_COLOR = "rgba(120, 210, 255, 0.12)";
const GAUGE_LCD_ON_GLOW_COLOR = "#8fe3ff";
const GAUGE_LCD_ON_COLOR = "#d6faff";

const SEVEN_SEGMENT_MAP: Record<string, readonly string[]> = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "g", "c", "d"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "6": ["a", "f", "g", "e", "c", "d"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"],
};

function gaugeAngleForKW(valueKW: number) {
  const clamped = Math.max(GAUGE_MIN_KW, Math.min(GAUGE_MAX_KW, valueKW));
  const ratio = (clamped - GAUGE_MIN_KW) / (GAUGE_MAX_KW - GAUGE_MIN_KW);
  return GAUGE_START_ANGLE + ratio * (GAUGE_END_ANGLE - GAUGE_START_ANGLE);
}

function gaugePolarPoint(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(angleRad), y: cy - r * Math.cos(angleRad) };
}

function gaugeArcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = gaugePolarPoint(cx, cy, r, startAngle);
  const end = gaugePolarPoint(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

const GAUGE_SEGMENT_COORDS: Record<string, [number, number, number, number]> = {
  a: [1, 0, 0, 0],
  b: [1, 0, 1, 0.5],
  c: [1, 0.5, 1, 1],
  d: [0, 1, 1, 1],
  e: [0, 0.5, 0, 1],
  f: [0, 0, 0, 0.5],
  g: [0, 0.5, 1, 0.5],
};

function buildSevenSegmentDigit(
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  char: string,
  glowFilterId: string
) {
  const st = w * 0.24;
  const shrink = st * 0.3;
  const elements: ReturnType<typeof createElement>[] = [];
  const segKeys = Object.keys(GAUGE_SEGMENT_COORDS);
  const onSegments = new Set(SEVEN_SEGMENT_MAP[char] ?? []);

  const segmentEndpoints = (seg: string) => {
    const [nx1, ny1, nx2, ny2] = GAUGE_SEGMENT_COORDS[seg];
    const isVertical = nx1 === nx2;
    let y1 = y + ny1 * h;
    let y2 = y + ny2 * h;
    if (isVertical && ny1 === 0.5) y1 += shrink;
    if (isVertical && ny2 === 0.5) y2 -= shrink;
    return { x1: x + nx1 * w, y1, x2: x + nx2 * w, y2 };
  };

  segKeys.forEach((seg) => {
    const { x1, y1, x2, y2 } = segmentEndpoints(seg);
    elements.push(
      createElement("line", {
        key: `${key}-ghost-${seg}`,
        x1,
        y1,
        x2,
        y2,
        stroke: GAUGE_LCD_GHOST_COLOR,
        strokeWidth: st,
        strokeLinecap: "round",
      })
    );
  });

  onSegments.forEach((seg) => {
    const { x1, y1, x2, y2 } = segmentEndpoints(seg);
    elements.push(
      createElement("line", {
        key: `${key}-glow-${seg}`,
        x1,
        y1,
        x2,
        y2,
        stroke: GAUGE_LCD_ON_GLOW_COLOR,
        strokeWidth: st,
        strokeLinecap: "round",
        opacity: 0.75,
        filter: `url(#${glowFilterId})`,
      })
    );
    elements.push(
      createElement("line", {
        key: `${key}-on-${seg}`,
        x1,
        y1,
        x2,
        y2,
        stroke: GAUGE_LCD_ON_COLOR,
        strokeWidth: st * 0.8,
        strokeLinecap: "round",
      })
    );
  });

  return elements;
}

function buildLcdDot(key: string, cx: number, cy: number, r: number, glowFilterId: string) {
  return [
    createElement("circle", {
      key: `${key}-glow`,
      cx,
      cy,
      r,
      fill: GAUGE_LCD_ON_GLOW_COLOR,
      opacity: 0.75,
      filter: `url(#${glowFilterId})`,
    }),
    createElement("circle", { key, cx, cy, r: r * 0.8, fill: GAUGE_LCD_ON_COLOR }),
  ];
}

function buildPowerGaugeSvg(valueKW: number, _accentColor: string, widgetId: string) {
  const safeValueKW = Number.isFinite(valueKW) ? valueKW : 0;
  const needleAngle = gaugeAngleForKW(safeValueKW);
  const greenEndAngle = gaugeAngleForKW(GAUGE_GREEN_END_KW);
  const warnStartAngle = gaugeAngleForKW(GAUGE_WARN_KW);
  const greenPath = gaugeArcPath(GAUGE_CENTER, GAUGE_CENTER, GAUGE_RADIUS, GAUGE_START_ANGLE, greenEndAngle);
  const yellowPath = gaugeArcPath(GAUGE_CENTER, GAUGE_CENTER, GAUGE_RADIUS, greenEndAngle, warnStartAngle);
  const redPath = gaugeArcPath(GAUGE_CENTER, GAUGE_CENTER, GAUGE_RADIUS, warnStartAngle, GAUGE_END_ANGLE);
  const bezelTintRadius = GAUGE_FACE_RADIUS + GAUGE_BEZEL_WIDTH * 0.32;
  const greenBezelPath = gaugeArcPath(GAUGE_CENTER, GAUGE_CENTER, bezelTintRadius, GAUGE_START_ANGLE, greenEndAngle);
  const yellowBezelPath = gaugeArcPath(GAUGE_CENTER, GAUGE_CENTER, bezelTintRadius, greenEndAngle, warnStartAngle);
  const redBezelPath = gaugeArcPath(GAUGE_CENTER, GAUGE_CENTER, bezelTintRadius, warnStartAngle, GAUGE_END_ANGLE);
  const hubGradientId = `wallboxV2Hub-${widgetId}`;
  const faceGradientId = `wallboxV2Face-${widgetId}`;
  const bezelGradientId = `wallboxV2Bezel-${widgetId}`;
  const glossId = `wallboxV2Gloss-${widgetId}`;
  const faceClipId = `wallboxV2FaceClip-${widgetId}`;
  const glowBlurId = `wallboxV2GlowBlur-${widgetId}`;
  const bezelGlowBlurId = `wallboxV2BezelGlowBlur-${widgetId}`;
  const needleGlowBlurId = `wallboxV2NeedleGlowBlur-${widgetId}`;
  const lcdGlowBlurId = `wallboxV2LcdGlowBlur-${widgetId}`;
  const needleTip = gaugePolarPoint(GAUGE_CENTER, GAUGE_CENTER, GAUGE_NEEDLE_TIP_RADIUS, needleAngle);
  const needleBaseLeft = gaugePolarPoint(GAUGE_CENTER, GAUGE_CENTER, 3, needleAngle - 90);
  const needleBaseRight = gaugePolarPoint(GAUGE_CENTER, GAUGE_CENTER, 3, needleAngle + 90);
  const needleTailPoint = gaugePolarPoint(GAUGE_CENTER, GAUGE_CENTER, 7, needleAngle + 180);
  const needlePoints = `${needleTip.x},${needleTip.y} ${needleBaseLeft.x},${needleBaseLeft.y} ${needleTailPoint.x},${needleTailPoint.y} ${needleBaseRight.x},${needleBaseRight.y}`;
  const needleHighlightTip = gaugePolarPoint(GAUGE_CENTER, GAUGE_CENTER, GAUGE_NEEDLE_TIP_RADIUS - 3, needleAngle);

  const pseudoRandom = (i: number) => {
    const v = Math.sin(i * 12.9898) * 43758.5453;
    return v - Math.floor(v);
  };
  const bezelBrushLines = Array.from({ length: 72 }, (_, i) => {
    const angle = (i / 72) * 360;
    const rand = pseudoRandom(i);
    const inner = gaugePolarPoint(GAUGE_CENTER, GAUGE_CENTER, GAUGE_FACE_RADIUS + 1, angle);
    const outer = gaugePolarPoint(GAUGE_CENTER, GAUGE_CENTER, GAUGE_BEZEL_TRIM_RADIUS - 1, angle);
    return createElement("line", {
      key: `brush-${i}`,
      x1: inner.x,
      y1: inner.y,
      x2: outer.x,
      y2: outer.y,
      stroke: rand > 0.5 ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.32)",
      strokeWidth: 0.6,
      opacity: 0.12 + rand * 0.18,
    });
  });

  const ticks = GAUGE_TICK_VALUES.map((tick) => {
    const angle = gaugeAngleForKW(tick);
    const isMajor = (GAUGE_LABEL_VALUES as readonly number[]).includes(tick);
    const outer = gaugePolarPoint(GAUGE_CENTER, GAUGE_CENTER, GAUGE_RADIUS + 9, angle);
    const inner = gaugePolarPoint(GAUGE_CENTER, GAUGE_CENTER, GAUGE_RADIUS - 1, angle);
    return createElement("line", {
      key: `tick-${tick}`,
      x1: inner.x,
      y1: inner.y,
      x2: outer.x,
      y2: outer.y,
      stroke: tick >= GAUGE_WARN_KW ? "rgba(239, 93, 107, 0.9)" : "rgba(214, 224, 244, 0.5)",
      strokeWidth: isMajor ? 2.5 : 1.25,
      strokeLinecap: "round",
    });
  });

  const labels = GAUGE_LABEL_VALUES.map((tick) => {
    const angle = gaugeAngleForKW(tick);
    const pos = gaugePolarPoint(GAUGE_CENTER, GAUGE_CENTER, GAUGE_RADIUS - 22, angle);
    return createElement(
      "text",
      {
        key: `label-${tick}`,
        x: pos.x,
        y: pos.y + 4,
        fill: tick >= GAUGE_WARN_KW ? "#ef5d6b" : "rgba(226, 233, 248, 0.88)",
        fontSize: 11,
        fontWeight: 700,
        textAnchor: "middle",
      },
      String(tick)
    );
  });

  const zoneArc = (key: string, d: string, color: string) => [
    createElement("path", {
      key: `${key}-glow`,
      d,
      fill: "none",
      stroke: color,
      strokeWidth: 10,
      strokeLinecap: "round",
      opacity: 0.65,
      filter: `url(#${glowBlurId})`,
    }),
    createElement("path", {
      key,
      d,
      fill: "none",
      stroke: color,
      strokeWidth: 6,
      strokeLinecap: "round",
    }),
  ];

  const glowRing = (key: string, r: number) => [
    createElement("circle", {
      key: `${key}-glow`,
      cx: GAUGE_CENTER,
      cy: GAUGE_CENTER,
      r,
      fill: "none",
      stroke: GAUGE_RING_COLOR,
      strokeWidth: 5,
      opacity: 0.55,
      filter: `url(#${glowBlurId})`,
    }),
    createElement("circle", {
      key,
      cx: GAUGE_CENTER,
      cy: GAUGE_CENTER,
      r,
      fill: "none",
      stroke: GAUGE_RING_COLOR,
      strokeWidth: 1.4,
      opacity: 0.9,
    }),
  ];

  const bezelColorBleed = (d: string, color: string, filterId: string) =>
    createElement("path", {
      key: `bezel-bleed-${color}`,
      d,
      fill: "none",
      stroke: color,
      strokeWidth: GAUGE_BEZEL_WIDTH * 0.7,
      strokeLinecap: "round",
      opacity: 0.3,
      filter: `url(#${filterId})`,
    });

  const lcdValueText = safeValueKW.toFixed(1);
  const lcdChars = lcdValueText.split("");
  let lcdAdvance = 0;
  lcdChars.forEach((ch) => {
    lcdAdvance += (ch === "." ? GAUGE_LCD_DOT_WIDTH : GAUGE_LCD_DIGIT_WIDTH) + GAUGE_LCD_DIGIT_GAP;
  });
  const lcdDigitsWidth = lcdAdvance - GAUGE_LCD_DIGIT_GAP;
  const lcdKwGap = 5;
  const lcdKwLabelWidth = 13;
  const lcdPaddingX = 7;
  const lcdWidth = lcdDigitsWidth + lcdKwGap + lcdKwLabelWidth + lcdPaddingX * 2;
  const lcdHeight = GAUGE_LCD_DIGIT_HEIGHT + 10;
  const lcdX = GAUGE_CENTER - lcdWidth / 2;
  const lcdY = GAUGE_CENTER + 40;
  const digitsOriginX = lcdX + lcdPaddingX;
  const digitsOriginY = lcdY + (lcdHeight - GAUGE_LCD_DIGIT_HEIGHT) / 2;
  const lcdDigitElements: ReturnType<typeof createElement>[] = [];
  let lcdCursorX = digitsOriginX;
  lcdChars.forEach((ch, idx) => {
    if (ch === ".") {
      lcdDigitElements.push(
        ...buildLcdDot(`lcd-dot-${idx}`, lcdCursorX + GAUGE_LCD_DOT_WIDTH / 2, digitsOriginY + GAUGE_LCD_DIGIT_HEIGHT, 1.6, lcdGlowBlurId)
      );
      lcdCursorX += GAUGE_LCD_DOT_WIDTH + GAUGE_LCD_DIGIT_GAP;
    } else {
      lcdDigitElements.push(
        ...buildSevenSegmentDigit(`lcd-digit-${idx}`, lcdCursorX, digitsOriginY, GAUGE_LCD_DIGIT_WIDTH, GAUGE_LCD_DIGIT_HEIGHT, ch, lcdGlowBlurId)
      );
      lcdCursorX += GAUGE_LCD_DIGIT_WIDTH + GAUGE_LCD_DIGIT_GAP;
    }
  });
  const lcdKwLabelX = digitsOriginX + lcdDigitsWidth + lcdKwGap;

  return createElement(
    "svg",
    { width: GAUGE_SIZE, height: GAUGE_SIZE, viewBox: `0 0 ${GAUGE_SIZE} ${GAUGE_SIZE}` },
    createElement(
      "defs",
      null,
      createElement(
        "radialGradient",
        { id: hubGradientId, cx: "35%", cy: "28%", r: "80%" },
        createElement("stop", { offset: "0%", stopColor: "#4c5566" }),
        createElement("stop", { offset: "55%", stopColor: "#262b35" }),
        createElement("stop", { offset: "100%", stopColor: "#0d0f14" })
      ),
      createElement(
        "radialGradient",
        { id: faceGradientId, cx: "50%", cy: "42%", r: "62%" },
        createElement("stop", { offset: "0%", stopColor: "#141d2b" }),
        createElement("stop", { offset: "70%", stopColor: "#0a1119" }),
        createElement("stop", { offset: "100%", stopColor: "#05080d" })
      ),
      createElement(
        "linearGradient",
        { id: bezelGradientId, x1: "20%", y1: "10%", x2: "80%", y2: "90%" },
        createElement("stop", { offset: "0%", stopColor: "#eef1f6" }),
        createElement("stop", { offset: "22%", stopColor: "#9199a8" }),
        createElement("stop", { offset: "45%", stopColor: "#575d6c" }),
        createElement("stop", { offset: "60%", stopColor: "#c3c8d2" }),
        createElement("stop", { offset: "80%", stopColor: "#4a4f5c" }),
        createElement("stop", { offset: "100%", stopColor: "#1b1e26" })
      ),
      createElement(
        "linearGradient",
        { id: glossId, x1: "50%", y1: "0%", x2: "50%", y2: "100%" },
        createElement("stop", { offset: "0%", stopColor: "rgba(255,255,255,0.22)" }),
        createElement("stop", { offset: "40%", stopColor: "rgba(255,255,255,0.05)" }),
        createElement("stop", { offset: "70%", stopColor: "rgba(255,255,255,0)" })
      ),
      createElement("clipPath", { id: faceClipId }, createElement("circle", { cx: GAUGE_CENTER, cy: GAUGE_CENTER, r: GAUGE_FACE_RADIUS })),
      createElement(
        "filter",
        { id: glowBlurId, x: "-60%", y: "-60%", width: "220%", height: "220%" },
        createElement("feGaussianBlur", { stdDeviation: 2.4 })
      ),
      createElement(
        "filter",
        { id: bezelGlowBlurId, x: "-80%", y: "-80%", width: "260%", height: "260%" },
        createElement("feGaussianBlur", { stdDeviation: 3.4 })
      ),
      createElement(
        "filter",
        { id: needleGlowBlurId, x: "-100%", y: "-100%", width: "300%", height: "300%" },
        createElement("feGaussianBlur", { stdDeviation: 2.2 })
      ),
      createElement(
        "filter",
        { id: lcdGlowBlurId, x: "-100%", y: "-100%", width: "300%", height: "300%" },
        createElement("feGaussianBlur", { stdDeviation: 1.6 })
      )
    ),
    createElement("circle", {
      cx: GAUGE_CENTER,
      cy: GAUGE_CENTER,
      r: GAUGE_BEZEL_MID_RADIUS,
      fill: "none",
      stroke: `url(#${bezelGradientId})`,
      strokeWidth: GAUGE_BEZEL_WIDTH,
    }),
    ...bezelBrushLines,
    bezelColorBleed(greenBezelPath, GAUGE_ZONE_GREEN, bezelGlowBlurId),
    bezelColorBleed(yellowBezelPath, GAUGE_ZONE_YELLOW, bezelGlowBlurId),
    bezelColorBleed(redBezelPath, GAUGE_ZONE_RED, bezelGlowBlurId),
    createElement("circle", {
      cx: GAUGE_CENTER,
      cy: GAUGE_CENTER,
      r: GAUGE_BEZEL_TRIM_RADIUS,
      fill: "none",
      stroke: "rgba(5, 6, 9, 0.85)",
      strokeWidth: 2,
    }),
    createElement("circle", {
      cx: GAUGE_CENTER,
      cy: GAUGE_CENTER,
      r: GAUGE_FACE_RADIUS,
      fill: `url(#${faceGradientId})`,
      stroke: "rgba(0, 0, 0, 0.6)",
      strokeWidth: 1.5,
    }),
    ...glowRing("ring-outer", GAUGE_OUTER_RING_RADIUS),
    ...zoneArc("zone-green", greenPath, GAUGE_ZONE_GREEN),
    ...zoneArc("zone-yellow", yellowPath, GAUGE_ZONE_YELLOW),
    ...zoneArc("zone-red", redPath, GAUGE_ZONE_RED),
    ...glowRing("ring-inner", GAUGE_INNER_RING_RADIUS),
    ...ticks,
    ...labels,
    createElement("rect", {
      x: lcdX,
      y: lcdY,
      width: lcdWidth,
      height: lcdHeight,
      rx: 4,
      fill: "#050b12",
      stroke: "rgba(120, 200, 255, 0.35)",
      strokeWidth: 1,
    }),
    ...lcdDigitElements,
    createElement(
      "text",
      {
        x: lcdKwLabelX,
        y: digitsOriginY + GAUGE_LCD_DIGIT_HEIGHT - 1,
        fill: "#8fb7c9",
        fontSize: 7,
        fontWeight: 700,
        textAnchor: "start",
      },
      "kW"
    ),
    createElement("polygon", {
      key: "needle-glow",
      points: needlePoints,
      fill: GAUGE_NEEDLE_COLOR,
      opacity: 0.7,
      filter: `url(#${needleGlowBlurId})`,
    }),
    createElement("polygon", {
      key: "needle-body",
      points: needlePoints,
      fill: GAUGE_NEEDLE_COLOR,
      stroke: "rgba(0,0,0,0.35)",
      strokeWidth: 0.5,
    }),
    createElement("line", {
      key: "needle-highlight",
      x1: GAUGE_CENTER,
      y1: GAUGE_CENTER,
      x2: needleHighlightTip.x,
      y2: needleHighlightTip.y,
      stroke: "rgba(255, 240, 220, 0.55)",
      strokeWidth: 0.6,
      strokeLinecap: "round",
    }),
    createElement("circle", {
      cx: GAUGE_CENTER,
      cy: GAUGE_CENTER,
      r: GAUGE_HUB_RADIUS,
      fill: `url(#${hubGradientId})`,
      stroke: "rgba(210, 220, 235, 0.3)",
      strokeWidth: 1,
    }),
    createElement("ellipse", {
      cx: GAUGE_CENTER - GAUGE_FACE_RADIUS * 0.1,
      cy: GAUGE_CENTER - GAUGE_FACE_RADIUS * 0.38,
      rx: GAUGE_FACE_RADIUS * 0.75,
      ry: GAUGE_FACE_RADIUS * 0.3,
      fill: `url(#${glossId})`,
      clipPath: `url(#${faceClipId})`,
      transform: `rotate(-24 ${GAUGE_CENTER - GAUGE_FACE_RADIUS * 0.1} ${GAUGE_CENTER - GAUGE_FACE_RADIUS * 0.38})`,
    })
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
  card: {
    flex: 1,
    minHeight: 0,
    borderRadius: 0,
    borderWidth: 0,
    overflow: "hidden",
    position: "relative",
  },
  scaledContent: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 11,
    zIndex: 2,
    position: "relative",
  },
  widgetBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  widgetBackgroundImage: {
    resizeMode: "cover",
  },
  widgetBackgroundOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5, 10, 18, 0.36)",
  },
  header: {
    gap: 3,
  },
  chargeStatusStrip: {
    borderRadius: 12,
    borderWidth: 1,
    borderTopColor: "rgba(255,255,255,0.16)",
    borderBottomColor: "rgba(0,0,0,0.35)",
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 3,
    elevation: 2,
  },
  chargeStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  chargeStatusText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  allowChargingRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderTopColor: "rgba(0,0,0,0.4)",
    borderBottomColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.22)",
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 2,
  },
  allowChargingLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  subtitleBottom: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  metricsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
  },
  metricCard: {
    flex: 1,
    minHeight: 70,
    borderRadius: 11,
    borderWidth: 1,
    borderTopColor: "rgba(255,255,255,0.18)",
    borderBottomColor: "rgba(0,0,0,0.3)",
    paddingHorizontal: 9,
    paddingVertical: 8,
    justifyContent: "space-between",
    gap: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 4,
    elevation: 3,
  },
  metricCardPower: {
    borderWidth: 1.2,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.45,
    textTransform: "uppercase",
  },
  metricValue: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
  },
  powerBarBlock: {
    gap: 6,
    marginTop: 1,
  },
  powerBarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  powerBarLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.45,
    textTransform: "uppercase",
  },
  powerBarValue: {
    fontSize: 12,
    fontWeight: "700",
  },
  powerBarTrack: {
    height: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(191, 209, 245, 0.24)",
    backgroundColor: "rgba(20, 27, 38, 0.72)",
    overflow: "hidden",
  },
  powerBarFillClip: {
    height: "100%",
    minWidth: 0,
    borderRadius: 999,
    overflow: "hidden",
    position: "relative",
  },
  gaugeFace: {
    alignItems: "center",
    justifyContent: "center",
  },
  gaugeNativeFallback: {
    width: "100%",
    gap: 8,
    alignItems: "center",
  },
  gaugeNativeValue: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: "800",
  },
  powerBarGlow: {
    position: "absolute",
    left: 0,
    top: -5,
    bottom: -5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.5)",
    shadowColor: "#fff",
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  powerBarScaleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  powerBarScaleLabel: {
    fontSize: 10,
    fontWeight: "600",
  },
  block: {
    gap: 7,
  },
  blockHeaderInline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  targetSliderPanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderTopColor: "rgba(0,0,0,0.45)",
    borderBottomColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(0,0,0,0.24)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.32,
    shadowRadius: 3,
  },
  targetScaleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  targetScaleLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  blockLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  ampereValue: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  segmentShell: {
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
    padding: 4,
    flexDirection: "row",
    gap: 6,
  },
  segmentButton: {
    flex: 1,
    borderRadius: 10,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderTopColor: "rgba(255,255,255,0.34)",
    borderBottomColor: "rgba(0,0,0,0.4)",
    backgroundColor: "rgba(255,255,255,0.05)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.32,
    shadowRadius: 4,
    elevation: 4,
  },
  segmentButtonActive: {
    borderColor: "transparent",
    borderTopColor: "rgba(0,0,0,0.28)",
    borderBottomColor: "rgba(255,255,255,0.22)",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 1,
  },
  segmentLabel: {
    fontSize: 15,
    fontWeight: "800",
    zIndex: 2,
  },
  ampereControls: {
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
  },
  stepButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  stepButtonLabel: {
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 20,
    marginTop: -1,
  },
  sliderWrap: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    gap: 2,
  },
  nativeTickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 24,
  },
  nativeTickButton: {
    flex: 1,
    minHeight: 22,
    justifyContent: "center",
  },
  nativeTickBar: {
    height: 8,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
  },
  sliderScaleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sliderScaleLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  toggleBlock: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  toggleTextWrap: {
    flex: 1,
    gap: 2,
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  toggleHint: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "500",
  },
  toggleTrack: {
    width: 54,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
    justifyContent: "center",
    position: "relative",
  },
  toggleTrackActive: {
    borderColor: "transparent",
    backgroundColor: "rgba(252, 204, 124, 0.2)",
  },
  toggleTrackInactive: {
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  toggleKnob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 2,
    zIndex: 2,
  },
  toggleKnobActive: {
    alignSelf: "flex-end",
    borderColor: "rgba(77, 48, 15, 0.35)",
    backgroundColor: "#fff6e8",
  },
  toggleKnobInactive: {
    alignSelf: "flex-start",
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(232, 238, 251, 0.9)",
  },
  quickControlPanel: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 2,
  },
  quickControlGroup: {
    gap: 6,
  },
  quickControlHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "center",
  },
  quickControlLabel: {
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.35,
  },
  quickControlValue: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
    maxWidth: "46%",
  },
  quickButtonRow: {
    flexDirection: "row",
    gap: 6,
  },
  quickSelectButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    borderTopColor: "rgba(255,255,255,0.32)",
    borderBottomColor: "rgba(0,0,0,0.38)",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  quickSelectButtonWide: {
    minHeight: 38,
  },
  quickSelectButtonActive: {
    borderColor: "transparent",
    borderTopColor: "rgba(0,0,0,0.25)",
    borderBottomColor: "rgba(255,255,255,0.2)",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.45,
    shadowRadius: 1,
    elevation: 1,
  },
  quickSelectButtonDisabled: {
    opacity: 0.45,
  },
  quickSelectLabel: {
    fontSize: 13,
    fontWeight: "800",
    zIndex: 2,
  },
  quickControlHint: {
    fontSize: 11,
    fontWeight: "600",
    textAlign: "right",
  },
  footer: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  disabledControl: {
    opacity: 0.5,
  },
  pressScale: {
    transform: [{ scale: 0.97 }],
  },
});

const webGradientLayerStyle = {
  position: "absolute",
  inset: 0,
  zIndex: 1,
  pointerEvents: "none",
} as const;

const webBackgroundLayerStyle = {
  position: "absolute",
  inset: "-14px",
  zIndex: 0,
  pointerEvents: "none",
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
  backgroundSize: "cover",
  transform: "scale(1.04)",
} as const;

const webSliderStyle = {
  width: "100%",
  margin: 0,
  background: "transparent",
  cursor: "pointer",
} as const;

const webPowerBarGlowStyle = {
  position: "absolute",
  left: 0,
  top: "-5px",
  bottom: "-5px",
  borderRadius: "999px",
  backgroundColor: "rgba(255,255,255,0.42)",
  pointerEvents: "none",
  animationName: "smarthomeV2WallboxGlow",
  animationTimingFunction: "linear",
  animationIterationCount: "infinite",
} as const;
