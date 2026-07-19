import { Suspense, createElement, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { GridCanvas } from "../components/GridCanvas";
import { SettingsModal } from "../components/SettingsModal";
import { TopBar } from "../components/TopBar";
import { WidgetLibraryModal } from "../components/WidgetLibraryModal";
import { useDashboardConfig } from "../context/DashboardConfigContext";
import { useIoBrokerStates } from "../hooks/useIoBrokerStates";
import { BackgroundMode, DashboardPageMode, WidgetConfig, WidgetType } from "../types/dashboard";
import { constrainToPrimarySections, normalizeWidgetLayout, resolveWidgetPosition } from "../utils/gridLayout";
import { buildMobileOverrideFromWidget, resolveMobileWidget } from "../utils/mobileWidget";
import { configureUiSounds, playConfiguredUiSound, primeConfiguredSounds } from "../utils/uiSounds";
import { buildWidgetTemplate } from "../utils/widgetFactory";
import { palette } from "../utils/theme";

const LazyWidgetEditorModal = lazy(() =>
  import("../components/WidgetEditorModal").then((module) => ({ default: module.WidgetEditorModal }))
);

const WEB_ACTIVE_PAGE_STORAGE_KEY = "smarthome-dashboard-v2.activePageId";

export function DashboardScreen() {
  const { width, height } = useWindowDimensions();
  const [isTouchCapableWeb, setIsTouchCapableWeb] = useState(false);
  const isPhoneLikeWeb = Platform.OS === "web" && isTouchCapableWeb && Math.max(width, height) < 1000;
  const isCompact = width < 700 || isPhoneLikeWeb;
  const activeLayoutTarget: "desktop" | "mobile" = isCompact ? "mobile" : "desktop";
  const isPhoneWeb = Platform.OS === "web" && isTouchCapableWeb && Math.min(width, height) <= 500;
  const isTouchLayout = width < 1100 || isTouchCapableWeb;
  const horizontalPagerRef = useRef<ScrollView | null>(null);
  const horizontalOffsetRef = useRef(0);
  const pageOffsetsRef = useRef<Record<string, number>>({});
  const pullRefreshBlockedUntilRef = useRef(0);
  const pullRefreshInFlightRef = useRef(false);
  const edgeTransferCooldownRef = useRef(0);
  const fullscreenCameraMapRef = useRef<Record<string, boolean>>({});
  const pullGestureRef = useRef<{
    pageId: string | null;
    startX: number | null;
    startY: number | null;
    lastX: number | null;
    lastY: number | null;
    armed: boolean;
    startedAt: number;
    movedAt: number;
  }>({
    pageId: null,
    startX: null,
    startY: null,
    lastX: null,
    lastY: null,
    armed: false,
    startedAt: 0,
    movedAt: 0,
  });
  const {
    addWidget,
    config,
    dashboardPages,
    activePageId,
    createDashboardPage,
    moveDashboardPage,
    updateDashboardPage,
    deleteDashboardPage,
    moveWidgetToPage,
    removeWidget,
    replaceWidgets,
    setActivePage,
    updateWidget,
  } = useDashboardConfig();
  const committedPageIdRef = useRef(activePageId);
  const restoredStoredPageRef = useRef(false);
  const { client, error, isOnline, stateStore, stateWrites, writeStateTracked } = useIoBrokerStates();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [scrollFocusWidgetId, setScrollFocusWidgetId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState(false);
  const [visiblePageId, setVisiblePageId] = useState(activePageId);
  const [pageSettingsPageId, setPageSettingsPageId] = useState<string | null>(null);
  const [pageSettingsTitle, setPageSettingsTitle] = useState("");
  const [pageSettingsMode, setPageSettingsMode] = useState<DashboardPageMode>("dashboard");
  const [pageSettingsUrl, setPageSettingsUrl] = useState("");
  const [pageSettingsUrlZoom, setPageSettingsUrlZoom] = useState("100");
  const [deletePageId, setDeletePageId] = useState<string | null>(null);
  const lastContentScrollAt = useRef(0);
  const activePageIndex = Math.max(0, dashboardPages.findIndex((page) => page.id === activePageId));

  const pageConfigs = useMemo(
    () =>
      dashboardPages.map((page) => ({
        ...config,
        title: page.title,
        mode: page.mode,
        url: page.url,
        urlZoomPercent: page.urlZoomPercent,
        widgets: page.widgets,
        activePageId: page.id,
      })),
    [config, dashboardPages]
  );
  const pageSettingsTargetPage = useMemo(
    () => dashboardPages.find((page) => page.id === pageSettingsPageId) || null,
    [dashboardPages, pageSettingsPageId]
  );
  const deleteTargetPage = useMemo(
    () => dashboardPages.find((page) => page.id === deletePageId) || null,
    [dashboardPages, deletePageId]
  );
  const activeDashboardPage = useMemo(
    () => dashboardPages.find((page) => page.id === activePageId) || null,
    [dashboardPages, activePageId]
  );

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      setIsTouchCapableWeb(false);
      return;
    }

    const touchCapable =
      (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
      ("matchMedia" in window && window.matchMedia("(pointer: coarse)").matches);

    setIsTouchCapableWeb(Boolean(touchCapable));
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      return;
    }

    const html = document.documentElement;
    const body = document.body;
    const styleTagId = "smarthome-dashboard-v2-ios-web-fixes";
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    const previousViewport = viewportMeta?.getAttribute("content") ?? null;
    const previousHtmlWebkitTextAdjust = html.style.getPropertyValue("-webkit-text-size-adjust");
    const previousHtmlTextAdjust = html.style.getPropertyValue("text-size-adjust");
    const previousBodyWebkitTextAdjust = body.style.getPropertyValue("-webkit-text-size-adjust");
    const previousBodyTextAdjust = body.style.getPropertyValue("text-size-adjust");

    html.style.setProperty("-webkit-text-size-adjust", "100%");
    html.style.setProperty("text-size-adjust", "100%");
    body.style.setProperty("-webkit-text-size-adjust", "100%");
    body.style.setProperty("text-size-adjust", "100%");

    if (viewportMeta) {
      const normalized = previousViewport || "width=device-width, initial-scale=1";
      const hasViewportFit = /viewport-fit\s*=\s*cover/i.test(normalized);
      const nextViewport = hasViewportFit ? normalized : `${normalized}, viewport-fit=cover`;
      viewportMeta.setAttribute("content", nextViewport);
    }

    let injectedStyle: HTMLStyleElement | null = null;
    const isIosWeb =
      typeof navigator !== "undefined" &&
      (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    if (isIosWeb && !document.getElementById(styleTagId)) {
      injectedStyle = document.createElement("style");
      injectedStyle.id = styleTagId;
      injectedStyle.textContent = `
        input, textarea, select {
          font-size: 16px !important;
        }
      `;
      document.head.appendChild(injectedStyle);
    }

    return () => {
      if (viewportMeta && previousViewport !== null) {
        viewportMeta.setAttribute("content", previousViewport);
      }
      if (previousHtmlWebkitTextAdjust) {
        html.style.setProperty("-webkit-text-size-adjust", previousHtmlWebkitTextAdjust);
      } else {
        html.style.removeProperty("-webkit-text-size-adjust");
      }
      if (previousHtmlTextAdjust) {
        html.style.setProperty("text-size-adjust", previousHtmlTextAdjust);
      } else {
        html.style.removeProperty("text-size-adjust");
      }
      if (previousBodyWebkitTextAdjust) {
        body.style.setProperty("-webkit-text-size-adjust", previousBodyWebkitTextAdjust);
      } else {
        body.style.removeProperty("-webkit-text-size-adjust");
      }
      if (previousBodyTextAdjust) {
        body.style.setProperty("text-size-adjust", previousBodyTextAdjust);
      } else {
        body.style.removeProperty("text-size-adjust");
      }
      if (injectedStyle?.parentNode) {
        injectedStyle.parentNode.removeChild(injectedStyle);
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || typeof document === "undefined" || !isPhoneWeb) {
      return;
    }

    const html = document.documentElement;
    const body = document.body;
    const prevHtmlHeight = html.style.height;
    const prevBodyHeight = body.style.height;
    const prevBodyMargin = body.style.margin;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyBackground = body.style.background;
    const prevBodyOverscroll = body.style.getPropertyValue("overscroll-behavior");
    const kickViewport = () => {
      window.scrollTo(0, 1);
    };

    html.style.height = "100%";
    body.style.height = "100%";
    body.style.margin = "0";
    body.style.overflow = "hidden";
    body.style.background = "#000";
    body.style.setProperty("overscroll-behavior", "none");

    const timer = window.setTimeout(kickViewport, 60);
    window.addEventListener("resize", kickViewport);
    window.addEventListener("orientationchange", kickViewport);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", kickViewport);
      window.removeEventListener("orientationchange", kickViewport);
      html.style.height = prevHtmlHeight;
      body.style.height = prevBodyHeight;
      body.style.margin = prevBodyMargin;
      body.style.overflow = prevBodyOverflow;
      body.style.background = prevBodyBackground;
      if (prevBodyOverscroll) {
        body.style.setProperty("overscroll-behavior", prevBodyOverscroll);
      } else {
        body.style.removeProperty("overscroll-behavior");
      }
    };
  }, [isPhoneWeb]);

  useEffect(() => {
    if (!horizontalPagerRef.current) {
      return;
    }

    horizontalPagerRef.current.scrollTo({ x: width * activePageIndex, animated: false });
  }, [activePageIndex, width]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return;
    }
    if (!restoredStoredPageRef.current) {
      return;
    }
    if (!activePageId) {
      return;
    }
    try {
      window.localStorage.setItem(WEB_ACTIVE_PAGE_STORAGE_KEY, activePageId);
    } catch {
      // Ignore browsers/environments where storage is unavailable.
    }
  }, [activePageId]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return;
    }
    if (!dashboardPages.length) {
      return;
    }
    if (restoredStoredPageRef.current) {
      return;
    }

    restoredStoredPageRef.current = true;

    let storedPageId = "";
    try {
      storedPageId = window.localStorage.getItem(WEB_ACTIVE_PAGE_STORAGE_KEY) || "";
    } catch {
      storedPageId = "";
    }

    if (!storedPageId || storedPageId === activePageId) {
      return;
    }

    const storedPageIndex = dashboardPages.findIndex((page) => page.id === storedPageId);
    if (storedPageIndex < 0) {
      return;
    }

    committedPageIdRef.current = storedPageId;
    setVisiblePageId(storedPageId);
    setActivePage(storedPageId);
    horizontalPagerRef.current?.scrollTo({ x: width * storedPageIndex, animated: false });
  }, [activePageId, dashboardPages, setActivePage, width]);

  useEffect(() => {
    setVisiblePageId(activePageId);
    committedPageIdRef.current = activePageId;
  }, [activePageId]);

  useEffect(() => {
    if (!scrollFocusWidgetId) {
      return;
    }
    const activePage = dashboardPages.find((page) => page.id === activePageId);
    if (!activePage?.widgets.some((widget) => widget.id === scrollFocusWidgetId)) {
      setScrollFocusWidgetId(null);
    }
  }, [activePageId, dashboardPages, scrollFocusWidgetId]);

  useEffect(() => {
    if (layoutMode && scrollFocusWidgetId) {
      setScrollFocusWidgetId(null);
    }
  }, [layoutMode, scrollFocusWidgetId]);

  useEffect(() => {
    configureUiSounds(config.uiSounds);
  }, [config.uiSounds]);

  useEffect(() => {
    const configuredSoundIds = [
      ...(config.uiSounds?.widgetTypeDefaults?.state?.press || []),
      ...(config.uiSounds?.widgetTypeDefaults?.state?.confirm || []),
      ...(config.uiSounds?.widgetTypeDefaults?.camera?.press || []),
      ...(config.uiSounds?.widgetTypeDefaults?.camera?.open || []),
      ...(config.uiSounds?.widgetTypeDefaults?.camera?.close || []),
      ...(config.uiSounds?.widgetTypeDefaults?.camera?.scroll || []),
      ...(config.uiSounds?.widgetTypeDefaults?.grafana?.press || []),
      ...(config.uiSounds?.widgetTypeDefaults?.numpad?.press || []),
      ...(config.uiSounds?.widgetTypeDefaults?.numpad?.confirm || []),
      ...(config.uiSounds?.widgetTypeDefaults?.link?.press || []),
      ...(config.uiSounds?.widgetTypeDefaults?.link?.open || []),
      ...(config.uiSounds?.widgetTypeDefaults?.link?.close || []),
      ...(config.uiSounds?.widgetTypeDefaults?.log?.press || []),
      ...(config.uiSounds?.widgetTypeDefaults?.log?.scroll || []),
      ...(config.uiSounds?.widgetTypeDefaults?.log?.notify || []),
      ...(config.uiSounds?.widgetTypeDefaults?.log?.notifyWarn || []),
      ...(config.uiSounds?.widgetTypeDefaults?.log?.notifyError || []),
      ...(config.uiSounds?.widgetTypeDefaults?.script?.press || []),
      ...(config.uiSounds?.widgetTypeDefaults?.script?.scroll || []),
      ...(config.uiSounds?.widgetTypeDefaults?.wallbox?.press || []),
      ...(config.uiSounds?.widgetTypeDefaults?.wallbox?.confirm || []),
      ...(config.uiSounds?.widgetTypeDefaults?.wallbox?.slider || []),
      ...(config.uiSounds?.widgetTypeDefaults?.goe?.press || []),
      ...(config.uiSounds?.widgetTypeDefaults?.goe?.confirm || []),
      ...(config.uiSounds?.widgetTypeDefaults?.goe?.slider || []),
      ...(config.uiSounds?.pageSounds?.tabPress || []),
      ...(config.uiSounds?.pageSounds?.swipe || []),
      ...(config.uiSounds?.pageSounds?.contentScroll || []),
      ...(config.uiSounds?.pageSounds?.pullToRefresh || []),
      ...(config.uiSounds?.pageSounds?.layoutToggle || []),
      ...(config.uiSounds?.pageSounds?.addWidget || []),
      ...(config.uiSounds?.pageSounds?.openSettings || []),
      ...(config.uiSounds?.pageSounds?.widgetEdit || []),
      ...(config.uiSounds?.pageSounds?.editorButton || []),
      ...config.widgets.flatMap((widget) => [
          ...(widget.interactionSounds?.press || []),
          ...(widget.interactionSounds?.confirm || []),
          ...(widget.interactionSounds?.slider || []),
          ...(widget.interactionSounds?.open || []),
          ...(widget.interactionSounds?.close || []),
          ...(widget.interactionSounds?.scroll || []),
          ...(widget.interactionSounds?.notify || []),
          ...(widget.interactionSounds?.notifyWarn || []),
          ...(widget.interactionSounds?.notifyError || []),
        ]),
    ];

    primeConfiguredSounds(configuredSoundIds);
  }, [config.uiSounds, config.widgets]);

  const addWidgetByType = (type: WidgetType) => {
    if (normalizeDashboardPageMode(activeDashboardPage?.mode) === "url") {
      return;
    }
    const widget = buildWidgetTemplate(type, config.widgets.length, { columns: config.grid.columns });
    const existingIds = new Set(config.widgets.map((entry) => entry.id));
    if (existingIds.has(widget.id)) {
      const base = widget.id;
      let counter = 2;
      while (existingIds.has(`${base}-${counter}`)) {
        counter += 1;
      }
      widget.id = `${base}-${counter}`;
    }
    const constrainedPosition = constrainToPrimarySections(widget.position, config.grid.columns);
    const nextWidgets = normalizeWidgetLayout([
      ...config.widgets,
      {
        ...widget,
        position: resolveWidgetPosition(config.widgets, widget.id, constrainedPosition, config.grid.columns),
      },
    ], config.grid.columns);
    addWidget(nextWidgets[nextWidgets.length - 1]);
  };

  const handleUpdateWidget = (widgetId: string, partial: Partial<WidgetConfig>) => {
    const currentWidget = config.widgets.find((widget) => widget.id === widgetId);
    if (!currentWidget) {
      return;
    }
    const supportsManualHeightOverride =
      currentWidget.type === "camera" ||
      currentWidget.type === "cameraTalk" ||
      currentWidget.type === "cameraTalkReolink" ||
      currentWidget.type === "solar" ||
      currentWidget.type === "weather" ||
      currentWidget.type === "grafana" ||
      currentWidget.type === "log" ||
      currentWidget.type === "script" ||
      currentWidget.type === "host" ||
      currentWidget.type === "raspberryPiStats" ||
      currentWidget.type === "wallbox" ||
      currentWidget.type === "goe" ||
      currentWidget.type === "heating" ||
      currentWidget.type === "heatingV2";
    if (partial.mobilePosition) {
      const currentMobile = resolveMobileWidget(currentWidget);
      const nextMobileOverride = {
        ...buildMobileOverrideFromWidget(currentMobile),
        ...(supportsManualHeightOverride ? { manualHeightOverride: true } : null),
      };
      updateWidget(widgetId, {
        mobilePosition: partial.mobilePosition,
        mobileOverride: nextMobileOverride,
        ...(supportsManualHeightOverride ? { manualHeightOverride: true } : null),
      });
      return;
    }
    if (activeLayoutTarget === "mobile") {
      const currentMobile = resolveMobileWidget(currentWidget);
      const nextMobileWidget = {
        ...currentMobile,
        ...partial,
      } as WidgetConfig;
      const nextMobileOverride = {
        ...buildMobileOverrideFromWidget(nextMobileWidget),
        ...(supportsManualHeightOverride ? { manualHeightOverride: true } : null),
      };
      updateWidget(widgetId, {
        mobileOverride: nextMobileOverride,
      });
      return;
    }
    if (partial.position) {
      const positionConstraint =
        currentWidget.type === "camera" ||
        currentWidget.type === "cameraTalk" ||
        currentWidget.type === "cameraTalkReolink"
          ? { minHeight: 0.5, heightSnap: 0.1 }
          : currentWidget.type === "solar"
            ? { minHeight: 2.5, heightSnap: 0.1 }
            : currentWidget.type === "weather" ||
                currentWidget.type === "grafana" ||
                currentWidget.type === "log" ||
                currentWidget.type === "script" ||
                currentWidget.type === "host" ||
                currentWidget.type === "raspberryPiStats" ||
                currentWidget.type === "wallbox" ||
                currentWidget.type === "goe" ||
                currentWidget.type === "heating" ||
                currentWidget.type === "heatingV2"
              ? { minHeight: 1, heightSnap: 0.1 }
            : undefined;
      updateWidget(widgetId, {
        ...partial,
        position: constrainToPrimarySections(partial.position, config.grid.columns, positionConstraint),
        ...(supportsManualHeightOverride ? { manualHeightOverride: true } : null),
      });
      return;
    }

    updateWidget(widgetId, partial);
  };

  const closePageSettingsDialog = () => {
    setPageSettingsPageId(null);
    setPageSettingsTitle("");
    setPageSettingsMode("dashboard");
    setPageSettingsUrl("");
    setPageSettingsUrlZoom("100");
  };

  const openPageSettingsDialog = (pageId: string) => {
    const page = dashboardPages.find((entry) => entry.id === pageId);
    if (!page) {
      return;
    }
    const pageMode = normalizeDashboardPageMode(page.mode);
    setPageSettingsPageId(pageId);
    setPageSettingsTitle(page.title);
    setPageSettingsMode(pageMode);
    setPageSettingsUrl(page.url || "");
    setPageSettingsUrlZoom(String(normalizeUrlZoomPercent(page.urlZoomPercent)));
  };

  const submitPageSettingsDialog = () => {
    if (!pageSettingsPageId) {
      return;
    }
    const nextTitle = pageSettingsTitle.trim();
    if (!nextTitle) {
      return;
    }
    if (pageSettingsMode === "url" && !normalizeUrl(pageSettingsUrl)) {
      return;
    }
    updateDashboardPage(pageSettingsPageId, {
      title: nextTitle,
      mode: pageSettingsMode,
      url: pageSettingsMode === "url" ? pageSettingsUrl : "",
      urlZoomPercent: pageSettingsMode === "url" ? parseUrlZoomPercent(pageSettingsUrlZoom) : 100,
    });
    closePageSettingsDialog();
  };

  const closeDeleteDialog = () => {
    setDeletePageId(null);
  };

  const openDeleteDialog = (pageId: string) => {
    if (dashboardPages.length <= 1) {
      return;
    }
    if (!dashboardPages.some((entry) => entry.id === pageId)) {
      return;
    }
    setDeletePageId(pageId);
  };

  const submitDeleteDialog = () => {
    if (!deletePageId) {
      return;
    }
    deleteDashboardPage(deletePageId);
    closeDeleteDialog();
  };

  const handleDragAcrossPageEdge = (
    sourcePageId: string,
    direction: "left" | "right",
    widgetId: string,
    position: WidgetConfig["position"]
  ) => {
    const now = Date.now();
    if (now - edgeTransferCooldownRef.current < 520) {
      return;
    }

    const sourceIndex = dashboardPages.findIndex((page) => page.id === sourcePageId);
    if (sourceIndex < 0) {
      return;
    }

    const targetIndex = direction === "left" ? sourceIndex - 1 : sourceIndex + 1;
    const targetPage = dashboardPages[targetIndex];
    if (!targetPage) {
      return;
    }

    edgeTransferCooldownRef.current = now;
    moveWidgetToPage(widgetId, targetPage.id, position);
    setVisiblePageId(targetPage.id);
    horizontalOffsetRef.current = width * targetIndex;
    horizontalPagerRef.current?.scrollTo({ x: width * targetIndex, animated: false });
    playConfiguredUiSound(config.uiSounds?.pageSounds?.swipe, "swipe", "global:dragEdgePageTransfer");
  };

  const editingWidgetBase: WidgetConfig | null =
    config.widgets.find((widget) => widget.id === editingWidgetId) || null;
  const editingWidget: WidgetConfig | null = editingWidgetBase
    ? activeLayoutTarget === "mobile"
      ? resolveMobileWidget(editingWidgetBase)
      : editingWidgetBase
    : null;

  const resolvePageFromOffset = (offsetX: number) => {
    if (!width) {
      return null;
    }

    const nextIndex = Math.round(offsetX / width);
    return dashboardPages[nextIndex] || null;
  };

  const handlePageScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    horizontalOffsetRef.current = offsetX;
  };

  const commitPageByOffset = (offsetX: number) => {
    const nextPage = resolvePageFromOffset(offsetX);
    if (nextPage) {
      if (nextPage.id !== committedPageIdRef.current) {
        playConfiguredUiSound(config.uiSounds?.pageSounds?.swipe, "swipe", "global:pageSwipe");
      }
      committedPageIdRef.current = nextPage.id;
      setVisiblePageId(nextPage.id);
      setActivePage(nextPage.id);
    }
  };

  const handlePageMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    horizontalOffsetRef.current = offsetX;
    commitPageByOffset(offsetX);
  };

  const handlePageDragEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    horizontalOffsetRef.current = offsetX;
    commitPageByOffset(offsetX);
  };

  const handleContentScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (event.nativeEvent.contentOffset.y <= 12) {
      return;
    }

    const now = Date.now();
    if (now - lastContentScrollAt.current < 280) {
      return;
    }

    lastContentScrollAt.current = now;
    playConfiguredUiSound(config.uiSounds?.pageSounds?.contentScroll, "tap", "global:pageContentScroll");
  };

  const handlePageContentScroll =
    (pageId: string) =>
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      pageOffsetsRef.current[pageId] = event.nativeEvent.contentOffset.y;
    };

  const handlePageTouchStart =
    (pageId: string) =>
    (event: unknown) => {
      if (!isTouchLayout) {
        return;
      }
      if (layoutMode) {
        return;
      }
      const hasFullscreenCamera = Object.values(fullscreenCameraMapRef.current).some(Boolean);
      if (hasFullscreenCamera || Date.now() < pullRefreshBlockedUntilRef.current) {
        pullGestureRef.current = {
          pageId: null,
          startX: null,
          startY: null,
          lastX: null,
          lastY: null,
          armed: false,
          startedAt: 0,
          movedAt: 0,
        };
        return;
      }

      const currentOffset = pageOffsetsRef.current[pageId] || 0;
      if (currentOffset > 0) {
        pullGestureRef.current = {
          pageId: null,
          startX: null,
          startY: null,
          lastX: null,
          lastY: null,
          armed: false,
          startedAt: 0,
          movedAt: 0,
        };
        return;
      }

      const point = extractTouchPoint(event);
      pullGestureRef.current = {
        pageId,
        startX: point?.pageX ?? null,
        startY: point?.pageY ?? null,
        lastX: point?.pageX ?? null,
        lastY: point?.pageY ?? null,
        armed: false,
        startedAt: Date.now(),
        movedAt: 0,
      };
    };

  const handlePageTouchMove =
    (pageId: string) =>
    (event: unknown) => {
      if (!isTouchLayout) {
        return;
      }
      if (layoutMode) {
        return;
      }
      const hasFullscreenCamera = Object.values(fullscreenCameraMapRef.current).some(Boolean);
      if (hasFullscreenCamera || Date.now() < pullRefreshBlockedUntilRef.current) {
        return;
      }

      const activeGesture = pullGestureRef.current;
      if (activeGesture.pageId !== pageId || activeGesture.startY === null || activeGesture.startX === null) {
        return;
      }

      const point = extractTouchPoint(event);
      if (!point) {
        return;
      }

      activeGesture.lastX = point.pageX;
      activeGesture.lastY = point.pageY;

      const currentOffset = pageOffsetsRef.current[pageId] || 0;
      if (currentOffset > 0) {
        activeGesture.armed = false;
        return;
      }

      const deltaY = point.pageY - activeGesture.startY;
      const deltaX = point.pageX - activeGesture.startX;
      activeGesture.armed = deltaY > 96 && deltaY > Math.abs(deltaX) + 32;
      activeGesture.movedAt = Date.now();
    };

  const handlePageTouchEnd =
    (pageId: string) =>
    (event: unknown) => {
      if (!isTouchLayout || Platform.OS !== "web" || typeof window === "undefined") {
        return;
      }
      if (layoutMode) {
        pullGestureRef.current = {
          pageId: null,
          startX: null,
          startY: null,
          lastX: null,
          lastY: null,
          armed: false,
          startedAt: 0,
          movedAt: 0,
        };
        return;
      }

      const activeGesture = pullGestureRef.current;
      const currentOffset = pageOffsetsRef.current[pageId] || 0;
      const endPoint = extractTouchPoint(event);
      const now = Date.now();
      const hasFullscreenCamera = Object.values(fullscreenCameraMapRef.current).some(Boolean);
      if (hasFullscreenCamera || now < pullRefreshBlockedUntilRef.current) {
        pullGestureRef.current = {
          pageId: null,
          startX: null,
          startY: null,
          lastX: null,
          lastY: null,
          armed: false,
          startedAt: 0,
          movedAt: 0,
        };
        return;
      }
      const endY = endPoint?.pageY ?? activeGesture.lastY;
      const endX = endPoint?.pageX ?? activeGesture.lastX;
      const deltaY =
        activeGesture.startY !== null && endY !== null ? endY - activeGesture.startY : 0;
      const deltaX =
        activeGesture.startX !== null && endX !== null ? endX - activeGesture.startX : 0;
      const isFreshGesture =
        activeGesture.startedAt > 0 &&
        now - activeGesture.startedAt <= 2500 &&
        activeGesture.movedAt > 0 &&
        now - activeGesture.movedAt <= 600;

      if (
        activeGesture.pageId === pageId &&
        activeGesture.startX !== null &&
        activeGesture.startY !== null &&
        activeGesture.armed &&
        isFreshGesture &&
        currentOffset <= 0 &&
        deltaY > 96 &&
        deltaY > Math.abs(deltaX) + 32 &&
        !pullRefreshInFlightRef.current
      ) {
        pullRefreshInFlightRef.current = true;
        playConfiguredUiSound(config.uiSounds?.pageSounds?.pullToRefresh, "page", "global:pullToRefresh");
        window.setTimeout(() => {
          window.location.reload();
        }, 160);
      }

      pullGestureRef.current = {
        pageId: null,
        startX: null,
        startY: null,
        lastX: null,
        lastY: null,
        armed: false,
        startedAt: 0,
        movedAt: 0,
      };
    };

  const phoneViewportStyle =
    Platform.OS === "web" && isPhoneWeb
      ? ({
          minHeight: "100dvh",
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        } as any)
      : null;

  return (
    <View style={[styles.root, phoneViewportStyle]}>
      <BackgroundLayer
        accent={config.backgroundAccent}
        color={config.backgroundColor}
        mode={config.backgroundMode}
      />
      <TopBar
        homeLabel={config.homeLabel || "My Home"}
        activePageId={visiblePageId}
        isOnline={isOnline}
        isLayoutMode={layoutMode}
        pageTabSounds={config.uiSounds?.pageSounds?.tabPress}
        layoutToggleSounds={config.uiSounds?.pageSounds?.layoutToggle}
        addWidgetSounds={config.uiSounds?.pageSounds?.addWidget}
        openSettingsSounds={config.uiSounds?.pageSounds?.openSettings}
        pageTitles={dashboardPages.map((page) => ({ id: page.id, title: page.title }))}
        onAddWidget={() => setLibraryOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onSelectPage={(pageId) => {
          const nextIndex = dashboardPages.findIndex((page) => page.id === pageId);
          if (nextIndex >= 0) {
            horizontalOffsetRef.current = width * nextIndex;
            horizontalPagerRef.current?.scrollTo({ x: width * nextIndex, animated: false });
          }
          setVisiblePageId(pageId);
          setActivePage(pageId);
        }}
        onToggleLayoutMode={() => setLayoutMode((current) => !current)}
        onMovePage={(pageId, direction) => {
          moveDashboardPage(pageId, direction);
        }}
        onRenamePage={(pageId) => {
          openPageSettingsDialog(pageId);
        }}
        onDeletePage={(pageId) => {
          openDeleteDialog(pageId);
        }}
      />
      <ScrollView
        style={[styles.scroll, isCompact ? styles.scrollCompact : null]}
        horizontal
        pagingEnabled
        ref={horizontalPagerRef}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        onScroll={handlePageScroll}
        onMomentumScrollEnd={handlePageMomentumEnd}
        onScrollEndDrag={handlePageDragEnd}
      >
        {pageConfigs.map((pageConfig, pageIndex) => {
          const isActive = pageIndex === activePageIndex;
          const shouldRenderContent = isActive;
          const pageMode = normalizeDashboardPageMode(pageConfig.mode);
          const isUrlPage = pageMode === "url";

          return (
            <View key={pageConfig.activePageId} style={[styles.page, { width }]}>
              {shouldRenderContent ? (
                isUrlPage ? (
                  <UrlSidePage
                    title={pageConfig.title}
                    url={pageConfig.url || ""}
                    urlZoomPercent={normalizeUrlZoomPercent(pageConfig.urlZoomPercent)}
                  />
                ) : (
                  <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    scrollEnabled={!scrollFocusWidgetId}
                    style={styles.pageScroll}
                    onScroll={handlePageContentScroll(pageConfig.activePageId)}
                    onMomentumScrollEnd={handleContentScrollEnd}
                    onScrollEndDrag={handleContentScrollEnd}
                    onTouchStart={handlePageTouchStart(pageConfig.activePageId)}
                    onTouchMove={handlePageTouchMove(pageConfig.activePageId)}
                    onTouchEnd={handlePageTouchEnd(pageConfig.activePageId)}
                  >
                    <GridCanvas
                      client={client}
                      config={pageConfig}
                      isActivePage={isActive}
                      isLayoutMode={layoutMode}
                      onCameraFullscreenSwipeClose={() => {
                        pullRefreshBlockedUntilRef.current = Date.now() + 2500;
                        pullGestureRef.current = {
                          pageId: null,
                          startX: null,
                          startY: null,
                          lastX: null,
                          lastY: null,
                          armed: false,
                          startedAt: 0,
                          movedAt: 0,
                        };
                      }}
                      onCameraFullscreenVisibilityChange={(widgetId, open) => {
                        fullscreenCameraMapRef.current[widgetId] = open;
                        if (!open) {
                          pullRefreshBlockedUntilRef.current = Date.now() + 2500;
                        }
                        pullGestureRef.current = {
                          pageId: null,
                          startX: null,
                          startY: null,
                          lastX: null,
                          lastY: null,
                          armed: false,
                          startedAt: 0,
                          movedAt: 0,
                        };
                      }}
                      onEditWidget={setEditingWidgetId}
                      onRemoveWidget={removeWidget}
                      onUpdateWidget={handleUpdateWidget}
                      onWriteState={writeStateTracked}
                      onDragAcrossPageEdge={(direction, widgetId, position) =>
                        handleDragAcrossPageEdge(pageConfig.activePageId, direction, widgetId, position)
                      }
                      onWidgetScrollFocusChange={(widgetId, active) => {
                        setScrollFocusWidgetId((current) => {
                          if (active) {
                            return widgetId;
                          }
                          return current === widgetId ? null : current;
                        });
                      }}
                      stateWrites={stateWrites}
                      stateStore={stateStore}
                    />
                  </ScrollView>
                )
              ) : (
                <View style={styles.pagePlaceholder} />
              )}
            </View>
          );
        })}
      </ScrollView>
      <WidgetLibraryModal
        onCreateDashboard={createDashboardPage}
        onCreateUrlPage={() => createDashboardPage("url")}
        onClose={() => setLibraryOpen(false)}
        onSelectType={addWidgetByType}
        visible={libraryOpen}
      />
      {editingWidget ? (
        <Suspense fallback={null}>
          <LazyWidgetEditorModal
            client={client}
            onClose={() => setEditingWidgetId(null)}
            onSave={handleUpdateWidget}
            visible
            widget={editingWidget}
          />
        </Suspense>
      ) : null}
      <SettingsModal onClose={() => setSettingsOpen(false)} visible={settingsOpen} />
      <Modal
        animationType="fade"
        onRequestClose={closePageSettingsDialog}
        transparent
        visible={Boolean(pageSettingsTargetPage)}
      >
        <View style={styles.renameBackdrop}>
          <View style={styles.renameCard}>
            <Text style={styles.renameTitle}>Side-Page Einstellungen</Text>
            <Text style={styles.renameHint}>Titel fuer den Seiten-Button:</Text>
            <TextInput
              autoFocus
              onChangeText={setPageSettingsTitle}
              onSubmitEditing={submitPageSettingsDialog}
              placeholder="z. B. Wallbox, Garten, Uebersicht"
              placeholderTextColor={palette.textMuted}
              style={styles.renameInput}
              value={pageSettingsTitle}
            />
            <Text style={styles.renameHint}>Seiten-Typ:</Text>
            <View style={styles.pageModeRow}>
              <Pressable
                onPress={() => setPageSettingsMode("dashboard")}
                style={[
                  styles.pageModeButton,
                  pageSettingsMode === "dashboard" ? styles.pageModeButtonActive : null,
                ]}
              >
                <Text
                  style={[
                    styles.pageModeButtonLabel,
                    pageSettingsMode === "dashboard" ? styles.pageModeButtonLabelActive : null,
                  ]}
                >
                  Dashboard
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setPageSettingsMode("url")}
                style={[
                  styles.pageModeButton,
                  pageSettingsMode === "url" ? styles.pageModeButtonActive : null,
                ]}
              >
                <Text
                  style={[
                    styles.pageModeButtonLabel,
                    pageSettingsMode === "url" ? styles.pageModeButtonLabelActive : null,
                  ]}
                >
                  URL
                </Text>
              </Pressable>
            </View>
            {pageSettingsMode === "url" ? (
              <>
                <Text style={styles.renameHint}>URL der Seite:</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setPageSettingsUrl}
                  onSubmitEditing={submitPageSettingsDialog}
                  placeholder="https://..."
                  placeholderTextColor={palette.textMuted}
                  style={styles.renameInput}
                  value={pageSettingsUrl}
                />
                <Text style={styles.renameHint}>Zoom (%):</Text>
                <TextInput
                  keyboardType="numeric"
                  onChangeText={setPageSettingsUrlZoom}
                  onSubmitEditing={submitPageSettingsDialog}
                  placeholder="100"
                  placeholderTextColor={palette.textMuted}
                  style={styles.renameInput}
                  value={pageSettingsUrlZoom}
                />
                <Text style={styles.renameHint}>Empfohlen fuer zu grosse Seiten: 80-95%</Text>
              </>
            ) : null}
            <View style={styles.renameActions}>
              <Pressable onPress={closePageSettingsDialog} style={[styles.renameButton, styles.renameButtonSecondary]}>
                <Text style={styles.renameButtonSecondaryLabel}>Abbrechen</Text>
              </Pressable>
              <Pressable
                disabled={!pageSettingsTitle.trim() || (pageSettingsMode === "url" && !normalizeUrl(pageSettingsUrl))}
                onPress={submitPageSettingsDialog}
                style={[
                  styles.renameButton,
                  styles.renameButtonPrimary,
                  !pageSettingsTitle.trim() || (pageSettingsMode === "url" && !normalizeUrl(pageSettingsUrl))
                    ? styles.renameButtonDisabled
                    : null,
                ]}
              >
                <Text style={styles.renameButtonPrimaryLabel}>Speichern</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={closeDeleteDialog}
        transparent
        visible={Boolean(deleteTargetPage)}
      >
        <View style={styles.renameBackdrop}>
          <View style={styles.renameCard}>
            <Text style={styles.deleteTitle}>Side-Page loeschen?</Text>
            <Text style={styles.deleteHint}>
              Die Seite "{deleteTargetPage?.title || ""}" wird entfernt. Dieser Schritt kann nicht rueckgaengig gemacht
              werden.
            </Text>
            <View style={styles.deleteActions}>
              <Pressable onPress={closeDeleteDialog} style={[styles.renameButton, styles.renameButtonSecondary]}>
                <Text style={styles.renameButtonSecondaryLabel}>Abbrechen</Text>
              </Pressable>
              <Pressable onPress={submitDeleteDialog} style={[styles.renameButton, styles.deleteButtonDanger]}>
                <Text style={styles.deleteButtonDangerLabel}>Loeschen</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function UrlSidePage({ title, url, urlZoomPercent = 100 }: { title: string; url?: string; urlZoomPercent?: number }) {
  const resolvedUrl = normalizeUrl(url);
  if (!resolvedUrl) {
    return (
      <View style={styles.urlFallback}>
        <Text style={styles.urlFallbackTitle}>URL fehlt</Text>
        <Text style={styles.urlFallbackHint}>Trage in den Seiten-Einstellungen eine gueltige URL ein.</Text>
      </View>
    );
  }

  if (Platform.OS === "web") {
    const zoomScale = normalizeUrlZoomPercent(urlZoomPercent) / 100;
    return createElement(
      "div",
      { style: webUrlPageWrapStyle },
      createElement("iframe", {
        src: resolvedUrl,
        style: buildWebUrlPageFrameStyle(zoomScale),
        allow: "fullscreen; autoplay; clipboard-read; clipboard-write",
        allowFullScreen: true,
        loading: "eager",
        referrerPolicy: "no-referrer",
      })
    );
  }

  return (
    <View style={styles.urlFallback}>
      <Text style={styles.urlFallbackTitle}>{title || "URL-Seite"}</Text>
      <Text style={styles.urlFallbackHint}>Diese Seite wird auf nativen Clients extern geoeffnet.</Text>
      <Pressable onPress={() => void Linking.openURL(resolvedUrl)} style={[styles.renameButton, styles.renameButtonPrimary]}>
        <Text style={styles.renameButtonPrimaryLabel}>URL oeffnen</Text>
      </Pressable>
    </View>
  );
}

function normalizeDashboardPageMode(value: unknown): DashboardPageMode {
  return value === "url" ? "url" : "dashboard";
}

function normalizeUrl(value?: string) {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function normalizeUrlZoomPercent(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 100;
  }
  return Math.max(50, Math.min(150, Math.round(value)));
}

function parseUrlZoomPercent(value: string) {
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return 100;
  }
  return normalizeUrlZoomPercent(parsed);
}

function extractTouchPoint(event: unknown) {
  if (!event || typeof event !== "object" || !("nativeEvent" in event)) {
    return null;
  }

  const nativeEvent = (event as { nativeEvent?: unknown }).nativeEvent;
  if (!nativeEvent || typeof nativeEvent !== "object") {
    return null;
  }

  const touches =
    "touches" in nativeEvent
      ? (nativeEvent as { touches?: Array<{ pageX?: number; pageY?: number }> }).touches
      : undefined;
  const changedTouches =
    "changedTouches" in nativeEvent
      ? (nativeEvent as { changedTouches?: Array<{ pageX?: number; pageY?: number }> }).changedTouches
      : undefined;

  const directPageX = "pageX" in nativeEvent ? (nativeEvent as { pageX?: number }).pageX : undefined;
  const directPageY = "pageY" in nativeEvent ? (nativeEvent as { pageY?: number }).pageY : undefined;

  const pageX = touches?.[0]?.pageX ?? changedTouches?.[0]?.pageX ?? directPageX;
  const pageY = touches?.[0]?.pageY ?? changedTouches?.[0]?.pageY ?? directPageY;

  if (typeof pageX !== "number" || typeof pageY !== "number") {
    return null;
  }

  return { pageX, pageY };
}

function BackgroundLayer({
  mode,
  color,
  accent,
}: {
  mode: BackgroundMode;
  color: string;
  accent: string;
}) {
  void mode;
  void color;
  void accent;
  return <View style={[styles.background, { backgroundColor: "#000000" }]} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000000",
  },
  scroll: {
    flex: 1,
    margin: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    ...(Platform.OS === "web"
      ? {
          overscrollBehaviorY: "contain" as const,
          touchAction: "pan-x" as const,
        }
      : null),
  },
  scrollCompact: {
    margin: 0,
    borderRadius: 0,
    borderWidth: 0,
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    opacity: 1,
  },
  gradientTop: {
    position: "absolute",
    inset: 0,
    opacity: 0.18,
  },
  gradientBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -180,
    height: 360,
    borderRadius: 999,
    opacity: 0.22,
  },
  meshA: {
    position: "absolute",
    left: -80,
    bottom: 80,
    width: 240,
    height: 240,
    borderRadius: 999,
    opacity: 0.08,
  },
  meshB: {
    position: "absolute",
    right: 80,
    bottom: -30,
    width: 180,
    height: 180,
    borderRadius: 999,
    opacity: 0.07,
  },
  scrollContent: {
    paddingBottom: 96,
    paddingTop: 2,
  },
  page: {
    flex: 1,
  },
  pagePlaceholder: {
    flex: 1,
  },
  urlFallback: {
    flex: 1,
    marginTop: 10,
    marginHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(4, 10, 18, 0.9)",
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  urlFallbackTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  urlFallbackHint: {
    color: palette.textMuted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  pageScroll: {
    flex: 1,
    ...(Platform.OS === "web"
      ? {
          overscrollBehaviorY: "contain" as const,
          touchAction: "pan-x pan-y" as const,
        }
      : null),
  },
  renameBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  renameCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.panelStrong,
    padding: 16,
    gap: 10,
  },
  renameTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "800",
  },
  renameHint: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  renameInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(6, 12, 20, 0.92)",
    color: palette.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pageModeRow: {
    flexDirection: "row",
    gap: 8,
  },
  pageModeButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  pageModeButtonActive: {
    borderColor: "rgba(77, 226, 177, 0.4)",
    backgroundColor: "rgba(77, 226, 177, 0.15)",
  },
  pageModeButtonLabel: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  pageModeButtonLabelActive: {
    color: palette.text,
  },
  renameActions: {
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  renameButton: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  renameButtonSecondary: {
    borderColor: palette.border,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  renameButtonPrimary: {
    borderColor: "rgba(77, 226, 177, 0.34)",
    backgroundColor: palette.accent,
  },
  renameButtonDisabled: {
    opacity: 0.5,
  },
  renameButtonSecondaryLabel: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "700",
  },
  renameButtonPrimaryLabel: {
    color: "#041019",
    fontSize: 12,
    fontWeight: "800",
  },
  deleteTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "800",
  },
  deleteHint: {
    color: palette.textMuted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  deleteActions: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  deleteButtonDanger: {
    borderColor: "rgba(248, 113, 113, 0.45)",
    backgroundColor: "rgba(220, 38, 38, 0.35)",
  },
  deleteButtonDangerLabel: {
    color: "#fee2e2",
    fontSize: 12,
    fontWeight: "800",
  },
});

const webUrlPageWrapStyle = {
  width: "100%",
  height: "100%",
  paddingTop: "4px",
  paddingBottom: "86px",
  paddingLeft: "10px",
  paddingRight: "10px",
  boxSizing: "border-box",
  overflow: "hidden",
};

function buildWebUrlPageFrameStyle(zoomScale: number) {
  const safeScale = Math.max(0.5, Math.min(1.5, Number.isFinite(zoomScale) ? zoomScale : 1));
  const normalizedPercent = `${(100 / safeScale).toFixed(3)}%`;

  return {
    width: normalizedPercent,
    height: normalizedPercent,
    border: "0",
    borderRadius: "18px",
    background: "rgba(4, 10, 18, 0.92)",
    display: "block",
    transform: `scale(${safeScale})`,
    transformOrigin: "top left",
  };
}
