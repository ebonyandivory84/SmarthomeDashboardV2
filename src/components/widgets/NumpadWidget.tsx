import { Pressable, StyleSheet, Text, View } from "react-native";
import { NumpadWidgetConfig } from "../../types/dashboard";
import { playConfiguredUiSound } from "../../utils/uiSounds";

type NumpadWidgetProps = {
  config: NumpadWidgetConfig;
};

const ROWS = [
  ["7", "8", "9", "⌫"],
  ["4", "5", "6", "CLEAR"],
  ["1", "2", "3", "PREV"],
] as const;

const BOTTOM_ROW = ["*", "0", "#", "NEXT"] as const;

const ACCENT_BG = "#d9bea7";
const PANEL_BG = "#000000";
const KEY_BG = "#c79d79";
const LABEL_COLOR = "#1d1108";
const SOFT_BG = "#dac3ae";

function isAction(label: string) {
  return label === "CLEAR" || label === "PREV" || label === "NEXT" || label === "⌫" || label === "ENTER";
}

function buildSoundKey(raw: string) {
  if (raw === "⌫") {
    return "backspace";
  }
  if (raw === "#") {
    return "hash";
  }
  if (raw === "*") {
    return "star";
  }
  return raw.toLowerCase();
}

function playPress(config: NumpadWidgetConfig, label: string) {
  const eventType = isAction(label) ? "panel" : "tap";
  const sound = isAction(label) ? config.interactionSounds?.confirm : config.interactionSounds?.press;
  playConfiguredUiSound(sound, eventType, `${config.id}:press:${buildSoundKey(label)}`);
}

function Key({
  config,
  label,
  style,
}: {
  config: NumpadWidgetConfig;
  label: string;
  style?: object;
}) {
  const textColor = config.appearance?.textColor || LABEL_COLOR;
  const keyColor = config.appearance?.cardColor2 || KEY_BG;
  return (
    <Pressable
      onPress={() => playPress(config, label)}
      style={({ pressed }) => [styles.key, { backgroundColor: keyColor }, style, pressed ? styles.keyPressed : null]}
    >
      <Text numberOfLines={1} style={[styles.keyLabel, isAction(label) ? styles.keyLabelAction : null, { color: textColor }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function NumpadWidget({ config }: NumpadWidgetProps) {
  const textColor = config.appearance?.textColor || LABEL_COLOR;
  const panelColor = config.appearance?.cardColor || PANEL_BG;
  const frameColor = config.appearance?.widgetColor || ACCENT_BG;
  const softColor = config.appearance?.widgetColor2 || SOFT_BG;

  return (
    <View style={[styles.frame, { backgroundColor: frameColor }]}>
      <View style={styles.topRow}>
        <View style={[styles.topSpacer, { backgroundColor: frameColor }]} />
        <View style={[styles.rangeBox, { backgroundColor: KEY_BG }]}>
          <Text style={[styles.rangeLabel, { color: textColor }]}>RANGE: 0 - 100</Text>
        </View>
        <Pressable
          onPress={() => playPress(config, "ENTER")}
          style={({ pressed }) => [
            styles.enterBox,
            { backgroundColor: "#ad7b57" },
            pressed ? styles.keyPressed : null,
          ]}
        >
          <Text style={[styles.enterLabel, { color: textColor }]}>ENTER</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <View style={[styles.sideRail, { backgroundColor: softColor }]}>
          <View style={styles.sideRailTop} />
          <Pressable
            onPress={() => playPress(config, "123")}
            style={({ pressed }) => [styles.sideChip, { backgroundColor: softColor }, pressed ? styles.keyPressed : null]}
          >
            <Text style={[styles.sideChipLabel, { color: textColor }]}>123</Text>
          </Pressable>
        </View>

        <View style={[styles.panel, { backgroundColor: panelColor }]}>
          {ROWS.map((row, rowIndex) => (
            <View key={`row-${rowIndex}`} style={styles.row}>
              {row.map((label) => (
                <Key config={config} key={label} label={label} style={label === "⌫" ? styles.backspaceKey : undefined} />
              ))}
            </View>
          ))}

          <View style={styles.row}>
            <Key config={config} label={BOTTOM_ROW[0]} />
            <Key config={config} label={BOTTOM_ROW[1]} style={styles.zeroKey} />
            <Key config={config} label={BOTTOM_ROW[2]} />
            <Key config={config} label={BOTTOM_ROW[3]} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    borderRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 10,
    paddingBottom: 12,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  topSpacer: {
    width: 128,
    height: 34,
    borderTopLeftRadius: 22,
    borderBottomLeftRadius: 22,
  },
  rangeBox: {
    flex: 1,
    minHeight: 34,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  rangeLabel: {
    fontSize: 23,
    lineHeight: 25,
    letterSpacing: 0.4,
    fontWeight: "900",
  },
  enterBox: {
    width: 140,
    minHeight: 34,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  enterLabel: {
    fontSize: 23,
    lineHeight: 25,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  body: {
    flex: 1,
    flexDirection: "row",
    gap: 10,
  },
  sideRail: {
    width: 66,
    borderBottomLeftRadius: 0,
    borderTopLeftRadius: 24,
    alignItems: "center",
    paddingTop: 84,
  },
  sideRailTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 74,
    borderTopLeftRadius: 24,
    backgroundColor: "rgba(176, 126, 88, 0.56)",
  },
  sideChip: {
    marginTop: 14,
    width: 56,
    minHeight: 56,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  sideChipLabel: {
    fontSize: 23,
    lineHeight: 25,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  panel: {
    flex: 1,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: "center",
    gap: 10,
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  key: {
    flex: 1,
    minHeight: 46,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  backspaceKey: {
    minWidth: 136,
  },
  zeroKey: {
    flex: 1.3,
  },
  keyPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.985 }],
  },
  keyLabel: {
    fontSize: 35,
    lineHeight: 36,
    fontWeight: "900",
    letterSpacing: 0.7,
    textAlign: "center",
  },
  keyLabelAction: {
    fontSize: 27,
    lineHeight: 29,
    letterSpacing: 0.35,
  },
});
