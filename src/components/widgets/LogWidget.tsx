import { MaterialCommunityIcons } from "@expo/vector-icons";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import { IoBrokerLogEntry, LogWidgetConfig } from "../../types/dashboard";
import { palette } from "../../utils/theme";
import { playConfiguredUiSound } from "../../utils/uiSounds";

type LogWidgetProps = {
  config: LogWidgetConfig;
  client: IoBrokerClient;
  isActivePage?: boolean;
  onScrollModeChange?: (active: boolean) => void;
  notificationsEnabled?: boolean;
};

const SEVERITY_ORDER: Record<NonNullable<LogWidgetConfig["minSeverity"]>, number> = {
  silly: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

const MONO_FONT = Platform.select({
  web: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  default: "monospace",
});

const MAX_LOG_ENTRIES_HARD_LIMIT = 200;
const LOG_WS_PATH = "/smarthome-dashboard-v2/ws-logs";
const WS_RECONNECT_BASE_DELAY_MS = 900;
const WS_RECONNECT_MAX_DELAY_MS = 9000;

export function LogWidget({
  config,
  client,
  isActivePage = true,
  onScrollModeChange,
  notificationsEnabled = true,
}: LogWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const [entries, setEntries] = useState<IoBrokerLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [quickSeverity, setQuickSeverity] = useState<"base" | "warn" | "error">("base");
  const [isScrollActive, setIsScrollActive] = useState(false);
  const webRootRef = useRef<HTMLDivElement | null>(null);
  const webListRef = useRef<HTMLDivElement | null>(null);
  const entriesRef = useRef<IoBrokerLogEntry[]>([]);
  const lastScrollSoundAtRef = useRef(0);
  const latestSeenTimestampRef = useRef(0);
  const scrollModeCallbackRef = useRef(onScrollModeChange);

  useEffect(() => {
    scrollModeCallbackRef.current = onScrollModeChange;
  }, [onScrollModeChange]);

  const textColor = config.appearance?.textColor || palette.text;
  const mutedTextColor = config.appearance?.mutedTextColor || palette.textMuted;
  const refreshMs = clampInt(config.refreshMs, 2000, 500);
  const maxEntries = clampIntMax(config.maxEntries, 80, 5, MAX_LOG_ENTRIES_HARD_LIMIT);
  const configuredMinSeverity = normalizeSeverity(config.minSeverity);
  const requestMinSeverity = quickSeverity === "base" ? configuredMinSeverity : quickSeverity;
  const sourceFilter = (config.sourceFilter || "").trim();
  const textFilter = (config.textFilter || "").trim();
  const logWsUrl = useMemo(() => buildLogPushWebSocketUrl(), []);
  const shouldUseLogPushWebSocket = Platform.OS === "web" && runtimeActive && Boolean(logWsUrl);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const applyEntries = useCallback(
    (nextEntries: IoBrokerLogEntry[], suppressIncomingSound = false) => {
      const cappedLogs = nextEntries.slice(0, MAX_LOG_ENTRIES_HARD_LIMIT);
      setEntries(cappedLogs);
      setError(null);

      const nextLatestTimestamp = cappedLogs.reduce(
        (largest, entry) => Math.max(largest, Number.isFinite(entry.ts) ? entry.ts : 0),
        0
      );

      if (suppressIncomingSound || !notificationsEnabled) {
        latestSeenTimestampRef.current = Math.max(latestSeenTimestampRef.current, nextLatestTimestamp);
        return;
      }

      if (nextLatestTimestamp <= latestSeenTimestampRef.current) {
        return;
      }

      const incomingEntries = cappedLogs.filter(
        (entry) => Number.isFinite(entry.ts) && entry.ts > latestSeenTimestampRef.current
      );
      latestSeenTimestampRef.current = nextLatestTimestamp;

      const hasError = incomingEntries.some((entry) => entry.severity === "error");
      const hasWarn = incomingEntries.some((entry) => entry.severity === "warn");
      if (hasError) {
        playConfiguredUiSound(
          config.interactionSounds?.notifyError?.length
            ? config.interactionSounds.notifyError
            : config.interactionSounds?.notify,
          "page",
          `${config.id}:incoming-log:error`
        );
      } else if (hasWarn) {
        playConfiguredUiSound(
          config.interactionSounds?.notifyWarn?.length
            ? config.interactionSounds.notifyWarn
            : config.interactionSounds?.notify,
          "page",
          `${config.id}:incoming-log:warn`
        );
      } else {
        playConfiguredUiSound(config.interactionSounds?.notify, "page", `${config.id}:incoming-log`);
      }
    },
    [
      config.id,
      config.interactionSounds?.notify,
      config.interactionSounds?.notifyError,
      config.interactionSounds?.notifyWarn,
      notificationsEnabled,
    ]
  );

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined" || !isScrollActive) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const root = webRootRef.current;
      const target = event.target;
      if (!root || !(target instanceof Node)) {
        return;
      }
      if (root.contains(target)) {
        return;
      }
      setIsScrollActive(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [isScrollActive]);

  useEffect(() => {
    scrollModeCallbackRef.current?.(isScrollActive);
  }, [isScrollActive]);

  useEffect(() => {
    return () => {
      scrollModeCallbackRef.current?.(false);
    };
  }, []);

  useEffect(() => {
    if (!shouldUseLogPushWebSocket || !logWsUrl) {
      setWsConnected(false);
      return;
    }

    let active = true;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;

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
        socket = new WebSocket(logWsUrl);
      } catch (connectError) {
        setWsConnected(false);
        setError(connectError instanceof Error ? connectError.message : "Log websocket connection failed");
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        if (!active || !socket) {
          return;
        }
        reconnectAttempt = 0;
        setWsConnected(true);
        setError(null);
        socket.send(
          JSON.stringify({
            type: "watch",
            limit: maxEntries,
            minSeverity: requestMinSeverity,
            source: sourceFilter,
            contains: textFilter,
          })
        );
      };

      socket.onmessage = (event) => {
        if (!active) {
          return;
        }

        try {
          const payload = JSON.parse(String(event.data ?? ""));
          if (payload?.type === "snapshot" && Array.isArray(payload?.entries)) {
            applyEntries(payload.entries as IoBrokerLogEntry[], true);
            return;
          }
          if (payload?.type === "entry" && payload?.entry && typeof payload.entry === "object") {
            const incomingEntry = payload.entry as IoBrokerLogEntry;
            const incomingKey = `${incomingEntry.id}-${incomingEntry.ts}-${incomingEntry.from}-${incomingEntry.message}`;
            const currentEntries = entriesRef.current || [];
            const nextEntries = [incomingEntry, ...currentEntries.filter((row) => {
              const rowKey = `${row.id}-${row.ts}-${row.from}-${row.message}`;
              return rowKey !== incomingKey;
            })];
            applyEntries(nextEntries, false);
            return;
          }
          if (payload?.type === "error" && typeof payload?.message === "string") {
            setError(payload.message);
          }
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
      if (socket) {
        try {
          socket.close();
        } catch {
          // Ignore best-effort socket close failures.
        }
      }
    };
  }, [applyEntries, logWsUrl, maxEntries, requestMinSeverity, shouldUseLogPushWebSocket, sourceFilter, textFilter]);

  useEffect(() => {
    if (!runtimeActive) {
      return;
    }
    if (shouldUseLogPushWebSocket && wsConnected) {
      return;
    }
    let active = true;
    let inFlight = false;
    let pending = false;
    let skipIncomingSound = true;

    const sync = async () => {
      if (inFlight) {
        pending = true;
        return;
      }

      inFlight = true;
      try {
        const logs = await client.readLogs({
          limit: maxEntries,
          minSeverity: requestMinSeverity,
          source: sourceFilter,
          contains: textFilter,
        });

        if (active) {
          const filteredLogs =
            quickSeverity === "warn"
              ? logs.filter((entry) => entry.severity === "warn")
              : quickSeverity === "error"
                ? logs.filter((entry) => entry.severity === "error")
                : logs;
          applyEntries(filteredLogs, skipIncomingSound);
          skipIncomingSound = false;
        }
      } catch (syncError) {
        if (active) {
          setError(syncError instanceof Error ? syncError.message : "Logs konnten nicht geladen werden");
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
  }, [
    applyEntries,
    client,
    maxEntries,
    quickSeverity,
    refreshMs,
    requestMinSeverity,
    runtimeActive,
    shouldUseLogPushWebSocket,
    sourceFilter,
    textFilter,
    wsConnected,
  ]);

  const levelLabel = quickSeverity === "base" ? configuredMinSeverity.toUpperCase() : `${quickSeverity.toUpperCase()} ONLY`;

  const statusText = useMemo(() => {
    if (error) {
      return error;
    }
    return isScrollActive ? "Widget-Scroll aktiv" : "Widget-Scroll inaktiv";
  }, [error, isScrollActive]);

  const playScrollSound = () => {
    const now = Date.now();
    if (now - lastScrollSoundAtRef.current < 190) {
      return;
    }
    lastScrollSoundAtRef.current = now;
    playConfiguredUiSound(config.interactionSounds?.scroll, "swipe", `${config.id}:scroll`);
  };

  const activateScrollMode = () => {
    setIsScrollActive(true);
  };

  const toggleWarnFilter = () => {
    playConfiguredUiSound(config.interactionSounds?.press, "tap", `${config.id}:filter:warn`);
    setQuickSeverity((current) => (current === "warn" ? "base" : "warn"));
  };

  const toggleErrorFilter = () => {
    playConfiguredUiSound(config.interactionSounds?.press, "tap", `${config.id}:filter:error`);
    setQuickSeverity((current) => (current === "error" ? "base" : "error"));
  };

  const logRows = entries.map((entry) => (
    <View key={`${entry.id}-${entry.ts}-${entry.from}`} style={styles.row}>
      <Text style={[styles.timestamp, { color: mutedTextColor }]}>{formatTimestamp(entry.ts)}</Text>
      <Text style={[styles.severity, { color: colorForSeverity(entry.severity) }]}> {entry.severity.toUpperCase()} </Text>
      <Text numberOfLines={1} style={[styles.source, { color: mutedTextColor }]}>
        {entry.from || "unknown"}
      </Text>
      <Text style={[styles.message, { color: textColor }]}>{entry.message}</Text>
    </View>
  ));

  const scrollContainer =
    Platform.OS === "web"
      ? createElement(
          "div",
          {
            onPointerDown: () => setIsScrollActive(true),
            onScroll: () => {
              if (isScrollActive) {
                playScrollSound();
              }
            },
            onWheel: (event: any) => {
              if (!isScrollActive) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              const list = webListRef.current;
              if (!list) {
                return;
              }
              list.scrollTop += event.deltaY;
              playScrollSound();
            },
            ref: webListRef,
            style: {
              ...webScrollStyle,
              overflowY: isScrollActive ? "auto" : "hidden",
              outline: isScrollActive ? "1px solid rgba(248, 193, 111, 0.42)" : "none",
            },
          },
          createElement("div", { style: webScrollContentStyle }, ...logRows)
        )
      : (
          <ScrollView
            nestedScrollEnabled
            onScrollBeginDrag={() => {
              if (isScrollActive) {
                playScrollSound();
              }
            }}
            scrollEnabled={isScrollActive}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
          >
            {logRows}
          </ScrollView>
        );

  const content = (
    <View style={[styles.container, isScrollActive ? styles.containerActive : null]}>
      <View style={styles.metaRow}>
        <View style={styles.metaLeft}>
          <Text style={[styles.metaText, { color: mutedTextColor }]}>Level: {levelLabel}</Text>
          <View style={styles.filterButtonRow}>
            <Pressable
              onPress={toggleWarnFilter}
              style={[
                styles.filterButton,
                quickSeverity === "warn" ? styles.filterButtonActive : null,
              ]}
            >
              <MaterialCommunityIcons
                color={quickSeverity === "warn" ? "#08111f" : "#f8c16f"}
                name="alert-circle"
                size={15}
              />
            </Pressable>
            <Pressable
              onPress={toggleErrorFilter}
              style={[
                styles.filterButton,
                quickSeverity === "error" ? styles.filterButtonActive : null,
              ]}
            >
              <MaterialCommunityIcons
                color={quickSeverity === "error" ? "#08111f" : "#ff7d7d"}
                name="alert"
                size={15}
              />
            </Pressable>
          </View>
        </View>
        <Text numberOfLines={1} style={[styles.metaText, { color: error ? palette.danger : mutedTextColor, maxWidth: "58%" }]}>
          {statusText}
        </Text>
      </View>
      {scrollContainer}
    </View>
  );

  if (Platform.OS === "web") {
    return createElement(
      "div",
      {
        ref: webRootRef,
        onPointerDown: activateScrollMode,
        style: webRootStyle,
      },
      content
    );
  }

  return (
    <Pressable onPressIn={activateScrollMode} style={styles.touchShell}>
      {content}
    </Pressable>
  );
}

function clampInt(value: number | undefined, fallback: number, min: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.round(value));
}

function buildLogPushWebSocketUrl() {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return "";
  }

  try {
    const baseUrl = window.location.origin || "";
    if (!baseUrl) {
      return "";
    }
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = LOG_WS_PATH;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function clampIntMax(value: number | undefined, fallback: number, min: number, max: number) {
  return Math.min(max, clampInt(value, fallback, min));
}

function normalizeSeverity(value: LogWidgetConfig["minSeverity"]) {
  if (value && value in SEVERITY_ORDER) {
    return value;
  }
  return "info";
}

function formatTimestamp(value: number) {
  if (!Number.isFinite(value)) {
    return "--:--:--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function colorForSeverity(value: IoBrokerLogEntry["severity"]) {
  if (value === "error") {
    return "#ff7d7d";
  }
  if (value === "warn") {
    return "#f8c16f";
  }
  if (value === "debug" || value === "silly") {
    return "#87b8ff";
  }
  return "#95e9b8";
}

const styles = StyleSheet.create({
  touchShell: {
    flex: 1,
  },
  container: {
    flex: 1,
    minHeight: 0,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(6, 10, 18, 0.5)",
    overflow: "hidden",
  },
  containerActive: {
    borderColor: "rgba(248, 193, 111, 0.42)",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(5, 8, 14, 0.55)",
    gap: 8,
  },
  metaLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaText: {
    fontSize: 11,
    fontWeight: "700",
  },
  filterButtonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  filterButton: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  filterButtonActive: {
    backgroundColor: palette.accent,
    borderColor: "rgba(92,124,255,0.5)",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  row: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.02)",
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 3,
  },
  timestamp: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  severity: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.45,
  },
  source: {
    fontSize: 10,
    fontFamily: MONO_FONT,
  },
  message: {
    fontSize: 12,
    lineHeight: 16,
  },
});

const webRootStyle = {
  display: "flex",
  flexDirection: "column" as const,
  width: "100%",
  height: "100%",
  minHeight: 0,
};

const webScrollStyle = {
  flex: 1,
  minHeight: 0,
  width: "100%",
  overscrollBehaviorY: "contain" as const,
};

const webScrollContentStyle = {
  padding: 10,
  display: "flex",
  flexDirection: "column" as const,
  gap: 8,
};
