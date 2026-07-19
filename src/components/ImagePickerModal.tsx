import { createElement, useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { IoBrokerClient } from "../services/iobroker";
import { WidgetImageEntry } from "../types/dashboard";
import { palette } from "../utils/theme";

type ImagePickerModalProps = {
  client: IoBrokerClient;
  visible: boolean;
  selectedName?: string;
  title?: string;
  helperText?: string;
  onClose: () => void;
  onSelect: (entry: WidgetImageEntry) => void;
};

export function ImagePickerModal({
  client,
  visible,
  selectedName,
  title,
  helperText,
  onClose,
  onSelect,
}: ImagePickerModalProps) {
  const [images, setImages] = useState<WidgetImageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const loadImages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const entries = await client.listWidgetImages();
      setImages(entries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Bilder konnten nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, [client]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!files || !files.length) {
        return;
      }
      setUploadBusy(true);
      setUploadError(null);
      try {
        for (const file of Array.from(files)) {
          if (!file.type.startsWith("image/")) {
            continue;
          }
          const dataUrl = await readFileAsDataUrl(file);
          await client.uploadWidgetImage(file.name, dataUrl);
        }
        await loadImages();
      } catch (uploadErr) {
        setUploadError(uploadErr instanceof Error ? uploadErr.message : "Bild-Upload fehlgeschlagen");
      } finally {
        setUploadBusy(false);
      }
    },
    [client, loadImages]
  );

  useEffect(() => {
    if (!visible) {
      return;
    }
    setUploadError(null);
    void loadImages();
  }, [loadImages, visible]);

  return (
    <Modal animationType="fade" transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{title || "Solar-Hintergrund waehlen"}</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.close}>Schliessen</Text>
            </Pressable>
          </View>
          <Text style={styles.helper}>{helperText || "Eigene Bilder koennen per Drag-and-Drop hochgeladen und sofort verwendet werden."}</Text>
          {Platform.OS === "web"
            ? createElement(
                "div",
                {
                  style: webDropZoneStyle,
                  onDragOver: (event: DragEvent) => event.preventDefault(),
                  onDrop: (event: DragEvent) => {
                    event.preventDefault();
                    if (event.dataTransfer?.files?.length) {
                      void uploadFiles(event.dataTransfer.files);
                    }
                  },
                },
                createElement("div", { style: webDropZoneTextStyle }, "Bilder hierher ziehen oder auswaehlen"),
                createElement("input", {
                  type: "file",
                  accept: "image/*",
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
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {uploadError ? <Text style={styles.error}>{uploadError}</Text> : null}
          <ScrollView contentContainerStyle={styles.grid}>
            {images.map((image) => {
              const active = selectedName === image.name;
              return (
                <Pressable
                  key={image.name}
                  onPress={() => onSelect(image)}
                  style={[styles.tile, active ? styles.tileActive : null]}
                >
                  <Image source={{ uri: image.url }} style={styles.preview} />
                  <Text numberOfLines={1} style={styles.label}>
                    {image.name}
                  </Text>
                </Pressable>
              );
            })}
            {!loading && !images.length ? <Text style={styles.helper}>Keine Bilder gefunden.</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
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

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    maxHeight: "82%",
    borderRadius: 22,
    padding: 18,
    backgroundColor: palette.panelStrong,
    borderWidth: 1,
    borderColor: palette.border,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  title: {
    color: palette.text,
    fontSize: 20,
    fontWeight: "800",
  },
  close: {
    color: palette.textMuted,
    fontWeight: "700",
  },
  helper: {
    color: palette.textMuted,
    marginBottom: 10,
  },
  error: {
    color: palette.danger,
    marginBottom: 10,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tile: {
    width: 150,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(255,255,255,0.03)",
    padding: 8,
    gap: 8,
  },
  tileActive: {
    borderColor: "rgba(92, 124, 255, 0.45)",
    backgroundColor: "rgba(92, 124, 255, 0.08)",
  },
  preview: {
    width: "100%",
    height: 84,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  label: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "700",
  },
});

const webDropZoneStyle = {
  border: `1px dashed ${palette.border}`,
  borderRadius: "12px",
  padding: "12px",
  marginBottom: "10px",
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
