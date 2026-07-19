import { ThemeSettings } from "../types/dashboard";

export const defaultThemeSettings: ThemeSettings = {
  widgetTones: {
    stateStart: "rgba(154, 16, 38, 0.98)",
    stateEnd: "rgba(163, 22, 126, 0.92)",
    energyStart: "rgba(26, 74, 148, 0.9)",
    energyEnd: "rgba(18, 36, 78, 0.96)",
    cameraStart: "rgba(31, 28, 44, 0.92)",
    cameraEnd: "rgba(14, 16, 26, 0.96)",
    solarStart: "rgba(18, 122, 94, 0.98)",
    solarEnd: "rgba(16, 72, 156, 0.96)",
  },
  solar: {
    sceneCardBackground: "rgba(226, 232, 240, 0.04)",
    sceneCardBorder: "rgba(226, 232, 240, 0.12)",
    nodeCardBackground: "rgba(226, 232, 240, 0.12)",
    nodeCardBorder: "rgba(226, 232, 240, 0.18)",
    statCardBackground: "rgba(255,255,255,0.03)",
    statCardBorder: "rgba(157, 173, 214, 0.14)",
  },
};

export function resolveThemeSettings(theme?: Partial<ThemeSettings>): ThemeSettings {
  return {
    widgetTones: {
      ...defaultThemeSettings.widgetTones,
      ...(theme?.widgetTones || {}),
    },
    solar: {
      ...defaultThemeSettings.solar,
      ...(theme?.solar || {}),
    },
  };
}
