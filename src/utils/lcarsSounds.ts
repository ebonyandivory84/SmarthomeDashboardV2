import { Asset } from "expo-asset";
import { WidgetSoundEntry } from "../types/dashboard";

export type LcarsSoundOption = {
  id: string;
  label: string;
  module?: unknown;
  url?: string;
  source?: "builtin" | "custom";
};

export const LCARS_SOUND_OPTIONS: LcarsSoundOption[] = [
  { id: "alarm2.wav", label: "alarm2.wav", module: require("../../assets/LCARS Sounds/alarm2.wav"), source: "builtin" },
  { id: "alarm4.wav", label: "alarm4.wav", module: require("../../assets/LCARS Sounds/alarm4.wav"), source: "builtin" },
  { id: "alarm6.wav", label: "alarm6.wav", module: require("../../assets/LCARS Sounds/alarm6.wav"), source: "builtin" },
  { id: "computerbeep_12.mp3", label: "computerbeep_12.mp3", module: require("../../assets/LCARS Sounds/computerbeep_12.mp3"), source: "builtin" },
  { id: "computerbeep_23.mp3", label: "computerbeep_23.mp3", module: require("../../assets/LCARS Sounds/computerbeep_23.mp3"), source: "builtin" },
  { id: "computerbeep_30.mp3", label: "computerbeep_30.mp3", module: require("../../assets/LCARS Sounds/computerbeep_30.mp3"), source: "builtin" },
  { id: "computerbeep_4.mp3", label: "computerbeep_4.mp3", module: require("../../assets/LCARS Sounds/computerbeep_4.mp3"), source: "builtin" },
  { id: "computerbeep_55.mp3", label: "computerbeep_55.mp3", module: require("../../assets/LCARS Sounds/computerbeep_55.mp3"), source: "builtin" },
  { id: "computerbeep_59.mp3", label: "computerbeep_59.mp3", module: require("../../assets/LCARS Sounds/computerbeep_59.mp3"), source: "builtin" },
  { id: "computerbeep_61.mp3", label: "computerbeep_61.mp3", module: require("../../assets/LCARS Sounds/computerbeep_61.mp3"), source: "builtin" },
  { id: "computerbeep_66.mp3", label: "computerbeep_66.mp3", module: require("../../assets/LCARS Sounds/computerbeep_66.mp3"), source: "builtin" },
  { id: "computerbeep_68.mp3", label: "computerbeep_68.mp3", module: require("../../assets/LCARS Sounds/computerbeep_68.mp3"), source: "builtin" },
  { id: "computerbeep_69.mp3", label: "computerbeep_69.mp3", module: require("../../assets/LCARS Sounds/computerbeep_69.mp3"), source: "builtin" },
  { id: "computerbeep_74.mp3", label: "computerbeep_74.mp3", module: require("../../assets/LCARS Sounds/computerbeep_74.mp3"), source: "builtin" },
  { id: "denybeep1.mp3", label: "denybeep1.mp3", module: require("../../assets/LCARS Sounds/denybeep1.mp3"), source: "builtin" },
  { id: "denybeep3.mp3", label: "denybeep3.mp3", module: require("../../assets/LCARS Sounds/denybeep3.mp3"), source: "builtin" },
  { id: "incoming_hail3.mp3", label: "incoming_hail3.mp3", module: require("../../assets/LCARS Sounds/incoming_hail3.mp3"), source: "builtin" },
  { id: "input_ok_1_clean.mp3", label: "input_ok_1_clean.mp3", module: require("../../assets/LCARS Sounds/input_ok_1_clean.mp3"), source: "builtin" },
  { id: "inputok1.wav", label: "inputok1.wav", module: require("../../assets/LCARS Sounds/inputok1.wav"), source: "builtin" },
  { id: "inputok2.wav", label: "inputok2.wav", module: require("../../assets/LCARS Sounds/inputok2.wav"), source: "builtin" },
  { id: "keydenied.wav", label: "keydenied.wav", module: require("../../assets/LCARS Sounds/keydenied.wav"), source: "builtin" },
  { id: "keyok1.mp3", label: "keyok1.mp3", module: require("../../assets/LCARS Sounds/keyok1.mp3"), source: "builtin" },
  { id: "keyok2.mp3", label: "keyok2.mp3", module: require("../../assets/LCARS Sounds/keyok2.mp3"), source: "builtin" },
  { id: "keyok3.wav", label: "keyok3.wav", module: require("../../assets/LCARS Sounds/keyok3.wav"), source: "builtin" },
  { id: "keyok4.wav", label: "keyok4.wav", module: require("../../assets/LCARS Sounds/keyok4.wav"), source: "builtin" },
  { id: "keyok5.mp3", label: "keyok5.mp3", module: require("../../assets/LCARS Sounds/keyok5.mp3"), source: "builtin" },
  { id: "keyok5.wav", label: "keyok5.wav", module: require("../../assets/LCARS Sounds/keyok5.wav"), source: "builtin" },
  { id: "processing1.wav", label: "processing1.wav", module: require("../../assets/LCARS Sounds/processing1.wav"), source: "builtin" },
  { id: "processing3.mp3", label: "processing3.mp3", module: require("../../assets/LCARS Sounds/processing3.mp3"), source: "builtin" },
  { id: "processing3.wav", label: "processing3.wav", module: require("../../assets/LCARS Sounds/processing3.wav"), source: "builtin" },
  { id: "scrclose1.wav", label: "scrclose1.wav", module: require("../../assets/LCARS Sounds/scrclose1.wav"), source: "builtin" },
  { id: "scrclose2.wav", label: "scrclose2.wav", module: require("../../assets/LCARS Sounds/scrclose2.wav"), source: "builtin" },
  { id: "scrdisplay1.wav", label: "scrdisplay1.wav", module: require("../../assets/LCARS Sounds/scrdisplay1.wav"), source: "builtin" },
  { id: "scrdisplay2.wav", label: "scrdisplay2.wav", module: require("../../assets/LCARS Sounds/scrdisplay2.wav"), source: "builtin" },
  { id: "scrscroll1.mp3", label: "scrscroll1.mp3", module: require("../../assets/LCARS Sounds/scrscroll1.mp3"), source: "builtin" },
  { id: "scrscroll1.wav", label: "scrscroll1.wav", module: require("../../assets/LCARS Sounds/scrscroll1.wav"), source: "builtin" },
  { id: "scrscroll2.mp3", label: "scrscroll2.mp3", module: require("../../assets/LCARS Sounds/scrscroll2.mp3"), source: "builtin" },
  { id: "scrscroll2.wav", label: "scrscroll2.wav", module: require("../../assets/LCARS Sounds/scrscroll2.wav"), source: "builtin" },
  { id: "scrsearch.mp3", label: "scrsearch.mp3", module: require("../../assets/LCARS Sounds/scrsearch.mp3"), source: "builtin" },
  { id: "scrsearch.wav", label: "scrsearch.wav", module: require("../../assets/LCARS Sounds/scrsearch.wav"), source: "builtin" },
  { id: "voiceinput2.wav", label: "voiceinput2.wav", module: require("../../assets/LCARS Sounds/voiceinput2.wav"), source: "builtin" },
  { id: "voiceinput3.wav", label: "voiceinput3.wav", module: require("../../assets/LCARS Sounds/voiceinput3.wav"), source: "builtin" },
  { id: "voiceinput4.wav", label: "voiceinput4.wav", module: require("../../assets/LCARS Sounds/voiceinput4.wav"), source: "builtin" },
  { id: "voy_hail.mp3", label: "voy_hail.mp3", module: require("../../assets/LCARS Sounds/voy_hail.mp3"), source: "builtin" },
];

const CUSTOM_SOUND_PREFIX = "upload:";
const BUILTIN_SOUND_OPTION_MAP = new Map(LCARS_SOUND_OPTIONS.map((option) => [option.id, option]));
const customSoundOptionMap = new Map<string, LcarsSoundOption>();
const AUDIO_FILE_PATTERN = /\.(mp3|wav|ogg|m4a)$/i;

export function toCustomLcarsSoundId(name: string) {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) {
    return "";
  }
  return `${CUSTOM_SOUND_PREFIX}${encodeURIComponent(trimmedName)}`;
}

export function setCustomLcarsSoundOptions(entries: WidgetSoundEntry[] | undefined | null) {
  customSoundOptionMap.clear();
  if (!Array.isArray(entries)) {
    return;
  }

  entries.forEach((entry) => {
    if (!entry || typeof entry.name !== "string" || typeof entry.url !== "string") {
      return;
    }
    const name = entry.name.trim();
    if (!name) {
      return;
    }
    const id = toCustomLcarsSoundId(name);
    if (!id) {
      return;
    }
    customSoundOptionMap.set(id, {
      id,
      label: `${name} (Upload)`,
      url: entry.url,
      source: "custom",
    });
  });
}

export function getLcarsSoundOptions() {
  const customOptions = [...customSoundOptionMap.values()].sort((a, b) => a.label.localeCompare(b.label, "de"));
  return [...customOptions, ...LCARS_SOUND_OPTIONS];
}

export function normalizeSoundSelection(value: string[] | undefined | null, max = 5) {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique: string[] = [];

  value.forEach((entry) => {
    const normalized = typeof entry === "string" ? entry.trim() : "";
    if (!normalized || unique.includes(normalized) || !isKnownSoundId(normalized)) {
      return;
    }
    if (unique.length < max) {
      unique.push(normalized);
    }
  });

  return unique;
}

export function resolveLcarsSoundLabel(id: string) {
  if (BUILTIN_SOUND_OPTION_MAP.has(id)) {
    return BUILTIN_SOUND_OPTION_MAP.get(id)?.label || id;
  }
  if (customSoundOptionMap.has(id)) {
    return customSoundOptionMap.get(id)?.label || id;
  }
  const customName = parseCustomSoundId(id);
  if (customName) {
    return `${customName} (Upload)`;
  }
  return id;
}

export function resolveLcarsSoundUri(id: string) {
  const option = BUILTIN_SOUND_OPTION_MAP.get(id) || customSoundOptionMap.get(id);
  if (!option) {
    const customName = parseCustomSoundId(id) || (AUDIO_FILE_PATTERN.test(id) ? id : null);
    if (!customName) {
      return null;
    }
    return normalizeWebAssetUri(`/smarthome-dashboard-v2/widget-sounds/${encodeURIComponent(customName)}`);
  }

  if (option.source === "custom") {
    const customUrl =
      option.url ||
      `/smarthome-dashboard-v2/widget-sounds/${encodeURIComponent(parseCustomSoundId(option.id) || option.label)}`;
    return normalizeWebAssetUri(customUrl);
  }

  const source = option.module;

  if (typeof source === "string") {
    return normalizeWebAssetUri(source);
  }

  if (source && typeof source === "object") {
    const uri = "uri" in source && typeof source.uri === "string" ? source.uri : null;
    if (uri) {
      return normalizeWebAssetUri(uri);
    }

    const defaultUri =
      "default" in source &&
      source.default &&
      typeof source.default === "object" &&
      "uri" in source.default &&
      typeof source.default.uri === "string"
        ? source.default.uri
        : null;

    if (defaultUri) {
      return normalizeWebAssetUri(defaultUri);
    }
  }

  try {
    const asset = Asset.fromModule(source as never);
    if (asset?.uri) {
      return normalizeWebAssetUri(asset.uri);
    }
    if (asset?.localUri) {
      return normalizeWebAssetUri(asset.localUri);
    }
  } catch {
    // Ignore and fall through to null.
  }

  return null;
}

function isKnownSoundId(id: string) {
  return BUILTIN_SOUND_OPTION_MAP.has(id) || customSoundOptionMap.has(id) || Boolean(parseCustomSoundId(id)) || AUDIO_FILE_PATTERN.test(id);
}

function parseCustomSoundId(id: string) {
  if (typeof id !== "string" || !id.startsWith(CUSTOM_SOUND_PREFIX)) {
    return null;
  }
  const encodedName = id.slice(CUSTOM_SOUND_PREFIX.length);
  if (!encodedName) {
    return null;
  }
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

function normalizeWebAssetUri(uri: string) {
  if (typeof window === "undefined") {
    return uri;
  }

  if (/^(data:|blob:|https?:)/i.test(uri)) {
    return uri;
  }

  if (uri.startsWith("/assets/")) {
    const hostedBasePath = resolveHostedBasePath();
    return encodeURI(`${window.location.origin}${hostedBasePath}${uri}`);
  }

  try {
    return encodeURI(new URL(uri, window.location.href).toString());
  } catch {
    return encodeURI(uri);
  }
}

function resolveHostedBasePath() {
  const pathname = window.location.pathname || "/";
  const hostedSegment = "/smarthome-dashboard-v2";
  const segmentIndex = pathname.indexOf(hostedSegment);

  if (segmentIndex >= 0) {
    return hostedSegment;
  }

  return "";
}
