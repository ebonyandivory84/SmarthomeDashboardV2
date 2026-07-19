import { createElement, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import { HostStatsWidgetConfig, IoBrokerHostStats } from "../../types/dashboard";
import { palette } from "../../utils/theme";

type HostStatsWidgetProps = {
  config: HostStatsWidgetConfig;
  client: IoBrokerClient;
  isActivePage?: boolean;
};

export function HostStatsWidget({ config, client, isActivePage = true }: HostStatsWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible;
  const [stats, setStats] = useState<IoBrokerHostStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshMs = clampInt(config.refreshMs, 5000, 1500);

  useEffect(() => {
    if (!runtimeActive) {
      return;
    }
    let active = true;
    let inFlight = false;
    let pending = false;

    const sync = async () => {
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      try {
        const payload = await client.readHostStats();
        if (active) {
          setStats(payload);
          setError(null);
        }
      } catch (syncError) {
        if (active) {
          setError(syncError instanceof Error ? syncError.message : "Host-Stats konnten nicht geladen werden");
        }
      } finally {
        inFlight = false;
        if (active && pending) {
          pending = false;
          void sync();
        }
      }
    };

    void sync();
    const timer = setInterval(() => {
      void sync();
    }, refreshMs);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [client, refreshMs, runtimeActive]);

  const textColor = config.appearance?.textColor || palette.text;
  const mutedTextColor = config.appearance?.mutedTextColor || palette.textMuted;
  const panelStart = config.appearance?.widgetColor || "rgba(12, 26, 52, 0.95)";
  const panelEnd = config.appearance?.widgetColor2 || "rgba(6, 14, 28, 0.98)";
  const diskUsedColor = config.appearance?.cardColor || "#6ce8b4";
  const diskFreeColor = config.appearance?.cardColor2 || "rgba(255,255,255,0.12)";
  const ramUsedColor = config.appearance?.pvCardColor || "#73b9ff";
  const ramFreeColor = config.appearance?.homeCardColor || "rgba(255,255,255,0.12)";
  const cpuBarStart = config.appearance?.activeWidgetColor || "#65d6ff";
  const cpuBarEnd = config.appearance?.activeWidgetColor2 || "#4d86ff";
  const tempBarStart = config.appearance?.inactiveWidgetColor || "#ffcb67";
  const tempBarEnd = config.appearance?.inactiveWidgetColor2 || "#ff7f66";
  const processBadgeStart = config.appearance?.statColor || "rgba(130, 182, 255, 0.24)";
  const processBadgeEnd = config.appearance?.statColor2 || "rgba(89, 132, 238, 0.18)";

  const diskRatio = ratioFromBytes(stats?.diskTotalBytes ?? null, stats?.diskFreeBytes ?? null);
  const ramRatio = ratioFromBytes(stats?.ramTotalBytes ?? null, stats?.ramFreeBytes ?? null);
  const cpuPercent = clampPercent(stats?.cpuUsagePercent ?? null);
  const temperature = normalizeTemperature(stats?.cpuTemperatureC ?? null);
  const tempRatio = temperature === null ? null : clampNumber(temperature / 100, 0, 1);

  const hostLabel = (config.hostLabel || stats?.hostName || "Host").trim() || "Host";
  const footerText = useMemo(() => {
    if (error) {
      return error;
    }
    if (!stats?.ts) {
      return "Warte auf Host-Daten...";
    }
    return `Aktualisiert: ${new Date(stats.ts).toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })}`;
  }, [error, stats?.ts]);

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
            {hostLabel}
          </Text>
          <View
            style={[
              styles.processBadge,
              Platform.OS !== "web"
                ? { backgroundColor: processBadgeStart }
                : null,
            ]}
          >
            {Platform.OS === "web"
              ? createElement("div", {
                  style: {
                    ...webGradientStyle,
                    borderRadius: 999,
                    background: `linear-gradient(120deg, ${processBadgeStart}, ${processBadgeEnd})`,
                  },
                })
              : null}
            <Text style={[styles.processBadgeLabel, { color: textColor }]}>Prozesse: {formatInteger(stats?.processes)}</Text>
          </View>
        </View>

        <View style={styles.topRow}>
          <MetricDonut
            freeBytes={stats?.diskFreeBytes ?? null}
            freeColor={diskFreeColor}
            label="Festplatte"
            mutedTextColor={mutedTextColor}
            ratio={diskRatio}
            textColor={textColor}
            totalBytes={stats?.diskTotalBytes ?? null}
            usedColor={diskUsedColor}
          />
          <MetricDonut
            freeBytes={stats?.ramFreeBytes ?? null}
            freeColor={ramFreeColor}
            label="RAM"
            mutedTextColor={mutedTextColor}
            ratio={ramRatio}
            textColor={textColor}
            totalBytes={stats?.ramTotalBytes ?? null}
            usedColor={ramUsedColor}
          />
        </View>

        <HorizontalMetricBar
          endColor={cpuBarEnd}
          label="CPU Nutzung"
          mutedTextColor={mutedTextColor}
          ratio={cpuPercent === null ? null : cpuPercent / 100}
          startColor={cpuBarStart}
          textColor={textColor}
          valueLabel={cpuPercent === null ? "n/a" : `${cpuPercent.toFixed(1)} %`}
        />

        <HorizontalMetricBar
          endColor={tempBarEnd}
          label="CPU Temperatur"
          mutedTextColor={mutedTextColor}
          ratio={tempRatio}
          startColor={tempBarStart}
          textColor={textColor}
          valueLabel={temperature === null ? "n/a" : `${temperature.toFixed(1)} °C`}
        />

        <Text numberOfLines={1} style={[styles.footerText, { color: error ? palette.danger : mutedTextColor }]}>
          {footerText}
        </Text>
      </View>
    </View>
  );
}

type MetricDonutProps = {
  label: string;
  ratio: number | null;
  totalBytes: number | null;
  freeBytes: number | null;
  usedColor: string;
  freeColor: string;
  textColor: string;
  mutedTextColor: string;
};

function MetricDonut({
  label,
  ratio,
  totalBytes,
  freeBytes,
  usedColor,
  freeColor,
  textColor,
  mutedTextColor,
}: MetricDonutProps) {
  const percentText = ratio === null ? "n/a" : `${Math.round(ratio * 100)}%`;
  const usedBytes =
    totalBytes !== null && freeBytes !== null && Number.isFinite(totalBytes) && Number.isFinite(freeBytes)
      ? Math.max(0, totalBytes - freeBytes)
      : null;

  const donut =
    Platform.OS === "web"
      ? createElement(
          "div",
          {
            style: {
              ...webDonutStyle,
              background: buildDonutGradient(ratio, usedColor, freeColor),
            },
          },
          createElement("div", { style: webDonutHoleStyle })
        )
      : (
          <View style={[styles.nativeRing, { borderColor: freeColor }]}>
            <View style={[styles.nativeRingFill, { borderColor: usedColor }]} />
          </View>
        );

  return (
    <View style={styles.metricCard}>
      <View style={styles.donutWrap}>{donut}</View>
      <Text style={[styles.metricValue, { color: textColor }]}>{percentText}</Text>
      <Text style={[styles.metricLabel, { color: mutedTextColor }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.metricMeta, { color: mutedTextColor }]}>
        {usedBytes === null ? "-" : `${formatBytes(usedBytes)} genutzt`}
      </Text>
      <Text numberOfLines={1} style={[styles.metricMeta, { color: mutedTextColor }]}>
        {freeBytes === null ? "-" : `${formatBytes(freeBytes)} frei`}
      </Text>
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

function buildDonutGradient(ratio: number | null, usedColor: string, freeColor: string) {
  const safeRatio = ratio === null ? 0 : clampNumber(ratio, 0, 1);
  const splitDeg = Math.round(safeRatio * 360);
  return `conic-gradient(${usedColor} 0deg ${splitDeg}deg, ${freeColor} ${splitDeg}deg 360deg)`;
}

function ratioFromBytes(totalBytes: number | null, freeBytes: number | null) {
  if (
    typeof totalBytes !== "number" ||
    typeof freeBytes !== "number" ||
    !Number.isFinite(totalBytes) ||
    !Number.isFinite(freeBytes) ||
    totalBytes <= 0
  ) {
    return null;
  }
  const used = Math.max(0, totalBytes - freeBytes);
  return clampNumber(used / totalBytes, 0, 1);
}

function clampInt(value: number | undefined, fallback: number, min: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.round(value));
}

function clampPercent(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return clampNumber(value, 0, 100);
}

function normalizeTemperature(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return clampNumber(value, 0, 150);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatInteger(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return Math.round(value).toLocaleString("de-DE");
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
  processBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    overflow: "hidden",
    position: "relative",
  },
  processBadgeLabel: {
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
