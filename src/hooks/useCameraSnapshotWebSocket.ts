import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

const CAMERA_SNAPSHOT_WS_PATH = "/smarthome-dashboard-v2/ws-camera-snapshot";
const WS_RECONNECT_BASE_DELAY_MS = 900;
const WS_RECONNECT_MAX_DELAY_MS = 9000;
const MIN_SNAPSHOT_REFRESH_MS = 2000;

type UseCameraSnapshotWebSocketInput = {
  enabled: boolean;
  snapshotUrl: string | null;
  refreshMs: number;
  staggerKey: string;
};

export function useCameraSnapshotWebSocket({
  enabled,
  snapshotUrl,
  refreshMs,
  staggerKey,
}: UseCameraSnapshotWebSocketInput) {
  const [connected, setConnected] = useState(false);
  const [snapshotObjectUrl, setSnapshotObjectUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const refreshMsRef = useRef(refreshMs);
  const socketRef = useRef<WebSocket | null>(null);

  const replaceObjectUrl = (nextObjectUrl: string | null) => {
    const previousObjectUrl = objectUrlRef.current;
    objectUrlRef.current = nextObjectUrl;
    setSnapshotObjectUrl(nextObjectUrl);
    if (previousObjectUrl && previousObjectUrl !== nextObjectUrl) {
      window.setTimeout(() => URL.revokeObjectURL(previousObjectUrl), 1000);
    }
  };

  useEffect(() => {
    refreshMsRef.current = refreshMs;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN && snapshotUrl) {
      socket.send(
        JSON.stringify({
          type: "start",
          url: snapshotUrl,
          refreshMs: Math.max(MIN_SNAPSHOT_REFRESH_MS, Math.round(refreshMs)),
          staggerKey,
        })
      );
    }
  }, [refreshMs, snapshotUrl, staggerKey]);

  useEffect(() => {
    const wsUrl = buildCameraSnapshotWebSocketUrl();
    if (!enabled || !snapshotUrl || !wsUrl) {
      setConnected(false);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setSnapshotObjectUrl(null);
      return;
    }

    let active = true;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;

    const clearReconnectTimer = () => {
      if (!reconnectTimer) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const scheduleReconnect = () => {
      if (!active) return;
      clearReconnectTimer();
      const delay = Math.min(WS_RECONNECT_MAX_DELAY_MS, WS_RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt);
      reconnectAttempt = Math.min(reconnectAttempt + 1, 8);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const sendStart = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          type: "start",
          url: snapshotUrl,
          refreshMs: Math.max(MIN_SNAPSHOT_REFRESH_MS, Math.round(refreshMsRef.current || MIN_SNAPSHOT_REFRESH_MS)),
          staggerKey,
        })
      );
    };

    const connect = () => {
      if (!active) return;
      try {
        socket = new WebSocket(wsUrl);
        socket.binaryType = "blob";
        socketRef.current = socket;
      } catch {
        setConnected(false);
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        if (!active || !socket) return;
        reconnectAttempt = 0;
        setConnected(true);
        sendStart();
      };

      socket.onmessage = (event) => {
        if (!active || typeof event.data === "string") return;
        const blob = event.data instanceof Blob ? event.data : new Blob([event.data], { type: "image/jpeg" });
        replaceObjectUrl(URL.createObjectURL(blob));
      };

      socket.onclose = () => {
        if (!active) return;
        setConnected(false);
        scheduleReconnect();
      };

      socket.onerror = () => {
        if (!active) return;
        setConnected(false);
      };
    };

    connect();

    return () => {
      active = false;
      socketRef.current = null;
      setConnected(false);
      clearReconnectTimer();
      try {
        socket?.close();
      } catch {
        // Best-effort close.
      }
    };
  }, [enabled, snapshotUrl, staggerKey]);

  useEffect(
    () => () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    },
    []
  );

  return { connected, snapshotObjectUrl };
}

function buildCameraSnapshotWebSocketUrl() {
  if (Platform.OS !== "web" || typeof window === "undefined") return "";
  try {
    const url = new URL(window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = CAMERA_SNAPSHOT_WS_PATH;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}
