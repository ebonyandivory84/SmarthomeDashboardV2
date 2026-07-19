import { createElement, useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { GrafanaWidgetConfig } from "../../types/dashboard";
import { playConfiguredUiSound } from "../../utils/uiSounds";
import { palette } from "../../utils/theme";

type GrafanaWidgetProps = {
  config: GrafanaWidgetConfig;
  isActivePage?: boolean;
  lowPowerMode?: boolean;
};

export function GrafanaWidget({ config, isActivePage = true, lowPowerMode = false }: GrafanaWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const textColor = config.appearance?.textColor || palette.text;
  const mutedTextColor = config.appearance?.mutedTextColor || palette.textMuted;
  const resolvedUrl = normalizeGrafanaUrl(config.url);
  const iframeUrl = applyGrafanaRefresh(resolvedUrl, config.refreshMs);
  const renderUrl = useMemo(
    () => resolveGrafanaRenderUrl(config.renderUrl, resolvedUrl),
    [config.renderUrl, resolvedUrl]
  );
  const previewUrl = useMemo(() => appendRevision(renderUrl, previewRevision), [previewRevision, renderUrl]);
  const runtimeActive = isActivePage && documentVisible;
  const previewRefreshMs = clampPreviewRefresh(config.refreshMs);
  const interactionsAllowed = config.allowInteractions !== false;
  const sandboxValue = interactionsAllowed ? undefined : "allow-same-origin allow-scripts";

  useEffect(() => {
    setPreviewReady(false);
    setPreviewFailed(false);
    if (!runtimeActive || !renderUrl) {
      return;
    }
    const timer = setTimeout(() => setPreviewReady(true), lowPowerMode ? 240 : 100);
    return () => clearTimeout(timer);
  }, [lowPowerMode, renderUrl, runtimeActive]);

  useEffect(() => {
    if (!runtimeActive || !renderUrl) {
      return;
    }
    const timer = setInterval(() => {
      setPreviewFailed(false);
      setPreviewRevision((current) => current + 1);
    }, previewRefreshMs);
    return () => clearInterval(timer);
  }, [previewRefreshMs, renderUrl, runtimeActive]);

  const openFullscreen = () => {
    if (!resolvedUrl) {
      return;
    }
    playConfiguredUiSound(config.interactionSounds?.press, "panel", `${config.id}:press`);
    playConfiguredUiSound(config.interactionSounds?.open, "open", `${config.id}:open`);
    setFullscreenOpen(true);
  };

  const closeFullscreen = () => {
    playConfiguredUiSound(config.interactionSounds?.close, "close", `${config.id}:close`);
    setFullscreenOpen(false);
  };

  if (Platform.OS !== "web") {
    return (
      <View style={styles.fallback}>
        <Text style={[styles.title, { color: textColor }]}>Grafana ist aktuell nur im Web eingebettet.</Text>
        <Text style={[styles.meta, { color: mutedTextColor }]}>{resolvedUrl || "Grafana-URL fehlt"}</Text>
      </View>
    );
  }

  if (!resolvedUrl) {
    return (
      <View style={styles.fallback}>
        <Text style={[styles.title, { color: textColor }]}>Grafana-URL fehlt</Text>
        <Text style={[styles.meta, { color: mutedTextColor }]}>
          Trage im Widget eine Panel- oder Dashboard-URL ein.
        </Text>
      </View>
    );
  }

  return (
    <>
      {createElement(
        "div",
        {
          style: webFrameWrapStyle,
        },
        previewReady && previewUrl && !previewFailed
          ? createElement("img", {
              alt: config.title || "Grafana Vorschau",
              decoding: "async",
              loading: "lazy",
              onError: () => setPreviewFailed(true),
              src: previewUrl,
              style: webPreviewImageStyle,
            })
          : createElement(
              "div",
              { style: webPreviewPlaceholderStyle },
              renderUrl ? "Grafana-Vorschau wird geladen..." : "Grafana Render-URL fehlt"
            ),
        createElement(
          "div",
          {
            onPointerDown: openFullscreen,
            style: webFullscreenOverlayButtonStyle,
            title: "Grafana im Vollbild anzeigen",
            "aria-label": "Grafana im Vollbild anzeigen",
            role: "button",
            tabIndex: 0,
            onKeyDown: (event: { key?: string }) => {
              if (event.key === "Enter" || event.key === " ") {
                openFullscreen();
              }
            },
          },
          null
        )
      )}
      <Modal animationType={Platform.OS === "web" ? "fade" : "slide"} transparent visible={fullscreenOpen}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSurface}>
            <View style={styles.modalHeader}>
              <Text numberOfLines={1} style={[styles.modalTitle, { color: textColor }]}>
                {config.title || "Grafana"}
              </Text>
              <Pressable onPress={closeFullscreen} style={styles.modalButton}>
                <Text style={[styles.modalButtonLabel, { color: textColor }]}>Schliessen</Text>
              </Pressable>
            </View>
            {createElement("iframe", {
              src: iframeUrl,
              style: {
                ...webFullscreenFrameStyle,
                pointerEvents: interactionsAllowed ? "auto" : "none",
              },
              sandbox: sandboxValue,
              allow: "fullscreen; autoplay; clipboard-read; clipboard-write",
              allowFullScreen: true,
              loading: "lazy",
              referrerPolicy: "no-referrer",
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

function normalizeGrafanaUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("<")) {
    const match = trimmed.match(/src\s*=\s*["']([^"']+)["']/i);
    if (match?.[1]) {
      return match[1];
    }
  }

  return trimmed;
}

function normalizeRefreshMs(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function clampPreviewRefresh(value?: number) {
  const normalized = normalizeRefreshMs(value);
  return Math.max(30000, Math.min(60000, normalized || 60000));
}

function resolveGrafanaRenderUrl(configuredRenderUrl: string | undefined, dashboardUrl: string) {
  const configured = normalizeGrafanaUrl(configuredRenderUrl);
  if (configured) {
    return configured;
  }
  if (!dashboardUrl) {
    return "";
  }
  try {
    const url = new URL(dashboardUrl, typeof window === "undefined" ? undefined : window.location.origin);
    if (url.pathname.includes("/d-solo/")) {
      url.pathname = url.pathname.replace("/d-solo/", "/render/d-solo/");
    } else if (url.pathname.includes("/d/")) {
      url.pathname = url.pathname.replace("/d/", "/render/d/");
    } else {
      return "";
    }
    url.searchParams.delete("refresh");
    url.searchParams.set("width", "640");
    url.searchParams.set("height", "360");
    return url.toString();
  } catch {
    return "";
  }
}

function appendRevision(url: string, revision: number) {
  if (!url) {
    return "";
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_dashboardV2=${revision}`;
}

function applyGrafanaRefresh(url: string, refreshMs?: number) {
  if (!url) {
    return url;
  }

  if (/[?&]refresh=/.test(url)) {
    return url;
  }

  const normalizedRefreshMs = normalizeRefreshMs(refreshMs);
  if (!normalizedRefreshMs) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}refresh=${toGrafanaRefreshValue(normalizedRefreshMs)}`;
}

function toGrafanaRefreshValue(refreshMs: number) {
  if (refreshMs < 1000) {
    return "1s";
  }

  if (refreshMs < 60000) {
    return `${Math.max(1, Math.round(refreshMs / 1000))}s`;
  }

  if (refreshMs < 3600000) {
    return `${Math.max(1, Math.round(refreshMs / 60000))}m`;
  }

  return `${Math.max(1, Math.round(refreshMs / 3600000))}h`;
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    backgroundColor: "rgba(0,0,0,0.18)",
    padding: 14,
    justifyContent: "center",
  },
  title: {
    color: palette.text,
    fontSize: 16,
    fontWeight: "700",
  },
  meta: {
    color: palette.textMuted,
    marginTop: 8,
    lineHeight: 18,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
    padding: 18,
  },
  modalSurface: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(4, 10, 18, 1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  modalHeader: {
    height: 56,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  modalTitle: {
    flex: 1,
    marginRight: 12,
    color: palette.text,
    fontSize: 16,
    fontWeight: "800",
  },
  modalButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalButtonLabel: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "700",
  },
});

const webFrameWrapStyle = {
  width: "100%",
  height: "100%",
  position: "relative",
};

const webPreviewImageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  background: "rgba(4,10,18,0.85)",
  display: "block",
  pointerEvents: "none",
};

const webPreviewPlaceholderStyle = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "rgba(220,230,245,0.72)",
  background: "rgba(4,10,18,0.85)",
  fontSize: "13px",
  fontWeight: 700,
};

const webFullscreenFrameStyle = {
  width: "100%",
  height: "calc(100% - 56px)",
  border: "0",
  display: "block",
  background: "transparent",
};

const webFullscreenOverlayButtonStyle = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  border: "0",
  background: "transparent",
  cursor: "zoom-in",
  padding: 0,
};
