import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, ImageBackground, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useDashboardConfig } from "../../context/DashboardConfigContext";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import { TelegramWidgetConfig, TelegramWidgetHistoryEntry } from "../../types/dashboard";
import { palette } from "../../utils/theme";
import { playConfiguredUiSound } from "../../utils/uiSounds";

type TelegramWidgetProps = {
  config: TelegramWidgetConfig;
  client: IoBrokerClient;
  isActivePage?: boolean;
  onScrollModeChange?: (active: boolean) => void;
  notificationsEnabled?: boolean;
};

const MAX_HISTORY_ENTRIES_HARD_LIMIT = 200;
const TELEGRAM_WS_PATH = "/smarthome-dashboard-v2/ws-telegram";
const WS_RECONNECT_BASE_DELAY_MS = 900;
const WS_RECONNECT_MAX_DELAY_MS = 9000;
const THUMB_MAX_WIDTH = 220;
const THUMB_MIN_HEIGHT = 90;
const THUMB_MAX_HEIGHT = 220;

export function TelegramWidget({
  config,
  client,
  isActivePage = true,
  onScrollModeChange,
  notificationsEnabled = true,
}: TelegramWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const { dashboardPages, activePageId, setActivePage } = useDashboardConfig();
  const [entries, setEntries] = useState<TelegramWidgetHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [isScrollActive, setIsScrollActive] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [sending, setSending] = useState(false);
  const [pressingButtons, setPressingButtons] = useState<Set<string>>(new Set());
  const pendingButtonKeysRef = useRef<Set<string>>(new Set());
  const webRootRef = useRef<HTMLDivElement | null>(null);
  const webListRef = useRef<HTMLDivElement | null>(null);
  const nativeListRef = useRef<ScrollView | null>(null);
  const lastScrollSoundAtRef = useRef(0);
  const latestSeenTimestampRef = useRef(0);
  const scrollModeCallbackRef = useRef(onScrollModeChange);

  useEffect(() => {
    scrollModeCallbackRef.current = onScrollModeChange;
  }, [onScrollModeChange]);

  const textColor = config.appearance?.textColor || palette.text;
  const mutedTextColor = config.appearance?.mutedTextColor || palette.textMuted;
  const refreshMs = clampInt(config.refreshMs, 2500, 800);
  const maxEntries = clampIntMax(config.maxEntries, 200, 10, MAX_HISTORY_ENTRIES_HARD_LIMIT);
  const composerEnabled = config.composerEnabled !== false;
  const backgroundBlur = Math.min(24, clampInt(config.backgroundImageBlur, 8, 0));
  const telegramWsUrl = useMemo(() => buildTelegramPushWebSocketUrl(), []);
  const shouldUseTelegramPushWebSocket = Platform.OS === "web" && runtimeActive && Boolean(telegramWsUrl);

  const scrollToBottom = useCallback(() => {
    if (Platform.OS === "web") {
      const list = webListRef.current;
      if (list) {
        list.scrollTop = list.scrollHeight;
      }
      return;
    }
    nativeListRef.current?.scrollToEnd({ animated: false });
  }, []);

  const applyEntries = useCallback(
    (nextEntries: TelegramWidgetHistoryEntry[], suppressIncomingSound = false) => {
      const cappedEntries = nextEntries.slice(-maxEntries);
      setEntries(cappedEntries);
      setError(null);

      const nextLatestTimestamp = cappedEntries.reduce(
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

      const incomingEntries = cappedEntries.filter(
        (entry) => Number.isFinite(entry.ts) && entry.ts > latestSeenTimestampRef.current
      );
      latestSeenTimestampRef.current = nextLatestTimestamp;

      if (incomingEntries.some((entry) => entry.direction === "in")) {
        playConfiguredUiSound(config.interactionSounds?.notify, "page", `${config.id}:incoming-telegram`);
      }
    },
    [config.id, config.interactionSounds?.notify, maxEntries, notificationsEnabled]
  );

  useEffect(() => {
    scrollToBottom();
  }, [entries, scrollToBottom]);

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
    if (!shouldUseTelegramPushWebSocket || !telegramWsUrl) {
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
        socket = new WebSocket(telegramWsUrl);
      } catch (connectError) {
        setWsConnected(false);
        setError(connectError instanceof Error ? connectError.message : "Telegram websocket connection failed");
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
      };

      socket.onmessage = (event) => {
        if (!active) {
          return;
        }

        try {
          const payload = JSON.parse(String(event.data ?? ""));
          if (payload?.type === "snapshot" && Array.isArray(payload?.entries)) {
            applyEntries(payload.entries as TelegramWidgetHistoryEntry[], false);
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
      clearReconnectTimer();
      if (socket) {
        try {
          socket.close();
        } catch {
          // Ignore best-effort socket close failures.
        }
      }
    };
  }, [applyEntries, shouldUseTelegramPushWebSocket, telegramWsUrl]);

  useEffect(() => {
    if (!runtimeActive) {
      return;
    }
    if (shouldUseTelegramPushWebSocket && wsConnected) {
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
        const history = await client.readTelegramHistory();
        if (active) {
          applyEntries(history, skipIncomingSound);
          skipIncomingSound = false;
        }
      } catch (syncError) {
        if (active) {
          setError(syncError instanceof Error ? syncError.message : "Telegram-Verlauf konnte nicht geladen werden");
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
  }, [applyEntries, client, refreshMs, runtimeActive, shouldUseTelegramPushWebSocket, wsConnected]);

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

  const openCamera = useCallback(
    (cameraKey: string) => {
      playConfiguredUiSound(config.interactionSounds?.press, "tap", `${config.id}:camera:${cameraKey}`);
      // CameraWidget's maximizeStateId trigger only fires on a rising edge
      // (non-matching -> matching against the default boolean/"true" format),
      // so a monotonically increasing timestamp would never reliably match.
      // Pulse 0 -> 1 instead, which matches the default boolean trigger format.
      const stateId = `0_userdata.0.Telegram.Widget.cameraTriggers.${cameraKey}`;
      // If the camera that owns this trigger lives on a different page, switch to it first so
      // its CameraWidget is mounted (and seeded with the pre-pulse value) before we pulse the
      // trigger — otherwise nothing visible would react to the state change.
      const targetPage = dashboardPages.find((page) =>
        page.widgets.some((widget) => (widget as { maximizeStateId?: string }).maximizeStateId === stateId)
      );
      if (targetPage && targetPage.id !== activePageId) {
        setActivePage(targetPage.id);
      }
      void client.writeState(stateId, 0).then(() => client.writeState(stateId, 1));
    },
    [client, config.id, config.interactionSounds?.press, dashboardPages, activePageId, setActivePage]
  );

  const pressButtonChip = useCallback(
    async (entryId: string, callbackData: string) => {
      const key = `${entryId}:${callbackData}`;
      if (pendingButtonKeysRef.current.has(key)) {
        return;
      }
      pendingButtonKeysRef.current.add(key);
      setPressingButtons(new Set(pendingButtonKeysRef.current));
      playConfiguredUiSound(config.interactionSounds?.press, "tap", `${config.id}:button:${entryId}:${callbackData}`);
      try {
        await client.pressTelegramButton(callbackData);
      } catch (pressError) {
        setError(pressError instanceof Error ? pressError.message : "Telegram-Aktion konnte nicht ausgelöst werden");
      } finally {
        pendingButtonKeysRef.current.delete(key);
        setPressingButtons(new Set(pendingButtonKeysRef.current));
      }
    },
    [client, config.id, config.interactionSounds?.press]
  );

  const handleSend = async () => {
    const text = composerText.trim();
    if (!text || sending) {
      return;
    }
    playConfiguredUiSound(config.interactionSounds?.press, "tap", `${config.id}:send`);
    setSending(true);
    try {
      await client.sendTelegramMessage(text);
      setComposerText("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Telegram-Nachricht konnte nicht gesendet werden");
    } finally {
      setSending(false);
    }
  };

  const openButtonLink = useCallback(
    (url: string) => {
      playConfiguredUiSound(config.interactionSounds?.press, "tap", `${config.id}:button:link`);
      void Linking.openURL(url);
    },
    [config.id, config.interactionSounds?.press]
  );

  const messageRows = entries.map((entry) => {
    let pendingCallbackData: string | null = null;
    if (entry.buttons) {
      const pendingKeys: string[] = [];
      for (const button of entry.buttons) {
        if (button.callback_data && pressingButtons.has(`${entry.id}:${button.callback_data}`)) {
          pendingKeys.push(button.callback_data);
        }
      }
      // Joined with a separator that can't appear in callback_data itself, so this stays a single
      // primitive string prop (keeps TelegramMessageRow's React.memo comparison cheap) while still
      // letting multiple buttons in the same message show as pending at once.
      pendingCallbackData = pendingKeys.length > 0 ? pendingKeys.join("|") : null;
    }
    return (
      <TelegramMessageRow
        key={entry.id}
        entry={entry}
        client={client}
        textColor={textColor}
        mutedTextColor={mutedTextColor}
        onOpenCamera={openCamera}
        onPressButton={pressButtonChip}
        onOpenUrl={openButtonLink}
        pendingCallbackData={pendingCallbackData}
      />
    );
  });

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
              outline: isScrollActive ? "1px solid rgba(93, 168, 255, 0.42)" : "none",
            },
          },
          createElement("div", { style: webScrollContentStyle }, ...messageRows)
        )
      : (
          <ScrollView
            ref={nativeListRef}
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
            {messageRows}
          </ScrollView>
        );

  const content = (
    <View style={[styles.container, isScrollActive ? styles.containerActive : null]}>
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
      <View style={styles.metaRow}>
        <View style={styles.metaLeft}>
          <MaterialCommunityIcons
            color={wsConnected ? "#6cff8f" : mutedTextColor}
            name={wsConnected ? "wifi" : "wifi-off"}
            size={13}
          />
          <Text style={[styles.metaText, { color: mutedTextColor }]}>{entries.length} Nachrichten</Text>
        </View>
        <Text numberOfLines={1} style={[styles.metaText, { color: error ? palette.danger : mutedTextColor, maxWidth: "58%" }]}>
          {statusText}
        </Text>
      </View>
      {scrollContainer}
      {composerEnabled ? (
        <View style={styles.composerRow}>
          <TextInput
            multiline
            onChangeText={setComposerText}
            placeholder="Nachricht schreiben..."
            placeholderTextColor={mutedTextColor}
            style={[styles.composerInput, { color: textColor }]}
            value={composerText}
          />
          <Pressable
            disabled={sending || !composerText.trim()}
            onPress={handleSend}
            style={[styles.sendButton, !composerText.trim() || sending ? styles.sendButtonDisabled : null]}
          >
            <MaterialCommunityIcons color="#08111f" name="send" size={17} />
          </Pressable>
        </View>
      ) : null}
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

type TelegramMessageRowProps = {
  entry: TelegramWidgetHistoryEntry;
  client: IoBrokerClient;
  textColor: string;
  mutedTextColor: string;
  onOpenCamera: (cameraKey: string) => void;
  onPressButton: (entryId: string, callbackData: string) => void;
  pendingCallbackData: string | null;
  onOpenUrl: (url: string) => void;
};

const TelegramMessageRow = memo(function TelegramMessageRow({
  entry,
  client,
  textColor,
  mutedTextColor,
  onOpenCamera,
  onPressButton,
  pendingCallbackData,
  onOpenUrl,
}: TelegramMessageRowProps) {
  const isOutgoing = entry.direction === "out";
  const thumbUrl =
    entry.kind !== "photo"
      ? null
      : entry.localSnapshotKey
        ? client.telegramLocalSnapshotUrl(entry.localSnapshotKey, entry.localSnapshotTs ?? entry.ts)
        : entry.thumbFileId
          ? client.telegramThumbUrl(entry.thumbFileId, entry.thumbFileId)
          : null;
  const thumbSize =
    entry.localSnapshotWidth && entry.localSnapshotHeight
      ? {
          width: THUMB_MAX_WIDTH,
          height: Math.min(
            THUMB_MAX_HEIGHT,
            Math.max(THUMB_MIN_HEIGHT, Math.round((THUMB_MAX_WIDTH * entry.localSnapshotHeight) / entry.localSnapshotWidth)),
          ),
        }
      : { width: THUMB_MAX_WIDTH, height: 135 };

  return (
    <View style={[styles.row, isOutgoing ? styles.rowOutgoing : styles.rowIncoming]}>
      <View style={[styles.bubble, isOutgoing ? styles.bubbleOutgoing : styles.bubbleIncoming]}>
        <View style={styles.bubbleHeaderRow}>
          <Text numberOfLines={1} style={[styles.sender, { color: mutedTextColor }]}>
            {entry.sender || (isOutgoing ? "Ich" : "Unbekannt")}
          </Text>
          <Text style={[styles.timestamp, { color: mutedTextColor }]}>{formatTimestamp(entry.ts)}</Text>
        </View>
        {thumbUrl ? (
          <Pressable
            onPress={() => {
              if (entry.cameraKey) onOpenCamera(entry.cameraKey);
            }}
            disabled={!entry.cameraKey}
          >
            <Image resizeMode="cover" source={{ uri: thumbUrl }} style={[styles.thumb, thumbSize]} />
          </Pressable>
        ) : null}
        {entry.text ? <Text style={[styles.message, { color: textColor }]}>{entry.text}</Text> : null}
        {entry.kind === "photo" && entry.cameraKey ? (
          <Pressable onPress={() => onOpenCamera(entry.cameraKey)} style={styles.cameraButton}>
            <MaterialCommunityIcons color="#08111f" name="camera-outline" size={16} />
            <Text style={styles.cameraButtonLabel}>Kamera öffnen</Text>
          </Pressable>
        ) : null}
        {entry.buttons && entry.buttons.length > 0 ? (
          <View style={styles.buttonChipRow}>
            {entry.buttons.map((button, index) => {
              const isLinkButton = !button.callback_data && Boolean(button.url);
              const isPending =
                !isLinkButton &&
                Boolean(button.callback_data) &&
                (pendingCallbackData?.split("|") ?? []).includes(button.callback_data as string);
              const cameraKey = entry.cameraKey;
              const opensCamera = isLinkButton && Boolean(cameraKey);
              return (
                <Pressable
                  key={`${entry.id}-btn-${index}`}
                  disabled={isPending}
                  onPress={() => {
                    if (opensCamera && cameraKey) onOpenCamera(cameraKey);
                    else if (isLinkButton) onOpenUrl(button.url as string);
                    else onPressButton(entry.id, button.callback_data);
                  }}
                  style={[styles.buttonChip, isPending ? styles.buttonChipPending : null]}
                >
                  <Text style={styles.buttonChipLabel}>{button.text}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
});

function clampInt(value: number | undefined, fallback: number, min: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.round(value));
}

function clampIntMax(value: number | undefined, fallback: number, min: number, max: number) {
  return Math.min(max, clampInt(value, fallback, min));
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

function buildTelegramPushWebSocketUrl() {
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
    url.pathname = TELEGRAM_WS_PATH;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function formatTimestamp(value: number) {
  if (!Number.isFinite(value)) {
    return "--:--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
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
    position: "relative",
  },
  containerActive: {
    borderColor: "rgba(93, 168, 255, 0.42)",
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
    gap: 6,
  },
  metaText: {
    fontSize: 11,
    fontWeight: "700",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 12,
  },
  row: {
    width: "100%",
    flexDirection: "row",
  },
  rowIncoming: {
    justifyContent: "flex-start",
  },
  rowOutgoing: {
    justifyContent: "flex-start",
  },
  bubble: {
    maxWidth: "82%",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 6,
  },
  bubbleIncoming: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.08)",
  },
  bubbleOutgoing: {
    backgroundColor: "rgba(44, 108, 240, 0.22)",
    borderColor: "rgba(93, 168, 255, 0.32)",
  },
  bubbleHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sender: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  timestamp: {
    fontSize: 10,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
  },
  thumb: {
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  cameraButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    gap: 6,
    minHeight: 48,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#79b5ff",
  },
  cameraButtonLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#08111f",
  },
  buttonChipRow: {
    flexDirection: "column",
    gap: 8,
  },
  buttonChip: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  buttonChipPending: {
    opacity: 0.5,
  },
  buttonChipLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(5, 8, 14, 0.55)",
  },
  composerInput: {
    flex: 1,
    maxHeight: 90,
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5c9dff",
  },
  sendButtonDisabled: {
    opacity: 0.4,
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
