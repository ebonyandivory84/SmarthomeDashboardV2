import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Suspense, createElement, lazy, memo, useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { StateWriteFeedback, useWidgetIoBrokerStates } from "../hooks/useIoBrokerStates";
import { IoBrokerClient } from "../services/iobroker";
import { IoBrokerStateStore } from "../state/IoBrokerStateStore";
import { DashboardSettings, StateSnapshot, WidgetConfig, WidgetInteractionSounds, WidgetType } from "../types/dashboard";
import { constrainToPrimarySections, GRID_SNAP, GRID_VERTICAL_SNAP } from "../utils/gridLayout";
import { applyMobileOverridesToSettings } from "../utils/mobileWidget";
import { playConfiguredUiSound } from "../utils/uiSounds";
import { resolveThemeSettings } from "../utils/themeConfig";
import { palette } from "../utils/theme";
import { WidgetFrame } from "./WidgetFrame";
import { EnergyWidget } from "./widgets/EnergyWidget";
import { HostStatsWidget } from "./widgets/HostStatsWidget";
import { HeatingWidget } from "./widgets/HeatingWidget";
import { HeatingWidgetV2 } from "./widgets/HeatingWidgetV2";
import { LinkWidget } from "./widgets/LinkWidget";
import { LogWidget } from "./widgets/LogWidget";
import { NumpadWidget } from "./widgets/NumpadWidget";
import { RaspberryPiStatsWidget } from "./widgets/RaspberryPiStatsWidget";
import { ScriptWidget } from "./widgets/ScriptWidget";
import { SolarWidget } from "./widgets/SolarWidget";
import { resolveStateNextValue, StateWidget } from "./widgets/StateWidget";
import { WallboxWidget } from "./widgets/WallboxWidget";
import { WeatherWidget } from "./widgets/WeatherWidget";

const LazyCameraWidget = lazy(() => import("./widgets/CameraWidget").then((module) => ({ default: module.CameraWidget })));
const LazyCameraTalkWidget = lazy(() =>
  import("./widgets/CameraTalkWidget").then((module) => ({ default: module.CameraTalkWidget }))
);
const LazyGrafanaWidget = lazy(() =>
  import("./widgets/GrafanaWidget").then((module) => ({ default: module.GrafanaWidget }))
);
const LazyCocoWidget = lazy(() => import("./widgets/CocoWidget").then((module) => ({ default: module.CocoWidget })));

type GridCanvasProps = {
  config: DashboardSettings;
  stateStore: IoBrokerStateStore;
  client: IoBrokerClient;
  isActivePage?: boolean;
  isLayoutMode: boolean;
  onEditWidget: (widgetId: string) => void;
  onUpdateWidget: (widgetId: string, partial: Partial<WidgetConfig>) => void;
  onRemoveWidget: (widgetId: string) => void;
  onWriteState: (stateId: string, value: unknown) => void | Promise<void>;
  stateWrites?: Record<string, StateWriteFeedback>;
  onLayoutMeasured?: (width: number) => void;
  onCameraFullscreenSwipeClose?: () => void;
  onCameraFullscreenVisibilityChange?: (widgetId: string, open: boolean) => void;
  onDragAcrossPageEdge?: (direction: "left" | "right", widgetId: string, position: WidgetConfig["position"]) => void;
  onWidgetScrollFocusChange?: (widgetId: string, active: boolean) => void;
};

export function GridCanvas({
  config,
  stateStore,
  client,
  isActivePage = true,
  isLayoutMode,
  onEditWidget,
  onUpdateWidget,
  onRemoveWidget,
  onWriteState,
  stateWrites,
  onLayoutMeasured,
  onCameraFullscreenSwipeClose,
  onCameraFullscreenVisibilityChange,
  onDragAcrossPageEdge,
  onWidgetScrollFocusChange,
}: GridCanvasProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);
  const isCoarsePointerWeb =
    Platform.OS === "web" &&
    (((typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
      (typeof window !== "undefined" &&
        "matchMedia" in window &&
        window.matchMedia("(pointer: coarse)").matches)));
  const useLowPowerWebEffects = Platform.OS === "web" && isCoarsePointerWeb;
  const isPhoneLikeWeb = isCoarsePointerWeb && Math.max(windowWidth, windowHeight) < 1000;
  const isCompactViewport = windowWidth < 700 || isPhoneLikeWeb;
  const isCompactWeb = Platform.OS === "web" && isCompactViewport;
  const isTabletLikeWeb = Platform.OS === "web" && windowWidth >= 700 && windowWidth < 1100;
  const isPhoneSingleColumn = Platform.OS === "web" && isPhoneLikeWeb && Math.min(windowWidth, windowHeight) <= 500;
  const displayColumns = isPhoneSingleColumn ? 1 : isCompactViewport ? 3 : 9;
  const effectiveLayoutMode = isLayoutMode;
  const displayGap = Platform.OS === "web" && !isCompactWeb ? Math.max(config.grid.gap, 18) : config.grid.gap;
  const mainColumnExtraGap = Platform.OS === "web" && !isCompactWeb ? displayGap * 2 : 0;
  const renderConfig = useMemo(
    () => (isCompactViewport ? applyMobileOverridesToSettings(config) : config),
    [config, isCompactViewport]
  );
  const displayConfig = useMemo(
    () => {
      const next = buildResponsiveAutoLayoutConfig(renderConfig, displayColumns, {
        isTabletLikeWeb,
        stackPrimarySections: isCompactViewport,
        singleColumnSectionStack: isPhoneSingleColumn,
      });
      return {
        ...next,
        grid: {
          ...next.grid,
          gap: displayGap,
        },
      };
    },
    [displayColumns, displayGap, isCompactViewport, isPhoneSingleColumn, isTabletLikeWeb, renderConfig]
  );
  const useStructuredGridSizing = true;
  const canvasInset = Platform.OS === "web" ? (isPhoneSingleColumn ? 14 : 64) : 60;
  const availableWidth = containerWidth > 0 ? containerWidth : windowWidth;
  const canvasWidth = Math.max(320, availableWidth - canvasInset);
  const cellWidth = useMemo(() => {
    const totalGap = (displayConfig.grid.columns - 1) * displayConfig.grid.gap;
    const totalMainExtraGap = mainColumnExtraGap * 2;
    return (canvasWidth - totalGap - totalMainExtraGap) / displayConfig.grid.columns;
  }, [canvasWidth, displayConfig.grid.columns, displayConfig.grid.gap, mainColumnExtraGap]);
  const compactSizingCellWidth = useMemo(() => {
    if (!isPhoneSingleColumn) {
      return cellWidth;
    }
    const sizingColumns = 3;
    const sizingGap = (sizingColumns - 1) * displayConfig.grid.gap;
    return (canvasWidth - sizingGap) / sizingColumns;
  }, [canvasWidth, cellWidth, displayConfig.grid.gap, isPhoneSingleColumn]);
  const renderRowHeight = useStructuredGridSizing
    ? (isCompactViewport ? compactSizingCellWidth * 0.72 : cellWidth)
    : displayConfig.grid.rowHeight;

  const canvasHeight = useMemo(() => {
    const maxRow = displayConfig.widgets.reduce((largest, widget) => {
      const bottom = widget.position.y + widget.position.h;
      return Math.max(largest, bottom);
    }, 0);
    return maxRow * (renderRowHeight + displayConfig.grid.gap) + 120;
  }, [displayConfig.grid.gap, displayConfig.widgets, renderRowHeight]);

  useEffect(() => {
    if (!isCompactViewport || isPhoneSingleColumn) {
      return;
    }

    const sourceById = new Map(config.widgets.map((widget) => [widget.id, widget]));
    for (const displayWidget of displayConfig.widgets) {
      const sourceWidget = sourceById.get(displayWidget.id);
      if (!sourceWidget || sourceWidget.mobilePosition) {
        continue;
      }
      onUpdateWidget(displayWidget.id, { mobilePosition: displayWidget.position });
    }
  }, [config.widgets, displayConfig.widgets, isCompactViewport, isPhoneSingleColumn, onUpdateWidget]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setContainerWidth(nextWidth);
    onLayoutMeasured?.(nextWidth);
  };

  const content =
    Platform.OS === "web" && !isCompactViewport ? (
      <WebGridCanvas
        canvasHeight={canvasHeight}
        cellWidth={cellWidth}
        client={client}
        config={displayConfig}
        isActivePage={isActivePage}
        mainColumnExtraGap={mainColumnExtraGap}
        sourceColumns={config.grid.columns}
        rowHeight={renderRowHeight}
        theme={resolveThemeSettings(displayConfig.theme)}
        isLayoutMode={effectiveLayoutMode}
        onEditWidget={onEditWidget}
        onRemoveWidget={onRemoveWidget}
        onUpdateWidget={onUpdateWidget}
        onWriteState={onWriteState}
        onDragAcrossPageEdge={onDragAcrossPageEdge}
        onWidgetScrollFocusChange={onWidgetScrollFocusChange}
        lowPowerMode={useLowPowerWebEffects}
        stateWrites={stateWrites}
        stateStore={stateStore}
      />
    ) : (
      <View style={[styles.canvas, { height: canvasHeight }]}>
        {displayConfig.widgets.map((widget) => {
          const style = {
            left: displayOffset(widget.position.x, cellWidth, displayConfig.grid.gap, mainColumnExtraGap),
            top: widget.position.y * (renderRowHeight + displayConfig.grid.gap),
            width: displaySpan(widget.position.x, widget.position.w, cellWidth, displayConfig.grid.gap, mainColumnExtraGap),
            height: widget.position.h * renderRowHeight + (widget.position.h - 1) * displayConfig.grid.gap,
            zIndex: effectiveLayoutMode ? Math.max(1, 10000 - Math.round(widget.position.y * 10)) : 1,
          };

          return (
            <View key={widget.id} style={[styles.widget, style]}>
              <WidgetFrame
                cellWidth={cellWidth}
                columns={displayConfig.grid.columns}
                gap={displayConfig.grid.gap}
                isLayoutMode={effectiveLayoutMode}
                allowManualLayout={!isCompactViewport || Platform.OS === "web"}
                allowResize={
                  widget.type === "camera" ||
                  widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ||
                  widget.type === "solar" ||
                  widget.type === "log" ||
                  widget.type === "script" ||
                  widget.type === "host" ||
                  widget.type === "raspberryPiStats" ||
                  widget.type === "coco" ||
                  widget.type === "wallbox" ||
                  widget.type === "goe" ||
                  widget.type === "heating" ||
                  widget.type === "heatingV2" ||
                  (Platform.OS === "web" && (widget.type === "weather" || widget.type === "grafana"))
                }
                onCommitPosition={(widgetId, position) =>
                  onUpdateWidget(
                    widgetId,
                    buildPositionUpdatePayload(
                      widget,
                      widgetId,
                      position,
                      isCompactViewport,
                      displayConfig.grid.columns,
                      config.grid.columns,
                      config.widgets
                    )
                  )
                }
                onEdit={onEditWidget}
                onRemove={onRemoveWidget}
                rowHeight={renderRowHeight}
                widget={widget}
              >
                <ViewportConnectedWidget
                  widget={widget}
                  stateStore={stateStore}
                  client={client}
                  onUpdateWidget={onUpdateWidget}
                  onWriteState={onWriteState}
                  theme={displayConfig.theme}
                  stateWrites={stateWrites}
                  widgetTypeDefaults={displayConfig.uiSounds?.widgetTypeDefaults}
                  onCameraFullscreenSwipeClose={onCameraFullscreenSwipeClose}
                  onCameraFullscreenVisibilityChange={onCameraFullscreenVisibilityChange}
                  onWidgetScrollFocusChange={onWidgetScrollFocusChange}
                  isActivePage={isActivePage}
                  lowPowerMode={useLowPowerWebEffects}
                />
              </WidgetFrame>
            </View>
          );
        })}
      </View>
    );

  return (
    <View onLayout={handleLayout} style={styles.host}>
      {content}
    </View>
  );
}

function fineGridOffset(index: number, unitSize: number, gap: number) {
  const units = index * GRID_SNAP;
  const fullUnits = Math.floor(units);
  const halfUnit = units - fullUnits;
  return fullUnits * unitSize + Math.max(0, fullUnits - 1) * gap + halfUnit * unitSize;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildResponsiveAutoLayoutConfig(
  config: DashboardSettings,
  columns: number,
  options?: {
    isTabletLikeWeb?: boolean;
    stackPrimarySections?: boolean;
    singleColumnSectionStack?: boolean;
  }
): DashboardSettings {
  if (columns === 9) {
    return buildDesktopAutoLayoutConfig(config, options);
  }

  if (columns === 1 && options?.singleColumnSectionStack) {
    return buildSingleColumnSectionStackLayoutConfig(config, options);
  }

  if (columns === 3 && options?.stackPrimarySections) {
    return buildCompactStackedLayoutConfig(config, options);
  }

  const sortedWidgets = [...config.widgets].sort((a, b) => {
    if (a.position.y !== b.position.y) {
      return a.position.y - b.position.y;
    }
    if (a.position.x !== b.position.x) {
      return a.position.x - b.position.x;
    }
    return a.id.localeCompare(b.id);
  });

  const columnHeights = Array.from({ length: columns }, () => 0);
  const widgets = sortedWidgets.map((widget) => {
    const spec = getAutoLayoutSpec(widget, columns, options);
    const desiredStart = clamp(Math.round(widget.position.x), 0, Math.max(0, columns - spec.w));
    const desiredY = Math.max(0, widget.position.y);
    const bestStart = desiredStart;
    const bestY = Math.max(desiredY, ...columnHeights.slice(bestStart, bestStart + spec.w));
    const snappedBottom = ceilGridUnitForWidget(bestY + spec.h, widget.type);

    for (let index = bestStart; index < bestStart + spec.w; index += 1) {
      columnHeights[index] = snappedBottom;
    }

    return {
      ...widget,
      position: {
        x: bestStart,
        y: bestY,
        w: spec.w,
        h: spec.h,
      },
    };
  });

  return {
    ...config,
    grid: {
      ...config.grid,
      columns,
    },
    widgets,
  };
}

function buildSingleColumnSectionStackLayoutConfig(
  config: DashboardSettings,
  options?: {
    isTabletLikeWeb?: boolean;
  }
): DashboardSettings {
  const columns = 1;
  const sourceColumns = Math.max(1, config.grid.columns);
  const sectionCount = 3;
  const sectionSpacing = 0.8;
  const sortedWidgets = [...config.widgets].sort((a, b) => {
    if (a.position.y !== b.position.y) {
      return a.position.y - b.position.y;
    }
    if (a.position.x !== b.position.x) {
      return a.position.x - b.position.x;
    }
    return a.id.localeCompare(b.id);
  });
  const sectionBuckets = Array.from({ length: sectionCount }, () => [] as WidgetConfig[]);

  for (const widget of sortedWidgets) {
    const sectionIndex = getPreferredDesktopSection(widget, sourceColumns);
    sectionBuckets[sectionIndex].push(widget);
  }

  const widgets: WidgetConfig[] = [];
  let cursorY = 0;

  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
    const sectionWidgets = sectionBuckets[sectionIndex];
    if (sectionWidgets.length === 0) {
      continue;
    }

    if (widgets.length > 0) {
      cursorY = ceilGridUnit(cursorY + sectionSpacing);
    }

    for (const widget of sectionWidgets) {
      const spec = getAutoLayoutSpec(widget, columns, options);
      const top = cursorY;
      const bottom = ceilGridUnitForWidget(top + spec.h, widget.type);
      widgets.push({
        ...widget,
        position: {
          x: 0,
          y: top,
          w: 1,
          h: spec.h,
        },
      });
      cursorY = bottom;
    }
  }

  return {
    ...config,
    grid: {
      ...config.grid,
      columns,
    },
    widgets,
  };
}

function buildCompactStackedLayoutConfig(
  config: DashboardSettings,
  options?: {
    isTabletLikeWeb?: boolean;
  }
): DashboardSettings {
  const columns = 3;
  const sourceColumns = Math.max(1, config.grid.columns);
  const sectionCount = 3;
  const sectionSpacing = 0.5;
  const sortedWidgets = [...config.widgets].sort((a, b) => {
    const aSeed = a.mobilePosition || a.position;
    const bSeed = b.mobilePosition || b.position;
    if (aSeed.y !== bSeed.y) {
      return aSeed.y - bSeed.y;
    }
    if (aSeed.x !== bSeed.x) {
      return aSeed.x - bSeed.x;
    }
    return a.id.localeCompare(b.id);
  });

  const sectionMinY = Array.from({ length: sectionCount }, () => Number.POSITIVE_INFINITY);
  for (const widget of sortedWidgets) {
    const seed = widget.mobilePosition || widget.position;
    const sectionIndex = getPreferredDesktopSection(widget, sourceColumns);
    sectionMinY[sectionIndex] = Math.min(sectionMinY[sectionIndex], Math.max(0, seed.y));
  }
  for (let index = 0; index < sectionCount; index += 1) {
    if (!Number.isFinite(sectionMinY[index])) {
      sectionMinY[index] = 0;
    }
  }

  const sectionColumnHeights = Array.from({ length: sectionCount }, () =>
    Array.from({ length: columns }, () => 0)
  );
  const sectionBottoms = Array.from({ length: sectionCount }, () => 0);
  const widgetsWithSection = sortedWidgets.map((widget) => {
    const seed = widget.mobilePosition || widget.position;
    const mobileAwareWidget = widget.mobilePosition ? { ...widget, position: seed } : widget;
    const spec = getAutoLayoutSpec(mobileAwareWidget, columns, options);
    const sectionIndex = getPreferredDesktopSection(widget, sourceColumns);
    const sourceSectionWidth = sourceColumns / sectionCount;
    const sectionStart = sectionIndex * sourceSectionWidth;
    const normalizedLocalX = widget.mobilePosition
      ? (columns > 0 ? seed.x / columns : 0)
      : sourceSectionWidth > 0
        ? (seed.x - sectionStart) / sourceSectionWidth
        : 0;
    const desiredStart = spec.w >= columns
      ? 0
      : clamp(Math.round(normalizedLocalX * columns), 0, Math.max(0, columns - spec.w));
    const desiredY = Math.max(0, seed.y - sectionMinY[sectionIndex]);
    const sectionHeights = sectionColumnHeights[sectionIndex];
    const maxStart = Math.max(0, columns - spec.w);
    let bestStart = desiredStart;
    let bestY = Math.max(desiredY, ...sectionHeights.slice(desiredStart, desiredStart + spec.w));

    for (let start = 0; start <= maxStart; start += 1) {
      const candidateY = Math.max(desiredY, ...sectionHeights.slice(start, start + spec.w));
      if (
        candidateY < bestY ||
        (candidateY === bestY && Math.abs(start - desiredStart) < Math.abs(bestStart - desiredStart))
      ) {
        bestStart = start;
        bestY = candidateY;
      }
    }

    const snappedBottom = ceilGridUnitForWidget(bestY + spec.h, widget.type);

    for (let index = bestStart; index < bestStart + spec.w; index += 1) {
      sectionHeights[index] = snappedBottom;
    }

    sectionBottoms[sectionIndex] = Math.max(sectionBottoms[sectionIndex], snappedBottom);

    return {
      sectionIndex,
      widget: {
        ...widget,
        position: {
          x: bestStart,
          y: bestY,
          w: spec.w,
          h: spec.h,
        },
      },
    };
  });

  const sectionOffsets = Array.from({ length: sectionCount }, () => 0);
  let runningOffset = 0;
  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
    sectionOffsets[sectionIndex] = runningOffset;
    runningOffset += sectionBottoms[sectionIndex] + (sectionIndex < sectionCount - 1 ? sectionSpacing : 0);
  }

  return {
    ...config,
    grid: {
      ...config.grid,
      columns,
    },
    widgets: widgetsWithSection.map(({ sectionIndex, widget }) => ({
      ...widget,
      position: {
        ...widget.position,
        y: widget.position.y + sectionOffsets[sectionIndex],
      },
    })),
  };
}

function buildDesktopAutoLayoutConfig(
  config: DashboardSettings,
  options?: {
    isTabletLikeWeb?: boolean;
  }
): DashboardSettings {
  const sourceColumns = Math.max(1, config.grid.columns);
  const mainColumnWidth = 3;
  const subColumnHeights = Array.from({ length: 9 }, () => 0);
  const sortedWidgets = [...config.widgets].sort((a, b) => {
    if (a.position.y !== b.position.y) {
      return a.position.y - b.position.y;
    }
    if (a.position.x !== b.position.x) {
      return a.position.x - b.position.x;
    }
    return a.id.localeCompare(b.id);
  });

  const widgets = sortedWidgets.map((widget) => {
    const spec = getAutoLayoutSpec(widget, 9, options);
    const desiredY = Math.max(0, widget.position.y);

    if (spec.w === 1) {
      const preferredSection = getPreferredDesktopSection(widget, sourceColumns);
      const sectionStart = preferredSection * mainColumnWidth;
      const localHint = clamp(
        Math.round(widget.position.x - preferredSection * sourceColumns / 3),
        0,
        mainColumnWidth - 1
      );
      const bestLocal = localHint;
      const bestY = Math.max(desiredY, subColumnHeights[sectionStart + bestLocal]);
      const snappedBottom = ceilGridUnitForWidget(bestY + spec.h, widget.type);

      const targetIndex = sectionStart + bestLocal;
      subColumnHeights[targetIndex] = snappedBottom;

      return {
        ...widget,
        position: {
          x: targetIndex,
          y: bestY,
          w: 1,
          h: spec.h,
        },
      };
    }

    const sectionSpan = Math.max(1, Math.round(spec.w / mainColumnWidth));
    const maxStartSection = Math.max(0, 3 - sectionSpan);
    const preferredSection = clamp(getPreferredDesktopSection(widget, sourceColumns), 0, maxStartSection);
    const bestStartSection = preferredSection;

    const startIndex = bestStartSection * mainColumnWidth;
    const endIndex = startIndex + sectionSpan * mainColumnWidth;
    const bestY = Math.max(desiredY, ...subColumnHeights.slice(startIndex, endIndex));
    const snappedBottom = ceilGridUnitForWidget(bestY + spec.h, widget.type);
    for (let index = startIndex; index < endIndex; index += 1) {
      subColumnHeights[index] = snappedBottom;
    }

    return {
      ...widget,
      position: {
        x: startIndex,
        y: bestY,
        w: sectionSpan * mainColumnWidth,
        h: spec.h,
      },
    };
  });

  return {
    ...config,
    grid: {
      ...config.grid,
      columns: 9,
    },
    widgets,
  };
}

function getPreferredDesktopSection(widget: WidgetConfig, sourceColumns: number) {
  const sectionWidth = sourceColumns / 3;
  const center = widget.position.x + widget.position.w / 2;
  return clamp(Math.floor(center / Math.max(1, sectionWidth)), 0, 2);
}

function getAutoLayoutSpec(
  widget: WidgetConfig,
  columns: number,
  options?: {
    isTabletLikeWeb?: boolean;
    stackPrimarySections?: boolean;
  }
) {
  const fallbackHeight = widget.position.h;

  if (columns === 1) {
    switch (widget.type) {
      case "state":
        return { w: 1, h: 1 };
      case "camera":
      case "cameraTalk":
      case "cameraTalkReolink": {
        if (widget.manualHeightOverride) {
          return { w: 1, h: Math.max(0.5, roundCameraGridUnit(fallbackHeight)) };
        }
        const ratio = normalizeAspectRatio(widget.snapshotAspectRatio);
        // Keep camera height close to the former "one primary section" footprint
        // so previews remain clearly visible in the iPhone single-column stack.
        const referenceSectionWidthUnits = 3;
        return { w: 1, h: Math.max(0.5, roundCameraGridUnit(referenceSectionWidthUnits / ratio)) };
      }
      case "solar":
        if (widget.manualHeightOverride) {
          return { w: 1, h: Math.max(2.5, roundGridUnit(fallbackHeight)) };
        }
        return { w: 1, h: roundGridUnit(3.8) };
      case "grafana":
        if (widget.manualHeightOverride) {
          return { w: 1, h: Math.max(1, roundGridUnit(fallbackHeight)) };
        }
        return { w: 1, h: roundGridUnit(2.8) };
      case "weather":
        if (widget.manualHeightOverride) {
          return { w: 1, h: Math.max(1, roundGridUnit(fallbackHeight)) };
        }
        return { w: 1, h: roundGridUnit(1.8) };
      case "energy":
        return { w: 1, h: roundGridUnit(2) };
      case "numpad":
        return { w: 1, h: roundGridUnit(3) };
      case "link":
      case "netflix":
        return { w: 1, h: 1 };
      case "log":
        if (widget.manualHeightOverride) {
          return { w: 1, h: Math.max(1, roundGridUnit(fallbackHeight)) };
        }
        return { w: 1, h: roundGridUnit(2.4) };
      case "script":
        if (widget.manualHeightOverride) {
          return { w: 1, h: Math.max(1, roundGridUnit(fallbackHeight)) };
        }
        return { w: 1, h: roundGridUnit(2.6) };
      case "host":
      case "raspberryPiStats":
      case "coco":
        if (widget.manualHeightOverride) {
          return { w: 1, h: Math.max(1, roundGridUnit(fallbackHeight)) };
        }
        return { w: 1, h: roundGridUnit(2.8) };
      case "wallbox":
      case "goe":
        if (widget.manualHeightOverride) {
          return { w: 1, h: Math.max(1, roundGridUnit(fallbackHeight)) };
        }
        return { w: 1, h: roundGridUnit(3) };
      case "heating":
      case "heatingV2":
        if (widget.manualHeightOverride) {
          return { w: 1, h: Math.max(1, roundGridUnit(fallbackHeight)) };
        }
        return { w: 1, h: roundGridUnit(3.2) };
    }

    return { w: 1, h: Math.max(1.5, roundGridUnit(fallbackHeight)) };
  }

  const mainColumnWidth = 3;
  const wideWidgetWidth = Math.min(mainColumnWidth * 2, columns);

  switch (widget.type) {
    case "state":
      return { w: 1, h: 1 };
    case "camera":
    case "cameraTalk":
    case "cameraTalkReolink": {
      if (widget.manualHeightOverride) {
        return { w: mainColumnWidth, h: Math.max(0.5, roundCameraGridUnit(fallbackHeight)) };
      }
      const ratio = normalizeAspectRatio(widget.snapshotAspectRatio);
      return { w: mainColumnWidth, h: Math.max(0.5, roundCameraGridUnit(mainColumnWidth / ratio)) };
    }
    case "solar":
      if (widget.manualHeightOverride) {
        return { w: mainColumnWidth, h: Math.max(2.5, roundGridUnit(fallbackHeight)) };
      }
      // Keep solar height stable across breakpoints to avoid abrupt vertical jumps
      // while still leaving enough room for in-scene stat cards.
      return { w: mainColumnWidth, h: roundGridUnit(3.5) };
    case "grafana":
      if (widget.manualHeightOverride) {
        return { w: mainColumnWidth, h: Math.max(1, roundGridUnit(fallbackHeight)) };
      }
      return { w: mainColumnWidth, h: roundGridUnit(2.2) };
    case "weather":
      if (widget.manualHeightOverride) {
        return { w: mainColumnWidth, h: Math.max(1, roundGridUnit(fallbackHeight)) };
      }
      return { w: mainColumnWidth, h: roundGridUnit(2.2) };
    case "energy":
      return { w: mainColumnWidth, h: roundGridUnit(2.4) };
    case "numpad":
      return { w: mainColumnWidth, h: roundGridUnit(3.2) };
    case "link":
    case "netflix":
      return { w: 1, h: 1 };
    case "log":
      if (widget.manualHeightOverride) {
        return { w: mainColumnWidth, h: Math.max(1, roundGridUnit(fallbackHeight)) };
      }
      return { w: mainColumnWidth, h: roundGridUnit(2.4) };
    case "script":
      if (widget.manualHeightOverride) {
        return { w: mainColumnWidth, h: Math.max(1, roundGridUnit(fallbackHeight)) };
      }
      return { w: mainColumnWidth, h: roundGridUnit(2.6) };
    case "host":
    case "raspberryPiStats":
    case "coco":
      if (widget.manualHeightOverride) {
        return { w: mainColumnWidth, h: Math.max(1, roundGridUnit(fallbackHeight)) };
      }
      return { w: mainColumnWidth, h: roundGridUnit(2.8) };
    case "wallbox":
    case "goe":
      if (widget.manualHeightOverride) {
        return { w: mainColumnWidth, h: Math.max(1, roundGridUnit(fallbackHeight)) };
      }
      return { w: mainColumnWidth, h: roundGridUnit(3) };
    case "heating":
    case "heatingV2":
      if (widget.manualHeightOverride) {
        return { w: mainColumnWidth, h: Math.max(1, roundGridUnit(fallbackHeight)) };
      }
      return { w: mainColumnWidth, h: roundGridUnit(3.2) };
  }

  return { w: 1, h: Math.max(1, roundGridUnit(fallbackHeight)) };
}

function normalizeAspectRatio(value?: number) {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return 16 / 9;
  }
  return value;
}

function roundGridUnit(value: number) {
  return Math.round(value / GRID_SNAP) * GRID_SNAP;
}

function roundCameraGridUnit(value: number) {
  return Math.round(value / CAMERA_GRID_SNAP) * CAMERA_GRID_SNAP;
}

function ceilGridUnit(value: number) {
  return Math.ceil(value / GRID_SNAP) * GRID_SNAP;
}

function ceilGridUnitForWidget(value: number, widgetType: WidgetType) {
  if (widgetType === "camera" || widgetType === "cameraTalk" || widgetType === "cameraTalkReolink") {
    return Math.ceil(value / CAMERA_GRID_SNAP) * CAMERA_GRID_SNAP;
  }
  return ceilGridUnit(value);
}

function mapDisplayPositionToSourceHint(
  position: WidgetConfig["position"],
  displayColumns: number,
  sourceColumns: number,
  options?: {
    stackPrimarySections?: boolean;
    displayCurrent?: WidgetConfig["position"];
    sourceCurrent?: WidgetConfig["position"];
    widgetType?: WidgetType;
  }
) {
  if (options?.stackPrimarySections && options.displayCurrent && options.sourceCurrent) {
    const sourceSectionWidth = sourceColumns / 3;
    const sourceCurrent = options.sourceCurrent;
    const displayCurrent = options.displayCurrent;
    const sourceCenter = sourceCurrent.x + sourceCurrent.w / 2;
    const sectionIndex = clamp(Math.floor(sourceCenter / Math.max(1, sourceSectionWidth)), 0, 2);
    const localDisplayMax = Math.max(0, displayColumns - position.w);
    const sourceLocalMax = Math.max(0, sourceSectionWidth - sourceCurrent.w);
    const localRatio = localDisplayMax > 0 ? clamp(position.x / localDisplayMax, 0, 1) : 0;
    const mappedX = sectionIndex * sourceSectionWidth + sourceLocalMax * localRatio;
    const mappedY = Math.max(0, sourceCurrent.y + (position.y - displayCurrent.y));
    const minHeight =
      options.widgetType === "camera" || options.widgetType === "cameraTalk" || options.widgetType === "cameraTalkReolink"
        ? 0.5
        : options.widgetType === "solar"
          ? 2.5
          : 1;
    const mappedH = Math.max(minHeight, sourceCurrent.h + (position.h - displayCurrent.h));

    return {
      ...sourceCurrent,
      x: mappedX,
      y: mappedY,
      h: mappedH,
    };
  }

  if (displayColumns <= 1 || sourceColumns <= 1 || displayColumns === sourceColumns) {
    return position;
  }

  const sectionCount = 3;
  const displaySectionWidth = displayColumns / sectionCount;
  const sourceSectionWidth = sourceColumns / sectionCount;
  const center = position.x + position.w / 2;
  const sectionIndex = clamp(Math.floor(center / Math.max(1, displaySectionWidth)), 0, sectionCount - 1);
  const displaySectionStart = sectionIndex * displaySectionWidth;
  const localX = clamp(position.x - displaySectionStart, 0, Math.max(0, displaySectionWidth - 0.5));
  const mappedX = sectionIndex * sourceSectionWidth + (localX / Math.max(1, displaySectionWidth)) * sourceSectionWidth;

  return {
    ...position,
    x: mappedX,
  };
}

function displayOffset(x: number, cellWidth: number, gap: number, mainColumnExtraGap: number) {
  const fullUnits = Math.floor(x);
  const partial = x - fullUnits;
  let offset = fullUnits * cellWidth + Math.max(0, fullUnits) * gap;

  if (mainColumnExtraGap > 0) {
    if (x >= 3) {
      offset += mainColumnExtraGap;
    }
    if (x >= 6) {
      offset += mainColumnExtraGap;
    }
  }

  return offset + partial * (cellWidth + gap);
}

function displaySpan(x: number, w: number, cellWidth: number, gap: number, mainColumnExtraGap: number) {
  const baseWidth = w * cellWidth + Math.max(0, w - 1) * gap;
  if (mainColumnExtraGap <= 0) {
    return baseWidth;
  }

  const startBoundary = x;
  const endBoundary = x + w;
  let extraInside = 0;

  for (const boundary of [3, 6]) {
    if (boundary > startBoundary && boundary < endBoundary) {
      extraInside += mainColumnExtraGap;
    }
  }

  return Math.max(cellWidth, baseWidth + extraInside);
}

function WebGridCanvas({
  config,
  isActivePage,
  mainColumnExtraGap,
  lowPowerMode,
  sourceColumns,
  theme,
  stateStore,
  client,
  cellWidth,
  canvasHeight,
  rowHeight,
  isLayoutMode,
  onEditWidget,
  onUpdateWidget,
  onRemoveWidget,
  onWriteState,
  onDragAcrossPageEdge,
  onWidgetScrollFocusChange,
  stateWrites,
}: {
  config: DashboardSettings;
  isActivePage: boolean;
  mainColumnExtraGap: number;
  lowPowerMode: boolean;
  sourceColumns: number;
  theme: ReturnType<typeof resolveThemeSettings>;
  stateStore: IoBrokerStateStore;
  client: IoBrokerClient;
  cellWidth: number;
  canvasHeight: number;
  rowHeight: number;
  isLayoutMode: boolean;
  onEditWidget: (widgetId: string) => void;
  onUpdateWidget: (widgetId: string, partial: Partial<WidgetConfig>) => void;
  onRemoveWidget: (widgetId: string) => void;
  onWriteState: (stateId: string, value: unknown) => void | Promise<void>;
  onDragAcrossPageEdge?: (direction: "left" | "right", widgetId: string, position: WidgetConfig["position"]) => void;
  onWidgetScrollFocusChange?: (widgetId: string, active: boolean) => void;
  stateWrites?: Record<string, StateWriteFeedback>;
}) {
  const stepX = cellWidth + config.grid.gap;
  const stepY = rowHeight + config.grid.gap;

  return (
    <div style={{ ...webCanvasStyle, height: canvasHeight }}>
      {config.widgets.map((widget) => (
        <MemoizedWebWidgetShell
          key={widget.id}
          cellWidth={cellWidth}
          client={client}
          config={config}
          isActivePage={isActivePage}
          rowHeight={rowHeight}
          theme={theme}
          isLayoutMode={isLayoutMode}
          onEditWidget={onEditWidget}
          onRemoveWidget={onRemoveWidget}
          onUpdateWidget={onUpdateWidget}
          onWriteState={onWriteState}
          onDragAcrossPageEdge={onDragAcrossPageEdge}
          onWidgetScrollFocusChange={onWidgetScrollFocusChange}
          stateWrites={stateWrites}
          allowManualLayout={true}
          allowResize={
            widget.type === "camera" ||
            widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ||
            widget.type === "solar" ||
            widget.type === "grafana" ||
            widget.type === "log" ||
            widget.type === "script" ||
            widget.type === "host" ||
            widget.type === "raspberryPiStats" ||
            widget.type === "coco" ||
            widget.type === "wallbox" ||
            widget.type === "goe" ||
            widget.type === "heating" ||
            widget.type === "heatingV2"
          }
          lowPowerMode={lowPowerMode}
          mainColumnExtraGap={mainColumnExtraGap}
          sourceColumns={sourceColumns}
          stateStore={stateStore}
          stepX={stepX}
          stepY={stepY}
          widget={widget}
        />
      ))}
    </div>
  );
}

function WebWidgetShell({
  widget,
  config,
  isActivePage,
  rowHeight,
  theme,
  stateStore,
  client,
  stepX,
  stepY,
  cellWidth,
  isLayoutMode,
  onEditWidget,
  onUpdateWidget,
  onRemoveWidget,
  onWriteState,
  onDragAcrossPageEdge,
  onWidgetScrollFocusChange,
  stateWrites,
  allowManualLayout = true,
  allowResize = true,
  lowPowerMode,
  mainColumnExtraGap,
  sourceColumns,
}: {
  widget: WidgetConfig;
  config: DashboardSettings;
  isActivePage: boolean;
  rowHeight: number;
  theme: ReturnType<typeof resolveThemeSettings>;
  stateStore: IoBrokerStateStore;
  client: IoBrokerClient;
  stepX: number;
  stepY: number;
  cellWidth: number;
  isLayoutMode: boolean;
  onEditWidget: (widgetId: string) => void;
  onUpdateWidget: (widgetId: string, partial: Partial<WidgetConfig>) => void;
  onRemoveWidget: (widgetId: string) => void;
  onWriteState: (stateId: string, value: unknown) => void | Promise<void>;
  onDragAcrossPageEdge?: (direction: "left" | "right", widgetId: string, position: WidgetConfig["position"]) => void;
  onWidgetScrollFocusChange?: (widgetId: string, active: boolean) => void;
  stateWrites?: Record<string, StateWriteFeedback>;
  allowManualLayout?: boolean;
  allowResize?: boolean;
  lowPowerMode: boolean;
  mainColumnExtraGap: number;
  sourceColumns: number;
}) {
  const [preview, setPreview] = useState(widget.position);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [isInViewport, setIsInViewport] = useState(true);
  const linkBorderless =
    (widget.type === "link" || widget.type === "netflix") &&
    Boolean(widget.iconImage) &&
    widget.iconImageSizeMode === "maximized" &&
    widget.iconImageBorderless === true;
  const showHeaderTitle =
    widget.type !== "camera" &&
    widget.type !== "cameraTalk" && widget.type !== "cameraTalkReolink" &&
    widget.type !== "wallbox" &&
    widget.type !== "goe" &&
    widget.type !== "coco" &&
    widget.type !== "heating" &&
    widget.type !== "heatingV2" &&
    widget.showTitle !== false &&
    Boolean(widget.title.trim());
  const interaction = useRef<{
    mode: "drag" | "resize";
    startX: number;
    startY: number;
    startPosition: WidgetConfig["position"];
  } | null>(null);
  const edgeDirectionRef = useRef<"left" | "right" | null>(null);
  const scrollBlockCleanupRef = useRef<(() => void) | null>(null);

  const releaseScrollBlock = () => {
    if (!scrollBlockCleanupRef.current) {
      return;
    }
    scrollBlockCleanupRef.current();
    scrollBlockCleanupRef.current = null;
  };

  const engageScrollBlock = () => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    if (scrollBlockCleanupRef.current) {
      return;
    }

    const body = document.body;
    const html = document.documentElement;
    const prevBodyTouchAction = body.style.touchAction;
    const prevBodyOverscroll = body.style.overscrollBehavior;
    const prevHtmlTouchAction = html.style.touchAction;
    const prevHtmlOverscroll = html.style.overscrollBehavior;

    body.style.touchAction = "none";
    body.style.overscrollBehavior = "none";
    html.style.touchAction = "none";
    html.style.overscrollBehavior = "none";

    const preventTouchMove = (event: TouchEvent) => {
      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation();
    };
    const preventWheel = (event: WheelEvent) => {
      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation();
    };

    window.addEventListener("touchmove", preventTouchMove, { capture: true, passive: false });
    window.addEventListener("wheel", preventWheel, { capture: true, passive: false });

    scrollBlockCleanupRef.current = () => {
      window.removeEventListener("touchmove", preventTouchMove, true);
      window.removeEventListener("wheel", preventWheel, true);
      body.style.touchAction = prevBodyTouchAction;
      body.style.overscrollBehavior = prevBodyOverscroll;
      html.style.touchAction = prevHtmlTouchAction;
      html.style.overscrollBehavior = prevHtmlOverscroll;
    };
  };

  useEffect(() => {
    setPreview(widget.position);
  }, [widget.position]);

  useEffect(() => {
    if (isLayoutMode || typeof window === "undefined") {
      setIsInViewport(true);
      return;
    }

    const node = shellRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setIsInViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        setIsInViewport(entry.isIntersecting || entry.intersectionRatio > 0);
      },
      {
        root: null,
        rootMargin: "260px 0px",
        threshold: 0.01,
      }
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [isLayoutMode, widget.id]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const active = interaction.current;
      if (!active) {
        return;
      }

      const dx = snapUnits((event.clientX - active.startX) / stepX);
      const dy = snapUnits(
        (event.clientY - active.startY) / stepY,
        active.mode === "resize" &&
        (widget.type === "camera" ||
          widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ||
          widget.type === "solar" ||
          widget.type === "grafana" ||
          widget.type === "log" ||
          widget.type === "script" ||
          widget.type === "host" ||
          widget.type === "raspberryPiStats" ||
          widget.type === "coco" ||
          widget.type === "wallbox" ||
          widget.type === "goe" ||
          widget.type === "heating" ||
          widget.type === "heatingV2")
          ? CAMERA_GRID_SNAP
          : GRID_VERTICAL_SNAP
      );

      if (!allowManualLayout) {
        return;
      }

      if (active.mode === "drag") {
        const nextPreview = constrainToPrimarySections({
          ...active.startPosition,
          x: clamp(active.startPosition.x + dx, 0, config.grid.columns - active.startPosition.w),
          y: Math.max(0, active.startPosition.y + dy),
        }, config.grid.columns, widget.type === "camera" || widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? { minHeight: 0.5, heightSnap: 0.1 } : widget.type === "solar" ? { minHeight: 2.5, heightSnap: 0.1 } : widget.type === "grafana" || widget.type === "log" || widget.type === "script" || widget.type === "host" || widget.type === "raspberryPiStats" || widget.type === "coco" || widget.type === "wallbox" || widget.type === "goe" || widget.type === "heating" || widget.type === "heatingV2" ? { minHeight: 1, heightSnap: 0.1 } : undefined);
        setPreview(nextPreview);

        if (isLayoutMode && onDragAcrossPageEdge) {
          const edgeThresholdPx = 72;
          const nextDirection =
            event.clientX <= edgeThresholdPx
              ? "left"
              : event.clientX >= window.innerWidth - edgeThresholdPx
                ? "right"
                : null;

          if (!nextDirection) {
            edgeDirectionRef.current = null;
          } else if (edgeDirectionRef.current !== nextDirection) {
            edgeDirectionRef.current = nextDirection;
            onDragAcrossPageEdge(
              nextDirection,
              widget.id,
              mapDisplayPositionToSourceHint(nextPreview, config.grid.columns, sourceColumns)
            );
          }
        }
      } else {
        if (
          widget.type === "camera" ||
          widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ||
          widget.type === "solar" ||
          widget.type === "grafana" ||
          widget.type === "log" ||
          widget.type === "script" ||
          widget.type === "host" ||
          widget.type === "raspberryPiStats" ||
          widget.type === "coco" ||
          widget.type === "wallbox" ||
          widget.type === "goe" ||
          widget.type === "heating" ||
          widget.type === "heatingV2"
        ) {
          const minHeight = widget.type === "camera" || widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? 0.5 : widget.type === "solar" ? 2.5 : 1;
          setPreview(constrainToPrimarySections({
            ...active.startPosition,
            w: active.startPosition.w,
            h: Math.max(minHeight, active.startPosition.h + dy),
          }, config.grid.columns, { minHeight, heightSnap: 0.1 }));
        } else {
          setPreview(constrainToPrimarySections({
            ...active.startPosition,
            w: clamp(active.startPosition.w + dx, 1, config.grid.columns),
            h: Math.max(1, active.startPosition.h + dy),
          }, config.grid.columns));
        }
      }
    };

    const handleUp = () => {
      const active = interaction.current;
      if (!active) {
        return;
      }
      interaction.current = null;
      releaseScrollBlock();
      edgeDirectionRef.current = null;
      if (allowManualLayout) {
        onUpdateWidget(widget.id, {
          position: mapDisplayPositionToSourceHint(preview, config.grid.columns, sourceColumns),
          ...(active.mode === "resize" && supportsManualHeightOverride(widget.type)
            ? { manualHeightOverride: true }
            : null),
        });
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      releaseScrollBlock();
    };
  }, [allowManualLayout, config.grid.columns, isLayoutMode, onDragAcrossPageEdge, onUpdateWidget, preview, sourceColumns, stepX, stepY, widget.id, widget.type]);

  const begin =
    (mode: "drag" | "resize") =>
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      interaction.current = {
        mode,
        startX: event.clientX,
        startY: event.clientY,
        startPosition: preview,
      };
      engageScrollBlock();
      edgeDirectionRef.current = null;
    };

  const shellStyle: CSSProperties = {
    ...webWidgetStyle,
    ...getWidgetTone(widget, theme),
    ...(lowPowerMode
      ? {
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
          boxShadow: "none",
        }
      : null),
    ...(widget.type === "camera" || widget.type === "cameraTalk" || widget.type === "cameraTalkReolink"
      ? {
          border: "none",
          background: "#000000",
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
          contain: "layout paint style",
          isolation: "isolate",
        }
      : null),
    ...(widget.type === "grafana"
      ? {
          border: "none",
          background: "transparent",
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
          boxShadow: "none",
          contain: "layout paint style",
          isolation: "isolate",
        }
      : null),
    ...(linkBorderless
      ? {
          border: "none",
          background: "transparent",
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
          boxShadow: "none",
          contain: "layout paint style",
          isolation: "isolate",
        }
      : null),
    left: displayOffset(preview.x, cellWidth, config.grid.gap, mainColumnExtraGap),
    top: preview.y * stepY,
    width: displaySpan(preview.x, preview.w, cellWidth, config.grid.gap, mainColumnExtraGap),
    height: preview.h * rowHeight + (preview.h - 1) * config.grid.gap,
    boxShadow: isLayoutMode ? "inset 0 0 0 1px rgba(77, 226, 177, 0.22)" : undefined,
  };

  const contentStyle = [
    styles.webContent,
    widget.type === "camera" || widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" || widget.type === "grafana" || linkBorderless ? styles.webContentBleed : null,
    widget.type !== "camera" &&
    widget.type !== "cameraTalk" && widget.type !== "cameraTalkReolink" &&
    widget.type !== "solar" &&
    widget.type !== "state" &&
    widget.type !== "wallbox" &&
    widget.type !== "goe" &&
    widget.type !== "coco" &&
    widget.type !== "heating" &&
    widget.type !== "heatingV2" &&
    widget.type !== "numpad" &&
    widget.type !== "grafana" &&
    !linkBorderless
      ? styles.webContentInset
      : null,
    widget.type === "grafana" ? styles.webContentGrafana : null,
  ];
  const dragSurfaceStyle = allowResize ? webWidgetDragSurfaceWithCornerReserveStyle : webWidgetDragSurfaceStyle;
  const shouldRenderWidgetContent = isLayoutMode || isInViewport;
  const widgetRuntimeActive = isActivePage && (isLayoutMode || isInViewport);

  return (
    <div ref={shellRef} style={shellStyle}>
      {isLayoutMode && allowManualLayout ? (
        <div
          onPointerDown={begin("drag")}
          onTouchMove={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onTouchStart={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          style={dragSurfaceStyle}
        />
      ) : null}
      {showHeaderTitle ? (
        <div style={webTitleBadgeStyle}>
          <div style={{ ...webTitleStyle, color: widget.appearance?.textColor || palette.text }}>{widget.title}</div>
        </div>
      ) : null}
      {isLayoutMode ? (
        <div style={webControlsStyle}>
          <button
            onClick={() => {
              playConfiguredUiSound(config.uiSounds?.pageSounds?.widgetEdit, "panel", `widget-edit:${widget.id}`);
              onEditWidget(widget.id);
            }}
            style={webIconButtonStyle}
            type="button"
          >
            ⋯
          </button>
          <button onClick={() => onRemoveWidget(widget.id)} style={webIconButtonStyle} type="button">
            ×
          </button>
        </div>
      ) : null}
      <View style={contentStyle}>
        {shouldRenderWidgetContent ? (
          <ConnectedWidget
            widget={widget}
            stateStore={stateStore}
            client={client}
            onUpdateWidget={onUpdateWidget}
            onWriteState={onWriteState}
            theme={config.theme}
            stateWrites={stateWrites}
            widgetTypeDefaults={config.uiSounds?.widgetTypeDefaults}
            onWidgetScrollFocusChange={onWidgetScrollFocusChange}
            isActivePage={widgetRuntimeActive}
            lowPowerMode={lowPowerMode}
          />
        ) : null}
      </View>
      {isLayoutMode && allowManualLayout && allowResize ? (
        <div style={webFooterOverlayStyle}>
          <div
            onPointerDown={begin("resize")}
            onTouchMove={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            style={webResizeHitAreaStyle}
            title="Skalieren"
          >
            <div style={webResizeHandleStyle} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

const MemoizedWebWidgetShell = memo(WebWidgetShell, (previous, next) =>
  previous.widget === next.widget &&
  previous.config.grid === next.config.grid &&
  previous.config.theme === next.config.theme &&
  previous.config.uiSounds === next.config.uiSounds &&
  previous.isActivePage === next.isActivePage &&
  previous.rowHeight === next.rowHeight &&
  previous.cellWidth === next.cellWidth &&
  previous.isLayoutMode === next.isLayoutMode &&
  previous.lowPowerMode === next.lowPowerMode &&
  previous.mainColumnExtraGap === next.mainColumnExtraGap &&
  previous.sourceColumns === next.sourceColumns &&
  previous.stepX === next.stepX &&
  previous.stepY === next.stepY &&
  previous.stateStore === next.stateStore &&
  previous.stateWrites === next.stateWrites
);

type ConnectedWidgetProps = {
  widget: WidgetConfig;
  stateStore: IoBrokerStateStore;
  client: IoBrokerClient;
  onUpdateWidget: (widgetId: string, partial: Partial<WidgetConfig>) => void;
  onWriteState: (stateId: string, value: unknown) => void | Promise<void>;
  theme?: DashboardSettings["theme"];
  stateWrites?: Record<string, StateWriteFeedback>;
  widgetTypeDefaults?: Partial<Record<WidgetType, WidgetInteractionSounds>>;
  onCameraFullscreenSwipeClose?: () => void;
  onCameraFullscreenVisibilityChange?: (widgetId: string, open: boolean) => void;
  onWidgetScrollFocusChange?: (widgetId: string, active: boolean) => void;
  isActivePage: boolean;
  lowPowerMode: boolean;
};

const ConnectedWidget = memo(function ConnectedWidget({
  widget,
  stateStore,
  client,
  onUpdateWidget,
  onWriteState,
  theme,
  stateWrites,
  widgetTypeDefaults,
  onCameraFullscreenSwipeClose,
  onCameraFullscreenVisibilityChange,
  onWidgetScrollFocusChange,
  isActivePage,
  lowPowerMode,
}: ConnectedWidgetProps) {
  const states = useWidgetIoBrokerStates(stateStore, widget);
  return renderWidget(
    widget,
    states,
    client,
    onUpdateWidget,
    onWriteState,
    theme,
    stateWrites,
    widgetTypeDefaults,
    onCameraFullscreenSwipeClose,
    onCameraFullscreenVisibilityChange,
    onWidgetScrollFocusChange,
    isActivePage,
    lowPowerMode
  );
}, (previous, next) =>
  previous.widget === next.widget &&
  previous.stateStore === next.stateStore &&
  previous.client === next.client &&
  previous.theme === next.theme &&
  previous.stateWrites === next.stateWrites &&
  previous.widgetTypeDefaults === next.widgetTypeDefaults &&
  previous.isActivePage === next.isActivePage &&
  previous.lowPowerMode === next.lowPowerMode
);

function ViewportConnectedWidget(props: ConnectedWidgetProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [isInViewport, setIsInViewport] = useState(true);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof IntersectionObserver === "undefined") {
      setIsInViewport(true);
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setIsInViewport(Boolean(entry?.isIntersecting || entry?.intersectionRatio)),
      { rootMargin: "240px 0px", threshold: 0.01 }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [props.widget.id]);

  if (Platform.OS !== "web") {
    return <ConnectedWidget {...props} />;
  }

  return createElement(
    "div",
    { ref: hostRef, style: viewportWidgetHostStyle },
    isInViewport ? <ConnectedWidget {...props} isActivePage={props.isActivePage && isInViewport} /> : null
  );
}

function renderWidget(
  widget: WidgetConfig,
  states: StateSnapshot,
  client: IoBrokerClient,
  onUpdateWidget: (widgetId: string, partial: Partial<WidgetConfig>) => void,
  onWriteState: (stateId: string, value: unknown) => void | Promise<void>,
  theme?: DashboardSettings["theme"],
  stateWrites?: Record<string, StateWriteFeedback>,
  widgetTypeDefaults?: Partial<Record<WidgetType, WidgetInteractionSounds>>,
  onCameraFullscreenSwipeClose?: () => void,
  onCameraFullscreenVisibilityChange?: (widgetId: string, open: boolean) => void,
  onWidgetScrollFocusChange?: (widgetId: string, active: boolean) => void,
  isActivePage: boolean = true,
  lowPowerMode: boolean = false
) {
  const effectiveWidget = mergeWidgetInteractionSounds(widget, widgetTypeDefaults?.[widget.type]);

  if (effectiveWidget.type === "state") {
    return (
      <StateWidget
        addonValue={effectiveWidget.addonStateId ? states[effectiveWidget.addonStateId] : undefined}
        config={effectiveWidget}
        interactionState={stateWrites?.[effectiveWidget.stateId]?.status || "idle"}
        value={states[effectiveWidget.stateId]}
        onToggle={() =>
          onWriteState(
            effectiveWidget.stateId,
            resolveStateNextValue(effectiveWidget, states[effectiveWidget.stateId])
          )
        }
      />
    );
  }

  if (effectiveWidget.type === "camera") {
    return (
      <Suspense fallback={<View style={styles.lazyWidgetFallback} />}>
      <LazyCameraWidget
        config={effectiveWidget}
        isActivePage={isActivePage}
        maximizeStateValue={effectiveWidget.maximizeStateId ? states[effectiveWidget.maximizeStateId] : undefined}
        onFullscreenSwipeClose={onCameraFullscreenSwipeClose}
        onFullscreenVisibilityChange={(open) => onCameraFullscreenVisibilityChange?.(effectiveWidget.id, open)}
        onAspectRatioDetected={(ratio) => {
          if (effectiveWidget.manualHeightOverride) {
            return;
          }
          if (!Number.isFinite(ratio) || ratio <= 0) {
            return;
          }

          const currentRatio = normalizeAspectRatio(effectiveWidget.snapshotAspectRatio);
          if (Math.abs(currentRatio - ratio) < 0.02) {
            return;
          }

          onUpdateWidget(effectiveWidget.id, { snapshotAspectRatio: ratio });
        }}
      />
      </Suspense>
    );
  }

  if (effectiveWidget.type === "cameraTalk" || effectiveWidget.type === "cameraTalkReolink") {
    return (
      <Suspense fallback={<View style={styles.lazyWidgetFallback} />}>
      <LazyCameraTalkWidget
        config={effectiveWidget}
        isActivePage={isActivePage}
        maximizeStateValue={effectiveWidget.maximizeStateId ? states[effectiveWidget.maximizeStateId] : undefined}
        onFullscreenSwipeClose={onCameraFullscreenSwipeClose}
        onFullscreenVisibilityChange={(open) => onCameraFullscreenVisibilityChange?.(effectiveWidget.id, open)}
        onAspectRatioDetected={(ratio) => {
          if (effectiveWidget.manualHeightOverride) {
            return;
          }
          if (!Number.isFinite(ratio) || ratio <= 0) {
            return;
          }

          const currentRatio = normalizeAspectRatio(effectiveWidget.snapshotAspectRatio);
          if (Math.abs(currentRatio - ratio) < 0.02) {
            return;
          }

          onUpdateWidget(effectiveWidget.id, { snapshotAspectRatio: ratio });
        }}
      />
      </Suspense>
    );
  }

  if (effectiveWidget.type === "energy") {
    return <EnergyWidget config={effectiveWidget} states={states} />;
  }

  if (effectiveWidget.type === "solar") {
    return <SolarWidget config={effectiveWidget} isActivePage={isActivePage} lowPowerMode={lowPowerMode} states={states} theme={theme} />;
  }

  if (effectiveWidget.type === "grafana") {
    return (
      <Suspense fallback={<View style={styles.lazyWidgetFallback} />}>
        <LazyGrafanaWidget config={effectiveWidget} isActivePage={isActivePage} lowPowerMode={lowPowerMode} />
      </Suspense>
    );
  }

  if (effectiveWidget.type === "weather") {
    return <WeatherWidget config={effectiveWidget} isActivePage={isActivePage} />;
  }

  if (effectiveWidget.type === "numpad") {
    return <NumpadWidget config={effectiveWidget} />;
  }

  if (effectiveWidget.type === "link" || effectiveWidget.type === "netflix") {
    return <LinkWidget config={effectiveWidget} />;
  }

  if (effectiveWidget.type === "log") {
    return (
      <LogWidget
        client={client}
        config={effectiveWidget}
        isActivePage={isActivePage}
        onScrollModeChange={(active) => onWidgetScrollFocusChange?.(effectiveWidget.id, active)}
        notificationsEnabled={isActivePage}
      />
    );
  }

  if (effectiveWidget.type === "script") {
    return (
      <ScriptWidget
        client={client}
        config={effectiveWidget}
        isActivePage={isActivePage}
        onScrollModeChange={(active) => onWidgetScrollFocusChange?.(effectiveWidget.id, active)}
      />
    );
  }

  if (effectiveWidget.type === "host") {
    return <HostStatsWidget client={client} config={effectiveWidget} isActivePage={isActivePage} />;
  }

  if (effectiveWidget.type === "raspberryPiStats") {
    return <RaspberryPiStatsWidget config={effectiveWidget} states={states} />;
  }

  if (effectiveWidget.type === "coco") {
    return (
      <Suspense fallback={<View style={styles.lazyWidgetFallback} />}>
        <LazyCocoWidget client={client} config={effectiveWidget} isActivePage={isActivePage} states={states} />
      </Suspense>
    );
  }

  if (effectiveWidget.type === "wallbox" || effectiveWidget.type === "goe") {
    return <WallboxWidget client={client} config={effectiveWidget} isActivePage={isActivePage} lowPowerMode={lowPowerMode} states={states} />;
  }

  if (effectiveWidget.type === "heating") {
    return <HeatingWidget client={client} config={effectiveWidget} isActivePage={isActivePage} lowPowerMode={lowPowerMode} states={states} />;
  }

  if (effectiveWidget.type === "heatingV2") {
    return <HeatingWidgetV2 client={client} config={effectiveWidget} isActivePage={isActivePage} lowPowerMode={lowPowerMode} states={states} />;
  }

  return null;
}

function buildPositionUpdatePayload(
  widget: WidgetConfig,
  widgetId: string,
  position: WidgetConfig["position"],
  isCompactViewport: boolean,
  displayColumns: number,
  sourceColumns: number,
  sourceWidgets: WidgetConfig[]
): Partial<WidgetConfig> {
  if (isCompactViewport) {
    return { mobilePosition: position };
  }

  const sourceCurrent = sourceWidgets.find((entry) => entry.id === widgetId)?.position;
  const mappedPosition = mapDisplayPositionToSourceHint(position, displayColumns, sourceColumns, {
    stackPrimarySections: isCompactViewport,
    displayCurrent: widget.position,
    sourceCurrent,
    widgetType: widget.type,
  });
  const heightChanged = Math.abs((sourceCurrent?.h ?? widget.position.h) - mappedPosition.h) > 0.01;

  return {
    position: mappedPosition,
    ...(heightChanged && supportsManualHeightOverride(widget.type) ? { manualHeightOverride: true } : null),
  } as Partial<WidgetConfig>;
}

function supportsManualHeightOverride(type: WidgetType) {
  return (
    type === "camera" ||
    type === "cameraTalk" ||
    type === "cameraTalkReolink" ||
    type === "solar" ||
    type === "grafana" ||
    type === "weather" ||
    type === "log" ||
    type === "script" ||
    type === "host" ||
    type === "raspberryPiStats" ||
    type === "coco" ||
    type === "wallbox" ||
    type === "goe" ||
    type === "heating" ||
    type === "heatingV2"
  );
}

const styles = StyleSheet.create({
  host: {
    width: "100%",
  },
  canvas: {
    position: "relative",
    margin: 20,
    borderRadius: 0,
    padding: 10,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
  },
  gridLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  gridRowLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  widget: {
    position: "absolute",
  },
  webContent: {
    flex: 1,
    minHeight: 0,
  },
  webContentInset: {
    padding: 16,
  },
  webContentGrafana: {
    paddingTop: 10,
  },
  webContentBleed: {
    width: "100%",
    height: "100%",
  },
  lazyWidgetFallback: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
});

function mergeWidgetInteractionSounds(
  widget: WidgetConfig,
  defaults?: WidgetInteractionSounds
): WidgetConfig {
  if (!defaults) {
    return widget;
  }

  return {
    ...widget,
    interactionSounds: {
      press: widget.interactionSounds?.press?.length ? widget.interactionSounds.press : defaults.press,
      confirm: widget.interactionSounds?.confirm?.length ? widget.interactionSounds.confirm : defaults.confirm,
      slider: widget.interactionSounds?.slider?.length ? widget.interactionSounds.slider : defaults.slider,
      open: widget.interactionSounds?.open?.length ? widget.interactionSounds.open : defaults.open,
      close: widget.interactionSounds?.close?.length ? widget.interactionSounds.close : defaults.close,
      scroll: widget.interactionSounds?.scroll?.length ? widget.interactionSounds.scroll : defaults.scroll,
      notify: widget.interactionSounds?.notify?.length ? widget.interactionSounds.notify : defaults.notify,
      notifyWarn: widget.interactionSounds?.notifyWarn?.length ? widget.interactionSounds.notifyWarn : defaults.notifyWarn,
      notifyError: widget.interactionSounds?.notifyError?.length ? widget.interactionSounds.notifyError : defaults.notifyError,
    },
  } as WidgetConfig;
}

function snapUnits(value: number, step: number = GRID_SNAP) {
  return Math.round(value / step) * step;
}

const webCanvasStyle: CSSProperties = {
  position: "relative",
  margin: 20,
  borderRadius: 0,
  padding: 12,
  background: "transparent",
  border: "none",
  overflow: "visible",
};

const viewportWidgetHostStyle: CSSProperties = {
  width: "100%",
  height: "100%",
};

const webVerticalLineStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  width: 1,
  background: "rgba(255,255,255,0.05)",
  pointerEvents: "none",
};

const webHorizontalLineStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  height: 1,
  background: "rgba(255,255,255,0.03)",
  pointerEvents: "none",
};

const webWidgetStyle: CSSProperties = {
  position: "absolute",
  display: "flex",
  flexDirection: "column",
  fontFamily: "Arial, sans-serif",
  borderRadius: 22,
  background: "linear-gradient(180deg, rgba(29,35,55,0.94), rgba(20,24,40,0.96))",
  border: "none",
  boxSizing: "border-box",
  overflow: "hidden",
  boxShadow: "none",
  backdropFilter: "blur(12px)",
};

const webTitleStyle: CSSProperties = {
  color: palette.text,
  fontSize: 15,
  fontWeight: 700,
};

const webControlsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  position: "absolute",
  top: 12,
  right: 12,
  zIndex: 4,
};

const webIconButtonStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 16,
  border: "1px solid transparent",
  background: "rgba(255,255,255,0.04)",
  color: palette.textMuted,
  cursor: "pointer",
  fontSize: 20,
  lineHeight: "28px",
  fontWeight: 700,
};

const webTitleBadgeStyle: CSSProperties = {
  position: "absolute",
  top: 12,
  left: 12,
  maxWidth: "74%",
  padding: "8px 10px",
  borderRadius: 12,
  background: "rgba(4,8,14,0.34)",
  zIndex: 4,
};

const webFooterOverlayStyle: CSSProperties = {
  position: "absolute",
  bottom: 12,
  right: 12,
  zIndex: 6,
};

const webWidgetDragSurfaceStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  cursor: "grab",
  zIndex: 2,
  userSelect: "none",
  WebkitUserSelect: "none",
  touchAction: "none",
};

const webWidgetDragSurfaceWithCornerReserveStyle: CSSProperties = {
  ...webWidgetDragSurfaceStyle,
  right: 64,
  bottom: 64,
};

const webResizeHitAreaStyle: CSSProperties = {
  width: 58,
  height: 58,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "flex-end",
  cursor: "nwse-resize",
  userSelect: "none",
  WebkitUserSelect: "none",
  touchAction: "none",
};

const webResizeHandleStyle: CSSProperties = {
  width: 18,
  height: 18,
  borderRight: `2px solid ${palette.textMuted}`,
  borderBottom: `2px solid ${palette.textMuted}`,
  userSelect: "none",
  WebkitUserSelect: "none",
  opacity: 0.7,
  touchAction: "none",
  pointerEvents: "none",
};

function getWidgetTone(widget: WidgetConfig, theme: ReturnType<typeof resolveThemeSettings>): CSSProperties {
  const appearance = widget.appearance;
  if (appearance?.widgetColor) {
    if (widget.type === "wallbox" || widget.type === "goe" || widget.type === "coco" || widget.type === "heating" || widget.type === "heatingV2") {
      return {
        background: buildGradientBackground(appearance.widgetColor, appearance.widgetColor2),
        border: "none",
      };
    }
    return {
      background: buildGradientBackground(appearance.widgetColor, appearance.widgetColor2),
      border: "1px solid rgba(255,255,255,0.1)",
    };
  }

  const type = widget.type;
  if (type === "state") {
    return {
      background: "transparent",
      border: "none",
      boxShadow: "none",
    };
  }
  if (type === "energy") {
    return {
      background: `linear-gradient(180deg, ${theme.widgetTones.energyStart}, ${theme.widgetTones.energyEnd})`,
      border: "1px solid rgba(90, 150, 255, 0.16)",
    };
  }
  if (type === "camera" || type === "cameraTalk" || type === "cameraTalkReolink") {
    return {
      background: `linear-gradient(180deg, ${theme.widgetTones.cameraStart}, ${theme.widgetTones.cameraEnd})`,
      border: "1px solid rgba(255,255,255,0.06)",
    };
  }
  if (type === "solar") {
    return {
      background: `linear-gradient(135deg, ${theme.widgetTones.solarStart} 0%, ${theme.widgetTones.solarEnd} 100%)`,
      border: "1px solid rgba(105, 214, 189, 0.18)",
      boxShadow: "0 18px 30px rgba(10, 62, 82, 0.28)",
    };
  }
  if (type === "grafana") {
    return {
      background: "linear-gradient(180deg, rgba(12,18,30,0.96), rgba(9,13,24,0.98))",
      border: "1px solid rgba(255,255,255,0.06)",
    };
  }
  if (type === "weather") {
    return {
      background: "linear-gradient(135deg, rgba(34,128,214,0.92), rgba(21,73,167,0.96))",
      border: "1px solid rgba(173, 219, 255, 0.18)",
    };
  }
  if (type === "numpad") {
    return {
      background: "linear-gradient(135deg, rgba(214, 188, 166, 0.94), rgba(173, 122, 82, 0.92))",
      border: "1px solid rgba(255, 220, 184, 0.24)",
      boxShadow: "0 16px 26px rgba(54, 28, 10, 0.28)",
    };
  }
  if (type === "link" || type === "netflix") {
    return {
      background: "linear-gradient(135deg, rgba(16, 34, 66, 0.94), rgba(10, 20, 40, 0.96))",
      border: "1px solid rgba(126, 168, 255, 0.24)",
      boxShadow: "0 14px 24px rgba(6, 16, 32, 0.32)",
    };
  }
  if (type === "log") {
    return {
      background: "linear-gradient(140deg, rgba(11, 22, 44, 0.95), rgba(6, 12, 25, 0.97))",
      border: "1px solid rgba(130, 170, 255, 0.22)",
      boxShadow: "0 14px 24px rgba(4, 10, 22, 0.34)",
    };
  }
  if (type === "script") {
    return {
      background: "linear-gradient(140deg, rgba(20, 40, 76, 0.95), rgba(8, 18, 38, 0.98))",
      border: "1px solid rgba(116, 171, 255, 0.24)",
      boxShadow: "0 14px 24px rgba(6, 14, 28, 0.34)",
    };
  }
  if (type === "host") {
    return {
      background: "linear-gradient(140deg, rgba(15, 34, 66, 0.95), rgba(8, 18, 36, 0.98))",
      border: "1px solid rgba(105, 182, 255, 0.24)",
      boxShadow: "0 14px 24px rgba(5, 12, 24, 0.34)",
    };
  }
  if (type === "raspberryPiStats") {
    return {
      background: "linear-gradient(140deg, rgba(15, 34, 66, 0.95), rgba(8, 18, 36, 0.98))",
      border: "1px solid rgba(105, 182, 255, 0.24)",
      boxShadow: "0 14px 24px rgba(5, 12, 24, 0.34)",
    };
  }
  if (type === "coco") {
    return {
      background: "linear-gradient(145deg, rgba(20, 30, 44, 0.96), rgba(10, 16, 27, 0.98))",
      border: "none",
      boxShadow: "0 16px 28px rgba(5, 10, 19, 0.34)",
    };
  }
  if (type === "wallbox" || type === "goe") {
    return {
      background: "linear-gradient(145deg, rgba(19, 31, 49, 0.96), rgba(10, 17, 31, 0.98))",
      border: "none",
      boxShadow: "0 16px 28px rgba(5, 10, 19, 0.36)",
    };
  }
  if (type === "heating" || type === "heatingV2") {
    return {
      background: "linear-gradient(145deg, rgba(18, 28, 42, 0.96), rgba(10, 16, 27, 0.98))",
      border: "none",
      boxShadow: "0 16px 28px rgba(5, 10, 19, 0.34)",
    };
  }
  return {};
}

function buildGradientBackground(start: string, end?: string) {
  if (end && end.trim()) {
    return `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;
  }
  return start;
}
const CAMERA_GRID_SNAP = 0.1;
