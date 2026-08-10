import { ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, StyleProp, StyleSheet, View, ViewStyle } from "react-native";

type AutoFitAlignment = "start" | "center" | "end";

type AutoFitContentProps = {
  children: ReactNode;
  designWidth: number;
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  horizontalAlignment?: AutoFitAlignment;
  verticalAlignment?: AutoFitAlignment;
  layoutKey?: string | number;
  maxScale?: number;
  onViewportSizeChange?: (width: number, height: number) => void;
};

type MeasuredSize = {
  width: number;
  height: number;
};

const EMPTY_SIZE: MeasuredSize = { width: 0, height: 0 };
type ContentMeasurement = {
  key: string;
  height: number;
};

export function AutoFitContent({
  children,
  designWidth,
  contentStyle,
  style,
  horizontalAlignment = "center",
  verticalAlignment = "center",
  layoutKey,
  maxScale,
  onViewportSizeChange,
}: AutoFitContentProps) {
  const [viewportSize, setViewportSize] = useState<MeasuredSize>(EMPTY_SIZE);
  const viewportSizeRef = useRef<MeasuredSize>(EMPTY_SIZE);
  const measurementKey = `${String(layoutKey ?? "default")}:${designWidth}`;
  const [contentMeasurement, setContentMeasurement] = useState<ContentMeasurement>({ key: "", height: 0 });

  const handleViewportLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const width = floorLayoutValue(event.nativeEvent.layout.width);
      const height = floorLayoutValue(event.nativeEvent.layout.height);
      const current = viewportSizeRef.current;
      if (current.width === width && current.height === height) {
        return;
      }

      const next = { width, height };
      viewportSizeRef.current = next;
      setViewportSize(next);
      onViewportSizeChange?.(width, height);
    },
    [onViewportSizeChange]
  );

  const handleContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = ceilLayoutValue(event.nativeEvent.layout.height);
      setContentMeasurement((current) =>
        current.key === measurementKey && current.height === height ? current : { key: measurementKey, height }
      );
    },
    [measurementKey]
  );

  const placement = useMemo(() => {
    const safeDesignWidth = Number.isFinite(designWidth) ? Math.max(1, designWidth) : 1;
    const contentHeight = contentMeasurement.key === measurementKey ? contentMeasurement.height : 0;
    const ready = viewportSize.width > 0 && viewportSize.height > 0 && contentHeight > 0;
    if (!ready) {
      return { left: 0, top: 0, scale: 1, ready: false };
    }

    const rawScale = Math.min(viewportSize.width / safeDesignWidth, viewportSize.height / contentHeight);
    const boundedScale =
      typeof maxScale === "number" && Number.isFinite(maxScale)
        ? Math.min(rawScale, Math.max(0, maxScale))
        : rawScale;
    const scale = Math.max(0, floorScale(boundedScale));
    const remainingWidth = Math.max(0, viewportSize.width - safeDesignWidth * scale);
    const remainingHeight = Math.max(0, viewportSize.height - contentHeight * scale);

    return {
      left: alignOffset(remainingWidth, horizontalAlignment),
      top: alignOffset(remainingHeight, verticalAlignment),
      scale,
      ready: scale > 0,
    };
  }, [contentMeasurement, designWidth, horizontalAlignment, maxScale, measurementKey, verticalAlignment, viewportSize.height, viewportSize.width]);

  return (
    <View onLayout={handleViewportLayout} style={[styles.viewport, style]}>
      <View
        key={measurementKey}
        onLayout={handleContentLayout}
        pointerEvents={placement.ready ? "auto" : "none"}
        style={[
          styles.content,
          contentStyle,
          {
            width: Number.isFinite(designWidth) ? Math.max(1, designWidth) : 1,
            left: placement.left,
            top: placement.top,
            opacity: placement.ready ? 1 : 0,
            transform: [{ scale: placement.scale }],
            transformOrigin: "top left",
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function alignOffset(remainingSpace: number, alignment: AutoFitAlignment) {
  if (alignment === "end") {
    return remainingSpace;
  }
  if (alignment === "center") {
    return remainingSpace / 2;
  }
  return 0;
}

function floorLayoutValue(value: number) {
  return Math.max(0, Math.floor(value * 10) / 10);
}

function ceilLayoutValue(value: number) {
  return Math.max(0, Math.ceil(value * 10) / 10);
}

function floorScale(value: number) {
  return Math.floor(value * 10000) / 10000;
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
