import { createElement, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

/**
 * Leichte analoge Zeigeranzeige fuer Leistungswerte.
 *
 * Bewusst ohne SVG-Filter aufgebaut (die Anzeige im WallboxAnalog-Widget nutzt
 * mehrere feGaussianBlur-Filter, was auf der Mali-T860 des RK3399 pro Frame
 * Compositing-Zeit kostet). Der Farbverlauf entsteht aus einem einzigen
 * linearGradient ueber die Bounding-Box: links Minimum in Gruen, rechts Maximum
 * in Rot, in der Mitte Gelb.
 */

const GAUGE_VIEWBOX_W = 200;
const GAUGE_VIEWBOX_H = 104;
const GAUGE_CX = GAUGE_VIEWBOX_W / 2;
const GAUGE_CY = 98;
const GAUGE_RADIUS = 76;
/** Exakt 90 Grad je Seite: der Bogen ist damit ein echter Halbkreis. */
const GAUGE_SWEEP_DEG = 90;
const GAUGE_TICK_COUNT = 25;
const GAUGE_ARC_STROKE = 13;
const GAUGE_NEEDLE_LENGTH = GAUGE_RADIUS - 14;
const GAUGE_NEEDLE_HALF_WIDTH = 3.6;

const COLOR_LOW = [61, 220, 132] as const;
const COLOR_MID = [242, 201, 76] as const;
const COLOR_HIGH = [235, 87, 87] as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function polarPoint(radius: number, angleFromTopDeg: number) {
  const rad = ((angleFromTopDeg - 90) * Math.PI) / 180;
  return {
    x: GAUGE_CX + radius * Math.cos(rad),
    y: GAUGE_CY + radius * Math.sin(rad),
  };
}

function mixChannel(from: readonly number[], to: readonly number[], t: number, index: number) {
  return Math.round(from[index] + (to[index] - from[index]) * t);
}

/** Farbe zum Skalenanteil: gruen bei 0, gelb bei 0.5, rot bei 1. */
export function powerGaugeColor(ratio: number) {
  const r = clamp(ratio, 0, 1);
  const [from, to, t] = r < 0.5 ? [COLOR_LOW, COLOR_MID, r * 2] : [COLOR_MID, COLOR_HIGH, (r - 0.5) * 2];
  return `rgb(${mixChannel(from, to, t, 0)}, ${mixChannel(from, to, t, 1)}, ${mixChannel(from, to, t, 2)})`;
}

function arcPath(radius: number, fromDeg: number, toDeg: number) {
  const start = polarPoint(radius, fromDeg);
  const end = polarPoint(radius, toDeg);
  const largeArc = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

export type PowerGaugeProps = {
  /** Messwert in der gewaehlten Einheit. null zeigt eine leere Anzeige mit Nadel am Minimum. */
  value: number | null;
  minKw: number;
  maxKw: number;
  label: string;
  /** Eindeutig je Instanz - die Gradient-IDs im SVG muessen kollisionsfrei sein. */
  instanceId: string;
  size?: number;
  mutedTextColor: string;
  textColor: string;
  /** Einheit fuer Messwert-Anzeige, z.B. "kW" oder "%". */
  unit?: string;
  /** Icon anstelle der Textbeschriftung; die Beschriftung kann zusaetzlich per showLabel eingeblendet werden. */
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  /** Textbeschriftung unter dem Icon anzeigen. Ohne icon wird die Beschriftung immer angezeigt. */
  showLabel?: boolean;
};

export function PowerGauge({
  value,
  minKw,
  maxKw,
  label,
  instanceId,
  size = 148,
  mutedTextColor,
  textColor,
  unit = "kW",
  icon,
  showLabel = true,
}: PowerGaugeProps) {
  const span = maxKw - minKw > 0 ? maxKw - minKw : 1;
  const ratio = value === null ? 0 : clamp((value - minKw) / span, 0, 1);
  // Auf 0.5 % quantisiert: ohne das wuerde jede Nachkommastelle einer
  // Leistungsmessung das komplette SVG neu aufbauen.
  const quantizedRatio = Math.round(ratio * 200) / 200;
  const valueColor = powerGaugeColor(quantizedRatio);
  const valueText =
    value === null ? "--" : unit === "%" ? `${Math.round(value)}` : value.toFixed(value >= 10 ? 1 : 2);

  const gaugeSvg = useMemo(() => {
    if (Platform.OS !== "web") {
      return null;
    }

    const gradientId = `powerGaugeGrad-${instanceId}`;
    const trackPath = arcPath(GAUGE_RADIUS, -GAUGE_SWEEP_DEG, GAUGE_SWEEP_DEG);
    const needleAngle = -GAUGE_SWEEP_DEG + quantizedRatio * GAUGE_SWEEP_DEG * 2;
    const needleTip = polarPoint(GAUGE_NEEDLE_LENGTH, needleAngle);
    const needleBaseLeft = polarPoint(GAUGE_NEEDLE_HALF_WIDTH, needleAngle - 90);
    const needleBaseRight = polarPoint(GAUGE_NEEDLE_HALF_WIDTH, needleAngle + 90);

    const ticks = Array.from({ length: GAUGE_TICK_COUNT }, (_, index) => {
      const tickRatio = index / (GAUGE_TICK_COUNT - 1);
      const angle = -GAUGE_SWEEP_DEG + tickRatio * GAUGE_SWEEP_DEG * 2;
      const isMajor = index % 6 === 0;
      const inner = polarPoint(GAUGE_RADIUS + GAUGE_ARC_STROKE / 2 + 4, angle);
      const outer = polarPoint(GAUGE_RADIUS + GAUGE_ARC_STROKE / 2 + (isMajor ? 14 : 9), angle);
      return createElement("line", {
        key: `tick-${index}`,
        x1: inner.x,
        y1: inner.y,
        x2: outer.x,
        y2: outer.y,
        stroke: "rgba(226, 233, 248, 0.55)",
        strokeWidth: isMajor ? 2.4 : 1.2,
        strokeLinecap: "round",
      });
    });

    return createElement(
      "svg",
      {
        viewBox: `0 0 ${GAUGE_VIEWBOX_W} ${GAUGE_VIEWBOX_H}`,
        width: size,
        height: Math.round((size * GAUGE_VIEWBOX_H) / GAUGE_VIEWBOX_W),
        style: { display: "block", overflow: "visible" },
        "aria-hidden": true,
      },
      createElement(
        "defs",
        null,
        createElement(
          "linearGradient",
          { id: gradientId, x1: "0", y1: "0", x2: "1", y2: "0" },
          createElement("stop", { offset: "0%", stopColor: `rgb(${COLOR_LOW.join(",")})` }),
          createElement("stop", { offset: "50%", stopColor: `rgb(${COLOR_MID.join(",")})` }),
          createElement("stop", { offset: "100%", stopColor: `rgb(${COLOR_HIGH.join(",")})` })
        )
      ),
      ...ticks,
      createElement("path", {
        key: "track",
        d: trackPath,
        fill: "none",
        stroke: `url(#${gradientId})`,
        strokeWidth: GAUGE_ARC_STROKE,
        strokeLinecap: "round",
      }),
      createElement("polygon", {
        key: "needle",
        // Dreieck von der Nabe zur Spitze statt einer Linie gleicher Staerke.
        points: [
          `${needleTip.x.toFixed(2)},${needleTip.y.toFixed(2)}`,
          `${needleBaseLeft.x.toFixed(2)},${needleBaseLeft.y.toFixed(2)}`,
          `${needleBaseRight.x.toFixed(2)},${needleBaseRight.y.toFixed(2)}`,
        ].join(" "),
        fill: valueColor,
      }),
      createElement("circle", {
        key: "hub-outer",
        cx: GAUGE_CX,
        cy: GAUGE_CY,
        r: 6,
        fill: "none",
        stroke: valueColor,
        strokeWidth: 2.5,
      }),
      createElement("circle", {
        key: "hub-inner",
        cx: GAUGE_CX,
        cy: GAUGE_CY,
        r: 2,
        fill: valueColor,
      })
    );
  }, [instanceId, quantizedRatio, size, valueColor]);

  const valueFontSize = Math.round(size * 0.155);
  const unitFontSize = Math.round(size * 0.1);
  const gaugeHeight = Math.round((size * GAUGE_VIEWBOX_H) / GAUGE_VIEWBOX_W);

  return (
    <View style={[styles.wrapper, { width: size }]}>
      {/* Messwert ueber dem Bogen: so kann die Nadel ihn nie kreuzen. */}
      <View style={styles.readoutRow}>
        <Text numberOfLines={1} style={[styles.value, { color: textColor, fontSize: valueFontSize }]}>
          {valueText}
        </Text>
        <Text numberOfLines={1} style={[styles.unit, { color: mutedTextColor, fontSize: unitFontSize }]}>
          {unit}
        </Text>
      </View>
      <View style={[styles.gaugeSlot, { height: gaugeHeight }]}>{gaugeSvg}</View>
      {icon ? (
        <View style={styles.iconRow}>
          <MaterialCommunityIcons color={valueColor} name={icon} size={unitFontSize + 10} />
          {showLabel ? (
            <Text numberOfLines={1} style={[styles.label, { color: valueColor, fontSize: unitFontSize + 1 }]}>
              {label}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text numberOfLines={1} style={[styles.label, { color: valueColor, fontSize: unitFontSize + 1 }]}>
          {label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
  },
  gaugeSlot: {
    position: "relative",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  readoutRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    gap: 4,
    marginBottom: 2,
  },
  value: {
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  unit: {
    fontWeight: "700",
  },
  label: {
    marginTop: 2,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
  },
});
