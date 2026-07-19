import { useEffect, useMemo, useState } from "react";
import { Platform, SafeAreaView, StatusBar, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { DashboardConfigProvider } from "./src/context/DashboardConfigContext";
import { LiveMediaProvider } from "./src/context/LiveMediaContext";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { palette } from "./src/utils/theme";

const defaultFontFamily = Platform.OS === "web" ? "Arial, sans-serif" : "Arial";

applyDefaultFont(Text as unknown as { defaultProps?: Record<string, unknown> });
applyDefaultFont(TextInput as unknown as { defaultProps?: Record<string, unknown> });

export default function App() {
  const { width, height } = useWindowDimensions();
  const [isTouchCapableWeb, setIsTouchCapableWeb] = useState(false);
  const isPortrait = height > width;
  const isTabletLike = useMemo(() => {
    const longestEdge = Math.max(width, height);
    return longestEdge >= 900;
  }, [height, width]);
  const blockPortraitOnTablet = Platform.OS === "web" && isTouchCapableWeb && isTabletLike && isPortrait;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      return;
    }

    const targets = [
      document.documentElement,
      document.body,
      document.getElementById("root"),
    ].filter(Boolean) as HTMLElement[];

    const previous = targets.map((target) => ({
      target,
      overscrollBehaviorY: target.style.overscrollBehaviorY,
    }));

    targets.forEach((target) => {
      target.style.overscrollBehaviorY = "none";
    });

    return () => {
      previous.forEach(({ target, overscrollBehaviorY }) => {
        target.style.overscrollBehaviorY = overscrollBehaviorY;
      });
    };
  }, []);

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

  return (
    <DashboardConfigProvider>
      <LiveMediaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <ExpoStatusBar style="light" />
        <View style={styles.app}>
          <DashboardScreen />
        </View>
        {blockPortraitOnTablet ? (
          <View style={styles.orientationOverlay}>
            <Text style={styles.orientationTitle}>Landscape erforderlich</Text>
            <Text style={styles.orientationHint}>Bitte Tablet ins Querformat drehen.</Text>
          </View>
        ) : null}
      </SafeAreaView>
      </LiveMediaProvider>
    </DashboardConfigProvider>
  );
}

function applyDefaultFont(component: { defaultProps?: Record<string, unknown> }) {
  const nextDefaultProps = component.defaultProps || {};
  const existingStyle = nextDefaultProps.style;
  component.defaultProps = {
    ...nextDefaultProps,
    style: existingStyle ? [{ fontFamily: defaultFontFamily }, existingStyle] : { fontFamily: defaultFontFamily },
  };
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  app: {
    flex: 1,
  },
  orientationOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: "rgba(2, 6, 11, 0.98)",
    zIndex: 9999,
  },
  orientationTitle: {
    color: palette.text,
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 8,
    textAlign: "center",
  },
  orientationHint: {
    color: palette.textMuted,
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
});
