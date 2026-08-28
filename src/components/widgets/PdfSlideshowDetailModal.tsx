import { createElement, useState } from "react";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { IoBrokerClient } from "../../services/iobroker";
import { PdfSlideshowWidgetConfig, WebdavPdfFile } from "../../types/dashboard";
import { palette } from "../../utils/theme";
import { NasFolderBrowserModal } from "../NasFolderBrowserModal";

type PdfSlideshowDetailModalProps = {
  client: IoBrokerClient;
  config: PdfSlideshowWidgetConfig;
  currentFile: WebdavPdfFile;
  viewerUrl: string | null;
  pdfError: string | null;
  textColor: string;
  mutedColor: string;
  onClose: () => void;
  onMoved: () => void;
};

export function PdfSlideshowDetailModal({
  client,
  config,
  currentFile,
  viewerUrl,
  pdfError,
  textColor,
  mutedColor,
  onClose,
  onMoved,
}: PdfSlideshowDetailModalProps) {
  const [folderBrowserVisible, setFolderBrowserVisible] = useState(false);

  return (
    <Modal animationType="fade" transparent visible>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text numberOfLines={1} style={[styles.title, { color: textColor }]}>
              {currentFile.name}
            </Text>
            <View style={styles.headerRight}>
              <Pressable onPress={() => setFolderBrowserVisible(true)} style={styles.iconButton}>
                <MaterialCommunityIcons color={mutedColor} name="folder-move-outline" size={22} />
              </Pressable>
              <Pressable onPress={onClose}>
                <Text style={[styles.close, { color: mutedColor }]}>Schliessen</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.body}>
            {pdfError ? (
              <Text style={[styles.message, { color: mutedColor }]}>{pdfError}</Text>
            ) : viewerUrl ? (
              createElement(
                "object",
                {
                  key: currentFile.path,
                  data: viewerUrl,
                  type: "application/pdf",
                  style: { width: "100%", height: "100%", border: "none" },
                },
                createElement(
                  Text,
                  { style: [styles.message, { color: mutedColor }] },
                  "PDF kann in diesem Browser nicht angezeigt werden.",
                ),
              )
            ) : (
              <Text style={[styles.message, { color: mutedColor }]}>Lädt…</Text>
            )}
          </View>
        </View>
      </View>

      <NasFolderBrowserModal
        client={client}
        config={config}
        fileName={currentFile.name}
        onClose={() => setFolderBrowserVisible(false)}
        onMove={async (destPath) => {
          await client.moveWebdavFile(config, currentFile.path, destPath);
          setFolderBrowserVisible(false);
          onMoved();
        }}
        visible={folderBrowserVisible}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.74)",
    padding: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    width: "100%",
    maxWidth: 1100,
    height: "90%",
    borderRadius: 22,
    backgroundColor: palette.panelStrong,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 18,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  iconButton: {
    padding: 2,
  },
  title: {
    fontWeight: "800",
    fontSize: 20,
    flexShrink: 1,
    marginRight: 12,
  },
  close: {
    fontWeight: "700",
  },
  body: {
    flex: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  message: {
    fontSize: 13,
    textAlign: "center",
  },
});
