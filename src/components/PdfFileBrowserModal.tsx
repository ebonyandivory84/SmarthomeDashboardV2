import { useState } from "react";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { WebdavPdfFile } from "../types/dashboard";
import { palette } from "../utils/theme";

type PdfFileBrowserModalProps = {
  visible: boolean;
  files: WebdavPdfFile[];
  currentPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
  onDelete: (path: string) => Promise<void>;
};

export function PdfFileBrowserModal({ visible, files, currentPath, onClose, onSelect, onDelete }: PdfFileBrowserModalProps) {
  const [confirmingPath, setConfirmingPath] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConfirmDelete = async (path: string) => {
    setBusyPath(path);
    setError(null);
    try {
      await onDelete(path);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Datei konnte nicht geloescht werden");
    } finally {
      setBusyPath(null);
      setConfirmingPath(null);
    }
  };

  return (
    <Modal animationType="fade" transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>PDF-Dateien</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.close}>Schliessen</Text>
            </Pressable>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <ScrollView contentContainerStyle={styles.list}>
            {files.map((file) => {
              const active = currentPath === file.path;
              const confirming = confirmingPath === file.path;
              const busy = busyPath === file.path;
              return (
                <View key={file.path} style={[styles.row, active ? styles.rowActive : null]}>
                  <Pressable onPress={() => onSelect(file.path)} style={styles.rowMain}>
                    <MaterialCommunityIcons color={palette.accent} name="file-pdf-box" size={22} />
                    <Text numberOfLines={1} style={styles.rowLabel}>
                      {file.name}
                    </Text>
                  </Pressable>
                  {busy ? (
                    <ActivityIndicator color={palette.accent} size="small" />
                  ) : confirming ? (
                    <View style={styles.confirmGroup}>
                      <Text style={styles.confirmText}>Loeschen?</Text>
                      <Pressable onPress={() => handleConfirmDelete(file.path)} style={styles.iconButton}>
                        <MaterialCommunityIcons color={palette.danger} name="check" size={20} />
                      </Pressable>
                      <Pressable onPress={() => setConfirmingPath(null)} style={styles.iconButton}>
                        <MaterialCommunityIcons color={palette.textMuted} name="close" size={20} />
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable onPress={() => setConfirmingPath(file.path)} style={styles.iconButton}>
                      <MaterialCommunityIcons color={palette.textMuted} name="trash-can-outline" size={20} />
                    </Pressable>
                  )}
                </View>
              );
            })}
            {!files.length ? <Text style={styles.helper}>Keine PDF-Dateien gefunden.</Text> : null}
          </ScrollView>
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
  },
  error: {
    color: palette.danger,
    marginBottom: 10,
  },
  list: {
    gap: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(255,255,255,0.03)",
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 8,
  },
  rowActive: {
    borderColor: "rgba(92, 124, 255, 0.45)",
    backgroundColor: "rgba(92, 124, 255, 0.08)",
  },
  rowMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  rowLabel: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  iconButton: {
    padding: 4,
  },
  confirmGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  confirmText: {
    color: palette.danger,
    fontSize: 12,
    fontWeight: "700",
    marginRight: 2,
  },
});
