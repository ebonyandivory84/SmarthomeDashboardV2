import { Platform } from "react-native";

export type PerformanceMode = "auto" | "low" | "full";

const DEVICE_OVERRIDE_STORAGE_KEY = "smarthome-dashboard-v2.performanceMode";

export function normalizePerformanceMode(value: unknown): PerformanceMode {
  return value === "low" || value === "full" ? value : "auto";
}

export function detectCoarsePointerWeb() {
  if (Platform.OS !== "web") {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) {
    return true;
  }
  return (
    typeof window !== "undefined" &&
    "matchMedia" in window &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

function parseOverrideParam(raw: string): PerformanceMode {
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "on" || value === "low" || value === "true") {
    return "low";
  }
  if (value === "0" || value === "off" || value === "full" || value === "false") {
    return "full";
  }
  return "auto";
}

/**
 * Geraetegebundener Override. Ein Kiosk-Display laesst sich damit einmalig per
 * URL festlegen (?lowpower=1 / 0 / auto), ohne die geteilte Dashboard-Konfiguration
 * zu aendern; der Wert bleibt im localStorage genau dieses Geraets.
 */
function readDeviceOverride(): PerformanceMode | null {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return null;
  }
  try {
    const param = new URLSearchParams(window.location.search).get("lowpower");
    if (param !== null) {
      const next = parseOverrideParam(param);
      if (next === "auto") {
        window.localStorage.removeItem(DEVICE_OVERRIDE_STORAGE_KEY);
        return null;
      }
      window.localStorage.setItem(DEVICE_OVERRIDE_STORAGE_KEY, next);
      return next;
    }
    const stored = window.localStorage.getItem(DEVICE_OVERRIDE_STORAGE_KEY);
    return stored === "low" || stored === "full" ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Entscheidet, ob die teuren Weboberflaechen-Effekte (Backdrop-Blur, Schatten,
 * Hintergrundunschaerfe, schnelle Flussanimationen) aktiv sind.
 *
 * Reihenfolge: Geraete-Override (URL/localStorage) vor Dashboard-Einstellung vor
 * Automatik. Die Automatik entspricht dem frueheren Verhalten und leitet den
 * Sparmodus aus dem Zeigergeraet ab - was auf einem Kiosk-Rechner ohne Touch
 * dazu fuehrte, dass ausgerechnet die schwaechste Hardware die vollen Effekte
 * bekam.
 */
export function resolveLowPowerWebEffects(mode: unknown): boolean {
  if (Platform.OS !== "web") {
    return false;
  }
  const effective = readDeviceOverride() ?? normalizePerformanceMode(mode);
  if (effective === "low") {
    return true;
  }
  if (effective === "full") {
    return false;
  }
  return detectCoarsePointerWeb();
}
