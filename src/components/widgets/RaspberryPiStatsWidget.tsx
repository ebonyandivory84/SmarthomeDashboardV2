import { createElement } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { RaspberryPiStatsWidgetConfig, StateSnapshot } from "../../types/dashboard";
import { palette } from "../../utils/theme";

type RaspberryPiStatsWidgetProps = {
  config: RaspberryPiStatsWidgetConfig;
  states: StateSnapshot;
};

type RaspberryValueUnit = "auto" | "B" | "kB" | "MB" | "GB" | "percent";

type StorageMetric = {
  valueLabel: string;
  ratio: number | null;
};

export function RaspberryPiStatsWidget({ config, states }: RaspberryPiStatsWidgetProps) {
  const textColor = config.appearance?.textColor || palette.text;
  const mutedTextColor = config.appearance?.mutedTextColor || palette.textMuted;
  const panelStart = config.appearance?.widgetColor || "rgba(12, 26, 52, 0.95)";
  const panelEnd = config.appearance?.widgetColor2 || "rgba(6, 14, 28, 0.98)";
  const diskRingColor = config.appearance?.cardColor || "#6ce8b4";
  const diskTrackColor = config.appearance?.cardColor2 || "rgba(255,255,255,0.12)";
  const ramRingColor = config.appearance?.pvCardColor || "#73b9ff";
  const ramTrackColor = config.appearance?.homeCardColor || "rgba(255,255,255,0.12)";
  const cpuBarStart = config.appearance?.activeWidgetColor || "#65d6ff";
  const cpuBarEnd = config.appearance?.activeWidgetColor2 || "#4d86ff";
  const tempBarStart = config.appearance?.inactiveWidgetColor || "#ffcb67";
  const tempBarEnd = config.appearance?.inactiveWidgetColor2 || "#ff7f66";
  const statusBadgeStart = config.appearance?.statColor || "rgba(130, 182, 255, 0.24)";
  const statusBadgeEnd = config.appearance?.statColor2 || "rgba(89, 132, 238, 0.18)";

  const online = normalizeBoolean(states[config.onlineStateId]);
  const cpuLoad = normalizePercent(states[config.cpuLoadStateId]);
  const cpuTemp = normalizeTemperature(states[config.cpuTempStateId]);
  const cpuLoadLabel = cpuLoad === null ? "n/a" : `${cpuLoad.toFixed(1)} %`;
  const cpuTempLabel = cpuTemp === null ? "n/a" : `${cpuTemp.toFixed(1)} C`;
  const headerLabel = (config.label || config.title || "Raspberry Pi").trim() || "Raspberry Pi";

  const ramMetric = buildStorageMetric(states[config.ramFreeStateId], config.ramFreeUnit || "auto", "ramFree");
  const diskMetric = buildStorageMetric(states[config.diskFreeStateId], config.diskFreeUnit || "auto", "diskFree");
  const ramFreeRatio = ramMetric.ratio ?? ratioFromCompanionPercentState(states, config.ramFreeStateId, "ramFree");
  const diskFreeRatio = diskMetric.ratio ?? ratioFromCompanionPercentState(states, config.diskFreeStateId, "diskFree");
  const ramUsedRatio = ramFreeRatio === null ? null : clampNumber(1 - ramFreeRatio, 0, 1);
  const diskUsedRatio = diskFreeRatio === null ? null : clampNumber(1 - diskFreeRatio, 0, 1);
  const ramFreeLabel = ramMetric.valueLabel.toLowerCase() === "n/a" ? ramMetric.valueLabel : `${ramMetric.valueLabel} frei`;
  const diskFreeLabel = diskMetric.valueLabel.toLowerCase() === "n/a" ? diskMetric.valueLabel : `${diskMetric.valueLabel} frei`;

  return (
    <View style={styles.container}>
      <View style={[styles.panel, { backgroundColor: panelStart }]}>
        {Platform.OS === "web"
          ? createElement("div", {
              style: {
                ...webGradientStyle,
                background: `linear-gradient(135deg, ${panelStart} 0%, ${panelEnd} 100%)`,
              },
            })
          : null}

        <View style={styles.headerRow}>
          <Text numberOfLines={1} style={[styles.hostTitle, { color: textColor }]}>
            {headerLabel}
          </Text>
          <View
            style={[
              styles.statusBadge,
              Platform.OS !== "web"
                ? { backgroundColor: statusBadgeStart }
                : null,
            ]}
          >
            {Platform.OS === "web"
              ? createElement("div", {
                  style: {
                    ...webGradientStyle,
                    borderRadius: 999,
                    background: `linear-gradient(120deg, ${statusBadgeStart}, ${statusBadgeEnd})`,
                  },
                })
              : null}
            <Text style={[styles.statusBadgeLabel, { color: textColor }]}>
              {online === null ? "Status: n/a" : online ? "Status: Online" : "Status: Offline"}
            </Text>
          </View>
        </View>

        <View style={styles.topRow}>
          <MetricDonut
            label="Festplatte genutzt"
            ratio={diskUsedRatio}
            ringColor={diskRingColor}
            trackColor={diskTrackColor}
            textColor={textColor}
            mutedTextColor={mutedTextColor}
            valueLabel={diskFreeLabel}
          />
          <MetricDonut
            label="RAM genutzt"
            ratio={ramUsedRatio}
            ringColor={ramRingColor}
            trackColor={ramTrackColor}
            textColor={textColor}
            mutedTextColor={mutedTextColor}
            valueLabel={ramFreeLabel}
          />
        </View>

        <HorizontalMetricBar
          endColor={cpuBarEnd}
          label="CPU Last"
          mutedTextColor={mutedTextColor}
          ratio={cpuLoad === null ? null : cpuLoad / 100}
          startColor={cpuBarStart}
          textColor={textColor}
          valueLabel={cpuLoadLabel}
        />

        <HorizontalMetricBar
          endColor={tempBarEnd}
          label="CPU Temperatur"
          mutedTextColor={mutedTextColor}
          ratio={cpuTemp === null ? null : clampNumber(cpuTemp / 100, 0, 1)}
          startColor={tempBarStart}
          textColor={textColor}
          valueLabel={cpuTempLabel}
        />

        <Text numberOfLines={1} style={[styles.footerText, { color: mutedTextColor }]}>
          Einheiten: RAM {config.ramFreeUnit || "auto"} | Disk {config.diskFreeUnit || "auto"}
        </Text>
      </View>
    </View>
  );
}

type MetricDonutProps = {
  label: string;
  valueLabel: string;
  ratio: number | null;
  ringColor: string;
  trackColor: string;
  textColor: string;
  mutedTextColor: string;
};

function MetricDonut({
  label,
  valueLabel,
  ratio,
  ringColor,
  trackColor,
  textColor,
  mutedTextColor,
}: MetricDonutProps) {
  const normalizedValue = valueLabel.trim();
  const hasValue = normalizedValue.length > 0 && normalizedValue.toLowerCase() !== "n/a";
  const hasRatio = ratio !== null;
  const primaryText = hasRatio ? `${Math.round(ratio * 100)}%` : hasValue ? normalizedValue : "n/a";
  const showMeta = hasRatio && hasValue;

  const donut =
    Platform.OS === "web"
      ? createElement(
          "div",
          {
            style: {
              ...webDonutStyle,
              background: buildDonutGradient(ratio, ringColor, trackColor),
            },
          },
          createElement("div", { style: webDonutHoleStyle })
        )
      : (
          <View style={[styles.nativeRing, { borderColor: trackColor }]}>
            <View style={[styles.nativeRingFill, { borderColor: ringColor }]} />
          </View>
        );

  return (
    <View style={styles.metricCard}>
      <View style={styles.donutWrap}>{donut}</View>
      <Text style={[styles.metricValue, !hasRatio && hasValue ? styles.metricValueCompact : null, { color: textColor }]}>
        {primaryText}
      </Text>
      <Text style={[styles.metricLabel, { color: mutedTextColor }]}>{label}</Text>
      {showMeta ? (
        <Text numberOfLines={1} style={[styles.metricMeta, { color: mutedTextColor }]}>
          {valueLabel}
        </Text>
      ) : null}
    </View>
  );
}

type HorizontalMetricBarProps = {
  label: string;
  valueLabel: string;
  ratio: number | null;
  startColor: string;
  endColor: string;
  textColor: string;
  mutedTextColor: string;
};

function HorizontalMetricBar({
  label,
  valueLabel,
  ratio,
  startColor,
  endColor,
  textColor,
  mutedTextColor,
}: HorizontalMetricBarProps) {
  const fillRatio = ratio === null ? 0 : clampNumber(ratio, 0, 1);

  return (
    <View style={styles.barBlock}>
      <View style={styles.barHeader}>
        <Text style={[styles.barLabel, { color: mutedTextColor }]}>{label}</Text>
        <Text style={[styles.barValue, { color: textColor }]}>{valueLabel}</Text>
      </View>
      <View style={styles.barTrack}>
        {Platform.OS === "web"
          ? createElement("div", {
              style: {
                ...webBarFillStyle,
                width: `${Math.max(0, Math.min(100, fillRatio * 100))}%`,
                background: `linear-gradient(90deg, ${startColor} 0%, ${endColor} 100%)`,
              },
            })
          : (
              <View
                style={[
                  styles.nativeBarFill,
                  {
                    width: `${Math.max(0, Math.min(100, fillRatio * 100))}%`,
                    backgroundColor: startColor,
                  },
                ]}
              />
            )}
      </View>
    </View>
  );
}

function buildStorageMetric(
  rawValue: unknown,
  unit: RaspberryValueUnit,
  key: "ramFree" | "diskFree"
): StorageMetric {
  const numeric = normalizeNumber(rawValue);

  if (typeof rawValue === "string" && rawValue.trim() && unit === "auto") {
    return {
      valueLabel: rawValue.trim(),
      ratio: inferRatioFromString(rawValue),
    };
  }

  if (numeric === null) {
    return {
      valueLabel: "n/a",
      ratio: null,
    };
  }

  if (unit === "percent") {
    const normalizedPercent = clampNumber(numeric, 0, 100);
    return {
      valueLabel: `${normalizedPercent.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`,
      ratio: normalizedPercent / 100,
    };
  }

  if (unit === "auto") {
    if (numeric >= 0 && numeric <= 100) {
      const normalizedPercent = clampNumber(numeric, 0, 100);
      return {
        valueLabel: `${normalizedPercent.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`,
        ratio: normalizedPercent / 100,
      };
    }

    return {
      valueLabel: formatBytes(numeric),
      ratio: null,
    };
  }

  let displayValue = numeric;
  // Legacy compatibility: many ioBroker scripts publish RAM in MB.
  // If widget unit is set to GB and the value is unrealistically high for RAM-in-GB,
  // treat it as MB and convert to GB for display.
  if (key === "ramFree" && unit === "GB" && displayValue > 128) {
    displayValue /= 1024;
  }

  return {
    valueLabel: formatValueInUnit(displayValue, unit),
    ratio: null,
  };
}

function ratioFromCompanionPercentState(
  states: StateSnapshot,
  stateId: string,
  key: "ramFree" | "diskFree"
) {
  const companionStateId = inferRaspberryPercentStateId(stateId, key);
  if (!companionStateId) {
    return null;
  }

  const percent = normalizePercent(states[companionStateId]);
  if (percent === null) {
    return null;
  }

  return percent / 100;
}

function inferRaspberryPercentStateId(stateId: string, key: "ramFree" | "diskFree") {
  const trimmed = stateId.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.toLowerCase().includes("percent")) {
    return trimmed;
  }

  const suffix = `.${key}`;
  if (trimmed.endsWith(suffix)) {
    return `${trimmed}Percent`;
  }

  return "";
}

function inferRatioFromString(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized.includes("%")) {
    return null;
  }
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return null;
  }
  return clampNumber(numeric / 100, 0, 1);
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "on" || normalized === "online") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "off" || normalized === "offline") {
    return false;
  }
  return null;
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    if (!normalized) {
      return null;
    }
    const direct = Number(normalized);
    if (Number.isFinite(direct)) {
      return direct;
    }
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function normalizePercent(value: unknown) {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return null;
  }
  if (numeric >= 0 && numeric <= 1.2) {
    return clampNumber(numeric * 100, 0, 100);
  }
  return clampNumber(numeric, 0, 100);
}

function normalizeTemperature(value: unknown) {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return null;
  }
  const normalized = numeric > 1000 ? numeric / 1000 : numeric;
  return clampNumber(normalized, 0, 150);
}

function buildDonutGradient(ratio: number | null, activeColor: string, inactiveColor: string) {
  const safeRatio = ratio === null ? 0 : clampNumber(ratio, 0, 1);
  const splitDeg = Math.round(safeRatio * 360);
  return `conic-gradient(${activeColor} 0deg ${splitDeg}deg, ${inactiveColor} ${splitDeg}deg 360deg)`;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatValueInUnit(value: number, unit: Exclude<RaspberryValueUnit, "auto" | "percent">) {
  if (!Number.isFinite(value) || value < 0) {
    return "n/a";
  }

  const maximumFractionDigits = unit === "B" ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toLocaleString("de-DE", { maximumFractionDigits })} ${unit}`;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return "n/a";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let remaining = value;
  let unitIndex = 0;
  while (remaining >= 1024 && unitIndex < units.length - 1) {
    remaining /= 1024;
    unitIndex += 1;
  }

  const fixed = remaining >= 100 || unitIndex === 0 ? 0 : remaining >= 10 ? 1 : 2;
  return `${remaining.toFixed(fixed)} ${units[unitIndex]}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
  panel: {
    flex: 1,
    minHeight: 0,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  hostTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    overflow: "hidden",
    position: "relative",
  },
  statusBadgeLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  topRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
    padding: 9,
    alignItems: "center",
    gap: 2,
  },
  donutWrap: {
    width: 74,
    height: 74,
    alignItems: "center",
    justifyContent: "center",
  },
  nativeRing: {
    width: 72,
    height: 72,
    borderRadius: 999,
    borderWidth: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  nativeRingFill: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 8,
    transform: [{ rotate: "-90deg" }],
  },
  metricValue: {
    fontSize: 18,
    fontWeight: "800",
  },
  metricValueCompact: {
    fontSize: 16,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  metricMeta: {
    fontSize: 10,
    fontWeight: "600",
  },
  barBlock: {
    gap: 5,
  },
  barHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  barLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  barValue: {
    fontSize: 12,
    fontWeight: "800",
  },
  barTrack: {
    height: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  nativeBarFill: {
    height: "100%",
    borderRadius: 999,
  },
  footerText: {
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
});

const webGradientStyle = {
  position: "absolute" as const,
  inset: 0,
  pointerEvents: "none" as const,
};

const webDonutStyle = {
  width: "72px",
  height: "72px",
  borderRadius: "999px",
  position: "relative" as const,
};

const webDonutHoleStyle = {
  position: "absolute" as const,
  inset: "12px",
  borderRadius: "999px",
  background: "rgba(8, 14, 24, 0.92)",
  border: "1px solid rgba(255,255,255,0.08)",
};

const webBarFillStyle = {
  height: "100%",
  borderRadius: "999px",
  minWidth: "0%",
};
