import { MaterialCommunityIcons } from "@expo/vector-icons";
import { createElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  ImageBackground,
  LayoutChangeEvent,
  Linking,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { SolarLayoutConfig, SolarNodeLayout, SolarWidgetConfig, StateSnapshot, ThemeSettings } from "../../types/dashboard";
import { useDashboardConfig } from "../../context/DashboardConfigContext";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { resolveThemeSettings } from "../../utils/themeConfig";
import { palette } from "../../utils/theme";

type SolarWidgetProps = {
  config: SolarWidgetConfig;
  states: StateSnapshot;
  theme?: ThemeSettings;
  isActivePage?: boolean;
  lowPowerMode?: boolean;
};

type FlowDir = "toHome" | "fromHome" | "idle";
const SOLAR_SCENE_BASE_WIDTH = 960;
const SOLAR_SCENE_BASE_HEIGHT = 960;
const SOLAR_MAX_STAT_CARDS = 6;
const FLOW_ACTIVE_THRESHOLD_W = 20;
const GRID_IMPORT_FLOW_THRESHOLD_W = 100;
const CAR_FLOW_THRESHOLD_W = 100;
const DEFAULT_WALLBOX_STATE_IDS = {
  carState: "go-e.0.car",
  chargePower: "go-e.0.nrg.11",
  ampere: "go-e.0.ampere",
  phaseMode: "go-e.0.phaseSwitchMode",
  carSoc: "go-e.0.carBatterySoc",
  carRange: "",
} as const;
const SOLAR_DEFAULT_STAT_LABELS = [
  "Eigenverbrauch",
  "Verbraucht",
  "Stat 3",
  "Stat 4",
  "Stat 5",
  "Stat 6",
];

export function SolarWidget({
  config,
  states,
  theme,
  isActivePage = true,
  lowPowerMode = false,
}: SolarWidgetProps) {
  const { dashboardPages, setActivePage } = useDashboardConfig();
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const flowAnimationEnabled = runtimeActive;
  const resolvedTheme = resolveThemeSettings(theme);
  const widgetAppearance = config.appearance;
  const textColor = widgetAppearance?.textColor || palette.text;
  const mutedTextColor = widgetAppearance?.mutedTextColor || palette.textMuted;
  const [widgetLayout, setWidgetLayout] = useState({ width: 0, height: 0 });
  const wallboxStateIds = useMemo(
    () => ({
      carState: resolveOptionalStateId(config.wallboxCarStateId, DEFAULT_WALLBOX_STATE_IDS.carState),
      chargePower: resolveOptionalStateId(config.wallboxChargePowerStateId, DEFAULT_WALLBOX_STATE_IDS.chargePower),
      ampere: resolveOptionalStateId(config.wallboxAmpereStateId, DEFAULT_WALLBOX_STATE_IDS.ampere),
      phaseMode: resolveOptionalStateId(config.wallboxPhaseModeStateId, DEFAULT_WALLBOX_STATE_IDS.phaseMode),
      carSoc: resolveOptionalStateId(config.wallboxCarSocStateId, DEFAULT_WALLBOX_STATE_IDS.carSoc),
      carRange: resolveOptionalStateId(config.wallboxCarRangeStateId, DEFAULT_WALLBOX_STATE_IDS.carRange),
    }),
    [
      config.wallboxAmpereStateId,
      config.wallboxCarRangeStateId,
      config.wallboxCarSocStateId,
      config.wallboxCarStateId,
      config.wallboxChargePowerStateId,
      config.wallboxPhaseModeStateId,
    ]
  );
  // Stabilized with useCallback so `incomingSnapshot` useMemo does not recompute
  // on every render (getValue was recreated each render and leaked into the closure).
  const getValue = useCallback(
    (snapshot: StateSnapshot, key?: string) => {
      if (!key) {
        return null;
      }
      return snapshot[`${config.statePrefix}.${key}`];
    },
    [config.statePrefix]
  );

  const incomingSnapshot = useMemo(
    () => ({
      pvNow: asNumber(getValue(states, config.keys.pvNow)),
      homeNow: asNumber(getValue(states, config.keys.homeNow)),
      gridIn: asNumber(getValue(states, config.keys.gridIn)),
      gridOut: asNumber(getValue(states, config.keys.gridOut)),
      soc: asNumber(getValue(states, config.keys.soc)),
      battIn: asNumber(getValue(states, config.keys.battIn)),
      battOut: asNumber(getValue(states, config.keys.battOut)),
      battTemp: asNumber(getValue(states, config.keys.battTemp)),
      pvTotalKWh: normalizeEnergyToKWh(getValue(states, config.keys.pvTotal), config.dailyEnergyUnit),
      dayConsumedKWh: normalizeEnergyToKWh(getValue(states, config.keys.dayConsumed), config.dailyEnergyUnit),
      daySelfKWh: normalizeEnergyToKWh(getValue(states, config.keys.daySelf), config.dailyEnergyUnit),
      wallboxCarCodeRaw: asNumber(states[wallboxStateIds.carState]),
      wallboxChargePowerRaw: states[wallboxStateIds.chargePower],
      wallboxAmpere: asNumber(states[wallboxStateIds.ampere]),
      wallboxPhaseModeRaw: states[wallboxStateIds.phaseMode],
      wallboxCarSocRaw: asNumber(states[wallboxStateIds.carSoc]),
      wallboxCarRangeRaw: asNumber(states[wallboxStateIds.carRange]),
    }),
    [config.dailyEnergyUnit, config.keys, config.statePrefix, states, wallboxStateIds]
  );

  const [displaySnapshot, setDisplaySnapshot] = useState(incomingSnapshot);

  // No transition mechanism depends on this delay — sync directly to avoid
  // a second re-render 220ms after every state update (costly on weak SoCs).
  useEffect(() => {
    setDisplaySnapshot(incomingSnapshot);
  }, [incomingSnapshot]);

  const {
    pvNow,
    homeNow,
    gridIn,
    gridOut,
    soc,
    battIn,
    battOut,
    battTemp,
    dayConsumedKWh,
    daySelfKWh,
    wallboxCarCodeRaw,
    wallboxChargePowerRaw,
    wallboxAmpere,
    wallboxPhaseModeRaw,
    wallboxCarSocRaw,
    wallboxCarRangeRaw,
  } =
    displaySnapshot;
  const missingCore = pvNow === null && homeNow === null && gridIn === null && gridOut === null;

  const battSigned =
    battOut !== null && battOut > FLOW_ACTIVE_THRESHOLD_W
      ? Math.abs(battOut)
      : battIn !== null && battIn > FLOW_ACTIVE_THRESHOLD_W
        ? -Math.abs(battIn)
        : 0;
  const gridDisplaySigned =
    gridIn !== null && gridIn > FLOW_ACTIVE_THRESHOLD_W
      ? Math.abs(gridIn)
      : gridOut !== null && gridOut > FLOW_ACTIVE_THRESHOLD_W
        ? -Math.abs(gridOut)
        : 0;
  const gridFlowSigned =
    gridIn !== null && gridIn >= GRID_IMPORT_FLOW_THRESHOLD_W
      ? Math.abs(gridIn)
      : gridOut !== null && gridOut > FLOW_ACTIVE_THRESHOLD_W
        ? -Math.abs(gridOut)
        : 0;
  const wallboxCarCode = wallboxCarCodeRaw === null ? null : Math.round(wallboxCarCodeRaw);
  const wallboxChargePowerW = resolveWallboxChargePowerW({
    chargePowerRaw: wallboxChargePowerRaw,
    ampere: wallboxAmpere,
    phaseModeRaw: wallboxPhaseModeRaw,
  });
  const carFlowSigned =
    wallboxCarCode === 2 && wallboxChargePowerW !== null
      ? Math.max(0, wallboxChargePowerW)
      : wallboxChargePowerW || 0;
  const pvDir: FlowDir = pvNow !== null && pvNow > FLOW_ACTIVE_THRESHOLD_W ? "toHome" : "idle";
  const battDir = dirFromSigned(battSigned, FLOW_ACTIVE_THRESHOLD_W);
  const gridDir = dirFromSigned(gridFlowSigned, FLOW_ACTIVE_THRESHOLD_W);
  const carDir = dirFromSigned(carFlowSigned, CAR_FLOW_THRESHOLD_W);
  const carSocPercent =
    wallboxCarSocRaw === null ? null : Math.max(0, Math.min(100, Math.round(wallboxCarSocRaw)));
  const carRangeKm =
    wallboxCarRangeRaw === null ? null : Math.max(0, Math.round(wallboxCarRangeRaw));
  const carPowerDisplayW =
    wallboxChargePowerW === null ? null : Math.max(0, wallboxChargePowerW);
  const backgroundBlur = lowPowerMode ? 0 : clamp(config.backgroundImageBlur ?? 8, 0, 24);
  const compactWidget = widgetLayout.width > 0 && (widgetLayout.width < 520 || widgetLayout.height < 420);
  const veryCompactWidget = widgetLayout.width > 0 && (widgetLayout.width < 420 || widgetLayout.height < 340);
  // `states` is broad — ideally we'd subscribe only to the specific stateIds from
  // resolveSolarStatDefinitions(config). However, those IDs are dynamically derived
  // from config.stats.cards at runtime, so narrowing the dependency here would
  // require extracting them outside this memo (adds complexity). Left as-is with a
  // note: if stat-card flicker becomes an issue, pre-extract stateIds and use a
  // selector that picks only those keys from `states`.
  const statCards = useMemo(
    () => resolveSolarStatCards(config, states, daySelfKWh, dayConsumedKWh),
    [config, states, dayConsumedKWh, daySelfKWh]
  );
  const tapAction = normalizeSolarTapAction(config.tapAction);
  const isActionable = tapAction.type !== "none";

  const handleWidgetPress = () => {
    if (tapAction.type === "dashboard") {
      if (dashboardPages.some((page) => page.id === tapAction.dashboardId)) {
        setActivePage(tapAction.dashboardId);
      }
      return;
    }
    if (tapAction.type === "url") {
      const resolvedUrl = normalizeExternalUrl(tapAction.url);
      if (resolvedUrl) {
        void Linking.openURL(resolvedUrl);
      }
    }
  };

  return (
    <Pressable
      onLayout={(event: LayoutChangeEvent) => setWidgetLayout(event.nativeEvent.layout)}
      onPress={isActionable ? handleWidgetPress : undefined}
      style={[styles.container, isActionable ? styles.containerActionable : null]}
    >
      {config.backgroundMode === "image" && config.backgroundImage ? (
        Platform.OS === "web" ? (
          <>
            {createElement("div", {
              style: buildBlurredWidgetBackgroundStyle(config.backgroundImage, backgroundBlur),
            })}
            <View style={styles.widgetBackgroundOverlay} />
          </>
        ) : (
          <ImageBackground
            blurRadius={backgroundBlur}
            imageStyle={styles.widgetBackgroundImage}
            source={{ uri: `/smarthome-dashboard-v2/widget-assets/${encodeURIComponent(config.backgroundImage)}` }}
            style={styles.widgetBackground}
          >
            <View style={styles.widgetBackgroundOverlay} />
          </ImageBackground>
        )
      ) : null}

      <View
        style={[
          styles.sceneCard,
          compactWidget ? styles.sceneCardCompact : null,
          veryCompactWidget ? styles.sceneCardVeryCompact : null,
          {
            backgroundColor:
              config.backgroundMode === "image" && config.backgroundImage
                ? "rgba(0,0,0,0)"
                : widgetAppearance?.cardColor || resolvedTheme.solar.sceneCardBackground,
            borderColor: resolvedTheme.solar.sceneCardBorder,
          },
        ]}
      >
        <SolarFlowScene
          battDir={battDir}
          battPower={Math.abs(battSigned)}
          battTemp={battTemp}
          gridDir={gridDir}
          gridPower={Math.abs(gridDisplaySigned)}
          carDir={carDir}
          carPower={carPowerDisplayW}
          carSoc={carSocPercent}
          carRange={carRangeKm}
          homeNow={homeNow}
          mutedTextColor={mutedTextColor}
          textColor={textColor}
          widgetAppearance={widgetAppearance}
          theme={resolvedTheme}
          pvDir={pvDir}
          pvNow={pvNow}
          soc={soc}
          compactMode={compactWidget}
          veryCompactMode={veryCompactWidget}
          nodeLayout={config.nodeLayout}
          statTextScale={config.statTextScale}
          statCards={statCards}
          animateFlow={flowAnimationEnabled}
          lowPowerMode={lowPowerMode}
        />
      </View>

      {!compactWidget ? (
        <Text style={[styles.footnote, { color: mutedTextColor }]}>
          Tageswerte nutzen `dailyEnergyUnit={config.dailyEnergyUnit || "auto"}`. `auto` erkennt `Wh`/`kWh` aus
          Strings oder schaetzt nackte Zahlen plausibel.
        </Text>
      ) : null}
      {missingCore ? <Text style={styles.warning}>Keine Solar-Daten gefunden. Pruefe Prefix und Key-Mapping.</Text> : null}
    </Pressable>
  );
}

function SolarFlowScene({
  pvDir,
  pvNow,
  homeNow,
  battDir,
  battPower,
  soc,
  battTemp,
  gridDir,
  gridPower,
  carDir,
  carPower,
  carSoc,
  carRange,
  theme,
  textColor,
  mutedTextColor,
  widgetAppearance,
  compactMode,
  veryCompactMode,
  nodeLayout,
  statTextScale,
  statCards,
  animateFlow,
  lowPowerMode,
}: {
  pvDir: FlowDir;
  pvNow: number | null;
  homeNow: number | null;
  battDir: FlowDir;
  battPower: number;
  soc: number | null;
  battTemp: number | null;
  gridDir: FlowDir;
  gridPower: number;
  carDir: FlowDir;
  carPower: number | null;
  carSoc: number | null;
  carRange: number | null;
  theme: ThemeSettings;
  textColor: string;
  mutedTextColor: string;
  widgetAppearance?: SolarWidgetConfig["appearance"];
  compactMode?: boolean;
  veryCompactMode?: boolean;
  nodeLayout?: Partial<SolarLayoutConfig>;
  statTextScale?: number;
  statCards: Array<{ label: string; value: string }>;
  animateFlow: boolean;
  lowPowerMode: boolean;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const [sceneLayout, setSceneLayout] = useState({ width: SOLAR_SCENE_BASE_WIDTH, height: SOLAR_SCENE_BASE_HEIGHT });
  const flowDurationMs = lowPowerMode ? 2400 : 1400;
  const isWeb = Platform.OS === "web";

  useEffect(() => {
    if (!isWeb || typeof document === "undefined") {
      return;
    }
    const styleId = "smarthome-solar-flow-keyframes";
    if (document.getElementById(styleId)) {
      return;
    }
    const styleEl = document.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = `
      @keyframes smarthomeSolarFlowX {
        from { transform: translate3d(var(--flow-x-from, 0px), 0, 0); }
        to { transform: translate3d(var(--flow-x-to, 0px), 0, 0); }
      }
      @keyframes smarthomeSolarFlowY {
        from { transform: translate3d(0, var(--flow-y-from, 0px), 0); }
        to { transform: translate3d(0, var(--flow-y-to, 0px), 0); }
      }
    `;
    document.head.appendChild(styleEl);
  }, [isWeb]);

  useEffect(() => {
    progress.stopAnimation();
    if (isWeb || !animateFlow) {
      progress.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: flowDurationMs,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== "web",
      })
    );
    loop.start();
    return () => loop.stop();
  }, [animateFlow, flowDurationMs, isWeb, progress]);

  const fittedScene = useMemo(() => {
    const availableWidth = Math.max(1, sceneLayout.width);
    const availableHeight = Math.max(1, sceneLayout.height);
    const scale = Math.min(availableWidth / SOLAR_SCENE_BASE_WIDTH, availableHeight / SOLAR_SCENE_BASE_HEIGHT);
    const width = Math.max(1, SOLAR_SCENE_BASE_WIDTH * scale);
    const height = Math.max(1, SOLAR_SCENE_BASE_HEIGHT * scale);
    return {
      x: (availableWidth - width) / 2,
      // Anchor to top so vertical space is used for larger node distances.
      y: 0,
      width,
      height,
    };
  }, [sceneLayout]);

  const defaults = getDefaultNodeLayout();
  const pvBox = resolveNodeBox(nodeLayout?.pv, defaults.pv, fittedScene);
  const homeBox = resolveNodeBox(nodeLayout?.home, defaults.home, fittedScene);
  const batteryBox = resolveNodeBox(nodeLayout?.battery, defaults.battery, fittedScene);
  const gridBox = resolveNodeBox(nodeLayout?.grid, defaults.grid, fittedScene);
  const carBox = resolveNodeBox(nodeLayout?.car, defaults.car, fittedScene);
  const flowDotSize = Math.max(8, Math.min(12, Math.round(fittedScene.width * 0.012)));
  const lineGap = Math.max(2, Math.round(fittedScene.width * 0.01));
  const verticalGap = Math.max(8, Math.round(fittedScene.height * 0.02));
  const sceneScale = clamp(fittedScene.width / SOLAR_SCENE_BASE_WIDTH, 0.52, 1);
  const statScale = clamp(fittedScene.width / SOLAR_SCENE_BASE_WIDTH, 0.38, 1);
  const effectiveStatTextScale = clamp(statTextScale ?? 1, 0.6, 2);
  const statWidth = Math.round(clamp(fittedScene.width * 0.33, 110, 340));
  const statBottom = Math.round(clamp(fittedScene.height * 0.008, 2, 14));
  const statGap = Math.round(clamp(8 * statScale, 4, 10));
  const leftStatCount = Math.ceil(statCards.length / 2);
  const leftStats = statCards.slice(0, leftStatCount);
  const rightStats = statCards.slice(leftStatCount);
  const maxStackCount = Math.max(leftStats.length, rightStats.length, 1);
  const maxStatStackHeight = Math.round(clamp(fittedScene.height * 0.34, 120, 260));
  const statMinHeight = Math.round(
    clamp((maxStatStackHeight - statGap * Math.max(0, maxStackCount - 1)) / maxStackCount, 36, 96)
  );
  const homeMidX = homeBox.x + homeBox.w / 2;
  const batteryMidY = batteryBox.y + batteryBox.h / 2;
  const homeMidY = homeBox.y + homeBox.h / 2;
  const gridMidY = gridBox.y + gridBox.h / 2;
  const topLineLeft = Math.round(homeMidX) - 2;
  const bottomLineLeft = Math.round(homeMidX) - 2;

  const topLineStart = pvBox.y + pvBox.h + verticalGap;
  const topLineEnd = homeBox.y - verticalGap;
  const topLineHeight = Math.max(12, topLineEnd - topLineStart);
  const leftLineTop = Math.round((batteryMidY + homeMidY) / 2) - 2;
  const rightLineTop = Math.round((gridMidY + homeMidY) / 2) - 2;
  const leftLineStart = batteryBox.x + batteryBox.w + lineGap;
  const leftLineEnd = homeBox.x - lineGap;
  const leftLineWidth = Math.max(16, leftLineEnd - leftLineStart);
  const rightLineStart = homeBox.x + homeBox.w + lineGap;
  const rightLineEnd = gridBox.x - lineGap;
  const rightLineWidth = Math.max(16, rightLineEnd - rightLineStart);
  const bottomLineStart = homeBox.y + homeBox.h + verticalGap;
  const bottomLineEnd = carBox.y - verticalGap;
  const bottomLineHeight = Math.max(12, bottomLineEnd - bottomLineStart);
  const infoGap = Math.round(clamp(14 * sceneScale, 8, 18));
  const batteryInfoWidth = Math.round(batteryBox.w);
  const carInfoWidth = Math.round(carBox.w);
  const infoMaxBottom = Math.max(0, fittedScene.height - Math.round(clamp(78 * sceneScale, 52, 90)));
  const batteryInfoLeft = batteryBox.x;
  const carInfoLeft = carBox.x;
  const batteryInfoTop = clamp(batteryBox.y + batteryBox.h + infoGap, 0, infoMaxBottom);
  const carInfoTop = clamp(carBox.y + carBox.h + infoGap, 0, infoMaxBottom);
  const batteryInfoLines = [
    {
      value: soc === null ? "-" : `${Math.round(clamp(soc, 0, 100))} %`,
    },
    {
      value: battTemp === null ? "-" : `${battTemp.toFixed(1)} °C`,
    },
  ];
  const carInfoLines = [
    {
      value: carSoc === null ? "-" : `${Math.round(clamp(carSoc, 0, 100))} %`,
    },
    {
      value: carRange === null ? "-" : `${Math.max(0, Math.round(carRange))} km`,
    },
  ];

  return (
    <View
      onLayout={(event: LayoutChangeEvent) => setSceneLayout(event.nativeEvent.layout)}
      style={styles.scene}
    >
      <View style={[styles.lineVertical, { top: topLineStart, left: topLineLeft, height: topLineHeight }]} />
      <View style={[styles.lineVertical, { top: bottomLineStart, left: bottomLineLeft, height: bottomLineHeight }]} />
      <View style={[styles.lineHorizontal, { top: leftLineTop, left: leftLineStart, width: leftLineWidth }]} />
      <View style={[styles.lineHorizontal, { top: rightLineTop, left: rightLineStart, width: rightLineWidth }]} />

      <AnimatedFlowDot
        active={pvDir !== "idle"}
        animate={animateFlow}
        lowPowerMode={lowPowerMode}
        durationMs={flowDurationMs}
        axis="y"
        progress={progress}
        range={pvDir === "toHome" ? [0, Math.max(0, topLineHeight - flowDotSize)] : [Math.max(0, topLineHeight - flowDotSize), 0]}
        baseStyle={{ top: topLineStart, left: topLineLeft - (flowDotSize - 4) / 2 }}
        size={flowDotSize}
        strength={clamp((pvNow || 0) / 8000, 0.2, 1)}
      />
      <AnimatedFlowDot
        active={battDir !== "idle"}
        animate={animateFlow}
        lowPowerMode={lowPowerMode}
        durationMs={flowDurationMs}
        axis="x"
        progress={progress}
        range={battDir === "toHome" ? [0, Math.max(0, leftLineWidth - flowDotSize)] : [Math.max(0, leftLineWidth - flowDotSize), 0]}
        baseStyle={{ top: leftLineTop - (flowDotSize - 4) / 2, left: leftLineStart }}
        size={flowDotSize}
        strength={clamp(battPower / 6000, 0.2, 1)}
      />
      <AnimatedFlowDot
        active={gridDir !== "idle"}
        animate={animateFlow}
        lowPowerMode={lowPowerMode}
        durationMs={flowDurationMs}
        axis="x"
        progress={progress}
        range={gridDir === "toHome" ? [Math.max(0, rightLineWidth - flowDotSize), 0] : [0, Math.max(0, rightLineWidth - flowDotSize)]}
        baseStyle={{ top: rightLineTop - (flowDotSize - 4) / 2, left: rightLineStart }}
        size={flowDotSize}
        strength={clamp(gridPower / 12000, 0.2, 1)}
      />
      <AnimatedFlowDot
        active={carDir !== "idle"}
        animate={animateFlow}
        lowPowerMode={lowPowerMode}
        durationMs={flowDurationMs}
        axis="y"
        progress={progress}
        range={
          carDir === "toHome"
            ? [0, Math.max(0, bottomLineHeight - flowDotSize)]
            : [Math.max(0, bottomLineHeight - flowDotSize), 0]
        }
        baseStyle={{ top: bottomLineStart, left: bottomLineLeft - (flowDotSize - 4) / 2 }}
        size={flowDotSize}
        strength={clamp((carPower || 0) / 12000, 0.2, 1)}
      />

      <NodeCard
        icon="white-balance-sunny"
        label="PV"
        iconColor="#ffd34f"
        iconSurface="rgba(120, 98, 24, 0.36)"
        nodeColor={widgetAppearance?.pvCardColor}
        theme={theme}
        textColor={textColor}
        mutedTextColor={textColor}
        widgetAppearance={widgetAppearance}
        compact={compactMode}
        veryCompact={veryCompactMode}
        sceneScale={sceneScale}
        style={{ ...styles.nodePosition, top: pvBox.y, left: pvBox.x, width: pvBox.w, minHeight: pvBox.h }}
        value={fmtW(pvNow)}
        highlight={pvDir !== "idle"}
      />
      <NodeCard
        icon="home-variant-outline"
        label="Haus"
        iconColor="#86b7ff"
        iconSurface="rgba(35, 59, 110, 0.34)"
        nodeColor={widgetAppearance?.homeCardColor}
        theme={theme}
        textColor={textColor}
        mutedTextColor={textColor}
        widgetAppearance={widgetAppearance}
        compact={compactMode}
        veryCompact={veryCompactMode}
        sceneScale={sceneScale}
        style={{ ...styles.nodePosition, top: homeBox.y, left: homeBox.x, width: homeBox.w, minHeight: homeBox.h }}
        value={fmtW(homeNow)}
        highlight
      />
      <NodeCard
        icon={resolveBatteryIcon(soc)}
        label="Akku"
        iconColor="#8b8dff"
        iconSurface="rgba(58, 48, 110, 0.34)"
        nodeColor={widgetAppearance?.batteryCardColor}
        theme={theme}
        textColor={textColor}
        mutedTextColor={textColor}
        widgetAppearance={widgetAppearance}
        compact={compactMode}
        veryCompact={veryCompactMode}
        sceneScale={sceneScale}
        style={{ ...styles.nodePosition, top: batteryBox.y, left: batteryBox.x, width: batteryBox.w, minHeight: batteryBox.h }}
        value={fmtW(battPower || null)}
        highlight={battDir !== "idle"}
      />
      <NodeCard
        icon="transmission-tower-export"
        label="Netz"
        iconColor="#b9c4d8"
        iconSurface="rgba(70, 78, 98, 0.28)"
        nodeColor={widgetAppearance?.gridCardColor}
        theme={theme}
        textColor={textColor}
        mutedTextColor={mutedTextColor}
        widgetAppearance={widgetAppearance}
        compact={compactMode}
        veryCompact={veryCompactMode}
        sceneScale={sceneScale}
        style={{ ...styles.nodePosition, top: gridBox.y, left: gridBox.x, width: gridBox.w, minHeight: gridBox.h }}
        value={fmtW(gridPower || null)}
        highlight={gridDir !== "idle"}
      />
      <NodeCard
        icon="ev-station"
        label="Auto"
        iconColor="#9fe89f"
        iconSurface="rgba(46, 94, 62, 0.28)"
        nodeColor={widgetAppearance?.carCardColor}
        theme={theme}
        textColor={textColor}
        mutedTextColor={mutedTextColor}
        widgetAppearance={widgetAppearance}
        compact={compactMode}
        veryCompact={veryCompactMode}
        sceneScale={sceneScale}
        style={{ ...styles.nodePosition, top: carBox.y, left: carBox.x, width: carBox.w, minHeight: carBox.h }}
        value={carPower === null ? "—" : fmtW(carPower)}
        highlight={carDir !== "idle"}
      />
      <ExternalNodeInfo
        lines={batteryInfoLines}
        style={{
          ...styles.nodePosition,
          top: batteryInfoTop,
          left: batteryInfoLeft,
          width: batteryInfoWidth,
        }}
        theme={theme}
        textColor={textColor}
        mutedTextColor={mutedTextColor}
        appearance={widgetAppearance}
        compact={compactMode}
        veryCompact={veryCompactMode}
        sceneScale={sceneScale}
        showPanel={false}
        valueSizeBoost={0.95}
        valueWeight="500"
        valueColor="#f5f8ff"
      />
      <ExternalNodeInfo
        lines={carInfoLines}
        style={{
          ...styles.nodePosition,
          top: carInfoTop,
          left: carInfoLeft,
          width: carInfoWidth,
        }}
        theme={theme}
        textColor={textColor}
        mutedTextColor={mutedTextColor}
        appearance={widgetAppearance}
        compact={compactMode}
        veryCompact={veryCompactMode}
        sceneScale={sceneScale}
        showPanel={false}
        valueSizeBoost={0.95}
        valueWeight="500"
        valueColor="#ffffff"
      />

      {leftStats.map((card, index) => (
        <MiniStat
          key={`solar-left-stat-${index}`}
          appearance={widgetAppearance}
          compact={compactMode}
          label={card.label}
          mutedTextColor={mutedTextColor}
          textColor={textColor}
          theme={theme}
          value={card.value}
          scale={statScale}
          textScale={effectiveStatTextScale}
          style={[
            styles.sceneStat,
            styles.sceneStatLeft,
            {
              bottom: statBottom + index * (statMinHeight + statGap),
              width: statWidth,
              minHeight: statMinHeight,
            },
          ]}
        />
      ))}
      {rightStats.map((card, index) => (
        <MiniStat
          key={`solar-right-stat-${index}`}
          appearance={widgetAppearance}
          compact={compactMode}
          label={card.label}
          mutedTextColor={mutedTextColor}
          textColor={textColor}
          theme={theme}
          value={card.value}
          scale={statScale}
          textScale={effectiveStatTextScale}
          style={[
            styles.sceneStat,
            styles.sceneStatRight,
            {
              bottom: statBottom + index * (statMinHeight + statGap),
              width: statWidth,
              minHeight: statMinHeight,
            },
          ]}
        />
      ))}
    </View>
  );
}

function AnimatedFlowDot({
  active,
  animate,
  lowPowerMode,
  durationMs,
  progress,
  axis,
  range,
  size,
  strength,
  baseStyle,
}: {
  active: boolean;
  animate: boolean;
  lowPowerMode: boolean;
  durationMs: number;
  progress: Animated.Value;
  axis: "x" | "y";
  range: [number, number];
  size: number;
  strength: number;
  baseStyle?: object;
}) {
  if (!active) {
    return null;
  }

  if (Platform.OS === "web") {
    const staticOffset = (range[0] + range[1]) / 2;
    const webBaseStyle = (baseStyle || {}) as Record<string, string | number>;
    const baseVisualStyle: Record<string, string | number> = {
      ...webFlowDotStyle,
      ...(lowPowerMode ? webFlowDotLowPowerStyle : null),
      ...webBaseStyle,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: `${size / 2}px`,
      opacity: clamp(0.35 + strength * 0.65, 0.35, 1),
    };

    if (!animate) {
      return createElement("div", {
        style: {
          ...baseVisualStyle,
          transform: axis === "x" ? `translate3d(${staticOffset}px, 0, 0)` : `translate3d(0, ${staticOffset}px, 0)`,
        },
      });
    }

    const variableStyle: Record<string, string> =
      axis === "x"
        ? {
            ["--flow-x-from" as any]: `${range[0]}px`,
            ["--flow-x-to" as any]: `${range[1]}px`,
          }
        : {
            ["--flow-y-from" as any]: `${range[0]}px`,
            ["--flow-y-to" as any]: `${range[1]}px`,
          };

    return createElement("div", {
      style: {
        ...baseVisualStyle,
        ...variableStyle,
        animationName: axis === "x" ? "smarthomeSolarFlowX" : "smarthomeSolarFlowY",
        animationDuration: `${Math.max(900, Math.round(durationMs))}ms`,
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
        animationFillMode: "both",
        // willChange: "transform" entfernt — erzeugt auf Mali-T860 zu viele GPU Compositing-Layers.
        // translate3d(0,0,0) bleibt als initial compositing-layer hint.
        transform: "translate3d(0, 0, 0)",
      },
    });
  }

  if (!animate) {
    const staticOffset = (range[0] + range[1]) / 2;
    const transform = axis === "x" ? [{ translateX: staticOffset }] : [{ translateY: staticOffset }];
    return (
      <View
        style={[
          styles.flowDot,
          baseStyle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            opacity: clamp(0.3 + strength * 0.45, 0.3, 0.75),
            transform,
          },
        ]}
      />
    );
  }

  const transform =
    axis === "x"
      ? [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: range }) }]
      : [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: range }) }];

  return (
    <Animated.View
      style={[
        styles.flowDot,
        lowPowerMode ? styles.flowDotLowPower : null,
        baseStyle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          opacity: clamp(0.35 + strength * 0.65, 0.35, 1),
          transform,
        },
      ]}
    />
  );
}

function NodeCard({
  icon,
  label,
  value,
  meta,
  highlight,
  style,
  theme,
  textColor,
  mutedTextColor,
  widgetAppearance,
  nodeColor,
  iconColor,
  iconSurface,
  valueColor,
  compact,
  veryCompact,
  sceneScale,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  value: string;
  meta?: string;
  highlight?: boolean;
  style?: object;
  theme: ThemeSettings;
  textColor: string;
  mutedTextColor: string;
  widgetAppearance?: SolarWidgetConfig["appearance"];
  nodeColor?: string;
  iconColor?: string;
  iconSurface?: string;
  valueColor?: string;
  compact?: boolean;
  veryCompact?: boolean;
  sceneScale?: number;
}) {
  const scale = clamp(sceneScale ?? 1, 0.52, 1);
  const iconSize = Math.round(clamp(30 * scale, 18, 30));
  const cardPadding = Math.round(clamp(10 * scale, 5, 10));
  const cardRadius = Math.round(clamp(20 * scale, 12, 20));
  const iconBox = Math.round(clamp(48 * scale, 28, 48));
  const iconRadius = Math.round(clamp(15 * scale, 10, 15));
  const iconInnerBox = Math.round(clamp(36 * scale, 22, 36));
  const iconInnerRadius = Math.round(clamp(12 * scale, 7, 12));
  const valueFontSize = Math.round(clamp(16 * scale, 11, 16));
  const valueMarginTop = Math.round(clamp(8 * scale, 4, 8));
  const metaFontSize = Math.round(clamp(9 * scale, 7, 9));
  const metaMarginTop = Math.round(clamp(4 * scale, 2, 4));

  return (
    <View
      style={[
        styles.nodeCard,
        {
          backgroundColor: nodeColor || widgetAppearance?.cardColor || theme.solar.nodeCardBackground,
          borderColor: theme.solar.nodeCardBorder,
          borderRadius: cardRadius,
          padding: cardPadding,
        },
        style,
        highlight ? styles.nodeCardActive : null,
      ]}
    >
      <View
        style={[
          styles.nodeIcon,
          {
            backgroundColor: iconSurface || "rgba(255,255,255,0.08)",
            width: iconBox,
            height: iconBox,
            borderRadius: iconRadius,
          },
          highlight ? styles.nodeIconActive : null,
        ]}
      >
        <View
          style={[
            styles.nodeIconInner,
            {
              width: iconInnerBox,
              height: iconInnerBox,
              borderRadius: iconInnerRadius,
            },
          ]}
        >
          <MaterialCommunityIcons
            color={iconColor || (highlight ? palette.accent : palette.textMuted)}
            name={icon}
            size={iconSize}
          />
        </View>
      </View>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.58}
        numberOfLines={1}
        style={[
          styles.nodeValue,
          {
            color: valueColor || textColor,
            marginTop: valueMarginTop,
            fontSize: valueFontSize,
          },
        ]}
      >
        {value}
      </Text>
      {meta ? (
        <Text
          numberOfLines={2}
          style={[
            styles.nodeMeta,
            {
              color: mutedTextColor,
              marginTop: metaMarginTop,
              fontSize: metaFontSize,
              lineHeight: Math.round(metaFontSize * 1.25),
            },
          ]}
        >
          {meta}
        </Text>
      ) : null}
    </View>
  );
}

type ExternalNodeInfoLine = {
  label?: string;
  value: string;
};

function ExternalNodeInfo({
  lines,
  style,
  theme,
  textColor,
  mutedTextColor,
  appearance,
  compact,
  veryCompact,
  sceneScale,
  showPanel,
  valueColor,
  valueSizeBoost,
  valueWeight,
}: {
  lines: ExternalNodeInfoLine[];
  style?: StyleProp<ViewStyle>;
  theme: ThemeSettings;
  textColor: string;
  mutedTextColor: string;
  appearance?: SolarWidgetConfig["appearance"];
  compact?: boolean;
  veryCompact?: boolean;
  sceneScale?: number;
  showPanel?: boolean;
  valueColor?: string;
  valueSizeBoost?: number;
  valueWeight?: "400" | "500" | "600" | "700" | "800";
}) {
  const baseScale = clamp(sceneScale ?? 1, 0.52, 1);
  const compactFactor = veryCompact ? 0.84 : compact ? 0.92 : 1;
  const scale = clamp(baseScale * compactFactor, 0.5, 1);
  const panelEnabled = showPanel !== false;
  const paddingH = panelEnabled ? Math.round(clamp(10 * scale, 6, 10)) : 0;
  const paddingV = panelEnabled ? Math.round(clamp(8 * scale, 5, 8)) : 0;
  const radius = Math.round(clamp(12 * scale, 8, 12));
  const labelSize = Math.round(clamp(11 * scale, 8, 12));
  const valueScale = clamp(valueSizeBoost ?? 1, 0.82, 1.8);
  const valueSize = Math.round(clamp(17 * scale * valueScale, 12, 34));
  const rowGap = Math.round(clamp(6 * scale, 3, 6));

  return (
    <View
      style={[
        panelEnabled ? styles.externalInfo : styles.externalInfoPlain,
        panelEnabled
          ? {
              backgroundColor: appearance?.cardColor || theme.solar.nodeCardBackground,
              borderColor: theme.solar.nodeCardBorder,
              paddingHorizontal: paddingH,
              paddingVertical: paddingV,
              borderRadius: radius,
            }
          : null,
        style,
      ]}
    >
      {lines.map((line, index) => (
        <View
          key={`${index}-${line.label || "value"}-${line.value}`}
          style={[styles.externalInfoRow, index > 0 ? { marginTop: rowGap } : null]}
        >
          {line.label ? (
            <Text numberOfLines={1} style={[styles.externalInfoLabel, { color: mutedTextColor, fontSize: labelSize }]}>
              {line.label}
            </Text>
          ) : null}
          <Text
            numberOfLines={1}
            style={[
              styles.externalInfoValue,
              {
                color: valueColor || textColor,
                fontSize: valueSize,
                fontWeight: valueWeight || "500",
              },
            ]}
          >
            {line.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function MiniStat({
  appearance,
  label,
  value,
  theme,
  textColor,
  mutedTextColor,
  compact,
  scale,
  textScale,
  style,
}: {
  appearance?: SolarWidgetConfig["appearance"];
  label: string;
  value: string;
  theme: ThemeSettings;
  textColor: string;
  mutedTextColor: string;
  compact?: boolean;
  scale?: number;
  textScale?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const effectiveScale = clamp((scale ?? 1) * (compact ? 0.9 : 1), 0.45, 1);
  const effectiveTextScale = clamp(textScale ?? 1, 0.6, 2);
  const cardPadding = Math.round(clamp(12 * effectiveScale, 6, 12));
  const cardRadius = Math.round(clamp(16 * effectiveScale, 10, 16));
  const valueFontSize = Math.round(clamp(18 * effectiveScale * effectiveTextScale, 9, 30));
  const labelFontSize = Math.round(clamp(12 * effectiveScale * effectiveTextScale, 7, 20));

  return (
    <View
      style={[
        styles.mini,
        {
          backgroundColor: appearance?.statColor || theme.solar.statCardBackground,
          borderColor: theme.solar.statCardBorder,
          padding: cardPadding,
          borderRadius: cardRadius,
        },
        compact ? styles.miniCompact : null,
        style,
      ]}
    >
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        numberOfLines={1}
        style={[
          styles.miniValue,
          compact ? styles.miniValueCompact : null,
          { color: textColor, fontSize: valueFontSize, lineHeight: Math.round(valueFontSize * 1.12) },
        ]}
      >
        {value}
      </Text>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        numberOfLines={1}
        style={[
          styles.miniLabel,
          compact ? styles.miniLabelCompact : null,
          { color: mutedTextColor, fontSize: labelFontSize, lineHeight: Math.round(labelFontSize * 1.15) },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  const match = String(v).trim().replace(",", ".").match(/-?\d+(\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveOptionalStateId(candidate: string | undefined, fallback: string) {
  const trimmed = String(candidate || "").trim();
  return trimmed || fallback;
}

function resolveWallboxChargePowerW({
  chargePowerRaw,
  ampere,
  phaseModeRaw,
}: {
  chargePowerRaw: unknown;
  ampere: number | null;
  phaseModeRaw: unknown;
}) {
  const normalizedDirect = normalizePowerToWatts(chargePowerRaw);
  if (normalizedDirect !== null) {
    return normalizedDirect;
  }

  if (ampere === null) {
    return null;
  }

  const phaseCount = inferPhaseCountFromMode(phaseModeRaw);
  const estimated = ampere * 230 * phaseCount;
  return Number.isFinite(estimated) ? estimated : null;
}

function normalizePowerToWatts(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) > 80 ? value : value * 1000;
  }

  const normalized = String(value).trim().toLowerCase().replace(",", ".");
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/-?\d+(\.\d+)?/);
  if (!match) {
    return null;
  }

  const numeric = Number(match[0]);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (normalized.includes("kw")) {
    return numeric * 1000;
  }
  if (normalized.includes("w")) {
    return numeric;
  }

  return Math.abs(numeric) > 80 ? numeric : numeric * 1000;
}

function inferPhaseCountFromMode(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    normalized === "2" ||
    normalized === "1p" ||
    normalized === "single" ||
    normalized === "single_phase" ||
    normalized === "one_phase"
  ) {
    return 1;
  }
  if (
    normalized === "3" ||
    normalized === "3p" ||
    normalized === "three" ||
    normalized === "three_phase"
  ) {
    return 3;
  }
  return 1;
}

function normalizeEnergyToKWh(
  value: unknown,
  configuredUnit: SolarWidgetConfig["dailyEnergyUnit"] = "auto"
) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replace(",", ".");
    const match = normalized.match(/-?\d+(\.\d+)?/);
    if (!match) {
      return null;
    }

    const numeric = Number(match[0]);
    if (!Number.isFinite(numeric)) {
      return null;
    }

    if (normalized.includes("mwh")) {
      return numeric * 1000;
    }
    if (normalized.includes("kwh")) {
      return numeric;
    }
    if (normalized.includes("wh")) {
      return numeric / 1000;
    }

    return numericToKWh(numeric, configuredUnit);
  }

  const numeric = asNumber(value);
  if (numeric === null) {
    return null;
  }

  return numericToKWh(numeric, configuredUnit);
}

function numericToKWh(
  numeric: number,
  configuredUnit: SolarWidgetConfig["dailyEnergyUnit"] = "auto"
) {
  if (configuredUnit === "kWh") {
    return numeric;
  }
  if (configuredUnit === "Wh") {
    return numeric / 1000;
  }
  if (Math.abs(numeric) > 100) {
    return numeric / 1000;
  }
  return numeric;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function dirFromSigned(value: number, threshold = 20): FlowDir {
  if (Math.abs(value) < threshold) {
    return "idle";
  }
  return value > 0 ? "toHome" : "fromHome";
}

function fmtW(n: number | null) {
  if (n === null) {
    return "—";
  }
  return `${(n / 1000).toFixed(1)} kW`;
}

function fmtKWh(n: number | null) {
  if (n === null) {
    return "—";
  }
  if (Math.abs(n) >= 1000) {
    return `${(n / 1000).toFixed(2)} MWh`;
  }
  return `${n.toFixed(1)} kWh`;
}

function resolveSolarStatCards(
  config: SolarWidgetConfig,
  states: StateSnapshot,
  daySelfKWh: number | null,
  dayConsumedKWh: number | null
) {
  const statDefinitions = resolveSolarStatDefinitions(config);
  return statDefinitions.flatMap((entry, index) => {
    // Keep Stat 1/2 as core KPIs, but hide unconfigured optional cards (Stat 3-6).
    if (index >= 2 && !entry.stateId) {
      return [];
    }

    const rawValue = entry.stateId ? states[entry.stateId] : undefined;
    const fallback = index === 0 ? fmtKWh(daySelfKWh) : index === 1 ? fmtKWh(dayConsumedKWh) : "—";
    return [
      {
        label: entry.label,
        value: resolveSolarStatValue(rawValue, fallback, config.statValueUnit || "none"),
      },
    ];
  });
}

function resolveSolarStatDefinitions(config: SolarWidgetConfig) {
  const legacyCards = [config.stats?.first, config.stats?.second, config.stats?.third].filter(Boolean) as Array<{
    label: string;
    stateId?: string;
  }>;
  const configuredCards =
    Array.isArray(config.stats?.cards) && config.stats.cards.length ? config.stats.cards : legacyCards;
  const configuredCount = Number.isFinite(config.stats?.count) ? Number(config.stats?.count) : configuredCards.length;
  const count = clamp(Math.round(configuredCount || 2), 1, SOLAR_MAX_STAT_CARDS);

  return Array.from({ length: count }, (_, index) => {
    const source = configuredCards[index];
    const label = (source?.label || SOLAR_DEFAULT_STAT_LABELS[index] || `Stat ${index + 1}`).trim();
    const stateId = (source?.stateId || "").trim() || undefined;
    return {
      label: label || `Stat ${index + 1}`,
      stateId,
    };
  });
}

function normalizeSolarTapAction(raw: SolarWidgetConfig["tapAction"] | undefined) {
  if (raw?.type === "dashboard" && typeof raw.dashboardId === "string" && raw.dashboardId.trim()) {
    return { type: "dashboard" as const, dashboardId: raw.dashboardId.trim() };
  }
  if (raw?.type === "url" && typeof raw.url === "string" && raw.url.trim()) {
    return { type: "url" as const, url: raw.url.trim() };
  }
  return { type: "none" as const };
}

function normalizeExternalUrl(raw: string) {
  const value = raw.trim();
  if (!value) {
    return "";
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return `https://${value}`;
}

function resolveSolarStatValue(
  rawValue: unknown,
  fallback: string,
  unit: SolarWidgetConfig["statValueUnit"] = "none"
) {
  if (rawValue === undefined) {
    return fallback;
  }
  if (rawValue === null) {
    return "—";
  }

  const parsedNumber = asNumber(rawValue);

  if (parsedNumber !== null && unit && unit !== "none") {
    return formatSolarStatNumberWithUnit(parsedNumber, unit);
  }

  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    if (Math.abs(rawValue) >= 1000) {
      return rawValue.toLocaleString("de-DE", { maximumFractionDigits: 0 });
    }
    if (Number.isInteger(rawValue)) {
      return String(rawValue);
    }
    return rawValue.toLocaleString("de-DE", { maximumFractionDigits: 1 });
  }
  return String(rawValue);
}

function formatSolarStatNumberWithUnit(value: number, unit: "W" | "kW" | "Wh" | "kWh") {
  const fractionDigits = unit === "kW" || unit === "kWh" ? 1 : 0;
  const formatted = value.toLocaleString("de-DE", { maximumFractionDigits: fractionDigits });
  return `${formatted} ${unit}`;
}

function resolveBatteryIcon(soc: number | null): keyof typeof MaterialCommunityIcons.glyphMap {
  if (soc === null) {
    return "battery-outline";
  }

  const percent = clamp(Math.round(soc), 0, 100);
  if (percent >= 95) {
    return "battery";
  }
  if (percent >= 75) {
    return "battery-80";
  }
  if (percent >= 50) {
    return "battery-50";
  }
  if (percent >= 25) {
    return "battery-30";
  }
  if (percent > 0) {
    return "battery-10";
  }
  return "battery-outline";
}

function getDefaultNodeLayout(): SolarLayoutConfig {
  return {
    pv: { x: 0.4, y: 0.03, w: 0.2, h: 0.12 },
    home: { x: 0.39, y: 0.43, w: 0.22, h: 0.16 },
    battery: { x: 0.03, y: 0.45, w: 0.19, h: 0.16 },
    grid: { x: 0.78, y: 0.45, w: 0.19, h: 0.16 },
    car: { x: 0.37, y: 0.74, w: 0.26, h: 0.1 },
  };
}

function resolveNodeBox(
  partial: Partial<SolarNodeLayout> | undefined,
  fallback: SolarNodeLayout,
  scene: { x?: number; y?: number; width: number; height: number }
) {
  const offsetX = Number.isFinite(scene.x) ? Number(scene.x) : 0;
  const offsetY = Number.isFinite(scene.y) ? Number(scene.y) : 0;
  const x = clamp(typeof partial?.x === "number" ? partial.x : fallback.x, 0, 1);
  const y = clamp(typeof partial?.y === "number" ? partial.y : fallback.y, 0, 1);
  const w = clamp(typeof partial?.w === "number" ? partial.w : fallback.w, 0.06, 0.4);
  const h = clamp(typeof partial?.h === "number" ? partial.h : fallback.h, 0.08, 0.4);
  const width = scene.width * w;
  const height = scene.height * h;
  const left = offsetX + clamp(scene.width * x, 0, Math.max(0, scene.width - width));
  const top = offsetY + clamp(scene.height * y, 0, Math.max(0, scene.height - height));

  return {
    x: left,
    y: top,
    w: width,
    h: height,
  };
}

function buildBlurredWidgetBackgroundStyle(imageName: string, blur: number) {
  return {
    position: "absolute",
    inset: "-18px",
    backgroundImage: `url("/smarthome-dashboard-v2/widget-assets/${encodeURIComponent(imageName)}")`,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "cover",
    filter: `blur(${blur}px)`,
    transform: "scale(1.04)",
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 12,
    position: "relative",
    overflow: "hidden",
  },
  containerActionable: {
    ...(Platform.OS === "web" ? ({ cursor: "pointer" } as const) : {}),
  },
  widgetBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  widgetBackgroundImage: {
    resizeMode: "cover",
  },
  widgetBackgroundOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5, 10, 18, 0.32)",
  },
  sceneCard: {
    borderRadius: 22,
    padding: 14,
    alignSelf: "stretch",
    minHeight: 0,
    flex: 1,
    borderWidth: 1,
    overflow: "hidden",
  },
  sceneCardCompact: {
    padding: 10,
  },
  sceneCardVeryCompact: {
    padding: 8,
  },
  scene: {
    flex: 1,
    position: "relative",
    backgroundColor: "rgba(0,0,0,0)",
  },
  lineVertical: {
    position: "absolute",
    width: 4,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  lineHorizontal: {
    position: "absolute",
    height: 4,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  flowDot: {
    position: "absolute",
    backgroundColor: palette.accentWarm,
    shadowColor: palette.accentWarm,
    shadowOpacity: 0.8,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  flowDotLowPower: {
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
  },
  nodePosition: {
    position: "absolute",
  },
  nodeCard: {
    position: "absolute",
    borderRadius: 20,
    padding: 10,
    alignItems: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  nodeCardCompact: {
    borderRadius: 16,
    padding: 8,
  },
  nodeCardVeryCompact: {
    borderRadius: 14,
    padding: 6,
  },
  nodeCardActive: {
    shadowOpacity: 0.2,
    shadowRadius: 14,
  },
  nodeIcon: {
    width: 40,
    height: 40,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  nodeIconCompact: {
    width: 34,
    height: 34,
    borderRadius: 12,
  },
  nodeIconVeryCompact: {
    width: 28,
    height: 28,
    borderRadius: 10,
  },
  nodeIconActive: {
    borderColor: "rgba(255,255,255,0.12)",
  },
  nodeIconInner: {
    width: 30,
    height: 30,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  nodeIconInnerCompact: {
    width: 26,
    height: 26,
    borderRadius: 10,
  },
  nodeIconInnerVeryCompact: {
    width: 22,
    height: 22,
    borderRadius: 8,
  },
  nodeLabel: {
    marginTop: 8,
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  nodeValue: {
    marginTop: 8,
    color: palette.text,
    fontSize: 16,
    fontWeight: "800",
  },
  nodeValueCompact: {
    marginTop: 10,
  },
  nodeValueCompactText: {
    marginTop: 8,
    fontSize: 14,
  },
  nodeValueVeryCompactText: {
    marginTop: 6,
    fontSize: 12,
  },
  nodeMeta: {
    marginTop: 4,
    color: palette.textMuted,
    fontSize: 9,
    maxWidth: "92%",
    textAlign: "center",
  },
  nodeMetaCompact: {
    marginTop: 2,
    fontSize: 8,
  },
  nodeMetaVeryCompact: {
    marginTop: 2,
    fontSize: 7,
  },
  externalInfo: {
    position: "absolute",
    borderWidth: 1,
    zIndex: 7,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    gap: 2,
  },
  externalInfoPlain: {
    position: "absolute",
    zIndex: 7,
    gap: 2,
  },
  externalInfoRow: {
    flexDirection: "column",
    alignItems: "center",
    marginTop: 0,
  },
  externalInfoLabel: {
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  externalInfoValue: {
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 19,
    textAlign: "center",
  },
  sceneStat: {
    position: "absolute",
    zIndex: 6,
    flexGrow: 0,
    flexBasis: "auto",
  },
  sceneStatLeft: {
    left: 0,
  },
  sceneStatRight: {
    right: 0,
  },
  mini: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  miniCompact: {
    flexBasis: 110,
    padding: 10,
    borderRadius: 14,
  },
  miniValue: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  miniValueCompact: {
    fontSize: 15,
  },
  miniLabel: {
    marginTop: 4,
    color: palette.textMuted,
    fontSize: 12,
    textAlign: "center",
  },
  miniLabelCompact: {
    marginTop: 3,
    fontSize: 11,
  },
  footnote: {
    color: palette.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  warning: {
    color: palette.danger,
    fontSize: 12,
    lineHeight: 18,
  },
});

const webFlowDotStyle: Record<string, string | number> = {
  position: "absolute",
  background: "#f7c65f",
  boxShadow: "0 0 10px rgba(247, 198, 95, 0.8)",
  transform: "translate3d(0, 0, 0)",
  backfaceVisibility: "hidden",
};

const webFlowDotLowPowerStyle: Record<string, string | number> = {
  boxShadow: "none",
};
