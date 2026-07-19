import { MaterialCommunityIcons } from "@expo/vector-icons";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import { IoBrokerScriptEntry, ScriptWidgetConfig } from "../../types/dashboard";
import { palette } from "../../utils/theme";
import { playConfiguredUiSound } from "../../utils/uiSounds";

type ScriptWidgetProps = {
  config: ScriptWidgetConfig;
  client: IoBrokerClient;
  isActivePage?: boolean;
  onScrollModeChange?: (active: boolean) => void;
};

type ExplorerEntry = IoBrokerScriptEntry & {
  folderPath: string[];
  displayName: string;
};

type ExplorerFolder = {
  name: string;
  path: string[];
  count: number;
};

const SCRIPT_WS_PATH = "/smarthome-dashboard-v2/ws-scripts";
const WS_RECONNECT_BASE_DELAY_MS = 900;
const WS_RECONNECT_MAX_DELAY_MS = 9000;

export function ScriptWidget({ config, client, isActivePage = true, onScrollModeChange }: ScriptWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const [entries, setEntries] = useState<IoBrokerScriptEntry[]>([]);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [isScrollActive, setIsScrollActive] = useState(false);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const webRootRef = useRef<HTMLDivElement | null>(null);
  const webListRef = useRef<HTMLDivElement | null>(null);
  const entriesRef = useRef<IoBrokerScriptEntry[]>([]);
  const lastScrollSoundAtRef = useRef(0);
  const scrollModeCallbackRef = useRef(onScrollModeChange);

  useEffect(() => {
    scrollModeCallbackRef.current = onScrollModeChange;
  }, [onScrollModeChange]);

  const textColor = config.appearance?.textColor || palette.text;
  const mutedTextColor = config.appearance?.mutedTextColor || palette.textMuted;
  const refreshMs = clampInt(config.refreshMs, 3000, 500);
  const maxEntries = clampInt(config.maxEntries, 120, 1);
  const instanceFilter = (config.instanceFilter || "").trim();
  const textFilter = (config.textFilter || "").trim();
  const scriptWsUrl = useMemo(() => buildScriptWebSocketUrl(), []);
  const shouldUseScriptPushWebSocket = Platform.OS === "web" && runtimeActive && Boolean(scriptWsUrl);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const applyEntries = useCallback((nextEntries: IoBrokerScriptEntry[]) => {
    setEntries(nextEntries.slice(0, maxEntries));
    setError(null);
  }, [maxEntries]);

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
    if (!shouldUseScriptPushWebSocket || !scriptWsUrl) {
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
        socket = new WebSocket(scriptWsUrl);
      } catch (connectError) {
        setWsConnected(false);
        setError(connectError instanceof Error ? connectError.message : "Script websocket connection failed");
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
            instance: instanceFilter,
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
            applyEntries(payload.entries as IoBrokerScriptEntry[]);
            return;
          }
          if (payload?.type === "entry" && payload?.entry && typeof payload.entry === "object") {
            const incoming = payload.entry as IoBrokerScriptEntry;
            const currentEntries = entriesRef.current || [];
            if (payload?.action === "remove") {
              applyEntries(currentEntries.filter((row) => row.stateId !== incoming.stateId));
              return;
            }
            const nextEntries = [incoming, ...currentEntries.filter((row) => row.stateId !== incoming.stateId)];
            applyEntries(nextEntries);
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
  }, [applyEntries, instanceFilter, maxEntries, scriptWsUrl, shouldUseScriptPushWebSocket, textFilter]);

  useEffect(() => {
    if (!runtimeActive) {
      return;
    }
    if (shouldUseScriptPushWebSocket && wsConnected) {
      return;
    }

    let active = true;
    let inFlight = false;
    let pendingSync = false;

    const sync = async () => {
      if (inFlight) {
        pendingSync = true;
        return;
      }
      inFlight = true;
      try {
        const scripts = await client.listScripts({
          limit: maxEntries,
          instance: instanceFilter,
          contains: textFilter,
        });
        if (active) {
          applyEntries(scripts);
        }
      } catch (syncError) {
        if (active) {
          setError(syncError instanceof Error ? syncError.message : "Skripte konnten nicht geladen werden");
        }
      } finally {
        inFlight = false;
        if (active && pendingSync) {
          pendingSync = false;
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
  }, [applyEntries, client, instanceFilter, maxEntries, refreshMs, runtimeActive, shouldUseScriptPushWebSocket, textFilter, wsConnected]);

  const includeInstanceRoot = useMemo(() => {
    if (instanceFilter) {
      return false;
    }
    const instances = new Set(entries.map((entry) => entry.instance));
    return instances.size > 1;
  }, [entries, instanceFilter]);

  const explorerEntries = useMemo(
    () => entries.map((entry) => toExplorerEntry(entry, includeInstanceRoot)),
    [entries, includeInstanceRoot]
  );

  const explorerListing = useMemo(
    () => buildExplorerListing(explorerEntries, currentPath),
    [currentPath, explorerEntries]
  );

  useEffect(() => {
    if (!currentPath.length) {
      return;
    }

    let nextPath = currentPath;
    while (nextPath.length > 0 && !hasPathPrefix(explorerEntries, nextPath)) {
      nextPath = nextPath.slice(0, -1);
    }

    if (nextPath.length !== currentPath.length) {
      setCurrentPath(nextPath);
    }
  }, [currentPath, explorerEntries]);

  const statusText = useMemo(() => {
    if (error) {
      return error;
    }
    return `${entries.length} Skripte`;
  }, [entries.length, error]);

  const playPressSound = (key: string) => {
    playConfiguredUiSound(config.interactionSounds?.press, "tap", `${config.id}:${key}`);
  };

  const playScrollSound = () => {
    const now = Date.now();
    if (now - lastScrollSoundAtRef.current < 190) {
      return;
    }
    lastScrollSoundAtRef.current = now;
    playConfiguredUiSound(config.interactionSounds?.scroll, "swipe", `${config.id}:scroll`);
  };

  const toggleScript = async (entry: IoBrokerScriptEntry) => {
    if (pending[entry.stateId]) {
      return;
    }

    setPending((current) => ({ ...current, [entry.stateId]: true }));
    setEntries((current) =>
      current.map((row) =>
        row.stateId === entry.stateId
          ? {
              ...row,
              enabled: !entry.enabled,
            }
          : row
      )
    );

    try {
      await client.writeState(entry.stateId, !entry.enabled);
      setError(null);
    } catch (toggleError) {
      setEntries((current) =>
        current.map((row) =>
          row.stateId === entry.stateId
            ? {
                ...row,
                enabled: entry.enabled,
              }
            : row
        )
      );
      setError(toggleError instanceof Error ? toggleError.message : "Skript konnte nicht geschaltet werden");
    } finally {
      setPending((current) => ({ ...current, [entry.stateId]: false }));
    }
  };

  const activateScrollMode = () => {
    setIsScrollActive(true);
  };

  const goToPath = (path: string[]) => {
    playPressSound(`explorer:${buildSoundKey(path.join("/"))}`);
    setCurrentPath(path);
  };

  const folderRows = explorerListing.folders.map((folder) => (
    <Pressable
      key={`folder:${folder.path.join("/")}`}
      onPress={() => {
        setIsScrollActive(true);
        goToPath(folder.path);
      }}
      style={[styles.row, styles.folderRow]}
    >
      <MaterialCommunityIcons color="#9ec3ff" name="folder-outline" size={18} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.name, { color: textColor }]}>
          {folder.name}
        </Text>
        <Text numberOfLines={1} style={[styles.instance, { color: mutedTextColor }]}>
          {folder.count} Skripte
        </Text>
      </View>
      <MaterialCommunityIcons color={mutedTextColor} name="chevron-right" size={18} />
    </Pressable>
  ));

  const scriptRows = explorerListing.scripts.map((entry) => {
    const isPending = Boolean(pending[entry.stateId]);
    const icon = entry.enabled ? "pause-circle-outline" : "play-circle-outline";
    const iconColor = entry.enabled ? "#f8c16f" : "#95e9b8";
    return (
      <View key={entry.stateId} style={styles.row}>
        <View style={styles.rowText}>
          <Text numberOfLines={1} style={[styles.name, { color: textColor }]}>
            {entry.displayName}
          </Text>
          <Text numberOfLines={1} style={[styles.instance, { color: mutedTextColor }]}>
            {entry.instance}
          </Text>
        </View>
        <Pressable
          disabled={isPending}
          onPress={() => {
            setIsScrollActive(true);
            playPressSound(`toggle:${buildSoundKey(entry.stateId)}`);
            void toggleScript(entry);
          }}
          style={[
            styles.actionButton,
            isPending ? styles.actionButtonDisabled : null,
          ]}
        >
          <MaterialCommunityIcons color={iconColor} name={icon} size={22} />
        </Pressable>
      </View>
    );
  });

  const emptyText =
    !entries.length
      ? "Keine JavaScript-Skripte gefunden."
      : explorerListing.scripts.length === 0 && explorerListing.folders.length === 0
        ? "Keine Eintraege in diesem Ordner."
        : null;

  const breadcrumb = ["Root", ...currentPath];

  const listContent = [
    <View key="explorer-bar" style={styles.explorerBar}>
      {breadcrumb.map((segment, index) => (
        <Pressable
          key={`crumb:${segment}:${index}`}
          onPress={() => {
            setIsScrollActive(true);
            goToPath(index === 0 ? [] : currentPath.slice(0, index));
          }}
          style={styles.breadcrumbChip}
        >
          {index === 0 ? <MaterialCommunityIcons color={mutedTextColor} name="home-outline" size={13} /> : null}
          <Text numberOfLines={1} style={[styles.breadcrumbLabel, { color: mutedTextColor }]}>
            {segment}
          </Text>
        </Pressable>
      ))}
    </View>,
    ...folderRows,
    ...scriptRows,
    emptyText ? (
      <Text key="empty" style={[styles.empty, { color: mutedTextColor }]}>
        {emptyText}
      </Text>
    ) : null,
  ].filter(Boolean);

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
              outline: isScrollActive ? "1px solid rgba(149, 233, 184, 0.4)" : "none",
            },
          },
          createElement("div", { style: webScrollContentStyle }, ...listContent)
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
            {listContent}
          </ScrollView>
        );

  const content = (
    <View style={[styles.container, isScrollActive ? styles.containerActive : null]}>
      <View style={styles.metaRow}>
        <Text numberOfLines={1} style={[styles.metaText, { color: mutedTextColor }]}>
          {instanceFilter || "Alle Instanzen"}
        </Text>
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

function buildScriptWebSocketUrl() {
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
    url.pathname = SCRIPT_WS_PATH;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function toExplorerEntry(entry: IoBrokerScriptEntry, includeInstanceRoot: boolean): ExplorerEntry {
  const suffix = resolveScriptSuffix(entry.stateId);
  const suffixSegments = suffix.split(".").map((part) => part.trim()).filter(Boolean);
  const labelSegments = normalizeLabelSegments(entry.name);

  let folderPath = suffixSegments.slice(0, Math.max(0, suffixSegments.length - 1));
  let displayName = labelSegments.length ? labelSegments[labelSegments.length - 1] : "";

  if (labelSegments.length > 1) {
    folderPath = labelSegments.slice(0, -1);
  }

  if (!displayName) {
    displayName = labelSegments[0] || suffixSegments[suffixSegments.length - 1] || entry.name || entry.stateId;
  }

  displayName = resolveScriptDisplayName(displayName, suffixSegments);

  if (includeInstanceRoot) {
    folderPath = [entry.instance, ...folderPath];
  }

  return {
    ...entry,
    folderPath,
    displayName,
  };
}

function resolveScriptSuffix(stateId: string) {
  const marker = ".scriptEnabled.";
  const markerIndex = stateId.indexOf(marker);
  if (markerIndex < 0) {
    return stateId;
  }
  return stateId.slice(markerIndex + marker.length);
}

function normalizeLabelSegments(value: string) {
  return String(value || "")
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function resolveScriptDisplayName(rawValue: string, suffixSegments: string[]) {
  const cleaned = stripKnownScriptPrefixes(rawValue);
  if (!cleaned) {
    return suffixSegments[suffixSegments.length - 1] || "";
  }

  if (!cleaned.includes(" ") && cleaned.includes(".")) {
    const dottedSegments = cleaned.split(".").map((segment) => segment.trim()).filter(Boolean);
    if (dottedSegments.length > 0) {
      return dottedSegments[dottedSegments.length - 1];
    }
  }

  return cleaned;
}

function stripKnownScriptPrefixes(value: string) {
  return String(value || "")
    .trim()
    .replace(/^javascript\.\d+\.scriptEnabled\./i, "")
    .replace(/^scriptEnabled\./i, "")
    .replace(/^script\.js\./i, "");
}

function hasPathPrefix(entries: ExplorerEntry[], path: string[]) {
  return entries.some((entry) => {
    if (entry.folderPath.length < path.length) {
      return false;
    }
    return path.every((segment, index) => entry.folderPath[index] === segment);
  });
}

function buildExplorerListing(entries: ExplorerEntry[], currentPath: string[]) {
  const folders = new Map<string, ExplorerFolder>();
  const scripts: ExplorerEntry[] = [];

  entries.forEach((entry) => {
    if (!currentPath.every((segment, index) => entry.folderPath[index] === segment)) {
      return;
    }

    const nextSegment = entry.folderPath[currentPath.length];
    if (nextSegment) {
      const nextPath = entry.folderPath.slice(0, currentPath.length + 1);
      const key = nextPath.join("/");
      const existing = folders.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        folders.set(key, {
          name: nextSegment,
          path: nextPath,
          count: 1,
        });
      }
      return;
    }

    scripts.push(entry);
  });

  return {
    folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name, "de")),
    scripts: scripts.sort((a, b) => {
      const byName = a.displayName.localeCompare(b.displayName, "de");
      if (byName !== 0) {
        return byName;
      }
      return a.stateId.localeCompare(b.stateId, "de");
    }),
  };
}

function buildSoundKey(value: string) {
  return value.replace(/[^a-zA-Z0-9:_-]+/g, "_").slice(0, 72);
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
    borderColor: "rgba(149, 233, 184, 0.42)",
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
  metaText: {
    fontSize: 11,
    fontWeight: "700",
    maxWidth: "48%",
  },
  explorerBar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 2,
  },
  breadcrumbChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  breadcrumbLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  empty: {
    fontSize: 12,
    fontWeight: "600",
    paddingVertical: 6,
  },
  row: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.02)",
    paddingHorizontal: 8,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  folderRow: {
    backgroundColor: "rgba(120, 170, 255, 0.08)",
    borderColor: "rgba(120, 170, 255, 0.2)",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    fontSize: 13,
    fontWeight: "700",
  },
  instance: {
    fontSize: 11,
    fontWeight: "600",
  },
  actionButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  actionButtonDisabled: {
    opacity: 0.55,
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
