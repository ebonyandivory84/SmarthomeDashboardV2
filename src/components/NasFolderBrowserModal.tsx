import { useEffect, useState } from "react";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { IoBrokerClient } from "../services/iobroker";
import { PdfSlideshowWidgetConfig, WebdavFolder } from "../types/dashboard";
import { palette } from "../utils/theme";

type NasFolderBrowserModalProps = {
  visible: boolean;
  client: IoBrokerClient;
  config: Pick<PdfSlideshowWidgetConfig, "webdavBaseUrl" | "webdavUsername" | "webdavPassword" | "folderPath">;
  fileName: string;
  onClose: () => void;
  onMove: (destinationFolderPath: string) => Promise<void>;
};

function parentPath(currentPath: string): string {
  const segments = currentPath.split("/").filter(Boolean);
  segments.pop();
  return `/${segments.join("/")}`;
}

export function NasFolderBrowserModal({ visible, client, config, fileName, onClose, onMove }: NasFolderBrowserModalProps) {
  const [currentPath, setCurrentPath] = useState(config.folderPath || "/");
  const [folders, setFolders] = useState<WebdavFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (visible) {
      setCurrentPath(config.folderPath || "/");
    }
    // Only reset the start path when the modal is (re-)opened, not on every folderPath config change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    client
      .listWebdavFolders(config, currentPath)
      .then((result) => {
        if (active) {
          setFolders(result);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Ordner konnten nicht geladen werden");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [client, config, currentPath, visible]);

  const handleMoveHere = async () => {
    setMoving(true);
    setError(null);
    try {
      await onMove(currentPath);
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Datei konnte nicht verschoben werden");
    } finally {
      setMoving(false);
    }
  };

  return (
    <Modal animationType="fade" transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Zielordner wählen</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.close}>Schliessen</Text>
            </Pressable>
          </View>

          <Text numberOfLines={1} style={styles.hint}>
            {fileName} verschieben nach:
          </Text>
          <Text numberOfLines={1} style={styles.pathLabel}>
            {currentPath}
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <ScrollView contentContainerStyle={styles.list}>
            {currentPath !== "/" ? (
              <Pressable onPress={() => setCurrentPath(parentPath(currentPath))} style={styles.row}>
                <MaterialCommunityIcons color={palette.accent} name="folder-upload-outline" size={22} />
                <Text style={styles.rowLabel}>..</Text>
              </Pressable>
            ) : null}

            {loading ? (
              <ActivityIndicator color={palette.accent} size="small" style={styles.loader} />
            ) : (
              folders.map((folder) => (
                <Pressable key={folder.path} onPress={() => setCurrentPath(folder.path)} style={styles.row}>
                  <MaterialCommunityIcons color={palette.accent} name="folder-outline" size={22} />
                  <Text numberOfLines={1} style={styles.rowLabel}>
                    {folder.name}
                  </Text>
                </Pressable>
              ))
            )}
            {!loading && folders.length === 0 ? <Text style={styles.helper}>Keine Unterordner</Text> : null}
          </ScrollView>

          <Pressable disabled={moving} onPress={handleMoveHere} style={[styles.moveButton, moving ? styles.moveButtonDisabled : null]}>
            {moving ? (
              <ActivityIndicator color="#041019" size="small" />
            ) : (
              <Text style={styles.moveButtonLabel}>Hierher verschieben</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
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
    gap: 10,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
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
  hint: {
    color: palette.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  pathLabel: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "700",
  },
  helper: {
    color: palette.textMuted,
  },
  error: {
    color: palette.danger,
  },
  loader: {
    paddingVertical: 12,
  },
  list: {
    gap: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(255,255,255,0.03)",
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  rowLabel: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  moveButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.accent,
  },
  moveButtonDisabled: {
    opacity: 0.6,
  },
  moveButtonLabel: {
    color: "#041019",
    fontSize: 14,
    fontWeight: "800",
  },
});
