import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useDashboardConfig } from "../context/DashboardConfigContext";
import { IoBrokerClient } from "../services/iobroker";
import { WidgetSoundEntry } from "../types/dashboard";
import {
  getLcarsSoundOptions,
  normalizeSoundSelection,
  resolveLcarsSoundLabel,
  setCustomLcarsSoundOptions,
  toCustomLcarsSoundId,
} from "../utils/lcarsSounds";
import { playSoundPreview } from "../utils/uiSounds";
import { palette } from "../utils/theme";

type SoundPickerFieldProps = {
  value?: string[];
  onChange: (value: string[]) => void;
  maxItems?: number;
  client?: IoBrokerClient;
};

export function SoundPickerField({ value, onChange, maxItems = 5, client }: SoundPickerFieldProps) {
  const { config } = useDashboardConfig();
  const fallbackClient = useMemo(() => new IoBrokerClient(config), [config]);
  const apiClient = client || fallbackClient;

  const [open, setOpen] = useState(false);
  const [customSounds, setCustomSounds] = useState<WidgetSoundEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    setCustomLcarsSoundOptions(customSounds);
  }, [customSounds]);

  const selected = useMemo(() => normalizeSoundSelection(value, maxItems), [maxItems, value, customSounds]);
  const soundOptions = useMemo(() => getLcarsSoundOptions(), [customSounds]);
  const customSoundIds = useMemo(
    () =>
      new Set(
        customSounds
          .map((entry) => toCustomLcarsSoundId(entry.name))
          .filter((entry): entry is string => Boolean(entry))
      ),
    [customSounds]
  );

  const loadCustomSounds = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const entries = await apiClient.listWidgetSounds();
      setCustomSounds(entries);
    } catch (error) {
      setCustomSounds([]);
      setLoadError(error instanceof Error ? error.message : "Sounds konnten nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!files || !files.length) {
        return;
      }
      setUploadBusy(true);
      setUploadError(null);

      try {
        for (const file of Array.from(files)) {
          if (!isLikelyAudioFile(file)) {
            continue;
          }
          const dataUrl = await readFileAsDataUrl(file);
          await apiClient.uploadWidgetSound(file.name, dataUrl);
        }
        await loadCustomSounds();
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : "Sound-Upload fehlgeschlagen");
      } finally {
        setUploadBusy(false);
      }
    },
    [apiClient, loadCustomSounds]
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setUploadError(null);
    void loadCustomSounds();
  }, [loadCustomSounds, open]);

  const toggle = (soundId: string) => {
    const exists = selected.includes(soundId);
    if (exists) {
      onChange(selected.filter((entry) => entry !== soundId));
      return;
    }

    if (selected.length >= maxItems) {
      return;
    }

    onChange([...selected, soundId]);
  };

  return (
    <>
      <View style={styles.fieldWrap}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>
            {selected.length ? selected.map((entry) => resolveLcarsSoundLabel(entry)).join(", ") : "Keine Sounds"}
          </Text>
          <Text style={styles.counter}>
            {selected.length}/{maxItems}
          </Text>
        </View>
        <View style={styles.actions}>
          <Pressable onPress={() => setOpen(true)} style={[styles.button, styles.primaryButton]}>
            <Text style={styles.primaryLabel}>Sounds waehlen</Text>
          </Pressable>
          {selected.length ? (
            <Pressable onPress={() => onChange([])} style={[styles.button, styles.secondaryButton]}>
              <Text style={styles.secondaryLabel}>Leeren</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Modal animationType="fade" transparent visible={open}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>Widget-Sounds</Text>
              <Pressable onPress={() => setOpen(false)}>
                <Text style={styles.close}>Schliessen</Text>
              </Pressable>
            </View>
            <Text style={styles.helper}>Bis zu {maxItems} Sounds auswaehlen. Eigene Sounds koennen per Drag-and-Drop hochgeladen werden.</Text>
            {Platform.OS === "web"
              ? createElement(
                  "div",
                  {
                    style: webDropZoneStyle,
                    onDragOver: (event: any) => event.preventDefault(),
                    onDrop: (event: any) => {
                      event.preventDefault();
                      if (event.dataTransfer?.files?.length) {
                        void uploadFiles(event.dataTransfer.files);
                      }
                    },
                  },
                  createElement("div", { style: webDropZoneTextStyle }, "Sounds hierher ziehen oder auswaehlen (.mp3/.wav/.ogg/.m4a)"),
                  createElement("input", {
                    type: "file",
                    accept: ".mp3,.wav,.ogg,.m4a,audio/*",
                    multiple: true,
                    onChange: (event: { target: { files?: FileList | null; value: string } }) => {
                      const files = event.target.files;
                      if (files && files.length) {
                        void uploadFiles(files);
                      }
                      event.target.value = "";
                    },
                    style: webFileInputStyle,
                  })
                )
              : null}
            {loading ? <ActivityIndicator color={palette.accent} size="small" /> : null}
            {uploadBusy ? <ActivityIndicator color={palette.accent} size="small" /> : null}
            {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
            {uploadError ? <Text style={styles.error}>{uploadError}</Text> : null}
            <ScrollView contentContainerStyle={styles.optionList}>
              {soundOptions.map((option) => {
                const active = selected.includes(option.id);
                const disabled = !active && selected.length >= maxItems;
                const isCustom = customSoundIds.has(option.id);

                return (
                  <View
                    key={option.id}
                    style={[
                      styles.optionRow,
                      active ? styles.optionActive : null,
                      disabled ? styles.optionDisabled : null,
                    ]}
                  >
                    <Pressable onPress={() => toggle(option.id)} style={styles.optionSelect}>
                      <Text style={[styles.optionLabel, active ? styles.optionLabelActive : null]}>{option.label}</Text>
                    </Pressable>
                    {isCustom ? (
                      <View style={[styles.customBadge, active ? styles.customBadgeActive : null]}>
                        <Text style={[styles.customBadgeText, active ? styles.customBadgeTextActive : null]}>Upload</Text>
                      </View>
                    ) : null}
                    <Pressable
                      onPress={() => playSoundPreview(option.id)}
                      style={[styles.previewButton, active ? styles.previewButtonActive : null]}
                    >
                      <Text style={[styles.previewLabel, active ? styles.previewLabelActive : null]}>▶</Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden"));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Datei konnte nicht gelesen werden"));
      }
    };
    reader.readAsDataURL(file);
  });
}

function isLikelyAudioFile(file: File) {
  if (!file) {
    return false;
  }
  if (typeof file.type === "string" && file.type.startsWith("audio/")) {
    return true;
  }
  const name = typeof file.name === "string" ? file.name : "";
  return /\.(mp3|wav|ogg|m4a)$/i.test(name);
}

const styles = StyleSheet.create({
  fieldWrap: {
    gap: 10,
  },
  summaryRow: {
    gap: 8,
  },
  summaryText: {
    color: palette.text,
    lineHeight: 18,
  },
  counter: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  button: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryButton: {
    backgroundColor: palette.accent,
  },
  secondaryButton: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  primaryLabel: {
    color: "#041019",
    fontWeight: "800",
  },
  secondaryLabel: {
    color: palette.text,
    fontWeight: "800",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    padding: 24,
    justifyContent: "center",
  },
  card: {
    maxHeight: "80%",
    borderRadius: 22,
    backgroundColor: palette.panelStrong,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: palette.text,
    fontWeight: "800",
    fontSize: 20,
  },
  close: {
    color: palette.textMuted,
    fontWeight: "700",
  },
  helper: {
    color: palette.textMuted,
    lineHeight: 18,
  },
  optionList: {
    gap: 8,
    paddingBottom: 8,
  },
  error: {
    color: palette.danger,
  },
  optionRow: {
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: "row",
    alignItems: "stretch",
  },
  optionActive: {
    backgroundColor: palette.accent,
    borderColor: "rgba(77, 226, 177, 0.55)",
  },
  optionDisabled: {
    opacity: 0.45,
  },
  optionSelect: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    justifyContent: "center",
  },
  optionLabel: {
    color: palette.text,
    fontWeight: "700",
  },
  optionLabelActive: {
    color: "#041019",
  },
  customBadge: {
    alignSelf: "center",
    marginVertical: 8,
    marginRight: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    justifyContent: "center",
  },
  customBadgeActive: {
    borderColor: "rgba(4, 16, 25, 0.28)",
    backgroundColor: "rgba(4, 16, 25, 0.08)",
  },
  customBadgeText: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  customBadgeTextActive: {
    color: "#041019",
  },
  previewButton: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: 1,
    borderLeftColor: palette.border,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  previewButtonActive: {
    borderLeftColor: "rgba(4, 16, 25, 0.16)",
    backgroundColor: "rgba(4, 16, 25, 0.08)",
  },
  previewLabel: {
    color: palette.text,
    fontSize: 14,
    fontWeight: "900",
  },
  previewLabelActive: {
    color: "#041019",
  },
});

const webDropZoneStyle = {
  border: `1px dashed ${palette.border}`,
  borderRadius: "12px",
  padding: "12px",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  background: "rgba(255,255,255,0.03)",
};

const webDropZoneTextStyle = {
  color: palette.textMuted,
  fontSize: "12px",
  lineHeight: "18px",
};

const webFileInputStyle = {
  color: palette.text,
};
