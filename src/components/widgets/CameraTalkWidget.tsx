import { MaterialCommunityIcons } from "@expo/vector-icons";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useCameraSnapshotWebSocket } from "../../hooks/useCameraSnapshotWebSocket";
import { useLiveMedia } from "../../context/LiveMediaContext";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { CameraTalkWidgetConfig } from "../../types/dashboard";
import { playConfiguredUiSound } from "../../utils/uiSounds";
import { palette } from "../../utils/theme";

declare global {
  interface Window {
    flvjs?: any;
  }
}

type CameraTalkWidgetProps = {
  config: CameraTalkWidgetConfig;
  isActivePage?: boolean;
  maximizeStateValue?: unknown;
  onAspectRatioDetected?: (ratio: number) => void;
  onFullscreenSwipeClose?: () => void;
  onFullscreenVisibilityChange?: (open: boolean) => void;
};

const MAX_FULLSCREEN_DURATION_MS = 30_000;
const LAYER_FADE_MS = 0;
const pinnedColor = "#f3c84a";
const FLV_SCRIPT_SRC = "https://cdn.jsdelivr.net/npm/flv.js@1.6.2/dist/flv.min.js";
const FLV_SCRIPT_LOAD_TIMEOUT_MS = 8000;
const MJPEG_SOURCE_SWITCH_TIMEOUT_MS = 12_000;
const MJPEG_RECONNECT_BASE_DELAY_MS = 700;
const MJPEG_RECONNECT_MAX_DELAY_MS = 8000;
const FLV_RECONNECT_DELAY_MS = 1800;
const FMP4_RECONNECT_DELAY_MS = 1800;
const STREAM_ERROR_GRACE_MS = 2500;
const STREAM_ERROR_AUTO_HIDE_MS = 5000;
const WEB_FULLSCREEN_MIN_ZOOM = 1;
const WEB_FULLSCREEN_MAX_ZOOM = 4;
let flvLoaderPromise: Promise<boolean> | null = null;

export function CameraTalkWidget({
  config,
  isActivePage = true,
  maximizeStateValue,
  onAspectRatioDetected,
  onFullscreenSwipeClose,
  onFullscreenVisibilityChange,
}: CameraTalkWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const { activeMediaId, activateMedia, releaseMedia } = useLiveMedia();
  const runtimeActive = isActivePage && documentVisible;
  const [tick, setTick] = useState(0);
  const [layerUrls, setLayerUrls] = useState<[string | null, string | null]>([null, null]);
  const [activeLayer, setActiveLayer] = useState<0 | 1>(0);
  const [loadingLayer, setLoadingLayer] = useState<0 | 1 | null>(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [webDocumentFullscreenActive, setWebDocumentFullscreenActive] = useState(false);
  const [webFullscreenZoom, setWebFullscreenZoom] = useState(1);
  const [webFullscreenOffset, setWebFullscreenOffset] = useState({ x: 0, y: 0 });
  const [webFullscreenViewport, setWebFullscreenViewport] = useState({ width: 0, height: 0 });
  const [pinned, setPinned] = useState(false);
  const [previewStreamDebug, setPreviewStreamDebug] = useState<string | null>(null);
  const [previewMjpegSession, setPreviewMjpegSession] = useState(0);
  const [fullscreenSession, setFullscreenSession] = useState(0);
  const [previewFlvSession, setPreviewFlvSession] = useState(0);
  const [previewMjpegSourceIndex, setPreviewMjpegSourceIndex] = useState(0);
  const [fullscreenMjpegSourceIndex, setFullscreenMjpegSourceIndex] = useState(0);
  const [previewFlvSourceIndex, setPreviewFlvSourceIndex] = useState(0);
  const [fullscreenFlvSourceIndex, setFullscreenFlvSourceIndex] = useState(0);
  const [previewFmp4SourceIndex, setPreviewFmp4SourceIndex] = useState(0);
  const [fullscreenFmp4SourceIndex, setFullscreenFmp4SourceIndex] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(config.audioEnabled === true);
  const [talkbackActive, setTalkbackActive] = useState(false);
  const [instarSpeakerVolume, setInstarSpeakerVolume] = useState(70);
  const [instarAlarmArmed, setInstarAlarmArmed] = useState<boolean | null>(null);
  const [instarLedOn, setInstarLedOn] = useState<boolean | null>(null);
  const [previewMjpegLoaded, setPreviewMjpegLoaded] = useState(false);
  const [fullscreenMjpegLoaded, setFullscreenMjpegLoaded] = useState(false);
  const hasReportedAspectRatio = useRef(false);
  const lastTriggerMatchRef = useRef(false);
  const activeLayerRef = useRef<0 | 1>(0);
  const latestRequestedUrlRef = useRef<string | null>(null);
  const loadingJobRef = useRef<{ layer: 0 | 1; url: string } | null>(null);
  const fullscreenVisibilityCallbackRef = useRef(onFullscreenVisibilityChange);
  const inPlaceFullscreenHostRef = useRef<any>(null);
  const wasDocumentFullscreenRef = useRef(false);
  const webPinchStartDistanceRef = useRef<number | null>(null);
  const webPinchStartZoomRef = useRef(1);
  const webFullscreenZoomRef = useRef(1);
  const webFullscreenOffsetRef = useRef({ x: 0, y: 0 });
  const webPanStartRef = useRef<{ touchX: number; touchY: number; offsetX: number; offsetY: number } | null>(null);
  const webPinchingRef = useRef(false);
  const previewMjpegReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewMjpegReconnectAttemptsRef = useRef(0);
  const instarTalkTokenRef = useRef<string | null>(null);
  const instarTalkStreamRef = useRef<MediaStream | null>(null);
  const instarTalkAudioContextRef = useRef<AudioContext | null>(null);
  const instarTalkProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const instarTalkSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const instarTalkFlushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const instarTalkQueueRef = useRef<Uint8Array[]>([]);
  const instarTalkQueueBytesRef = useRef(0);
  const instarTalkSentBytesRef = useRef(0);
  const instarTalkLastDebugAtRef = useRef(0);
  const reolinkTalkPeerRef = useRef<RTCPeerConnection | null>(null);
  const reolinkTalkStreamRef = useRef<MediaStream | null>(null);
  const reolinkTalkSourceRef = useRef<string | null>(null);
  const ptzHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ptzContinuousRef = useRef<"up" | "right" | "down" | "left" | null>(null);
  const volumeTrackHeightRef = useRef(84);
  const volumeDragActiveRef = useRef(false);
  const volumeLastSentRef = useRef(0);
  const instarFlushInProgressRef = useRef(false);
  const instarStartSessionRef = useRef(0);
  const instarIsStartingRef = useRef(false);
  const textColor = config.appearance?.textColor || palette.text;
  const mutedTextColor = config.appearance?.mutedTextColor || palette.textMuted;
  const titleFontSize = Math.max(11, Math.min(28, Math.round(config.titleFontSize || 14)));
  const displayUrl = layerUrls[activeLayer];
  const previewSnapshotBaseUrl = (config.snapshotUrl || "").trim() || null;
  const fullscreenSnapshotBaseUrl = (config.fullscreenSnapshotUrl || config.snapshotUrl || "").trim() || null;
  const previewMjpegUrl = (config.mjpegUrl || "").trim() || null;
  const fullscreenMjpegUrl = (config.fullscreenMjpegUrl || config.mjpegUrl || "").trim() || null;
  const previewFlvUrl = (config.flvUrl || "").trim() || null;
  const fullscreenFlvUrl = (config.fullscreenFlvUrl || config.flvUrl || "").trim() || null;
  const previewFmp4Url = (config.fmp4Url || "").trim() || null;
  const fullscreenFmp4Url = (config.fullscreenFmp4Url || config.fmp4Url || "").trim() || null;
  const fullscreenWebrtcUrl = (config.fullscreenWebrtcUrl || config.talkbackWebrtcUrl || "").trim() || null;
  const requestedFullscreenSourceMode = config.fullscreenSourceMode || config.previewSourceMode;
  const previewSourceMode = "snapshot" as const;
  const fullscreenSourceMode = resolveSourceMode(
    requestedFullscreenSourceMode,
    fullscreenSnapshotBaseUrl,
    fullscreenMjpegUrl,
    fullscreenFlvUrl,
    fullscreenFmp4Url,
    fullscreenWebrtcUrl,
    previewSourceMode
  );

  const previewFeed = (previewSnapshotBaseUrl ? { kind: "snapshot" as const, url: previewSnapshotBaseUrl } : null) as ReturnType<
    typeof resolveCameraFeed
  >;
  const fullscreenFeed = resolveCameraFeed({
    sourceMode: fullscreenSourceMode,
    snapshotUrl: fullscreenSnapshotBaseUrl,
    mjpegUrl: fullscreenMjpegUrl,
    flvUrl: fullscreenFlvUrl,
    fmp4Url: fullscreenFmp4Url,
    webrtcUrl: fullscreenWebrtcUrl,
  });
  const useInPlaceFullscreen = false;
  const showInPlaceFullscreen = useInPlaceFullscreen && (fullscreenOpen || webDocumentFullscreenActive);
  const showFixedFallbackFullscreen = showInPlaceFullscreen && !webDocumentFullscreenActive;
  const showPreviewFeed = !fullscreenOpen || showInPlaceFullscreen;
  const showNativeFullscreenModal = fullscreenOpen && activeMediaId === config.id;
  const talkbackWebrtcUrl = (config.talkbackWebrtcUrl || "").trim();
  const instarTalkbackEnabled = Platform.OS === "web" && config.instarTalkbackEnabled === true;
  const instarBaseUrl = (config.instarBaseUrl || "").trim();
  const instarUsername = (config.instarUsername || "").trim();
  const instarPassword = config.instarPassword || "";
  const reolinkTalkbackEnabled = Platform.OS === "web" && config.reolinkTalkbackEnabled === true;
  const reolinkBaseUrl = (config.reolinkBaseUrl || "").trim();
  const reolinkUsername = (config.reolinkUsername || "").trim();
  const reolinkPassword = config.reolinkPassword || "";
  const reolinkChannel = Number.isFinite(Number(config.reolinkChannel)) ? Number(config.reolinkChannel) : 0;
  const instarTalkbackConfigured = Boolean(instarBaseUrl && instarUsername && instarPassword);
  const reolinkTalkbackConfigured = Boolean(reolinkBaseUrl && reolinkUsername && reolinkPassword);
  const instarTalkbackActiveMode = instarTalkbackEnabled && instarTalkbackConfigured;
  const instarTalkbackAvailable = Platform.OS === "web" && instarTalkbackActiveMode;
  const reolinkTalkbackAvailable = Platform.OS === "web" && reolinkTalkbackEnabled && reolinkTalkbackConfigured && Boolean(talkbackWebrtcUrl);
  const talkbackAvailable =
    Platform.OS === "web" && (Boolean(talkbackWebrtcUrl) || instarTalkbackAvailable || reolinkTalkbackAvailable);
  const talkbackControlVisible = Platform.OS === "web";
  const talkbackPushToTalk = config.talkbackPushToTalk !== false;
  const talkbackPressToHold = talkbackPushToTalk && !reolinkTalkbackAvailable;
  const talkbackShowVideo = config.talkbackAutoEnableVideo === true;
  const talkbackIframeEnabled = Boolean(talkbackWebrtcUrl) && !instarTalkbackAvailable && !reolinkTalkbackAvailable;
  const showInstarControls = instarTalkbackConfigured;
  const showReolinkControls = reolinkTalkbackConfigured;
  const activeFeed = fullscreenOpen ? fullscreenFeed || previewFeed : previewFeed;
  const activeSnapshotBaseUrl = activeFeed?.kind === "snapshot" ? activeFeed.url : null;
  const previewMjpegSources = useMemo(
    () =>
      previewFeed?.kind === "mjpeg"
        ? buildWebStreamSources(previewFeed.url, "mjpeg")
        : [],
    [previewFeed?.kind, previewFeed?.url]
  );
  const fullscreenMjpegSources = useMemo(
    () =>
      fullscreenFeed?.kind === "mjpeg"
        ? buildWebStreamSources(fullscreenFeed.url, "mjpeg")
        : [],
    [fullscreenFeed?.kind, fullscreenFeed?.url]
  );
  const previewFlvSources = useMemo(
    () =>
      previewFeed?.kind === "flv"
        ? buildWebStreamSources(previewFeed.url, "flv")
        : [],
    [previewFeed?.kind, previewFeed?.url]
  );
  const fullscreenFlvSources = useMemo(
    () =>
      fullscreenFeed?.kind === "flv"
        ? buildWebStreamSources(fullscreenFeed.url, "flv")
        : [],
    [fullscreenFeed?.kind, fullscreenFeed?.url]
  );
  const previewFmp4Sources = useMemo(
    () =>
      previewFeed?.kind === "fmp4"
        ? buildWebStreamSources(previewFeed.url, "fmp4")
        : [],
    [previewFeed?.kind, previewFeed?.url]
  );
  const fullscreenFmp4Sources = useMemo(
    () =>
      fullscreenFeed?.kind === "fmp4"
        ? buildWebStreamSources(fullscreenFeed.url, "fmp4")
        : [],
    [fullscreenFeed?.kind, fullscreenFeed?.url]
  );
  const previewFeedKey = `${previewFeed?.kind || "none"}:${previewFeed?.url || ""}`;
  const fullscreenFeedKey = `${fullscreenFeed?.kind || "none"}:${fullscreenFeed?.url || ""}`;
  const currentPreviewMjpegSrc = previewMjpegSources[Math.min(previewMjpegSourceIndex, Math.max(0, previewMjpegSources.length - 1))] || null;
  const currentFullscreenMjpegSrc =
    fullscreenMjpegSources[Math.min(fullscreenMjpegSourceIndex, Math.max(0, fullscreenMjpegSources.length - 1))] || null;
  const currentPreviewFlvSrc = previewFlvSources[Math.min(previewFlvSourceIndex, Math.max(0, previewFlvSources.length - 1))] || null;
  const currentFullscreenFlvSrc =
    fullscreenFlvSources[Math.min(fullscreenFlvSourceIndex, Math.max(0, fullscreenFlvSources.length - 1))] || null;
  const currentPreviewFmp4Src =
    previewFmp4Sources[Math.min(previewFmp4SourceIndex, Math.max(0, previewFmp4Sources.length - 1))] || null;
  const currentFullscreenFmp4Src =
    fullscreenFmp4Sources[Math.min(fullscreenFmp4SourceIndex, Math.max(0, fullscreenFmp4Sources.length - 1))] || null;
  const activeRefreshMs = fullscreenOpen
    ? Math.max(2000, config.fullscreenRefreshMs || config.refreshMs || 2000)
    : Math.max(2000, config.refreshMs || 2000);
  const shouldUseSnapshotWebSocket =
    Platform.OS === "web" &&
    runtimeActive &&
    Boolean(activeSnapshotBaseUrl) &&
    typeof window !== "undefined" &&
    window.location.pathname.includes("/smarthome-dashboard-v2");
  const { snapshotObjectUrl } = useCameraSnapshotWebSocket({
    enabled: shouldUseSnapshotWebSocket,
    refreshMs: activeRefreshMs,
    snapshotUrl: activeSnapshotBaseUrl,
    staggerKey: config.id,
  });
  const liveSnapshotWsDataUrl = snapshotObjectUrl ?? null;
  const fullscreenMjpegHasFallback = fullscreenMjpegSourceIndex + 1 < fullscreenMjpegSources.length;
  const previewSupportsAudio = previewFeed?.kind === "flv" || previewFeed?.kind === "fmp4";
  const fullscreenSupportsAudio = fullscreenFeed?.kind === "flv" || fullscreenFeed?.kind === "fmp4";
  const showWebFullscreenAudioToggle = Platform.OS === "web" && showInPlaceFullscreen && previewSupportsAudio;
  const showNativeFullscreenAudioToggle = showNativeFullscreenModal && fullscreenSupportsAudio;
  const previewMuted = !(audioEnabled && showInPlaceFullscreen && previewSupportsAudio);
  const fullscreenMuted = !(audioEnabled && showNativeFullscreenModal && fullscreenSupportsAudio);

  useEffect(() => {
    setAudioEnabled(config.audioEnabled === true);
  }, [config.audioEnabled, config.id]);

  const clearPreviewMjpegReconnectTimer = useCallback(() => {
    if (previewMjpegReconnectTimerRef.current) {
      clearTimeout(previewMjpegReconnectTimerRef.current);
      previewMjpegReconnectTimerRef.current = null;
    }
  }, []);

  const schedulePreviewMjpegReconnect = useCallback((message: string, allowSourceRotate = true) => {
    if (previewFeed?.kind !== "mjpeg") {
      return;
    }

    clearPreviewMjpegReconnectTimer();
    const attempt = previewMjpegReconnectAttemptsRef.current;
    const delay = Math.min(MJPEG_RECONNECT_MAX_DELAY_MS, MJPEG_RECONNECT_BASE_DELAY_MS * 2 ** attempt);
    const shouldRotate = allowSourceRotate && previewMjpegSources.length > 1;

    if (shouldRotate) {
      setPreviewMjpegSourceIndex((current) => (current + 1) % previewMjpegSources.length);
    }

    setPreviewStreamDebug(`${message} (Retry in ${Math.round(delay / 100) / 10}s)`);
    previewMjpegReconnectTimerRef.current = setTimeout(() => {
      previewMjpegReconnectTimerRef.current = null;
      previewMjpegReconnectAttemptsRef.current = Math.min(previewMjpegReconnectAttemptsRef.current + 1, 6);
      setPreviewMjpegSession((current) => current + 1);
    }, delay);
  }, [clearPreviewMjpegReconnectTimer, previewFeed?.kind, previewMjpegSources.length]);

  const stopInstarTalkback = useCallback(async () => {
    instarStartSessionRef.current += 1;
    instarIsStartingRef.current = false;
    const token = instarTalkTokenRef.current;
    instarTalkTokenRef.current = null;

    if (instarTalkFlushTimerRef.current) {
      clearInterval(instarTalkFlushTimerRef.current);
      instarTalkFlushTimerRef.current = null;
    }
    instarTalkQueueRef.current = [];
    instarTalkQueueBytesRef.current = 0;
    instarTalkSentBytesRef.current = 0;
    instarTalkLastDebugAtRef.current = 0;

    if (instarTalkProcessorRef.current) {
      instarTalkProcessorRef.current.disconnect();
      instarTalkProcessorRef.current.onaudioprocess = null;
      instarTalkProcessorRef.current = null;
    }
    if (instarTalkSourceRef.current) {
      instarTalkSourceRef.current.disconnect();
      instarTalkSourceRef.current = null;
    }
    if (instarTalkAudioContextRef.current) {
      await instarTalkAudioContextRef.current.close().catch(() => undefined);
      instarTalkAudioContextRef.current = null;
    }
    if (instarTalkStreamRef.current) {
      instarTalkStreamRef.current.getTracks().forEach((track) => track.stop());
      instarTalkStreamRef.current = null;
    }

    if (token) {
      await fetch("/smarthome-dashboard-v2/api/instar-talk/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).catch(() => undefined);
    }
  }, []);

  const stopReolinkTalkback = useCallback(async () => {
    const source = reolinkTalkSourceRef.current;
    const cameraSrc = getGo2rtcCameraSrc(talkbackWebrtcUrl);
    const routingDst = cameraSrc;
    if (source && routingDst) {
      const stopUrl = resolveGo2rtcStreamsEndpoint(talkbackWebrtcUrl);
      const params = new URLSearchParams({ dst: routingDst, src: "" });
      await fetch(`${stopUrl}?${params.toString()}`, { method: "POST" }).catch(() => undefined);
    }
    reolinkTalkSourceRef.current = null;
    if (reolinkTalkPeerRef.current) {
      try {
        reolinkTalkPeerRef.current.close();
      } catch {
        // Ignore best-effort close errors.
      }
      reolinkTalkPeerRef.current = null;
    }
    if (reolinkTalkStreamRef.current) {
      reolinkTalkStreamRef.current.getTracks().forEach((track) => track.stop());
      reolinkTalkStreamRef.current = null;
    }
  }, [talkbackWebrtcUrl]);

  const closeFullscreen = useCallback(() => {
    if (previewFeed?.kind === "mjpeg") {
      setPreviewStreamDebug(null);
    }
    fullscreenVisibilityCallbackRef.current?.(false);
    releaseMedia(config.id);
    setFullscreenOpen(false);
    setPinned(false);
    if (instarTalkbackEnabled) {
      void stopInstarTalkback();
    }
    setTalkbackActive(false);
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const webDocument = document as Document & {
        webkitExitFullscreen?: () => Promise<void> | void;
        webkitFullscreenElement?: Element | null;
      };
      const exitFullscreen = webDocument.exitFullscreen || webDocument.webkitExitFullscreen;
      if (exitFullscreen && (webDocument.fullscreenElement || webDocument.webkitFullscreenElement)) {
        void Promise.resolve(exitFullscreen.call(webDocument)).catch(() => {
          // Ignore best-effort fullscreen exit errors.
        });
      }
    }
  }, [config.id, instarTalkbackEnabled, previewFeed?.kind, releaseMedia, stopInstarTalkback]);

  const moveFullscreenMjpegToNextSource = useCallback(() => {
    if (!fullscreenMjpegHasFallback) {
      return false;
    }
    setFullscreenMjpegLoaded(false);
    setFullscreenMjpegSourceIndex((current) => Math.min(fullscreenMjpegSources.length - 1, current + 1));
    return true;
  }, [fullscreenMjpegHasFallback, fullscreenMjpegSources.length]);

  const openFullscreen = useCallback(() => {
    activateMedia(config.id);
    webPinchingRef.current = false;
    webPinchStartDistanceRef.current = null;
    webPinchStartZoomRef.current = 1;
    webPanStartRef.current = null;
    webFullscreenZoomRef.current = 1;
    webFullscreenOffsetRef.current = { x: 0, y: 0 };
    setWebFullscreenZoom(1);
    setWebFullscreenOffset({ x: 0, y: 0 });
    setFullscreenSession((current) => current + 1);
    fullscreenVisibilityCallbackRef.current?.(true);
    setPinned(false);
    setFullscreenOpen(true);
    if (Platform.OS === "web" && useInPlaceFullscreen) {
      const host = inPlaceFullscreenHostRef.current as
        | (Element & { webkitRequestFullscreen?: () => Promise<void> | void })
        | null;
      const requestFullscreen = host?.requestFullscreen || host?.webkitRequestFullscreen;
      if (requestFullscreen) {
        void Promise.resolve(requestFullscreen.call(host)).catch(() => {
          // requestFullscreen may fail without user gesture (e.g. state-triggered maximize).
        });
      }
    }
  }, [activateMedia, config.id, useInPlaceFullscreen]);

  useEffect(() => {
    if (fullscreenOpen && activeMediaId && activeMediaId !== config.id) {
      closeFullscreen();
    }
  }, [activeMediaId, closeFullscreen, config.id, fullscreenOpen]);

  useEffect(() => {
    if (!runtimeActive && fullscreenOpen) {
      closeFullscreen();
    }
  }, [closeFullscreen, fullscreenOpen, runtimeActive]);

  useEffect(() => () => releaseMedia(config.id), [config.id, releaseMedia]);

  const toggleAudio = useCallback(() => {
    playConfiguredUiSound(config.interactionSounds?.press, "toggle", `${config.id}:audio`);
    setAudioEnabled((current) => !current);
  }, [config.id, config.interactionSounds?.press]);

  const startReolinkTalkback = useCallback(async () => {
    if (Platform.OS !== "web" || !reolinkTalkbackAvailable || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Reolink talkback unavailable");
    }
    const secureContextAllowed =
      typeof window === "undefined" ? true : window.isSecureContext || window.location.hostname === "localhost";
    if (!secureContextAllowed) {
      throw new Error("Mikrofon im Browser blockiert (unsicherer Kontext). Bitte ueber HTTPS oder localhost oeffnen.");
    }
    const cameraSrc = getGo2rtcCameraSrc(talkbackWebrtcUrl);
    const routingDst = cameraSrc;
    if (!cameraSrc) {
      throw new Error("Reolink Talkback URL ohne src-Parameter.");
    }
    if (!routingDst) {
      throw new Error("Reolink Backchannel-Ziel fehlt.");
    }
    await stopReolinkTalkback();
    setPreviewStreamDebug("Reolink: Mikrofon wird gestartet...");
    const source = cameraSrc;
    reolinkTalkSourceRef.current = source;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 48000,
        sampleSize: 16,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    reolinkTalkStreamRef.current = stream;
    const peer = new RTCPeerConnection();
    reolinkTalkPeerRef.current = peer;
    stream.getAudioTracks().forEach((track) => {
      track.contentHint = "speech";
      peer.addTrack(track, stream);
    });
    const offer = await peer.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
    });
    await peer.setLocalDescription(offer);
    if (reolinkTalkPeerRef.current !== peer) { peer.close(); return; }
    await waitForIceGathering(peer, 450);
    if (reolinkTalkPeerRef.current !== peer) { peer.close(); return; }

    const endpoint = resolveGo2rtcWebrtcEndpoint(talkbackWebrtcUrl);
    const localSdp = peer.localDescription?.sdp || offer.sdp;
    if (!localSdp) {
      throw new Error("Reolink: lokales SDP fehlt.");
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp",
        Accept: "application/sdp, text/plain, */*",
      },
      body: localSdp,
    });
    const answerSdp = await response.text();
    if (reolinkTalkPeerRef.current !== peer) { peer.close(); return; }
    if (!response.ok || !answerSdp.trim()) {
      const detail = (answerSdp || "").trim().slice(0, 220);
      throw new Error(`Reolink WebRTC Handshake fehlgeschlagen (${response.status})${detail ? `: ${detail}` : ""}.`);
    }
    await peer.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });
    if (reolinkTalkPeerRef.current !== peer) { peer.close(); return; }

    const streamRouteUrl = resolveGo2rtcStreamsEndpoint(talkbackWebrtcUrl);
    const routeSource = resolveGo2rtcWebsocketSource(talkbackWebrtcUrl, source);
    const params = new URLSearchParams({ dst: routingDst, src: routeSource });
    let routed = false;
    let lastStatus = 0;
    let lastDetail = "";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const routeResponse = await fetch(`${streamRouteUrl}?${params.toString()}`, { method: "POST" });
      const routeText = (await routeResponse.text().catch(() => "")).trim();
      if (routeResponse.ok) {
        routed = true;
        break;
      }
      lastStatus = routeResponse.status;
      lastDetail = routeText.slice(0, 220);
      if (!/can't find consumer/i.test(routeText)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 90));
    }
    if (!routed) {
      throw new Error(
        `Reolink Backchannel-Routing fehlgeschlagen (${lastStatus || 500})${lastDetail ? `: ${lastDetail}` : ""}.`
      );
    }
    setPreviewStreamDebug("Reolink Talkback aktiv.");
  }, [config.id, reolinkTalkbackAvailable, stopReolinkTalkback, talkbackWebrtcUrl]);

  const startInstarTalkback = useCallback(async () => {
    if (Platform.OS !== "web" || !instarTalkbackAvailable || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("INSTAR talkback unavailable");
    }
    if (instarIsStartingRef.current) {
      return;
    }
    instarIsStartingRef.current = true;
    instarStartSessionRef.current += 1;
    const sessionId = instarStartSessionRef.current;
    try {
      await stopInstarTalkback();
      if (instarStartSessionRef.current !== sessionId) {
        return;
      }
      setPreviewStreamDebug("INSTAR: starte Talkback...");
      const startResponse = await fetch("/smarthome-dashboard-v2/api/instar-talk/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cameraBaseUrl: instarBaseUrl,
          username: instarUsername,
          password: instarPassword,
          allowInsecure: true,
        }),
      });
      const startPayload = await startResponse.json().catch(() => ({}));
      if (!startResponse.ok || !startPayload?.token) {
        throw new Error(startPayload?.error || `INSTAR talk start failed (${startResponse.status})`);
      }
      if (instarStartSessionRef.current !== sessionId) {
        void fetch("/smarthome-dashboard-v2/api/instar-talk/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: String(startPayload.token) }),
        }).catch(() => undefined);
        return;
      }
      instarTalkTokenRef.current = String(startPayload.token);
      setPreviewStreamDebug("INSTAR: Session aktiv, Mikrofon wird angefordert...");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (instarStartSessionRef.current !== sessionId) {
        stream.getTracks().forEach((t) => t.stop());
        void stopInstarTalkback();
        return;
      }
      instarTalkStreamRef.current = stream;
      setPreviewStreamDebug("INSTAR: Mikrofon aktiv.");
      const audioContext = new AudioContext({ sampleRate: 16000 });
      instarTalkAudioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      instarTalkSourceRef.current = source;
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      instarTalkProcessorRef.current = processor;
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const pcm = downsampleFloat32ToInt16(input, event.inputBuffer.sampleRate, 16000);
        if (!pcm.length) {
          return;
        }
        instarTalkQueueRef.current.push(pcm);
        instarTalkQueueBytesRef.current += pcm.length;
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      instarTalkFlushTimerRef.current = setInterval(() => {
        void flushInstarTalkbackQueue(instarTalkTokenRef.current, instarTalkQueueRef, instarTalkQueueBytesRef, instarFlushInProgressRef, () => {
          void stopInstarTalkback();
        }).then((sent) => {
          if (sent > 0) {
            instarTalkSentBytesRef.current += sent;
            const now = Date.now();
            if (now - instarTalkLastDebugAtRef.current > 1000) {
              instarTalkLastDebugAtRef.current = now;
              setPreviewStreamDebug(`INSTAR: sende Audio (${instarTalkSentBytesRef.current} bytes)`);
            }
          }
        });
      }, 80);
    } finally {
      instarIsStartingRef.current = false;
    }
  }, [instarBaseUrl, instarPassword, instarTalkbackAvailable, instarUsername, stopInstarTalkback]);

  const callInstarControl = useCallback(
    async (query: Record<string, string | number>) => {
      if (!instarTalkbackConfigured) {
        setPreviewStreamDebug("INSTAR-Steuerung nicht konfiguriert.");
        return null;
      }
      try {
        const response = await fetch("/smarthome-dashboard-v2/api/instar-control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cameraBaseUrl: instarBaseUrl,
            username: instarUsername,
            password: instarPassword,
            allowInsecure: true,
            query,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || `INSTAR control failed (${response.status})`);
        }
        return payload;
      } catch (error) {
        setPreviewStreamDebug(error instanceof Error ? error.message : "INSTAR control failed");
        return null;
      }
    },
    [instarBaseUrl, instarPassword, instarTalkbackConfigured, instarUsername]
  );

  const callReolinkControl = useCallback(
    async (cmd: string, param: Record<string, unknown>) => {
      if (!reolinkTalkbackConfigured) {
        setPreviewStreamDebug("Reolink-Steuerung nicht konfiguriert.");
        return null;
      }
      try {
        const response = await fetch("/smarthome-dashboard-v2/api/reolink-control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cameraBaseUrl: reolinkBaseUrl,
            username: reolinkUsername,
            password: reolinkPassword,
            allowInsecure: true,
            cmd,
            action: 0,
            param,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || `Reolink control failed (${response.status})`);
        }
        return payload;
      } catch (error) {
        setPreviewStreamDebug(error instanceof Error ? error.message : "Reolink control failed");
        return null;
      }
    },
    [reolinkBaseUrl, reolinkPassword, reolinkTalkbackConfigured, reolinkUsername]
  );

  const sendPtz = useCallback(
    async (direction: "up" | "right" | "down" | "left" | "zoomin" | "zoomout") => {
      const result = await callInstarControl({
        cmd: "ptzmove",
        [direction]: 10,
        speed: 5,
        timeout: 1,
      });
      if (result) {
        setPreviewStreamDebug(`INSTAR: ${direction}`);
      }
    },
    [callInstarControl]
  );

  const stopPtzContinuous = useCallback(async () => {
    if (!ptzContinuousRef.current) {
      return;
    }
    ptzContinuousRef.current = null;
    await callInstarControl({
      cmd: "ptzmove",
      stop: "pt",
    });
  }, [callInstarControl]);

  const handlePtzPressIn = useCallback(
    (direction: "up" | "right" | "down" | "left") => {
      if (ptzHoldTimerRef.current) {
        clearTimeout(ptzHoldTimerRef.current);
        ptzHoldTimerRef.current = null;
      }
      ptzHoldTimerRef.current = setTimeout(() => {
        ptzHoldTimerRef.current = null;
        ptzContinuousRef.current = direction;
        void callInstarControl({
          cmd: "ptzmove",
          [direction]: 0,
          speed: 8,
          timeout: 0,
        });
      }, 220);
    },
    [callInstarControl]
  );

  const handlePtzPressOut = useCallback(
    (direction: "up" | "right" | "down" | "left") => {
      if (ptzHoldTimerRef.current) {
        clearTimeout(ptzHoldTimerRef.current);
        ptzHoldTimerRef.current = null;
      }
      if (ptzContinuousRef.current === direction) {
        void stopPtzContinuous();
        return;
      }
      void sendPtz(direction);
    },
    [sendPtz, stopPtzContinuous]
  );

  const setAlarmArmed = useCallback(
    async (armed: boolean) => {
      const result = showReolinkControls
        ? await callReolinkControl("AudioAlarmPlay", {
            alarm_mode: "manul",
            manual_switch: armed ? 1 : 0,
            times: 1,
            channel: reolinkChannel,
          })
        : await callInstarControl({
            cmd: "setalarmattr",
            armed: armed ? 1 : 0,
          });
      if (result) {
        setInstarAlarmArmed(armed);
        setPreviewStreamDebug(`Alarm ${armed ? "ON" : "OFF"}`);
      }
    },
    [callInstarControl, callReolinkControl, reolinkChannel, showReolinkControls]
  );

  const updateSpeakerVolume = useCallback(
    async (volume: number) => {
      const clamped = Math.max(1, Math.min(100, Math.round(volume)));
      setInstarSpeakerVolume(clamped);
      const result = showReolinkControls
        ? await callReolinkControl("SetAudioCfg", {
            AudioCfg: {
              channel: reolinkChannel,
              volume: clamped,
            },
          })
        : await callInstarControl({
            cmd: "setaudioattr",
            type: "out",
            enable: 1,
            volume: clamped,
          });
      if (result) {
        setPreviewStreamDebug(`Lautsprecher ${clamped}%`);
      }
    },
    [callInstarControl, callReolinkControl, reolinkChannel, showReolinkControls]
  );

  const updateSpeakerVolumeDrag = useCallback(
    async (next: number) => {
      const clamped = Math.max(1, Math.min(100, Math.round(next)));
      setInstarSpeakerVolume(clamped);
      const now = Date.now();
      if (now - volumeLastSentRef.current < 120) {
        return;
      }
      volumeLastSentRef.current = now;
      await updateSpeakerVolume(clamped);
    },
    [updateSpeakerVolume]
  );

  const setLedMode = useCallback(
    async (enabled: boolean) => {
      const result = showReolinkControls
        ? await callReolinkControl("SetWhiteLed", {
            WhiteLed: {
              channel: reolinkChannel,
              mode: 1,
              state: enabled ? 1 : 0,
              bright: 100,
            },
          })
        : await callInstarControl({
            cmd: "illuminate",
            duration: enabled ? 180 : 0,
          });
      if (result) {
        setInstarLedOn(enabled);
        setPreviewStreamDebug(`LED ${enabled ? "ON" : "OFF"}`);
      }
    },
    [callInstarControl, callReolinkControl, reolinkChannel, showReolinkControls]
  );

  const enableTalkback = useCallback(() => {
    if (!talkbackAvailable) {
      setPreviewStreamDebug("Talkback nicht konfiguriert. Bitte INSTAR/Reolink-Daten oder WebRTC-URL setzen.");
      return;
    }
    playConfiguredUiSound(config.interactionSounds?.press, "toggle", `${config.id}:talkback-on`);
    if (instarTalkbackAvailable) {
      void startInstarTalkback()
        .then(() => setTalkbackActive(true))
        .catch((error) => {
          setPreviewStreamDebug(error instanceof Error ? error.message : "INSTAR talkback failed");
          void stopInstarTalkback();
          setTalkbackActive(false);
        });
      return;
    }
    if (reolinkTalkbackAvailable) {
      void startReolinkTalkback()
        .then(() => setTalkbackActive(true))
        .catch((error) => {
          setPreviewStreamDebug(error instanceof Error ? error.message : "Reolink talkback failed");
          void stopReolinkTalkback();
          setTalkbackActive(false);
        });
      return;
    }
    setTalkbackActive(true);
  }, [
    config.id,
    config.interactionSounds?.press,
    instarTalkbackAvailable,
    reolinkTalkbackAvailable,
    startInstarTalkback,
    stopInstarTalkback,
    startReolinkTalkback,
    stopReolinkTalkback,
    talkbackAvailable,
  ]);

  const disableTalkback = useCallback(() => {
    if (instarTalkbackAvailable) {
      void stopInstarTalkback();
    }
    if (reolinkTalkbackAvailable) {
      void stopReolinkTalkback();
      setPreviewStreamDebug("Reolink Talkback beendet.");
    }
    setTalkbackActive(false);
  }, [instarTalkbackAvailable, reolinkTalkbackAvailable, stopInstarTalkback, stopReolinkTalkback]);

  const toggleTalkback = useCallback(() => {
    if (!talkbackAvailable) {
      setPreviewStreamDebug("Talkback nicht konfiguriert. Bitte INSTAR/Reolink-Daten oder WebRTC-URL setzen.");
      return;
    }
    playConfiguredUiSound(config.interactionSounds?.press, "toggle", `${config.id}:talkback-toggle`);
    if (instarTalkbackAvailable) {
      if (talkbackActive) {
        void stopInstarTalkback();
        setTalkbackActive(false);
      } else {
        void startInstarTalkback()
          .then(() => setTalkbackActive(true))
          .catch((error) => {
            setPreviewStreamDebug(error instanceof Error ? error.message : "INSTAR talkback failed");
            void stopInstarTalkback();
            setTalkbackActive(false);
          });
      }
      return;
    }
    if (reolinkTalkbackAvailable) {
      if (talkbackActive) {
        void stopReolinkTalkback();
        setTalkbackActive(false);
        setPreviewStreamDebug("Reolink Talkback beendet.");
      } else {
        void startReolinkTalkback()
          .then(() => setTalkbackActive(true))
          .catch((error) => {
            setPreviewStreamDebug(error instanceof Error ? error.message : "Reolink talkback failed");
            void stopReolinkTalkback();
            setTalkbackActive(false);
          });
      }
      return;
    }
    setTalkbackActive((current) => !current);
  }, [
    config.id,
    config.interactionSounds?.press,
    instarTalkbackAvailable,
    reolinkTalkbackAvailable,
    startReolinkTalkback,
    stopReolinkTalkback,
    startInstarTalkback,
    stopInstarTalkback,
    talkbackActive,
    talkbackAvailable,
  ]);

  const fullscreenPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          Math.abs(gestureState.dy) > 12 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderRelease: (_event, gestureState) => {
          if (gestureState.dy > 80 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)) {
            playConfiguredUiSound(config.interactionSounds?.scroll, "swipe", `${config.id}:scroll`);
            onFullscreenSwipeClose?.();
            closeFullscreen();
          }
        },
      }),
    [closeFullscreen, config.id, config.interactionSounds?.scroll, onFullscreenSwipeClose]
  );

  useEffect(() => {
    return () => {
      void stopInstarTalkback();
      void stopReolinkTalkback();
    };
  }, [stopInstarTalkback, stopReolinkTalkback]);

  useEffect(() => {
    if (!runtimeActive) {
      return;
    }
    if (!activeSnapshotBaseUrl) {
      return;
    }
    if (shouldUseSnapshotWebSocket && liveSnapshotWsDataUrl) {
      return;
    }
    const timer = setInterval(() => setTick((current) => current + 1), activeRefreshMs);
    return () => clearInterval(timer);
  }, [activeRefreshMs, activeSnapshotBaseUrl, liveSnapshotWsDataUrl, runtimeActive, shouldUseSnapshotWebSocket]);

  useEffect(() => {
    if (fullscreenOpen) {
      return;
    }
    void stopInstarTalkback();
    void stopReolinkTalkback();
    setTalkbackActive(false);
  }, [fullscreenOpen, stopInstarTalkback, stopReolinkTalkback]);

  useEffect(() => {
    if (Platform.OS !== "web" || !talkbackPressToHold || !talkbackActive) {
      return;
    }
    const release = () => disableTalkback();
    window.addEventListener("mouseup", release);
    window.addEventListener("touchend", release);
    window.addEventListener("touchcancel", release);
    return () => {
      window.removeEventListener("mouseup", release);
      window.removeEventListener("touchend", release);
      window.removeEventListener("touchcancel", release);
    };
  }, [disableTalkback, talkbackActive, talkbackPressToHold]);

  useEffect(() => {
    return () => {
      if (ptzHoldTimerRef.current) {
        clearTimeout(ptzHoldTimerRef.current);
        ptzHoldTimerRef.current = null;
      }
      if (ptzContinuousRef.current) {
        void stopPtzContinuous();
      }
    };
  }, [stopPtzContinuous]);

  useEffect(() => {
    if ((!useInPlaceFullscreen && fullscreenOpen) || previewFeed?.kind !== "mjpeg") {
      clearPreviewMjpegReconnectTimer();
      setPreviewStreamDebug(null);
      setPreviewMjpegLoaded(false);
    }
  }, [clearPreviewMjpegReconnectTimer, fullscreenOpen, previewFeed?.kind, useInPlaceFullscreen]);

  useEffect(() => {
    setPreviewMjpegSourceIndex(0);
    setPreviewMjpegLoaded(false);
    previewMjpegReconnectAttemptsRef.current = 0;
    clearPreviewMjpegReconnectTimer();
  }, [previewMjpegSources, previewFeed?.kind, previewFeed?.url]);

  useEffect(() => {
    // Force a clean preview re-init when source mode/url changes so updates apply instantly.
    loadingJobRef.current = null;
    latestRequestedUrlRef.current = null;
    hasReportedAspectRatio.current = false;
    setLoadingLayer(null);
    setLayerUrls([null, null]);
    setActiveLayer(0);
    activeLayerRef.current = 0;
  }, [previewFeedKey]);

  useEffect(() => {
    setFullscreenMjpegSourceIndex(0);
    setFullscreenMjpegLoaded(false);
  }, [fullscreenMjpegSources, fullscreenFeed?.kind, fullscreenFeed?.url]);

  useEffect(() => {
    setPreviewFlvSourceIndex(0);
  }, [previewFlvSources, previewFeed?.kind, previewFeed?.url]);

  useEffect(() => {
    setFullscreenFlvSourceIndex(0);
  }, [fullscreenFlvSources, fullscreenFeed?.kind, fullscreenFeed?.url]);

  useEffect(() => {
    setPreviewFmp4SourceIndex(0);
  }, [previewFmp4Sources, previewFeed?.kind, previewFeed?.url]);

  useEffect(() => {
    setFullscreenFmp4SourceIndex(0);
  }, [fullscreenFmp4Sources, fullscreenFeed?.kind, fullscreenFeed?.url]);

  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      ((!useInPlaceFullscreen && fullscreenOpen) || previewFeed?.kind !== "mjpeg") ||
      !currentPreviewMjpegSrc
    ) {
      return;
    }

    const watchdog = setTimeout(() => {
      if (previewMjpegLoaded) {
        return;
      }
      schedulePreviewMjpegReconnect("MJPEG Preview: Stream konnte nicht gestartet werden.");
    }, MJPEG_SOURCE_SWITCH_TIMEOUT_MS);

    return () => clearTimeout(watchdog);
  }, [
    currentPreviewMjpegSrc,
    fullscreenOpen,
    previewFeed?.kind,
    previewMjpegLoaded,
    schedulePreviewMjpegReconnect,
    useInPlaceFullscreen,
  ]);

  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      useInPlaceFullscreen ||
      !fullscreenOpen ||
      fullscreenFeed?.kind !== "mjpeg" ||
      !currentFullscreenMjpegSrc
    ) {
      return;
    }

    const watchdog = setTimeout(() => {
      if (fullscreenMjpegLoaded) {
        return;
      }
      moveFullscreenMjpegToNextSource();
    }, MJPEG_SOURCE_SWITCH_TIMEOUT_MS);

    return () => clearTimeout(watchdog);
  }, [
    currentFullscreenMjpegSrc,
    fullscreenFeed?.kind,
    fullscreenMjpegLoaded,
    fullscreenOpen,
    moveFullscreenMjpegToNextSource,
    useInPlaceFullscreen,
  ]);

  useEffect(() => {
    fullscreenVisibilityCallbackRef.current = onFullscreenVisibilityChange;
  }, [onFullscreenVisibilityChange]);

  useEffect(() => {
    if (!fullscreenOpen || pinned) {
      return;
    }

    const timer = setTimeout(() => {
      closeFullscreen();
    }, MAX_FULLSCREEN_DURATION_MS);

    return () => clearTimeout(timer);
  }, [fullscreenOpen, pinned]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      return;
    }

    const webDocument = document as Document & {
      webkitFullscreenElement?: Element | null;
    };
    const syncDocumentFullscreen = () => {
      const activeElement = webDocument.fullscreenElement || webDocument.webkitFullscreenElement || null;
      const host = inPlaceFullscreenHostRef.current as Element | null;
      const active = Boolean(activeElement && host && (activeElement === host || host.contains(activeElement)));
      setWebDocumentFullscreenActive(active);
      if (!active && wasDocumentFullscreenRef.current && fullscreenOpen && useInPlaceFullscreen) {
        setFullscreenOpen(false);
        setPinned(false);
      }
      wasDocumentFullscreenRef.current = active;
    };

    syncDocumentFullscreen();
    webDocument.addEventListener("fullscreenchange", syncDocumentFullscreen);
    webDocument.addEventListener("webkitfullscreenchange", syncDocumentFullscreen as EventListener);
    return () => {
      webDocument.removeEventListener("fullscreenchange", syncDocumentFullscreen);
      webDocument.removeEventListener("webkitfullscreenchange", syncDocumentFullscreen as EventListener);
    };
  }, [fullscreenOpen, useInPlaceFullscreen]);

  useEffect(() => {
    return () => {
      clearPreviewMjpegReconnectTimer();
    };
  }, [clearPreviewMjpegReconnectTimer]);

  useEffect(() => {
    if (showInPlaceFullscreen) {
      return;
    }
    webPinchingRef.current = false;
    webPinchStartDistanceRef.current = null;
    webPinchStartZoomRef.current = 1;
    webPanStartRef.current = null;
    webFullscreenZoomRef.current = 1;
    webFullscreenOffsetRef.current = { x: 0, y: 0 };
    setWebFullscreenZoom(1);
    setWebFullscreenOffset({ x: 0, y: 0 });
  }, [showInPlaceFullscreen]);

  useEffect(() => {
    webFullscreenZoomRef.current = webFullscreenZoom;
  }, [webFullscreenZoom]);

  useEffect(() => {
    webFullscreenOffsetRef.current = webFullscreenOffset;
  }, [webFullscreenOffset]);

  useEffect(() => {
    if (!showInPlaceFullscreen) {
      return;
    }
    const clamped = clampWebFullscreenOffset(
      webFullscreenOffsetRef.current.x,
      webFullscreenOffsetRef.current.y,
      webFullscreenZoomRef.current,
      webFullscreenViewport.width,
      webFullscreenViewport.height
    );
    if (
      Math.abs(clamped.x - webFullscreenOffsetRef.current.x) > 0.5 ||
      Math.abs(clamped.y - webFullscreenOffsetRef.current.y) > 0.5
    ) {
      webFullscreenOffsetRef.current = clamped;
      setWebFullscreenOffset(clamped);
    }
  }, [showInPlaceFullscreen, webFullscreenViewport.height, webFullscreenViewport.width]);

  const updateWebFullscreenViewport = useCallback((width: number, height: number) => {
    if (!width || !height) {
      return;
    }
    setWebFullscreenViewport((current) => {
      if (Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5) {
        return current;
      }
      return { width, height };
    });
  }, []);

  const handleWebPinchStart = useCallback((event: any) => {
    if (!showInPlaceFullscreen || Platform.OS !== "web") {
      return;
    }
    const touches = event?.nativeEvent?.touches;
    if (!touches || !touches.length) {
      return;
    }
    if (touches.length === 2) {
      const distance = getTouchDistance(touches);
      if (!distance) {
        return;
      }
      webPanStartRef.current = null;
      webPinchStartDistanceRef.current = distance;
      webPinchStartZoomRef.current = webFullscreenZoomRef.current;
      webPinchingRef.current = true;
      event?.preventDefault?.();
      return;
    }
    if (touches.length === 1 && webFullscreenZoomRef.current > 1.001) {
      const touch = touches[0];
      webPanStartRef.current = {
        touchX: Number(touch?.pageX ?? 0),
        touchY: Number(touch?.pageY ?? 0),
        offsetX: webFullscreenOffsetRef.current.x,
        offsetY: webFullscreenOffsetRef.current.y,
      };
      webPinchingRef.current = true;
      event?.preventDefault?.();
    }
  }, [showInPlaceFullscreen]);

  const handleWebPinchMove = useCallback((event: any) => {
    if (!showInPlaceFullscreen || Platform.OS !== "web") {
      return;
    }
    const touches = event?.nativeEvent?.touches;
    if (!touches || !touches.length) {
      return;
    }

    if (touches.length === 2 && webPinchStartDistanceRef.current) {
      const distance = getTouchDistance(touches);
      if (!distance) {
        return;
      }
      const nextZoom = clampZoom(webPinchStartZoomRef.current * (distance / webPinchStartDistanceRef.current));
      const midpoint = getTouchMidpoint(touches);
      const centerX = webFullscreenViewport.width / 2;
      const centerY = webFullscreenViewport.height / 2;
      const currentZoom = webFullscreenZoomRef.current;
      const currentOffset = webFullscreenOffsetRef.current;
      const ratio = currentZoom > 0 ? nextZoom / currentZoom : 1;
      const focusX = midpoint ? midpoint.x - centerX : 0;
      const focusY = midpoint ? midpoint.y - centerY : 0;
      const rawOffsetX = focusX * (1 - ratio) + currentOffset.x * ratio;
      const rawOffsetY = focusY * (1 - ratio) + currentOffset.y * ratio;
      const nextOffset = clampWebFullscreenOffset(
        rawOffsetX,
        rawOffsetY,
        nextZoom,
        webFullscreenViewport.width,
        webFullscreenViewport.height
      );
      if (Math.abs(nextZoom - webFullscreenZoomRef.current) > 0.01) {
        webFullscreenZoomRef.current = nextZoom;
        setWebFullscreenZoom(nextZoom);
      }
      if (
        Math.abs(nextOffset.x - webFullscreenOffsetRef.current.x) > 0.5 ||
        Math.abs(nextOffset.y - webFullscreenOffsetRef.current.y) > 0.5
      ) {
        webFullscreenOffsetRef.current = nextOffset;
        setWebFullscreenOffset(nextOffset);
      }
      webPinchingRef.current = true;
      event?.preventDefault?.();
      return;
    }

    if (touches.length === 1 && webPanStartRef.current && webFullscreenZoomRef.current > 1.001) {
      const touch = touches[0];
      const dx = Number(touch?.pageX ?? 0) - webPanStartRef.current.touchX;
      const dy = Number(touch?.pageY ?? 0) - webPanStartRef.current.touchY;
      const rawOffsetX = webPanStartRef.current.offsetX + dx;
      const rawOffsetY = webPanStartRef.current.offsetY + dy;
      const nextOffset = clampWebFullscreenOffset(
        rawOffsetX,
        rawOffsetY,
        webFullscreenZoomRef.current,
        webFullscreenViewport.width,
        webFullscreenViewport.height
      );
      if (
        Math.abs(nextOffset.x - webFullscreenOffsetRef.current.x) > 0.5 ||
        Math.abs(nextOffset.y - webFullscreenOffsetRef.current.y) > 0.5
      ) {
        webFullscreenOffsetRef.current = nextOffset;
        setWebFullscreenOffset(nextOffset);
      }
      webPinchingRef.current = true;
      event?.preventDefault?.();
    }
  }, [showInPlaceFullscreen, webFullscreenViewport.height, webFullscreenViewport.width]);

  const handleWebPinchEnd = useCallback((event: any) => {
    if (Platform.OS !== "web") {
      return;
    }
    const touches = event?.nativeEvent?.touches;
    if (touches && touches.length >= 2) {
      return;
    }
    webPinchStartDistanceRef.current = null;
    webPinchStartZoomRef.current = webFullscreenZoomRef.current;
    if (touches && touches.length === 1 && showInPlaceFullscreen && webFullscreenZoomRef.current > 1.001) {
      const touch = touches[0];
      webPanStartRef.current = {
        touchX: Number(touch?.pageX ?? 0),
        touchY: Number(touch?.pageY ?? 0),
        offsetX: webFullscreenOffsetRef.current.x,
        offsetY: webFullscreenOffsetRef.current.y,
      };
      return;
    }
    webPanStartRef.current = null;
    setTimeout(() => {
      webPinchingRef.current = false;
    }, 0);
  }, [showInPlaceFullscreen]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined" || !fullscreenOpen) {
      return;
    }

    const targets = [document.documentElement, document.body];
    const previous = targets.map((target) => ({
      target,
      overscrollBehaviorY: target.style.overscrollBehaviorY,
      touchAction: target.style.touchAction,
    }));

    targets.forEach((target) => {
      target.style.overscrollBehaviorY = "none";
      target.style.touchAction = "none";
    });

    return () => {
      previous.forEach(({ target, overscrollBehaviorY, touchAction }) => {
        target.style.overscrollBehaviorY = overscrollBehaviorY;
        target.style.touchAction = touchAction;
      });
    };
  }, [fullscreenOpen]);

  useEffect(() => {
    const nextMatch = matchesMaximizeTrigger(config, maximizeStateValue);
    const previousMatch = lastTriggerMatchRef.current;
    lastTriggerMatchRef.current = nextMatch;

    if (nextMatch && !previousMatch && !fullscreenOpen) {
      openFullscreen();
    }
  }, [config, fullscreenOpen, maximizeStateValue]);

  const reportAspectRatio = useCallback((width: number, height: number) => {
    if (!onAspectRatioDetected || hasReportedAspectRatio.current || !width || !height) {
      return;
    }

    const ratio = width / height;
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return;
    }

    if (config.snapshotAspectRatio) {
      hasReportedAspectRatio.current = true;
      return;
    }

    hasReportedAspectRatio.current = true;
    onAspectRatioDetected(ratio);
  }, [config.snapshotAspectRatio, onAspectRatioDetected]);

  const reportAspectRatioValue = useCallback((ratio: number) => {
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return;
    }
    reportAspectRatio(ratio, 1);
  }, [reportAspectRatio]);

  const snapshotUrl = useMemo(() => {
    if (!activeSnapshotBaseUrl) {
      return null;
    }
    if (liveSnapshotWsDataUrl) {
      return liveSnapshotWsDataUrl;
    }
    if (Platform.OS === "web" && typeof window !== "undefined" && window.location.pathname.includes("/smarthome-dashboard-v2")) {
      const proxyBase = `${window.location.origin}/smarthome-dashboard-v2/api/camera-snapshot`;
      return `${proxyBase}?url=${encodeURIComponent(activeSnapshotBaseUrl)}&t=${tick}`;
    }
    const separator = activeSnapshotBaseUrl.includes("?") ? "&" : "?";
    return `${activeSnapshotBaseUrl}${separator}t=${tick}`;
  }, [activeSnapshotBaseUrl, liveSnapshotWsDataUrl, tick]);

  useEffect(() => {
    activeLayerRef.current = activeLayer;
  }, [activeLayer]);

  const scheduleLoad = useCallback((url: string) => {
    const targetLayer: 0 | 1 = activeLayerRef.current === 0 ? 1 : 0;
    loadingJobRef.current = { layer: targetLayer, url };
    setLoadingLayer(targetLayer);
    setLayerUrls((current) => {
      const next: [string | null, string | null] = [...current] as [string | null, string | null];
      next[targetLayer] = url;
      return next;
    });
  }, []);

  const commitLayerLoad = useCallback(
    (layer: 0 | 1, url: string, width?: number, height?: number) => {
      const job = loadingJobRef.current;
      if (!job || job.layer !== layer || job.url !== url) {
        return;
      }

      if (width && height) {
        reportAspectRatio(width, height);
      }

      // Keep the imperative ref in sync immediately so any follow-up schedule
      // in this same tick always targets the opposite (hidden) layer.
      activeLayerRef.current = layer;
      setActiveLayer(layer);
      setLoadingLayer(null);
      loadingJobRef.current = null;

      const latest = latestRequestedUrlRef.current;
      if (latest && latest !== url) {
        scheduleLoad(latest);
      }
    },
    [reportAspectRatio, scheduleLoad]
  );

  useEffect(() => {
    latestRequestedUrlRef.current = snapshotUrl;

    if (!snapshotUrl) {
      loadingJobRef.current = null;
      setLoadingLayer(null);
      setLayerUrls([null, null]);
      setActiveLayer(0);
      activeLayerRef.current = 0;
      return;
    }

    const currentVisibleUrl = layerUrls[activeLayerRef.current];
    if (!currentVisibleUrl) {
      const visibleLayer = activeLayerRef.current;
      setLayerUrls((current) => {
        const next: [string | null, string | null] = [...current] as [string | null, string | null];
        next[visibleLayer] = snapshotUrl;
        return next;
      });
      return;
    }

    if (snapshotUrl === currentVisibleUrl) {
      return;
    }

    const job = loadingJobRef.current;
    if (job && job.url === snapshotUrl) {
      return;
    }

    scheduleLoad(snapshotUrl);
  }, [layerUrls, scheduleLoad, snapshotUrl]);

  const renderFullscreenControls = () => (
    <View pointerEvents="box-none" style={styles.fullscreenControlsWrap}>
      <View style={styles.fullscreenTopRightActions}>
        <Pressable
          onPress={() => setPinned((current) => !current)}
          style={[styles.fullscreenActionButton, pinned ? styles.fullscreenAudioActive : styles.fullscreenActionInactive]}
        >
          <MaterialCommunityIcons
            color={pinned ? pinnedColor : palette.text}
            name={pinned ? "pin" : "pin-outline"}
            size={22}
          />
        </Pressable>
        <Pressable
          onPress={() => {
            playConfiguredUiSound(config.interactionSounds?.close, "close", `${config.id}:close`);
            closeFullscreen();
          }}
          style={[styles.fullscreenActionButton, styles.fullscreenActionInactive]}
        >
          <MaterialCommunityIcons color={palette.text} name="close" size={22} />
        </Pressable>
      </View>

      <View style={styles.fullscreenControlsRow}>
        {showInstarControls || showReolinkControls ? (
          <View style={styles.controlColumn}>
            <Pressable
              onPress={() => void setAlarmArmed(!(instarAlarmArmed === true))}
              style={[
                styles.fullscreenActionButton,
                styles.alarmButton,
                instarAlarmArmed === true ? styles.fullscreenAudioActive : styles.fullscreenActionInactive,
              ]}
            >
              <MaterialCommunityIcons
                color={instarAlarmArmed === true ? "#ff4d4d" : "#ffc0c0"}
                name={instarAlarmArmed === true ? "alarm-light" : "alarm-light-outline"}
                size={26}
              />
            </Pressable>
          </View>
        ) : null}

        {showInstarControls ? (
          <>
            <View style={styles.ptzPad}>
              <Pressable
                onPressIn={() => handlePtzPressIn("up")}
                onPressOut={() => handlePtzPressOut("up")}
                onTouchCancel={() => handlePtzPressOut("up")}
                style={[styles.ptzButton, styles.ptzButtonTop]}
              >
                <MaterialCommunityIcons color={palette.text} name="chevron-up" size={18} />
              </Pressable>
              <Pressable
                onPressIn={() => handlePtzPressIn("right")}
                onPressOut={() => handlePtzPressOut("right")}
                onTouchCancel={() => handlePtzPressOut("right")}
                style={[styles.ptzButton, styles.ptzButtonRight]}
              >
                <MaterialCommunityIcons color={palette.text} name="chevron-right" size={18} />
              </Pressable>
              <Pressable
                onPressIn={() => handlePtzPressIn("down")}
                onPressOut={() => handlePtzPressOut("down")}
                onTouchCancel={() => handlePtzPressOut("down")}
                style={[styles.ptzButton, styles.ptzButtonBottom]}
              >
                <MaterialCommunityIcons color={palette.text} name="chevron-down" size={18} />
              </Pressable>
              <Pressable
                onPressIn={() => handlePtzPressIn("left")}
                onPressOut={() => handlePtzPressOut("left")}
                onTouchCancel={() => handlePtzPressOut("left")}
                style={[styles.ptzButton, styles.ptzButtonLeft]}
              >
                <MaterialCommunityIcons color={palette.text} name="chevron-left" size={18} />
              </Pressable>
            </View>

            <View style={styles.controlColumn}>
              <Pressable onPress={() => void sendPtz("zoomin")} style={styles.fullscreenActionButton}>
                <MaterialCommunityIcons color={palette.text} name="magnify-plus-outline" size={18} />
              </Pressable>
              <Pressable onPress={() => void sendPtz("zoomout")} style={styles.fullscreenActionButton}>
                <MaterialCommunityIcons color={palette.text} name="magnify-minus-outline" size={18} />
              </Pressable>
            </View>
          </>
        ) : null}

        {showInstarControls || showReolinkControls ? (
          <View style={styles.controlColumn}>
            <Pressable
              onPress={() => void setLedMode(!(instarLedOn === true))}
              style={[styles.fullscreenActionButton, instarLedOn === true ? styles.fullscreenAudioActive : styles.fullscreenActionInactive]}
            >
              <MaterialCommunityIcons
                color={instarLedOn === true ? "#ffd86b" : "#f7fbff"}
                name={instarLedOn === true ? "lightning-bolt" : "lightning-bolt-outline"}
                size={24}
              />
            </Pressable>
          </View>
        ) : null}

        {showInstarControls || showReolinkControls ? (
          <View style={styles.volumeColumn}>
          <Pressable onPress={() => void updateSpeakerVolume(instarSpeakerVolume + 5)} style={styles.volumeAdjustBtn}>
            <MaterialCommunityIcons color={palette.text} name="plus" size={16} />
          </Pressable>
          <View
            onLayout={(event) => {
              const h = Math.round(event.nativeEvent.layout.height || 84);
              volumeTrackHeightRef.current = h > 20 ? h : 84;
            }}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={(event) => {
              volumeDragActiveRef.current = true;
              const y = event.nativeEvent.locationY ?? 0;
              const pct = 100 - (y / volumeTrackHeightRef.current) * 100;
              void updateSpeakerVolumeDrag(pct);
            }}
            onResponderMove={(event) => {
              if (!volumeDragActiveRef.current) {
                return;
              }
              const y = event.nativeEvent.locationY ?? 0;
              const pct = 100 - (y / volumeTrackHeightRef.current) * 100;
              void updateSpeakerVolumeDrag(pct);
            }}
            onResponderRelease={() => {
              volumeDragActiveRef.current = false;
            }}
            onResponderTerminate={() => {
              volumeDragActiveRef.current = false;
            }}
            style={styles.volumeTrack}
          >
            <View style={[styles.volumeFill, { height: `${instarSpeakerVolume}%` }]} />
          </View>
          <Pressable onPress={() => void updateSpeakerVolume(instarSpeakerVolume - 5)} style={styles.volumeAdjustBtn}>
            <MaterialCommunityIcons color={palette.text} name="minus" size={16} />
          </Pressable>
          </View>
        ) : null}

        <View style={styles.controlColumn}>
          {talkbackControlVisible ? (
            <Pressable
              onPress={talkbackPressToHold ? undefined : toggleTalkback}
              onPressIn={talkbackPressToHold ? enableTalkback : undefined}
              onPressOut={talkbackPressToHold ? disableTalkback : undefined}
              onTouchEnd={talkbackPressToHold ? disableTalkback : undefined}
              onTouchCancel={talkbackPressToHold ? disableTalkback : undefined}
                style={[
                  styles.fullscreenActionButton,
                  talkbackActive ? styles.fullscreenAudioActive : null,
                  !talkbackAvailable ? styles.fullscreenActionDisabled : styles.fullscreenActionInactive,
                ]}
              >
                <MaterialCommunityIcons
                color={!talkbackAvailable ? palette.textMuted : talkbackActive ? pinnedColor : palette.text}
                name={talkbackActive ? "microphone" : "microphone-outline"}
                size={22}
              />
            </Pressable>
          ) : null}
        </View>
      </View>

    </View>
  );

  return (
    <>
      <View ref={inPlaceFullscreenHostRef} style={[styles.container, showFixedFallbackFullscreen ? webInPlaceFullscreenHostStyle : null]}>
        <Pressable
          disabled={!previewFeed && !fullscreenFeed}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            updateWebFullscreenViewport(width, height);
          }}
          onTouchCancel={handleWebPinchEnd}
          onTouchEnd={handleWebPinchEnd}
          onTouchMove={handleWebPinchMove}
          onTouchStart={handleWebPinchStart}
          onPress={() => {
            if (fullscreenOpen || webPinchingRef.current) {
              return;
            }
            playConfiguredUiSound(config.interactionSounds?.open, "open", `${config.id}:open`);
            openFullscreen();
          }}
          style={styles.preview}
        >
        {previewFeed ? (
          <View style={styles.snapshotWrap}>
            {showPreviewFeed && previewFeed.kind === "snapshot"
              ? ([0, 1] as const).map((layer) => {
                  const url = layerUrls[layer];
                  if (!url) {
                    return null;
                  }
                  const isVisible = layer === activeLayer;
                  const isLoadingTarget = loadingLayer === layer;
                  return Platform.OS === "web"
                    ? createElement("img", {
                        alt: isVisible ? config.title || "Camera snapshot" : "",
                        "aria-hidden": !isVisible,
                        decoding: "sync",
                        draggable: false,
                        key: `preview-web-layer-${layer}`,

                        loading: "eager",
                        onError: () => {
                          if (!isLoadingTarget) {
                            return;
                          }
                          const latest = latestRequestedUrlRef.current;
                          setLoadingLayer(null);
                          loadingJobRef.current = null;
                          if (latest && latest !== displayUrl) {
                            scheduleLoad(latest);
                          }
                        },
                        onLoad: (event: Event) => {
                          const target = event.currentTarget as HTMLImageElement | null;
                          if (!target) {
                            return;
                          }
                          if (isLoadingTarget) {
                            commitLayerLoad(layer, url, target.naturalWidth, target.naturalHeight);
                            return;
                          }
                          if (isVisible) {
                            reportAspectRatio(target.naturalWidth, target.naturalHeight);
                          }
                        },
                        src: url,
                        style: showInPlaceFullscreen
                          ? getFullscreenWebLayerStyle(isVisible, webFullscreenZoom, webFullscreenOffset.x, webFullscreenOffset.y)
                          : getWebLayerStyle(isVisible),
                      })
                    : (
                        <Image
                          key={`preview-native-layer-${layer}`}
                          onError={() => {
                            if (!isLoadingTarget) {
                              return;
                            }
                            const latest = latestRequestedUrlRef.current;
                            setLoadingLayer(null);
                            loadingJobRef.current = null;
                            if (latest && latest !== displayUrl) {
                              scheduleLoad(latest);
                            }
                          }}
                          onLoad={(event) => {
                            const source = event.nativeEvent.source;
                            if (isLoadingTarget) {
                              commitLayerLoad(layer, url, source?.width, source?.height);
                              return;
                            }
                            if (isVisible && source?.width && source?.height) {
                              reportAspectRatio(source.width, source.height);
                            }
                          }}
                          resizeMode="cover"
                          source={{ uri: url }}
                          style={[styles.imageLayer, isVisible ? styles.layerVisible : styles.layerHidden]}
                        />
                      );
                })
              : null}
            {showPreviewFeed && previewFeed.kind === "mjpeg" && previewFeed.url
              ? Platform.OS === "web"
                ? createElement("img", {
                    alt: config.title || "Camera MJPEG",
                    decoding: "async",
                    draggable: false,
                    key: `preview-mjpeg-${currentPreviewMjpegSrc || previewFeed.url}:${previewMjpegSession}`,
                    loading: "eager",
                    onError: () => {
                      schedulePreviewMjpegReconnect("MJPEG Preview: Quelle nicht erreichbar.");
                    },
                    onLoad: (event: Event) => {
                      const target = event.currentTarget as HTMLImageElement | null;
                      const width = target?.naturalWidth || 0;
                      const height = target?.naturalHeight || 0;
                      if (!width || !height) {
                        schedulePreviewMjpegReconnect("MJPEG Preview: Ungueltige Bilddaten.");
                        return;
                      }
                      clearPreviewMjpegReconnectTimer();
                      previewMjpegReconnectAttemptsRef.current = 0;
                      setPreviewMjpegLoaded(true);
                      setPreviewStreamDebug(null);
                      reportAspectRatio(width, height);
                    },
                    src: withReconnectNonce(currentPreviewMjpegSrc || previewFeed.url, previewMjpegSession),
                    style: showInPlaceFullscreen
                      ? getFullscreenWebMjpegStyle(webFullscreenZoom, webFullscreenOffset.x, webFullscreenOffset.y)
                      : webMjpegStyle,
                  })
                : (
                    <Image
                      onLoad={(event) => {
                        const source = event.nativeEvent.source;
                        if (source?.width && source?.height) {
                          reportAspectRatio(source.width, source.height);
                        }
                      }}
                      resizeMode="contain"
                      source={{ uri: withReconnectNonce(previewFeed.url, previewMjpegSession) }}
                      style={styles.mjpegImage}
                    />
                  )
              : null}
            {showPreviewFeed && previewFeed.kind === "mjpeg" && previewStreamDebug ? (
              <View style={styles.streamDebugOverlay}>
                <Text style={styles.streamDebugText}>{previewStreamDebug}</Text>
              </View>
            ) : null}
            {showPreviewFeed && previewFeed.kind === "flv" && previewFeed.url
              ? Platform.OS === "web"
                ? (
                    <WebFlvPlayer
                      key={`preview-flv-${previewFeedKey}:${previewFlvSession}`}
                      fullScreen={showInPlaceFullscreen}
                      muted={previewMuted}
                      zoomScale={webFullscreenZoom}
                      offsetX={webFullscreenOffset.x}
                      offsetY={webFullscreenOffset.y}
                      onAspectRatioDetected={reportAspectRatioValue}
                      onSourceIndexChange={setPreviewFlvSourceIndex}
                      preferredSourceIndex={previewFlvSourceIndex}
                      sources={previewFlvSources.length ? previewFlvSources : [previewFeed.url]}
                      title={config.title || "Camera FLV"}
                    />
                  )
                : (
                    <View style={styles.empty}>
                      <Text style={[styles.emptyText, { color: mutedTextColor }]}>FLV wird nur im Web unterstuetzt.</Text>
                    </View>
                  )
              : null}
            {showPreviewFeed && previewFeed.kind === "fmp4" && previewFeed.url
              ? Platform.OS === "web"
                ? (
                    <WebFmp4Player
                      key={`preview-fmp4-${previewFeedKey}:${currentPreviewFmp4Src || "none"}`}
                      fullScreen={showInPlaceFullscreen}
                      muted={previewMuted}
                      zoomScale={webFullscreenZoom}
                      offsetX={webFullscreenOffset.x}
                      offsetY={webFullscreenOffset.y}
                      onAspectRatioDetected={reportAspectRatioValue}
                      onSourceIndexChange={setPreviewFmp4SourceIndex}
                      preferredSourceIndex={previewFmp4SourceIndex}
                      sources={previewFmp4Sources.length ? previewFmp4Sources : [previewFeed.url]}
                      title={config.title || "Camera fMP4"}
                    />
                  )
                : (
                    <View style={styles.empty}>
                      <Text style={[styles.emptyText, { color: mutedTextColor }]}>fMP4 wird nur im Web unterstuetzt.</Text>
                    </View>
                  )
              : null}
            {config.showTitle !== false && config.title ? (
              <View style={styles.titleBadge}>
                <Text numberOfLines={1} style={[styles.titleBadgeLabel, { color: textColor, fontSize: titleFontSize }]}>
                  {config.title}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: mutedTextColor }]}>
              {previewSnapshotBaseUrl || previewMjpegUrl || previewFlvUrl || previewFmp4Url ? "Stream wird geladen..." : "Kein Stream konfiguriert"}
            </Text>
          </View>
        )}
        </Pressable>
        {showInPlaceFullscreen ? (
          <View pointerEvents="box-none" style={styles.inPlaceFullscreenHud}>
            {renderFullscreenControls()}
            {talkbackIframeEnabled && talkbackActive
              ? createElement("iframe", {
                  allow: "autoplay; microphone; camera",
                  src: talkbackWebrtcUrl,
                  style: talkbackShowVideo ? webTalkbackVisibleStyle : webTalkbackBridgeStyle,
                  title: `${config.title || "camera-talk"}-talkback`,
                })
              : null}
            {previewStreamDebug ? (
              <View style={styles.talkbackDebugBadge}>
                <Text style={styles.talkbackDebugText}>{previewStreamDebug}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {!previewFeed && !previewSnapshotBaseUrl && !previewMjpegUrl && !previewFlvUrl && !previewFmp4Url ? (
          <Text style={[styles.hint, { color: mutedTextColor }]}>Widget ist noch nicht konfiguriert.</Text>
        ) : null}
      </View>
      {showNativeFullscreenModal ? (
        <Modal
          animationType={
            Platform.OS === "web"
              ? "none"
              : "none"
          }
          transparent
          visible
        >
        <View style={styles.fullscreenBackdrop}>
          {renderFullscreenControls()}
          {talkbackIframeEnabled && talkbackActive
            ? createElement("iframe", {
                allow: "autoplay; microphone; camera",
                src: talkbackWebrtcUrl,
                style: talkbackShowVideo ? webTalkbackVisibleStyle : webTalkbackBridgeStyle,
                title: `${config.title || "camera-talk"}-talkback`,
              })
            : null}
          <View {...fullscreenPanResponder.panHandlers} style={styles.fullscreenStage}>
            {fullscreenFeed?.kind === "webrtc" && fullscreenFeed.url && Platform.OS === "web"
              ? createElement("iframe", {
                  allow: "autoplay; fullscreen; microphone",
                  allowFullScreen: true,
                  loading: "eager",
                  src: fullscreenFeed.url,
                  style: fullscreenWebrtcFrameStyle,
                  title: config.title || "Camera WebRTC fullscreen",
                })
              : null}
            {fullscreenFeed?.kind === "snapshot"
              ? ([0, 1] as const).map((layer) => {
              const url = layerUrls[layer];
              if (!url) {
                return null;
              }
              const isVisible = layer === activeLayer;
              const isLoadingTarget = loadingLayer === layer;
              return Platform.OS === "web"
                ? createElement("img", {
                    alt: isVisible ? config.title || "Camera snapshot fullscreen" : "",
                    "aria-hidden": !isVisible,
                    decoding: "sync",
                    draggable: false,
                    key: `fullscreen-web-layer-${layer}`,
                    loading: "eager",
                    onError: () => {
                      if (!isLoadingTarget) {
                        return;
                      }
                      const latest = latestRequestedUrlRef.current;
                      setLoadingLayer(null);
                      loadingJobRef.current = null;
                      if (latest && latest !== displayUrl) {
                        scheduleLoad(latest);
                      }
                    },
                    onLoad: () => {
                      if (isLoadingTarget) {
                        commitLayerLoad(layer, url);
                      }
                    },
                    src: url,
                    style: getFullscreenWebLayerStyle(isVisible),
                  })
                : (
                    <Image
                      key={`fullscreen-native-layer-${layer}`}
                      onError={() => {
                        if (!isLoadingTarget) {
                          return;
                        }
                        const latest = latestRequestedUrlRef.current;
                        setLoadingLayer(null);
                        loadingJobRef.current = null;
                        if (latest && latest !== displayUrl) {
                          scheduleLoad(latest);
                        }
                      }}
                      onLoad={() => {
                        if (isLoadingTarget) {
                          commitLayerLoad(layer, url);
                        }
                      }}
                      resizeMode="contain"
                      source={{ uri: url }}
                      style={[styles.fullscreenImageLayer, isVisible ? styles.layerVisible : styles.layerHidden]}
                    />
                  );
            })
              : null}
            {fullscreenFeed?.kind === "mjpeg" && fullscreenFeed.url
              ? Platform.OS === "web"
                ? createElement("img", {
                    alt: config.title || "Camera MJPEG fullscreen",
                    decoding: "async",
                    draggable: false,
                    key: `fullscreen-mjpeg-${currentFullscreenMjpegSrc || fullscreenFeed.url}:${fullscreenSession}`,
                    loading: "eager",
                    onError: () => {
                      if (moveFullscreenMjpegToNextSource()) {
                        return;
                      }
                      setFullscreenMjpegLoaded(false);
                    },
                    onLoad: (event: Event) => {
                      const target = event.currentTarget as HTMLImageElement | null;
                      const width = target?.naturalWidth || 0;
                      const height = target?.naturalHeight || 0;
                      if (!width || !height) {
                        if (moveFullscreenMjpegToNextSource()) {
                          return;
                        }
                        setFullscreenMjpegLoaded(false);
                        return;
                      }
                      setFullscreenMjpegLoaded(true);
                      reportAspectRatio(width, height);
                    },
                    src: withReconnectNonce(currentFullscreenMjpegSrc || fullscreenFeed.url, fullscreenSession),
                    style: fullscreenWebMjpegStyle,
                  })
                : (
                    <Image
                      onLoad={(event) => {
                        const source = event.nativeEvent.source;
                        if (source?.width && source?.height) {
                          reportAspectRatio(source.width, source.height);
                        }
                      }}
                      resizeMode="contain"
                      source={{ uri: fullscreenFeed.url }}
                      style={styles.fullscreenMjpegImage}
                    />
                  )
              : null}
            {fullscreenFeed?.kind === "flv" && fullscreenFeed.url
              ? Platform.OS === "web"
                ? (
                    <WebFlvPlayer
                      key={`fullscreen-flv-${fullscreenFeedKey}:${fullscreenSession}`}
                      fullScreen
                      muted={fullscreenMuted}
                      onAspectRatioDetected={reportAspectRatioValue}
                      onSourceIndexChange={setFullscreenFlvSourceIndex}
                      preferredSourceIndex={fullscreenFlvSourceIndex}
                      sources={fullscreenFlvSources.length ? fullscreenFlvSources : [fullscreenFeed.url]}
                      title={config.title || "Camera FLV fullscreen"}
                    />
                  )
                : (
                    <View style={styles.empty}>
                      <Text style={[styles.emptyText, { color: mutedTextColor }]}>FLV wird nur im Web unterstuetzt.</Text>
                    </View>
                  )
              : null}
            {fullscreenFeed?.kind === "fmp4" && fullscreenFeed.url
              ? Platform.OS === "web"
                ? (
                    <WebFmp4Player
                      key={`fullscreen-fmp4-${fullscreenFeedKey}:${currentFullscreenFmp4Src || "none"}`}
                      fullScreen
                      muted={fullscreenMuted}
                      onAspectRatioDetected={reportAspectRatioValue}
                      onSourceIndexChange={setFullscreenFmp4SourceIndex}
                      preferredSourceIndex={fullscreenFmp4SourceIndex}
                      sources={fullscreenFmp4Sources.length ? fullscreenFmp4Sources : [fullscreenFeed.url]}
                      title={config.title || "Camera fMP4 fullscreen"}
                    />
                  )
                : (
                    <View style={styles.empty}>
                      <Text style={[styles.emptyText, { color: mutedTextColor }]}>fMP4 wird nur im Web unterstuetzt.</Text>
                    </View>
                  )
              : null}
          </View>
          {config.showTitle !== false && config.title ? (
            <View style={styles.fullscreenTitle}>
              <Text style={[styles.titleBadgeLabel, { color: textColor, fontSize: titleFontSize }]}>{config.title}</Text>
            </View>
          ) : null}
        </View>
        </Modal>
      ) : null}
    </>
  );
}

function matchesMaximizeTrigger(config: CameraTalkWidgetConfig, value: unknown) {
  if (!config.maximizeStateId) {
    return false;
  }

  const triggerFormat = config.maximizeTriggerFormat || "boolean";
  const rawExpected = (config.maximizeTriggerValue || "").trim();

  if (triggerFormat === "boolean") {
    const expected = normalizeBoolean(rawExpected || "true");
    const actual = normalizeBoolean(value);
    return expected !== null && actual !== null && expected === actual;
  }

  if (triggerFormat === "number") {
    if (!rawExpected) {
      return false;
    }
    const expected = Number(rawExpected);
    const actual = typeof value === "number" ? value : Number(value);
    return Number.isFinite(expected) && Number.isFinite(actual) && expected === actual;
  }

  if (!rawExpected || value === null || value === undefined) {
    return false;
  }

  return String(value).trim() === rawExpected;
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return null;
  }

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (["true", "1", "on", "yes"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "off", "no"].includes(normalized)) {
    return false;
  }

  return null;
}

function downsampleFloat32ToInt16(input: Float32Array, sourceRate: number, targetRate: number) {
  if (!input.length || !Number.isFinite(sourceRate) || sourceRate <= 0) {
    return new Uint8Array(0);
  }

  if (!Number.isFinite(targetRate) || targetRate <= 0 || sourceRate <= targetRate) {
    const out = new Uint8Array(input.length * 2);
    const view = new DataView(out.buffer);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(i * 2, value, true);
    }
    return out;
  }

  const ratio = sourceRate / targetRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const out = new Uint8Array(length * 2);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (let i = 0; i < length; i += 1) {
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    while (offset < end) {
      sum += input[offset];
      count += 1;
      offset += 1;
    }
    const sample = count > 0 ? sum / count : input[Math.min(input.length - 1, offset)] || 0;
    const clipped = Math.max(-1, Math.min(1, sample));
    const value = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
    view.setInt16(i * 2, value, true);
  }
  return out;
}

async function flushInstarTalkbackQueue(
  token: string | null,
  queueRef: { current: Uint8Array[] },
  queueBytesRef: { current: number },
  isFlushingRef: { current: boolean },
  onAuthError: () => void
) {
  if (!token || !queueRef.current.length || queueBytesRef.current <= 0) {
    return 0;
  }
  if (isFlushingRef.current) {
    return 0;
  }
  isFlushingRef.current = true;
  try {
    const bytes = queueBytesRef.current;
    const merged = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of queueRef.current) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    queueRef.current = [];
    queueBytesRef.current = 0;

    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < merged.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, merged.subarray(i, i + CHUNK) as unknown as number[]);
    }
    const base64 = typeof btoa === "function" ? btoa(binary) : "";
    if (!base64) {
      return 0;
    }

    const response = await fetch("/smarthome-dashboard-v2/api/instar-talk/chunk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, pcmBase64: base64 }),
    }).catch(() => null);
    if (!response) {
      return 0;
    }
    if (response.status === 401 || response.status === 403) {
      onAuthError();
      return 0;
    }
    if (!response.ok) {
      return 0;
    }
    const payload = await response.json().catch(() => ({}));
    const sent = Number(payload?.sent || 0);
    return Number.isFinite(sent) ? sent : 0;
  } finally {
    isFlushingRef.current = false;
  }
}

function resolveCameraFeed(input: {
  sourceMode: "snapshot" | "mjpeg" | "flv" | "fmp4" | "webrtc";
  snapshotUrl: string | null;
  mjpegUrl: string | null;
  flvUrl: string | null;
  fmp4Url: string | null;
  webrtcUrl?: string | null;
}) {
  const sourcePriority =
    input.sourceMode === "webrtc"
      ? [
          { kind: "webrtc" as const, url: input.webrtcUrl },
          { kind: "fmp4" as const, url: input.fmp4Url },
          { kind: "flv" as const, url: input.flvUrl },
          { kind: "snapshot" as const, url: input.snapshotUrl },
        ]
      : input.sourceMode === "snapshot"
      ? [
          { kind: "snapshot" as const, url: input.snapshotUrl },
          { kind: "mjpeg" as const, url: input.mjpegUrl },
          { kind: "flv" as const, url: input.flvUrl },
          { kind: "fmp4" as const, url: input.fmp4Url },
        ]
      : input.sourceMode === "mjpeg"
        ? [
            { kind: "mjpeg" as const, url: input.mjpegUrl },
            { kind: "snapshot" as const, url: input.snapshotUrl },
            { kind: "flv" as const, url: input.flvUrl },
            { kind: "fmp4" as const, url: input.fmp4Url },
          ]
        : input.sourceMode === "flv"
          ? [
              { kind: "flv" as const, url: input.flvUrl },
              { kind: "mjpeg" as const, url: input.mjpegUrl },
              { kind: "snapshot" as const, url: input.snapshotUrl },
              { kind: "fmp4" as const, url: input.fmp4Url },
            ]
          : [
              { kind: "fmp4" as const, url: input.fmp4Url },
              { kind: "flv" as const, url: input.flvUrl },
              { kind: "mjpeg" as const, url: input.mjpegUrl },
              { kind: "snapshot" as const, url: input.snapshotUrl },
            ];

  for (const source of sourcePriority) {
    if (source.url) {
      return {
        kind: source.kind,
        url: source.url,
      };
    }
  }

  return null;
}

function resolveSourceMode(
  sourceMode: CameraTalkWidgetConfig["fullscreenSourceMode"],
  snapshotUrl: string | null,
  mjpegUrl: string | null,
  flvUrl: string | null,
  fmp4Url: string | null,
  webrtcUrl: string | null,
  fallback: "snapshot" | "mjpeg" | "flv" | "fmp4" | "webrtc" = "snapshot"
) {
  if (sourceMode === "snapshot" || sourceMode === "mjpeg" || sourceMode === "flv" || sourceMode === "fmp4" || sourceMode === "webrtc") {
    return sourceMode;
  }

  if (webrtcUrl) {
    return "webrtc";
  }

  if (snapshotUrl && !mjpegUrl && !flvUrl && !fmp4Url) {
    return "snapshot";
  }

  if (mjpegUrl && !snapshotUrl && !flvUrl && !fmp4Url) {
    return "mjpeg";
  }

  if (flvUrl && !snapshotUrl && !mjpegUrl && !fmp4Url) {
    return "flv";
  }

  if (fmp4Url && !snapshotUrl && !mjpegUrl && !flvUrl) {
    return "fmp4";
  }

  return fallback;
}

function getWebStreamProxyUrls(targetUrl: string, streamType: "mjpeg" | "flv" | "fmp4") {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return [];
  }

  const encodedUrl = encodeURIComponent(targetUrl);
  if (streamType === "mjpeg") {
    return [
      `${window.location.origin}/smarthome-dashboard-v2/api/camera-stream?streamType=${streamType}&url=${encodedUrl}`,
      `${window.location.origin}/smarthome-dashboard-v2/api/camera-mjpeg?streamType=${streamType}&url=${encodedUrl}`,
    ];
  }

  return [`${window.location.origin}/smarthome-dashboard-v2/api/camera-stream?streamType=${streamType}&url=${encodedUrl}`];
}

function buildWebStreamSources(targetUrl: string, streamType: "mjpeg" | "flv" | "fmp4") {
  if (streamType === "fmp4") {
    const proxySources = getWebStreamProxyUrls(targetUrl, streamType);
    return Array.from(new Set(proxySources.filter(Boolean)));
  }
  const includeDirect = shouldUseDirectWebStream(targetUrl, streamType);
  const proxySources = getWebStreamProxyUrls(targetUrl, streamType);
  const directSources = includeDirect ? [targetUrl] : [];
  const sources = [...proxySources, ...directSources];
  return Array.from(new Set(sources.filter(Boolean)));
}

function withReconnectNonce(url: string, nonce: number) {
  if (!url) {
    return url;
  }
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("_r", String(nonce));
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}_r=${nonce}`;
  }
}

function shouldUseDirectWebStream(targetUrl: string, streamType: "mjpeg" | "flv" | "fmp4") {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return true;
  }

  try {
    const parsed = new URL(targetUrl);
    const hasEmbeddedCredentials = Boolean(parsed.username || parsed.password);
    const hasQueryCredentials =
      Boolean(parsed.searchParams.get("user")) ||
      Boolean(parsed.searchParams.get("username")) ||
      Boolean(parsed.searchParams.get("password")) ||
      Boolean(parsed.searchParams.get("pass"));
    const mixedContentBlocked = window.location.protocol === "https:" && parsed.protocol === "http:";

    // Mixed-content is blocked on HTTPS pages.
    if (mixedContentBlocked) {
      return false;
    }

    // For MJPEG we still allow a direct fallback after proxy (many cameras work only directly).
    if (streamType === "mjpeg" && (hasEmbeddedCredentials || hasQueryCredentials)) {
      return true;
    }

    // For FLV with URL credentials we keep proxy-only by default.
    if (hasEmbeddedCredentials || hasQueryCredentials) {
      return false;
    }
  } catch {
    // Keep fallback path when URL parsing fails.
  }

  return true;
}

function isMixedContentBlocked(targetUrl: string) {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return false;
  }
  try {
    const parsed = new URL(targetUrl);
    return window.location.protocol === "https:" && parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function WebFlvPlayer({
  sources,
  title,
  fullScreen = false,
  muted = true,
  zoomScale = 1,
  offsetX = 0,
  offsetY = 0,
  onAspectRatioDetected,
  preferredSourceIndex = 0,
  onSourceIndexChange,
}: {
  sources: string[];
  title: string;
  fullScreen?: boolean;
  muted?: boolean;
  zoomScale?: number;
  offsetX?: number;
  offsetY?: number;
  onAspectRatioDetected?: (ratio: number) => void;
  preferredSourceIndex?: number;
  onSourceIndexChange?: (index: number) => void;
}) {
  const videoRef = useRef<any>(null);
  const setVideoRef = useCallback((element: any) => {
    videoRef.current = element;
  }, []);
  const playerRef = useRef<any>(null);
  const ratioReportedRef = useRef(false);
  const aspectRatioCallbackRef = useRef(onAspectRatioDetected);
  const normalizedSources = useMemo(
    () => Array.from(new Set((sources || []).map((entry) => (entry || "").trim()).filter(Boolean))),
    [sources]
  );
  const maxSourceIndex = Math.max(0, normalizedSources.length - 1);
  const [sourceIndex, setSourceIndex] = useState(Math.min(preferredSourceIndex, maxSourceIndex));
  const [restartNonce, setRestartNonce] = useState(0);
  const currentSource = normalizedSources[Math.min(sourceIndex, maxSourceIndex)] || "";
  const { errorMessage, queueError: queueStreamError, clearError: clearStreamError } = useTransientStreamError();
  const [hasVideoFrame, setHasVideoFrame] = useState(false);

  useEffect(() => {
    aspectRatioCallbackRef.current = onAspectRatioDetected;
  }, [onAspectRatioDetected]);

  useEffect(() => {
    const next = Math.min(preferredSourceIndex, maxSourceIndex);
    setSourceIndex(next);
  }, [maxSourceIndex, preferredSourceIndex]);

  useEffect(() => {
    onSourceIndexChange?.(sourceIndex);
  }, [onSourceIndexChange, sourceIndex]);

  useEffect(() => {
    clearStreamError();
    setHasVideoFrame(false);
  }, [clearStreamError, currentSource]);

  useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }
    const videoElement = videoRef.current as HTMLVideoElement | null;
    if (!videoElement) {
      return;
    }
    videoElement.defaultMuted = muted;
    videoElement.muted = muted;
    if (!muted) {
      void videoElement.play().catch(() => {
        // Browsers may still block autoplay with sound until interaction.
      });
    }
  }, [muted]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return;
    }

    let disposed = false;
    let player: any = null;
    let retryTimer: ReturnType<typeof setInterval> | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const videoElement = videoRef.current;

    const safeQueueError = (message: string) => {
      if (!disposed) {
        queueStreamError(message);
      }
    };

    const scheduleReconnect = (message: string) => {
      safeQueueError(message);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      reconnectTimer = setTimeout(() => {
        if (disposed) {
          return;
        }
        setRestartNonce((current) => current + 1);
      }, FLV_RECONNECT_DELAY_MS);
    };

    const moveToNextSource = (message: string) => {
      if (sourceIndex + 1 < normalizedSources.length) {
        setSourceIndex((current) => Math.min(normalizedSources.length - 1, current + 1));
        safeQueueError(message);
        return true;
      }
      return false;
    };

    const tryPlay = () => {
      if (!videoElement || disposed) {
        return;
      }
      try {
        if (playerRef.current?.play) {
          playerRef.current.play();
        }
      } catch {
        // ignore
      }
      void videoElement.play().catch(() => {
        // Ignore autoplay rejections; retry loop handles late-ready starts.
      });
    };

    const attach = async () => {
      if (!videoElement || !currentSource) {
        safeQueueError("FLV Stream URL fehlt.");
        return;
      }

      ratioReportedRef.current = false;
      const loaded = await ensureFlvJsLoaded();
      if (disposed || !loaded) {
        if (!moveToNextSource("FLV Quelle fehlgeschlagen, versuche alternative Quelle...")) {
          scheduleReconnect("FLV Player konnte nicht geladen werden, Neuverbindung...");
        }
        return;
      }

      if (!window.flvjs?.isSupported?.()) {
        safeQueueError("FLV wird von diesem Browser nicht unterstuetzt.");
        return;
      }

      let switchedSource = false;
      player = window.flvjs.createPlayer(
        {
          type: "flv",
          isLive: true,
          url: currentSource,
        },
        {
          enableStashBuffer: false,
          lazyLoad: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMinBackwardDuration: 5,
          autoCleanupMaxBackwardDuration: 10,
          fixAudioTimestampGap: false,
        }
      );
      playerRef.current = player;

      if (window.flvjs?.Events?.ERROR) {
        player.on(window.flvjs.Events.ERROR, (errorType: string, errorDetail: string) => {
          if (switchedSource || disposed) {
            return;
          }
          switchedSource = true;
          const detail = [errorType, errorDetail].filter(Boolean).join(" / ");
          if (moveToNextSource("FLV Quelle fehlgeschlagen, versuche alternative Quelle...")) {
            return;
          }
          scheduleReconnect(
            detail
              ? `FLV Stream konnte nicht gestartet werden (${detail}), Neuverbindung...`
              : "FLV Stream konnte nicht gestartet werden, Neuverbindung..."
          );
        });
      }

      player.attachMediaElement(videoElement);
      videoElement.onloadedmetadata = () => {
        const callback = aspectRatioCallbackRef.current;
        if (ratioReportedRef.current || !callback) {
          return;
        }
        const width = Number(videoElement.videoWidth || 0);
        const height = Number(videoElement.videoHeight || 0);
        if (!width || !height) {
          return;
        }
        const ratio = width / height;
        if (!Number.isFinite(ratio) || ratio <= 0) {
          return;
        }
        ratioReportedRef.current = true;
        callback(ratio);
      };
      videoElement.oncanplay = () => {
        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
        setHasVideoFrame(true);
        clearStreamError();
        tryPlay();
      };
      player.load();
      tryPlay();
      watchdogTimer = setTimeout(() => {
        if (disposed || switchedSource) {
          return;
        }
        const hasData = Number(videoElement.readyState || 0) >= 2;
        if (hasData) {
          return;
        }
        switchedSource = true;
        if (moveToNextSource("FLV Quelle fehlgeschlagen, versuche alternative Quelle...")) {
          return;
        }
        scheduleReconnect("FLV Stream konnte nicht gestartet werden, Neuverbindung...");
      }, MJPEG_SOURCE_SWITCH_TIMEOUT_MS);
      retryTimer = setInterval(() => {
        if (!videoElement || disposed || !videoElement.paused) {
          return;
        }
        tryPlay();
      }, 1200);
    };

    attach().catch(() => {
      if (!moveToNextSource("FLV Quelle fehlgeschlagen, versuche alternative Quelle...")) {
        scheduleReconnect("FLV Stream konnte nicht initialisiert werden, Neuverbindung...");
      }
    });

    return () => {
      disposed = true;
      if (player) {
        try {
          player.unload();
          player.detachMediaElement();
          player.destroy();
        } catch {
          // ignore cleanup errors
        }
      }
      if (videoElement) {
        videoElement.onloadedmetadata = null;
        videoElement.oncanplay = null;
        videoElement.removeAttribute("src");
        videoElement.load();
      }
      if (retryTimer) {
        clearInterval(retryTimer);
      }
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      playerRef.current = null;
    };
  }, [clearStreamError, currentSource, normalizedSources.length, queueStreamError, restartNonce, sourceIndex]);

  return (
    <>
      {createElement("video", {
        autoPlay: true,
        controls: false,
        muted,
        playsInline: true,
        ref: setVideoRef,
        style: fullScreen ? getFullscreenWebFlvStyle(zoomScale, offsetX, offsetY) : webFlvStyle,
        title,
      })}
      {!hasVideoFrame ? <View style={styles.flvLoadingOverlay} /> : null}
      {errorMessage ? (
        <View style={styles.flvErrorOverlay}>
          <Text style={styles.flvErrorText}>{errorMessage}</Text>
        </View>
      ) : null}
    </>
  );
}

function WebFmp4Player({
  sources,
  title,
  fullScreen = false,
  muted = true,
  zoomScale = 1,
  offsetX = 0,
  offsetY = 0,
  onAspectRatioDetected,
  preferredSourceIndex = 0,
  onSourceIndexChange,
}: {
  sources: string[];
  title: string;
  fullScreen?: boolean;
  muted?: boolean;
  zoomScale?: number;
  offsetX?: number;
  offsetY?: number;
  onAspectRatioDetected?: (ratio: number) => void;
  preferredSourceIndex?: number;
  onSourceIndexChange?: (index: number) => void;
}) {
  const videoRef = useRef<any>(null);
  const setVideoRef = useCallback((element: any) => {
    videoRef.current = element;
  }, []);
  const ratioReportedRef = useRef(false);
  const aspectRatioCallbackRef = useRef(onAspectRatioDetected);
  const normalizedSources = useMemo(
    () => Array.from(new Set((sources || []).map((entry) => (entry || "").trim()).filter(Boolean))),
    [sources]
  );
  const maxSourceIndex = Math.max(0, normalizedSources.length - 1);
  const [sourceIndex, setSourceIndex] = useState(Math.min(preferredSourceIndex, maxSourceIndex));
  const [restartNonce, setRestartNonce] = useState(0);
  const currentSource = normalizedSources[Math.min(sourceIndex, maxSourceIndex)] || "";
  const currentSourceWithNonce = useMemo(
    () => (currentSource ? withReconnectNonce(currentSource, restartNonce) : ""),
    [currentSource, restartNonce]
  );
  const { errorMessage, queueError: queueStreamError, clearError: clearStreamError } = useTransientStreamError();
  const [hasVideoFrame, setHasVideoFrame] = useState(false);

  useEffect(() => {
    aspectRatioCallbackRef.current = onAspectRatioDetected;
  }, [onAspectRatioDetected]);

  useEffect(() => {
    const next = Math.min(preferredSourceIndex, maxSourceIndex);
    setSourceIndex(next);
  }, [maxSourceIndex, preferredSourceIndex]);

  useEffect(() => {
    onSourceIndexChange?.(sourceIndex);
  }, [onSourceIndexChange, sourceIndex]);

  useEffect(() => {
    clearStreamError();
    ratioReportedRef.current = false;
    setHasVideoFrame(false);
  }, [clearStreamError, currentSource]);

  useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }
    const videoElement = videoRef.current as HTMLVideoElement | null;
    if (!videoElement) {
      return;
    }
    videoElement.defaultMuted = muted;
    videoElement.muted = muted;
    if (!muted) {
      void videoElement.play().catch(() => {
        // Browsers may still block autoplay with sound until interaction.
      });
    }
  }, [muted]);

  useEffect(() => {
    if (Platform.OS !== "web" || !currentSourceWithNonce) {
      return;
    }

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const videoElement = videoRef.current as HTMLVideoElement | null;
    if (!videoElement) {
      return;
    }

    const safeQueueError = (message: string) => {
      if (!disposed) {
        queueStreamError(message);
      }
    };

    const scheduleReconnect = (message: string) => {
      safeQueueError(message);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      reconnectTimer = setTimeout(() => {
        if (disposed) {
          return;
        }
        setRestartNonce((current) => current + 1);
      }, FMP4_RECONNECT_DELAY_MS);
    };

    const moveToNextSource = (message: string) => {
      if (sourceIndex + 1 < normalizedSources.length) {
        setSourceIndex((current) => Math.min(normalizedSources.length - 1, current + 1));
        safeQueueError(message);
        return true;
      }
      return false;
    };

    const tryPlay = () => {
      void videoElement.play().catch(() => {
        // ignore autoplay issues
      });
    };

    const markPlayable = () => {
      if (disposed) {
        return;
      }
      setHasVideoFrame(true);
      clearStreamError();
    };

    const handleMetadata = () => {
      const callback = aspectRatioCallbackRef.current;
      if (ratioReportedRef.current || !callback) {
        return;
      }
      const width = Number(videoElement.videoWidth || 0);
      const height = Number(videoElement.videoHeight || 0);
      if (!width || !height) {
        return;
      }
      const ratio = width / height;
      if (!Number.isFinite(ratio) || ratio <= 0) {
        return;
      }
      ratioReportedRef.current = true;
      callback(ratio);
    };

    const handleError = () => {
      if (disposed) {
        return;
      }
      if (!moveToNextSource("fMP4 Quelle fehlgeschlagen, versuche alternative Quelle...")) {
        const mediaError = videoElement.error;
        const detail = mediaError ? describeVideoError(mediaError) : "Unbekannter Video-Fehler";
        const codecHint =
          mediaError && (mediaError.code === 3 || mediaError.code === 4)
            ? " Browser/Codec evtl. inkompatibel (z.B. HEVC/hvc1)."
            : "";
        if (!mediaError || mediaError.code === 1 || mediaError.code === 2) {
          scheduleReconnect(`fMP4 Streamfehler (${detail}), Neuverbindung...`);
          return;
        }
        safeQueueError(`fMP4 Stream konnte nicht gestartet werden (${detail}).${codecHint}`);
      }
    };

    videoElement.addEventListener("loadeddata", markPlayable);
    videoElement.addEventListener("playing", markPlayable);
    videoElement.addEventListener("loadedmetadata", handleMetadata);
    videoElement.addEventListener("canplay", tryPlay);
    videoElement.addEventListener("error", handleError);
    tryPlay();

    const watchdog = setTimeout(() => {
      if (disposed) {
        return;
      }
      const hasData = videoElement.readyState >= 2 || videoElement.currentTime > 0;
      if (!hasData) {
        if (!moveToNextSource("fMP4 Quelle fehlgeschlagen, versuche alternative Quelle...")) {
          scheduleReconnect("fMP4 Stream reagiert nicht, Neuverbindung...");
        }
      }
    }, Math.max(MJPEG_SOURCE_SWITCH_TIMEOUT_MS, 25_000));

    return () => {
      disposed = true;
      clearTimeout(watchdog);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      videoElement.removeEventListener("loadeddata", markPlayable);
      videoElement.removeEventListener("playing", markPlayable);
      videoElement.removeEventListener("loadedmetadata", handleMetadata);
      videoElement.removeEventListener("canplay", tryPlay);
      videoElement.removeEventListener("error", handleError);
      videoElement.removeAttribute("src");
      videoElement.load();
    };
  }, [clearStreamError, currentSourceWithNonce, normalizedSources.length, queueStreamError, sourceIndex]);

  return (
    <>
      {createElement("video", {
        autoPlay: true,
        controls: false,
        muted,
        playsInline: true,
        preload: "auto",
        ref: setVideoRef,
        src: currentSourceWithNonce || undefined,
        style: fullScreen ? getFullscreenWebFmp4Style(zoomScale, offsetX, offsetY) : webFmp4Style,
        title,
      })}
      {!hasVideoFrame ? <View style={styles.flvLoadingOverlay} /> : null}
      {errorMessage ? (
        <View style={styles.flvErrorOverlay}>
          <Text style={styles.flvErrorText}>{errorMessage}</Text>
        </View>
      ) : null}
    </>
  );
}

function describeVideoError(error: MediaError) {
  if (!error) {
    return "kein Fehlercode";
  }

  switch (error.code) {
    case 1:
      return "MEDIA_ERR_ABORTED";
    case 2:
      return "MEDIA_ERR_NETWORK";
    case 3:
      return "MEDIA_ERR_DECODE";
    case 4:
      return "MEDIA_ERR_SRC_NOT_SUPPORTED";
    default:
      return `MEDIA_ERR_UNKNOWN_${error.code}`;
  }
}

function useTransientStreamError() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pendingMessageRef = useRef<string | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const clearError = useCallback(() => {
    pendingMessageRef.current = null;
    clearTimers();
    setErrorMessage(null);
  }, [clearTimers]);

  const queueError = useCallback(
    (message: string) => {
      const normalized = message.trim();
      if (!normalized) {
        clearError();
        return;
      }

      pendingMessageRef.current = normalized;
      clearTimers();
      showTimerRef.current = setTimeout(() => {
        if (pendingMessageRef.current !== normalized) {
          return;
        }
        setErrorMessage(normalized);
        hideTimerRef.current = setTimeout(() => {
          if (pendingMessageRef.current === normalized) {
            pendingMessageRef.current = null;
            setErrorMessage(null);
          }
        }, STREAM_ERROR_AUTO_HIDE_MS);
      }, STREAM_ERROR_GRACE_MS);
    },
    [clearError, clearTimers]
  );

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  return {
    errorMessage,
    queueError,
    clearError,
  };
}

async function ensureFlvJsLoaded() {
  if (Platform.OS !== "web" || typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  if (window.flvjs) {
    return true;
  }

  try {
    const imported = await import("flv.js");
    const maybeFlv = (imported as { default?: any }).default || imported;
    if (maybeFlv) {
      window.flvjs = maybeFlv;
      return true;
    }
  } catch {
    // fallback to CDN loader below
  }

  if (!flvLoaderPromise) {
    flvLoaderPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };
      const timeout = setTimeout(() => settle(Boolean(window.flvjs)), FLV_SCRIPT_LOAD_TIMEOUT_MS);
      const existing = document.querySelector(`script[data-flvjs-src="${FLV_SCRIPT_SRC}"]`) as HTMLScriptElement | null;
      if (existing) {
        const readyState = (existing as HTMLScriptElement & { readyState?: string }).readyState;
        if (readyState === "loaded" || readyState === "complete") {
          clearTimeout(timeout);
          settle(Boolean(window.flvjs));
          return;
        }
        existing.addEventListener("load", () => {
          clearTimeout(timeout);
          settle(Boolean(window.flvjs));
        }, { once: true });
        existing.addEventListener("error", () => {
          clearTimeout(timeout);
          settle(false);
        }, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = FLV_SCRIPT_SRC;
      script.async = true;
      script.dataset.flvjsSrc = FLV_SCRIPT_SRC;
      script.onload = () => {
        clearTimeout(timeout);
        settle(Boolean(window.flvjs));
      };
      script.onerror = () => {
        clearTimeout(timeout);
        settle(false);
      };
      document.head.appendChild(script);
    });
  }

  const loaded = await flvLoaderPromise;
  if (!loaded) {
    // Allow retries for later widgets if network/CDN was temporarily unavailable.
    flvLoaderPromise = null;
  }
  return loaded;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
  },
  preview: {
    flex: 1,
    minHeight: 0,
    borderRadius: 0,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  snapshotWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    ...(Platform.OS === "web"
      ? {
          isolation: "isolate" as const,
        }
      : null),
  },
  titleBadge: {
    position: "absolute",
    left: 14,
    top: 14,
    maxWidth: "72%",
    zIndex: 12,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "rgba(4, 8, 14, 0.44)",
    pointerEvents: "none",
    ...(Platform.OS === "web"
      ? {
          transform: "translateZ(0)" as const,
          willChange: "transform" as const,
          backfaceVisibility: "hidden" as const,
        }
      : null),
  },
  titleBadgeLabel: {
    color: palette.text,
    fontSize: 14,
    fontWeight: "700",
  },
  imageLayer: {
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
  },
  layerVisible: {
    opacity: 1,
  },
  layerHidden: {
    opacity: 0,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: palette.textMuted,
  },
  hint: {
    marginTop: 10,
    color: palette.danger,
    fontSize: 12,
  },
  fullscreenBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,1)",
    justifyContent: "center",
    alignItems: "center",
  },
  fullscreenStage: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  fullscreenImageLayer: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: undefined,
    height: undefined,
  },
  mjpegImage: {
    width: "100%",
    height: "100%",
  },
  fullscreenMjpegImage: {
    width: "100%",
    height: "100%",
  },
  inPlaceFullscreenHud: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2600,
    pointerEvents: "box-none",
  },
  fullscreenControlsWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 30,
    pointerEvents: "box-none",
  },
  fullscreenTopRightActions: {
    position: "absolute",
    right: 22,
    top: -3,
    flexDirection: "row",
    gap: 10,
    zIndex: 40,
  },
  fullscreenControlsRow: {
    position: "absolute",
    left: 26,
    bottom: 106,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 12,
    paddingHorizontal: 2,
  },
  fullscreenActionButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(190, 210, 255, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(220,235,255,0.38)",
  },
  controlColumn: {
    gap: 6,
    alignItems: "center",
  },
  ptzPad: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: "rgba(160,190,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(220,235,255,0.3)",
  },
  ptzButton: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10, 16, 28, 0.65)",
    borderWidth: 1,
    borderColor: "rgba(220,235,255,0.24)",
  },
  ptzButtonTop: {
    top: 4,
    left: 34,
  },
  ptzButtonRight: {
    top: 34,
    right: 4,
  },
  ptzButtonBottom: {
    bottom: 4,
    left: 34,
  },
  ptzButtonLeft: {
    top: 34,
    left: 4,
  },
  volumeColumn: {
    alignItems: "center",
    gap: 4,
  },
  volumeAdjustBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10, 16, 28, 0.65)",
    borderWidth: 1,
    borderColor: "rgba(220,235,255,0.24)",
  },
  volumeTrack: {
    width: 14,
    height: 84,
    borderRadius: 7,
    backgroundColor: "rgba(220,235,255,0.2)",
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  volumeFill: {
    width: "100%",
    backgroundColor: "#7eb9ff",
  },
  fullscreenAudioActive: {
    backgroundColor: "rgba(243, 200, 74, 0.18)",
  },
  fullscreenActionInactive: {
    opacity: 0.85,
    backgroundColor: "rgba(170, 192, 235, 0.22)",
    borderColor: "rgba(228, 240, 255, 0.45)",
  },
  alarmButton: {
    borderColor: "rgba(255, 92, 92, 0.95)",
    backgroundColor: "rgba(150, 22, 22, 0.34)",
  },
  fullscreenTitle: {
    position: "absolute",
    top: 24,
    left: 24,
    maxWidth: "72%",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "rgba(4, 8, 14, 0.44)",
  },
  flvErrorOverlay: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(160, 22, 40, 0.75)",
  },
  flvLoadingOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#000000",
  },
  flvErrorText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  flvTapOverlay: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 12,
    bottom: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.42)",
  },
  flvTapText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
  streamDebugOverlay: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    borderRadius: 10,
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  streamDebugText: {
    color: "#ffe7e7",
    fontSize: 12,
    fontWeight: "700",
  },
  talkbackDebugBadge: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 8,
    backgroundColor: "rgba(0, 0, 0, 0.76)",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  talkbackDebugText: {
    color: "#d7f6ff",
    fontSize: 12,
    fontWeight: "700",
  },
  controlBusyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  controlBusyText: {
    color: "#f0f6ff",
    fontSize: 11,
    fontWeight: "700",
  },
  fullscreenActionDisabled: {
    opacity: 0.45,
  },
});

const webInPlaceFullscreenHostStyle =
  Platform.OS === "web"
    ? ({
        position: "fixed",
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 2400,
        backgroundColor: "rgba(0,0,0,1)",
      } as any)
    : null;

function getWebLayerStyle(visible: boolean) {
  return {
    ...baseWebLayerStyle,
    opacity: visible ? 1 : 0,
    visibility: visible ? "visible" : "hidden",
    zIndex: visible ? 2 : 1,
  } as const;
}

function getFullscreenWebLayerStyle(visible: boolean, zoomScale: number = 1, offsetX: number = 0, offsetY: number = 0) {
  return {
    ...baseFullscreenWebLayerStyle,
    ...getZoomTransformStyle(zoomScale, offsetX, offsetY),
    opacity: visible ? 1 : 0,
    visibility: visible ? "visible" : "hidden",
    zIndex: visible ? 2 : 1,
  } as const;
}

function getFullscreenWebMjpegStyle(zoomScale: number = 1, offsetX: number = 0, offsetY: number = 0) {
  return {
    ...fullscreenWebMjpegStyle,
    ...getZoomTransformStyle(zoomScale, offsetX, offsetY),
  } as const;
}

function getFullscreenWebFlvStyle(zoomScale: number = 1, offsetX: number = 0, offsetY: number = 0) {
  return {
    ...fullscreenWebFlvStyle,
    ...getZoomTransformStyle(zoomScale, offsetX, offsetY),
  } as const;
}

function getFullscreenWebFmp4Style(zoomScale: number = 1, offsetX: number = 0, offsetY: number = 0) {
  return {
    ...fullscreenWebFmp4Style,
    ...getZoomTransformStyle(zoomScale, offsetX, offsetY),
  } as const;
}

function getZoomTransformStyle(zoomScale: number, offsetX: number = 0, offsetY: number = 0) {
  const safeZoom = clampZoom(zoomScale);
  const safeOffsetX = Number.isFinite(offsetX) ? offsetX : 0;
  const safeOffsetY = Number.isFinite(offsetY) ? offsetY : 0;
  if (safeZoom <= 1.001 && Math.abs(safeOffsetX) <= 0.5 && Math.abs(safeOffsetY) <= 0.5) {
    return {};
  }
  return {
    transform: `translate(${safeOffsetX}px, ${safeOffsetY}px) scale(${safeZoom})`,
    transformOrigin: "center center",
  } as const;
}

function clampZoom(value: number) {
  if (!Number.isFinite(value)) {
    return WEB_FULLSCREEN_MIN_ZOOM;
  }
  return Math.max(WEB_FULLSCREEN_MIN_ZOOM, Math.min(WEB_FULLSCREEN_MAX_ZOOM, value));
}

function clampWebFullscreenOffset(
  offsetX: number,
  offsetY: number,
  zoomScale: number,
  viewportWidth: number,
  viewportHeight: number
) {
  const safeZoom = clampZoom(zoomScale);
  const safeWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const safeHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;

  if (safeZoom <= 1.001 || !safeWidth || !safeHeight) {
    return { x: 0, y: 0 };
  }

  const maxX = ((safeZoom - 1) * safeWidth) / 2;
  const maxY = ((safeZoom - 1) * safeHeight) / 2;
  return {
    x: clampNumber(offsetX, -maxX, maxX),
    y: clampNumber(offsetY, -maxY, maxY),
  };
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function getTouchDistance(touches: ArrayLike<{ pageX?: number; pageY?: number }>) {
  if (!touches || touches.length < 2) {
    return null;
  }
  const first = touches[0];
  const second = touches[1];
  const dx = Number((first?.pageX ?? 0) - (second?.pageX ?? 0));
  const dy = Number((first?.pageY ?? 0) - (second?.pageY ?? 0));
  const distance = Math.sqrt(dx * dx + dy * dy);
  return Number.isFinite(distance) && distance > 0 ? distance : null;
}

function getTouchMidpoint(touches: ArrayLike<{ pageX?: number; pageY?: number }>) {
  if (!touches || touches.length < 2) {
    return null;
  }
  const first = touches[0];
  const second = touches[1];
  const x = (Number(first?.pageX ?? 0) + Number(second?.pageX ?? 0)) / 2;
  const y = (Number(first?.pageY ?? 0) + Number(second?.pageY ?? 0)) / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function getGo2rtcCameraSrc(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.searchParams.get("src") || "";
  } catch {
    return "";
  }
}

function buildReolinkBackchannelDst(baseUrl: string, username: string, password: string, channel: number) {
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname;
    if (!host) {
      return "";
    }
    const scheme = parsed.protocol === "rtsps:" ? "rtsps" : "rtsp";
    const port = parsed.port ? Number(parsed.port) : 554;
    const safeChannel = Number.isFinite(channel) ? Math.max(0, Math.round(channel)) : 0;
    const reolinkChannelPath = safeChannel + 1;
    const user = encodeURIComponent(username || "admin");
    const pass = encodeURIComponent(password || "");
    return `${scheme}://${user}:${pass}@${host}:${port}/h264Preview_${String(reolinkChannelPath).padStart(2, "0")}_main#transport=tcp#backchannel=1#audio=pcma`;
  } catch {
    return "";
  }
}

function resolveGo2rtcStreamsEndpoint(rawUrl: string) {
  const parsed = new URL(rawUrl);
  if (/\/stream\.html$/i.test(parsed.pathname)) {
    parsed.pathname = parsed.pathname.replace(/\/stream\.html$/i, "/api/streams");
  } else if (!/\/api\/streams$/i.test(parsed.pathname)) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") + "/api/streams";
  }
  parsed.search = "";
  return parsed.toString();
}

function resolveGo2rtcWebsocketSource(rawUrl: string, src: string) {
  const parsed = new URL(rawUrl);
  const localApiPort = parsed.port && Number(parsed.port) > 0 ? Number(parsed.port) : 11984;
  const wsUrl = new URL(`ws://127.0.0.1:${localApiPort}/api/ws`);
  wsUrl.searchParams.set("src", src);
  return `webrtc:${wsUrl.toString()}`;
}

function resolveGo2rtcWebrtcEndpoint(rawUrl: string) {
  const parsed = new URL(rawUrl);
  if (/\/stream\.html$/i.test(parsed.pathname)) {
    parsed.pathname = parsed.pathname.replace(/\/stream\.html$/i, "/api/webrtc");
  } else if (!/\/api\/webrtc$/i.test(parsed.pathname)) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") + "/api/webrtc";
  }
  const query = new URLSearchParams(parsed.search);
  parsed.search = "";
  query.forEach((value, key) => {
    if (!key || key.toLowerCase() === "mode") {
      return;
    }
    parsed.searchParams.set(key, value);
  });
  return parsed.toString();
}

function waitForIceGathering(peer: RTCPeerConnection, timeoutMs: number) {
  if (peer.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (peer.iceGatheringState === "complete") {
        finish();
      }
    };
    const timer = setTimeout(finish, Math.max(300, timeoutMs));
    peer.addEventListener("icegatheringstatechange", onChange);
  });
}

const baseWebLayerStyle = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
  backgroundColor: "#000000",
  transition: LAYER_FADE_MS > 0 ? `opacity ${LAYER_FADE_MS}ms linear` : "none",
  pointerEvents: "none",
} as const;

const baseFullscreenWebLayerStyle = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  objectFit: "contain",
  display: "block",
  backgroundColor: "#000000",
  transition: LAYER_FADE_MS > 0 ? `opacity ${LAYER_FADE_MS}ms linear` : "none",
  pointerEvents: "none",
} as const;

const webMjpegStyle = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  objectFit: "scale-down",
  objectPosition: "center center",
  display: "block",
  backgroundColor: "#000000",
  pointerEvents: "none",
} as const;

const fullscreenWebMjpegStyle = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  objectFit: "contain",
  objectPosition: "center center",
  display: "block",
  backgroundColor: "#000000",
  pointerEvents: "none",
} as const;

const webFlvStyle = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  display: "block",
  backgroundColor: "#000000",
} as const;

const fullscreenWebFlvStyle = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  display: "block",
  backgroundColor: "#000000",
} as const;

const webFmp4Style = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  display: "block",
  backgroundColor: "#000000",
} as const;

const fullscreenWebFmp4Style = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  display: "block",
  backgroundColor: "#000000",
} as const;

const fullscreenWebrtcFrameStyle = {
  width: "100%",
  height: "100%",
  border: 0,
  display: "block",
  backgroundColor: "#000000",
} as const;

const webTalkbackBridgeStyle = {
  position: "absolute",
  width: 2,
  height: 2,
  right: 0,
  bottom: 0,
  opacity: 0.01,
  border: "none",
  pointerEvents: "none",
} as const;

const webTalkbackVisibleStyle = {
  position: "absolute",
  right: 16,
  bottom: 16,
  width: 240,
  height: 135,
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 12,
  backgroundColor: "#000000",
} as const;
