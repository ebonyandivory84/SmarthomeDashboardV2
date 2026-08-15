import { ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { WidgetType } from "../types/dashboard";

type AutoScaleMinimum = {
  width: number;
  height: number;
};

type AutoScaleSurfaceProps = {
  children: ReactNode;
  minWidth: number;
  minHeight: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

type MeasuredSize = {
  width: number;
  height: number;
};

const EMPTY_SIZE: MeasuredSize = { width: 0, height: 0 };
const MAX_SCALED_CONTENT_AXIS_PX = 4096;

const WIDGET_AUTO_SCALE_MINIMUMS: Partial<Record<WidgetType, AutoScaleMinimum>> = {
  state: { width: 220, height: 180 },
  energy: { width: 380, height: 260 },
  solar: { width: 960, height: 960 },
  numpad: { width: 560, height: 360 },
  host: { width: 560, height: 340 },
  raspberryPiStats: { width: 560, height: 340 },
  coco: { width: 560, height: 320 },
  heating: { width: 560, height: 680 },
};

export function getWidgetAutoScaleMinimum(type: WidgetType): AutoScaleMinimum | null {
  return WIDGET_AUTO_SCALE_MINIMUMS[type] ?? null;
}

export function AutoScaleSurface({
  children,
  minWidth,
  minHeight,
  style,
  contentStyle,
}: AutoScaleSurfaceProps) {
  const [viewportSize, setViewportSize] = useState<MeasuredSize>(EMPTY_SIZE);
  const viewportSizeRef = useRef<MeasuredSize>(EMPTY_SIZE);

  const handleViewportLayout = useCallback((event: LayoutChangeEvent) => {
    const width = floorLayoutValue(event.nativeEvent.layout.width);
    const height = floorLayoutValue(event.nativeEvent.layout.height);
    const current = viewportSizeRef.current;

    if (current.width === width && current.height === height) {
      return;
    }

    const next = { width, height };
    viewportSizeRef.current = next;
    setViewportSize(next);
  }, []);

  const placement = useMemo(() => {
    const safeMinWidth = normalizeMinimum(minWidth);
    const safeMinHeight = normalizeMinimum(minHeight);
    const ready = viewportSize.width > 0 && viewportSize.height > 0;

    if (!ready) {
      return {
        contentWidth: safeMinWidth,
        contentHeight: safeMinHeight,
        left: 0,
        top: 0,
        scale: 1,
        ready: false,
      };
    }

    const scale = floorScale(
      Math.min(1, viewportSize.width / safeMinWidth, viewportSize.height / safeMinHeight)
    );

    if (scale <= 0) {
      return {
        contentWidth: safeMinWidth,
        contentHeight: safeMinHeight,
        left: 0,
        top: 0,
        scale: 1,
        ready: false,
      };
    }

    const naturalContentWidth = floorLayoutValue(viewportSize.width / scale);
    const naturalContentHeight = floorLayoutValue(viewportSize.height / scale);
    const contentWidth = Math.max(
      safeMinWidth,
      Math.min(naturalContentWidth, MAX_SCALED_CONTENT_AXIS_PX)
    );
    const contentHeight = Math.max(
      safeMinHeight,
      Math.min(naturalContentHeight, MAX_SCALED_CONTENT_AXIS_PX)
    );

    return {
      contentWidth,
      contentHeight,
      left: floorLayoutValue((viewportSize.width - contentWidth * scale) / 2),
      top: floorLayoutValue((viewportSize.height - contentHeight * scale) / 2),
      scale,
      ready: true,
    };
  }, [minHeight, minWidth, viewportSize.height, viewportSize.width]);

  return (
    <View onLayout={handleViewportLayout} style={[styles.viewport, style]}>
      <View
        pointerEvents={placement.ready ? "auto" : "none"}
        style={[
          styles.content,
          contentStyle,
          {
            width: placement.contentWidth,
            height: placement.contentHeight,
            left: placement.left,
            top: placement.top,
            opacity: placement.ready ? 1 : 0,
          },
          placement.scale < 1
            ? {
                transform: [{ scale: placement.scale }],
                transformOrigin: "top left",
              }
            : null,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function normalizeMinimum(value: number) {
  return Number.isFinite(value) ? Math.max(1, value) : 1;
}

function floorLayoutValue(value: number) {
  return Math.max(0, Math.floor(value * 10) / 10);
}

function floorScale(value: number) {
  return Math.max(0, Math.floor(value * 10000) / 10000);
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    position: "relative",
  },
  content: {
    position: "absolute",
  },
});
