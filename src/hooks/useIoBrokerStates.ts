import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useDashboardConfig } from "../context/DashboardConfigContext";
import { IoBrokerClient } from "../services/iobroker";
import { DashboardSettings, StateSnapshot, WidgetConfig } from "../types/dashboard";
import { IoBrokerStateStore, useIoBrokerStateSelection } from "../state/IoBrokerStateStore";
import { resolveMobileWidget } from "../utils/mobileWidget";
import { useDocumentVisibility } from "./useDocumentVisibility";

export type StateWriteFeedback = {
  expectedValue: unknown;
  status: "pending" | "confirmed" | "error";
  updatedAt: number;
};

function inferRaspberryPercentStateId(stateId: string, key: "ramFree" | "diskFree") {
  const trimmed = stateId.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.toLowerCase().includes("percent")) {
    return trimmed;
  }

  const suffix = `.${key}`;
  if (trimmed.endsWith(suffix)) {
    return `${trimmed}Percent`;
  }

  return "";
}

const WALLBOX_PRIMARY_FALLBACK_STATE_IDS = [
  "go-e-gemini-adapter.0.control.allowCharging",
  "go-e-gemini-adapter.0.control.emergencyStop",
  "go-e-gemini-adapter.0.control.mode",
  "go-e-gemini-adapter.0.control.gridManual.currentA",
  "go-e-gemini-adapter.0.control.gridManual.phaseMode",
  "go-e-gemini-adapter.0.control.targetSocPercent",
  "go-e-gemini-adapter.0.control.targetSocEnabled",
  "go-e-gemini-adapter.0.status.effectiveAllowCharging",
  "go-e-gemini-adapter.0.status.activeMode",
  "go-e-gemini-adapter.0.status.setCurrentA",
  "go-e-gemini-adapter.0.status.targetPhaseMode",
  "go-e-gemini-adapter.0.status.actualPhaseMode",
  "go-e-gemini-adapter.0.status.enabledPhases",
  "go-e-gemini-adapter.0.status.carState",
  "go-e-gemini-adapter.0.status.carSocPercent",
  "go-e-gemini-adapter.0.status.chargerPowerW",
  "go-e.0.eto",
];

const WALLBOX_LEGACY_FALLBACK_STATE_IDS = [
  "go-e.0.allow_charging",
  "0_userdata.0.goe.mode",
  "0_userdata.0.goe.gridAmpere",
  "go-e.0.phaseSwitchMode",
  "go-e.0.phaseSwitchModeEnabled",
  "go-e.0.ampere",
  "go-e.0.car",
  "go-e.0.carBatterySoc",
  "go-e.0.nrg.11",
  "go-e.0.stopChargeingAtCarSoc80",
  "go-e.0.eto",
];

const HEATING_FALLBACK_STATE_IDS = [
  "viessmannapi.0.299550.0.features.heating.circuits.1.operating.modes.active.commands.setMode.setValue",
  "viessmannapi.0.299550.0.features.heating.circuits.1.operating.modes.active.properties.value.value",
  "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.active.properties.value.value",
  "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.normal.commands.setTemperature.setValue",
  "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.reduced.commands.setTemperature.setValue",
  "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.comfort.commands.setTemperature.setValue",
  "viessmannapi.0.299550.0.features.heating.dhw.temperature.main.commands.setTargetTemperature.setValue",
  "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.comfort.commands.activate.setValue",
  "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.comfort.commands.deactivate.setValue",
  "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.eco.commands.setActive.setValue",
  "viessmannapi.0.299550.0.features.heating.dhw.oneTimeCharge.commands.setActive.setValue",
  "viessmannapi.0.299550.0.features.heating.dhw.oneTimeCharge.properties.active.value",
  "viessmannapi.0.299550.0.features.heating.dhw.charging.properties.active.value",
  "viessmannapi.0.299550.0.features.heating.circuits.1.temperature.properties.value.value",
  "viessmannapi.0.299550.0.features.heating.circuits.1.sensors.temperature.supply.properties.value.value",
  "viessmannapi.0.299550.0.features.heating.sensors.temperature.outside.properties.value.value",
  "viessmannapi.0.299550.0.features.heating.sensors.temperature.return.properties.value.value",
  "viessmannapi.0.299550.0.features.heating.dhw.sensors.temperature.dhwCylinder.properties.value.value",
  "viessmannapi.0.299550.0.features.heating.compressors.0.power.properties.value.value",
  "viessmannapi.0.299550.0.features.heating.compressors.0.sensors.power.properties.value.value",
];

export function collectExplicitStateIds(widget: WidgetConfig) {
  const explicit: string[] = [];
  for (const [key, value] of Object.entries(widget)) {
    if (!key.endsWith("StateId")) {
      continue;
    }
    explicit.push(typeof value === "string" ? value : "");
  }
  return explicit;
}

export const collectWidgetStateIds = (widget: WidgetConfig) => {
  if (widget.type === "state") {
    return [widget.stateId];
  }
  if (widget.type === "camera" || widget.type === "cameraTalk" || widget.type === "cameraTalkReolink") {
    return [widget.maximizeStateId || ""];
  }
  if (widget.type === "energy") {
    return [
      widget.pvStateId,
      widget.houseStateId,
      widget.batteryStateId || "",
      widget.gridStateId || "",
    ];
  }
  if (widget.type === "solar") {
    const prefix = widget.statePrefix;
    const withPrefix = (key?: string) => (key ? `${prefix}.${key}` : "");
    return [
      widget.wallboxCarStateId || "",
      widget.wallboxChargePowerStateId || "",
      widget.wallboxAmpereStateId || "",
      widget.wallboxPhaseModeStateId || "",
      widget.wallboxCarSocStateId || "",
      widget.wallboxCarRangeStateId || "",
      withPrefix(widget.keys.pvNow),
      withPrefix(widget.keys.homeNow),
      withPrefix(widget.keys.gridIn),
      withPrefix(widget.keys.gridOut),
      withPrefix(widget.keys.soc),
      withPrefix(widget.keys.battIn),
      withPrefix(widget.keys.battOut),
      withPrefix(widget.keys.dayConsumed),
      withPrefix(widget.keys.daySelf),
      withPrefix(widget.keys.pvTotal),
      withPrefix(widget.keys.battTemp),
      widget.stats?.first?.stateId || "",
      widget.stats?.second?.stateId || "",
      widget.stats?.third?.stateId || "",
    ];
  }
  if (widget.type === "raspberryPiStats") {
    return [
      widget.cpuTempStateId,
      widget.cpuLoadStateId,
      widget.ramFreeStateId,
      widget.diskFreeStateId,
      inferRaspberryPercentStateId(widget.ramFreeStateId, "ramFree"),
      inferRaspberryPercentStateId(widget.diskFreeStateId, "diskFree"),
      widget.onlineStateId,
    ];
  }
  if (widget.type === "coco") {
    return [
      widget.insideStateId,
      widget.lastDirectionStateId || "",
      widget.lastFlapStateId || "",
      widget.lastTimeStateId,
      widget.timesOutsideStateId || "",
      widget.timeSpentOutsideStateId || "",
      widget.flapBatteryStateId || "",
      widget.flapOnlineStateId || "",
      widget.hubOnlineStateId || "",
      widget.adapterConnectedStateId || "",
      widget.allDevicesOnlineStateId || "",
      widget.offlineDevicesStateId || "",
      widget.lockModeStateId || "",
      widget.lockWriteStateId || "",
    ];
  }
  if (widget.type === "wallbox" || widget.type === "goe") {
    return [
      ...collectExplicitStateIds(widget),
      ...WALLBOX_PRIMARY_FALLBACK_STATE_IDS,
      ...WALLBOX_LEGACY_FALLBACK_STATE_IDS,
    ];
  }
  if (widget.type === "heating" || widget.type === "heatingV2") {
    return [
      ...collectExplicitStateIds(widget),
      ...HEATING_FALLBACK_STATE_IDS,
    ];
  }
  return [];
};

export const pickStateIds = (widgets: ReturnType<typeof useDashboardConfig>["config"]["widgets"]) =>
  widgets.flatMap((widget) => {
    const mobileVariant = resolveMobileWidget(widget);
    return [...collectWidgetStateIds(widget), ...collectWidgetStateIds(mobileVariant)];
  });

export const normalizeStateIds = (stateIds: string[]) =>
  Array.from(new Set(stateIds.map((entry) => entry.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "de"));
const WS_RECONNECT_BASE_DELAY_MS = 850;
const WS_RECONNECT_MAX_DELAY_MS = 8000;

export function useIoBrokerStates() {
  const { config } = useDashboardConfig();
  const documentVisible = useDocumentVisibility();
  const stateStoreRef = useRef<IoBrokerStateStore | null>(null);
  if (!stateStoreRef.current) {
    stateStoreRef.current = new IoBrokerStateStore();
  }
  const stateStore = stateStoreRef.current;
  const [stateWrites, setStateWrites] = useState<Record<string, StateWriteFeedback>>({});
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const client = useMemo(
    () => new IoBrokerClient(config),
    [
      config.iobroker.adapterBasePath,
      config.iobroker.baseUrl,
      config.iobroker.password,
      config.iobroker.token,
      config.iobroker.username,
    ]
  );
  const watchedStateIds = useMemo(() => normalizeStateIds(pickStateIds(config.widgets)), [config.widgets]);
  const statePushWsUrl = useMemo(
    () => buildStatePushWebSocketUrl(config),
    [config.iobroker.adapterBasePath, config.iobroker.baseUrl]
  );
  const shouldUseStatePushWebSocket = Platform.OS === "web" && Boolean(statePushWsUrl);
  const watchRequestIdRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const watchedStateIdsRef = useRef(watchedStateIds);

  useEffect(() => {
    watchedStateIdsRef.current = watchedStateIds;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    watchRequestIdRef.current += 1;
    socket.send(
      JSON.stringify({
        type: "watch",
        requestId: `watch-${watchRequestIdRef.current}`,
        stateIds: watchedStateIds,
      })
    );
  }, [watchedStateIds]);

  useEffect(() => {
    if (!shouldUseStatePushWebSocket || !documentVisible || !statePushWsUrl) {
      setWsConnected(false);
      return;
    }

    let active = true;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stateBatchTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingStateBatch: StateSnapshot = {};
    let socket: WebSocket | null = null;

    const flushIncomingStateBatch = () => {
      stateBatchTimer = null;
      const incoming = pendingStateBatch;
      pendingStateBatch = {};
      stateStore.applyBatch(incoming);
      setStateWrites((current) => resolveStateWriteFeedback(current, stateStore.getSnapshot()));
      setError(null);
      setIsOnline(true);
    };

    const queueIncomingStateBatch = (incoming: StateSnapshot) => {
      Object.assign(pendingStateBatch, incoming);
      if (!stateBatchTimer) {
        stateBatchTimer = setTimeout(flushIncomingStateBatch, 100);
      }
    };

    const clearReconnectTimer = () => {
      if (!reconnectTimer) {
        return;
      }
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const scheduleReconnect = () => {
      if (!active) {
        return;
      }
      clearReconnectTimer();
      const delay = Math.min(WS_RECONNECT_MAX_DELAY_MS, WS_RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt);
      reconnectAttempt = Math.min(reconnectAttempt + 1, 8);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (!active) {
        return;
      }

      try {
        socket = new WebSocket(statePushWsUrl);
        socketRef.current = socket;
      } catch (connectError) {
        setWsConnected(false);
        setError(connectError instanceof Error ? connectError.message : "State push websocket connection failed");
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        if (!active || !socket) {
          return;
        }
        reconnectAttempt = 0;
        setWsConnected(true);
        setIsOnline(true);
        setError(null);
        watchRequestIdRef.current += 1;
        const watchPayload = {
          type: "watch",
          requestId: `watch-${watchRequestIdRef.current}`,
          stateIds: watchedStateIdsRef.current,
        };
        socket.send(JSON.stringify(watchPayload));
      };

      socket.onmessage = (event) => {
        if (!active) {
          return;
        }

        try {
          const payload = JSON.parse(String(event.data ?? ""));
          if (payload?.type !== "stateBatch") {
            return;
          }
          const rawStates = payload?.states;
          if (!rawStates || typeof rawStates !== "object" || Array.isArray(rawStates)) {
            return;
          }
          queueIncomingStateBatch(rawStates as StateSnapshot);
        } catch {
          // Ignore malformed websocket payloads; polling fallback stays active.
        }
      };

      socket.onclose = () => {
        if (!active) {
          return;
        }
        setWsConnected(false);
        scheduleReconnect();
      };

      socket.onerror = () => {
        if (!active) {
          return;
        }
        setWsConnected(false);
      };
    };

    connect();

    return () => {
      active = false;
      setWsConnected(false);
      clearReconnectTimer();
      if (stateBatchTimer) {
        clearTimeout(stateBatchTimer);
      }
      pendingStateBatch = {};
      socketRef.current = null;
      if (socket) {
        try {
          socket.close();
        } catch {
          // Ignore best-effort socket close errors.
        }
      }
    };
  }, [documentVisible, shouldUseStatePushWebSocket, stateStore, statePushWsUrl]);

  useEffect(() => {
    if (!documentVisible) {
      return;
    }
    if (shouldUseStatePushWebSocket && wsConnected) {
      return;
    }

    let active = true;
    let syncInFlight = false;
    let syncPending = false;

    const sync = async () => {
      if (syncInFlight) {
        syncPending = true;
        return;
      }
      syncInFlight = true;
      try {
        const next = await client.readStates(watchedStateIds);
        if (active) {
          stateStore.applyBatch(next);
          setStateWrites((current) => resolveStateWriteFeedback(current, stateStore.getSnapshot()));
          setError(null);
          setIsOnline(true);
        }
      } catch (syncError) {
        if (active) {
          setError(syncError instanceof Error ? syncError.message : "State sync failed");
          setIsOnline(false);
        }
      } finally {
        syncInFlight = false;
        if (active && syncPending) {
          syncPending = false;
          void sync();
        }
      }
    };

    void sync();
    client.primeObjectCache();
    const timer = setInterval(() => {
      void sync();
    }, Math.max(250, config.pollingMs));

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [client, config.pollingMs, documentVisible, shouldUseStatePushWebSocket, stateStore, watchedStateIds, wsConnected]);

  const writeStateTracked = async (stateId: string, value: unknown) => {
    const startedAt = Date.now();

    setStateWrites((current) => ({
      ...current,
      [stateId]: {
        expectedValue: value,
        status: "pending",
        updatedAt: startedAt,
      },
    }));

    try {
      await client.writeState(stateId, value);
    } catch (writeError) {
      setStateWrites((current) => ({
        ...current,
        [stateId]: {
          expectedValue: value,
          status: "error",
          updatedAt: Date.now(),
        },
      }));
      throw writeError;
    }
  };

  return {
    client,
    error,
    isOnline,
    stateStore,
    stateWrites,
    writeStateTracked,
  };
}

export function useWidgetIoBrokerStates(store: IoBrokerStateStore, widget: WidgetConfig) {
  const stateIds = useMemo(() => {
    const mobileVariant = resolveMobileWidget(widget);
    return normalizeStateIds([...collectWidgetStateIds(widget), ...collectWidgetStateIds(mobileVariant)]);
  }, [widget]);
  return useIoBrokerStateSelection(store, stateIds);
}

function buildStatePushWebSocketUrl(config: DashboardSettings) {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return "";
  }

  const configuredBase = (config.iobroker.baseUrl || "").trim();
  const baseUrl = (configuredBase || window.location.origin || "").trim();
  if (!baseUrl) {
    return "";
  }

  const adapterBasePath = normalizeAdapterBasePath(config.iobroker.adapterBasePath);
  const wsPath = adapterBasePath.endsWith("/api")
    ? `${adapterBasePath.slice(0, -4)}/ws`
    : `${adapterBasePath}/ws`;

  try {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = wsPath;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeAdapterBasePath(rawPath?: string) {
  const trimmed = String(rawPath || "/smarthome-dashboard-v2/api").trim();
  if (!trimmed) {
    return "/smarthome-dashboard-v2/api";
  }
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

function buildWatchedStateSnapshot(
  previous: StateSnapshot,
  incoming: StateSnapshot,
  watchedStateIds: string[]
) {
  const next: StateSnapshot = {};

  for (const stateId of watchedStateIds) {
    if (Object.prototype.hasOwnProperty.call(incoming, stateId)) {
      next[stateId] = incoming[stateId];
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(previous, stateId)) {
      next[stateId] = previous[stateId];
    }
  }

  return next;
}

function areStateSnapshotsEqual(current: StateSnapshot, next: StateSnapshot, watchedStateIds: string[]) {
  if (Object.keys(current).length !== Object.keys(next).length) {
    return false;
  }

  for (const stateId of watchedStateIds) {
    if (!Object.is(current[stateId], next[stateId])) {
      return false;
    }
  }

  return true;
}

function resolveStateWriteFeedback(
  current: Record<string, StateWriteFeedback>,
  nextStates: StateSnapshot
) {
  const entries = Object.entries(current);
  if (!entries.length) {
    return current;
  }
  const now = Date.now();
  let changed = false;
  const nextEntries = entries.reduce<Record<string, StateWriteFeedback>>((acc, [stateId, feedback]) => {
    const actualValue = nextStates[stateId];

    if (feedback.status === "pending" && matchesExpectedValue(actualValue, feedback.expectedValue)) {
      acc[stateId] = {
        ...feedback,
        status: "confirmed",
        updatedAt: now,
      };
      changed = true;
      return acc;
    }

    if ((feedback.status === "confirmed" || feedback.status === "error") && now - feedback.updatedAt > 1800) {
      changed = true;
      return acc;
    }

    acc[stateId] = feedback;
    return acc;
  }, {});

  return changed ? nextEntries : current;
}

function matchesExpectedValue(actualValue: unknown, expectedValue: unknown) {
  if (actualValue === expectedValue) {
    return true;
  }

  const actualNormalized = normalizeComparableValue(actualValue);
  const expectedNormalized = normalizeComparableValue(expectedValue);
  return actualNormalized !== null && actualNormalized === expectedNormalized;
}

function normalizeComparableValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  const stringValue = String(value).trim().toLowerCase();
  if (stringValue === "true" || stringValue === "1" || stringValue === "on") {
    return "true";
  }
  if (stringValue === "false" || stringValue === "0" || stringValue === "off") {
    return "false";
  }

  const numericValue = Number(stringValue.replace(",", "."));
  if (Number.isFinite(numericValue) && stringValue !== "") {
    return String(numericValue);
  }

  return stringValue;
}
