import { MaterialCommunityIcons } from "@expo/vector-icons";

export type StateIconOption = {
  label: string;
  active: keyof typeof MaterialCommunityIcons.glyphMap;
  inactive: keyof typeof MaterialCommunityIcons.glyphMap;
};

export const stateIconOptions: StateIconOption[] = [
  { label: "Schalter", active: "toggle-switch", inactive: "toggle-switch-off-outline" },
  { label: "Haustuer", active: "door-open", inactive: "door-closed" },
  { label: "Alarm", active: "shield-lock", inactive: "shield-off-outline" },
  { label: "Licht", active: "lightbulb-on", inactive: "lightbulb-outline" },
  { label: "Steckdose", active: "power-plug", inactive: "power-plug-off-outline" },
  { label: "Garage", active: "garage-open", inactive: "garage" },
  { label: "Schloss", active: "lock-open-variant", inactive: "lock-outline" },
  { label: "Fenster", active: "window-open-variant", inactive: "window-closed-variant" },
  { label: "Jalousie", active: "blinds-open", inactive: "blinds" },
  { label: "Heizung", active: "radiator", inactive: "radiator-disabled" },
  { label: "Musik", active: "speaker-wireless", inactive: "speaker-off" },
  { label: "Kamera", active: "cctv", inactive: "cctv-off" },
  { label: "Akku", active: "battery-high", inactive: "battery-outline" },
];
