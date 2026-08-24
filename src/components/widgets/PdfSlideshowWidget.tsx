import { createElement, useCallback, useEffect, useRef, useState } from "react";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { IoBrokerClient } from "../../services/iobroker";
import { PdfSlideshowWidgetConfig, WebdavPdfFile } from "../../types/dashboard";
import { palette } from "../../utils/theme";
import { playConfiguredUiSound } from "../../utils/uiSounds";
import { PdfFileBrowserModal } from "../PdfFileBrowserModal";

type PdfSlideshowWidgetProps = {
  client: IoBrokerClient;
  config: PdfSlideshowWidgetConfig;
  isActivePage?: boolean;
  lowPowerMode?: boolean;
};

export function PdfSlideshowWidget({ client, config, isActivePage = true, lowPowerMode = false }: PdfSlideshowWidgetProps) {
  const documentVisible = useDocumentVisibility();
  const runtimeActive = isActivePage && documentVisible && !lowPowerMode;

  const [files, setFiles] = useState<WebdavPdfFile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [browserVisible, setBrowserVisible] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const shareFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFiles = useCallback(async () => {
    try {
      const result = await client.listWebdavPdfFiles(config);
      setFiles(result);
      setError(null);
      setCurrentIndex((previous) => (previous >= result.length ? 0 : previous));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verzeichnis konnte nicht geladen werden.");
    }
  }, [client, config]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    return () => {
      if (shareFeedbackTimer.current) {
        clearTimeout(shareFeedbackTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!runtimeActive || files.length < 2) {
      return;
    }
    const intervalMs = Math.max(1, config.slideIntervalSeconds ?? 5) * 1000;
    const timer = setInterval(() => {
      setCurrentIndex((previous) => (previous + 1) % files.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [config.slideIntervalSeconds, files.length, runtimeActive]);

  const currentFile = files[currentIndex];

  useEffect(() => {
    setViewerUrl(null);
    if (!currentFile || Platform.OS !== "web" || !runtimeActive) {
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const blob = await client.fetchWebdavFile(config, currentFile.path, controller.signal);
        if (cancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setViewerUrl(objectUrl);
        setPdfError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setPdfError(err instanceof Error ? err.message : "PDF konnte nicht geladen werden.");
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [
    client,
    config.webdavBaseUrl,
    config.webdavUsername,
    config.webdavPassword,
    config.folderPath,
    currentFile?.path,
    runtimeActive,
  ]);

  const handleOpenBrowser = useCallback(() => {
    playConfiguredUiSound(config.interactionSounds?.press, "panel", `${config.id}:browser`);
    setBrowserVisible(true);
  }, [config.id, config.interactionSounds?.press]);

  const handleSelectFile = useCallback(
    (path: string) => {
      const index = files.findIndex((file) => file.path === path);
      if (index >= 0) {
        setCurrentIndex(index);
      }
      setBrowserVisible(false);
    },
    [files],
  );

  const handleDeleteFile = useCallback(
    async (path: string) => {
      await client.deleteWebdavFile(config, path);
      await loadFiles();
    },
    [client, config, loadFiles],
  );

  const handleShare = useCallback(async () => {
    if (!currentFile) {
      return;
    }
    playConfiguredUiSound(config.interactionSounds?.press, "panel", `${config.id}:share`);
    try {
      const { url } = await client.createWebdavShareLink(config, currentFile.path);
      const nav = typeof navigator !== "undefined" ? navigator : undefined;
      if (nav?.share) {
        await nav.share({ url, title: currentFile.name });
      } else if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(url);
        setShareFeedback("Link kopiert");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Teilen-Link konnte nicht erstellt werden.");
    } finally {
      if (shareFeedbackTimer.current) {
        clearTimeout(shareFeedbackTimer.current);
      }
      shareFeedbackTimer.current = setTimeout(() => setShareFeedback(null), 2500);
    }
  }, [config, currentFile]);

  const textColor = config.appearance?.textColor ?? palette.text;
  const mutedColor = config.appearance?.mutedTextColor ?? palette.textMuted;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {config.showTitle !== false ? (
          <Text numberOfLines={1} style={[styles.title, { color: textColor }]}>
            {config.title}
          </Text>
        ) : null}
        <View style={styles.headerRight}>
          {files.length > 0 ? (
            <Text style={[styles.counter, { color: mutedColor }]}>
              {currentIndex + 1} / {files.length}
            </Text>
          ) : null}
          <Pressable onPress={handleOpenBrowser} style={styles.iconButton}>
            <MaterialCommunityIcons color={mutedColor} name="file-search-outline" size={20} />
          </Pressable>
          <Pressable disabled={!currentFile} onPress={handleShare} style={styles.iconButton}>
            <MaterialCommunityIcons color={currentFile ? mutedColor : palette.border} name="share-variant" size={20} />
          </Pressable>
        </View>
      </View>

      <View style={styles.body}>
        {error || pdfError ? (
          <Text style={[styles.message, { color: mutedColor }]}>{error ?? pdfError}</Text>
        ) : !currentFile ? (
          <Text style={[styles.message, { color: mutedColor }]}>Keine PDF-Dateien gefunden.</Text>
        ) : Platform.OS === "web" ? (
          createElement("iframe", {
            key: currentFile.path,
            src: viewerUrl,
            style: { width: "100%", height: "100%", border: "none" },
            sandbox: "allow-same-origin allow-scripts",
            referrerPolicy: "no-referrer",
          })
        ) : (
          <View style={styles.fallback}>
            <MaterialCommunityIcons color={mutedColor} name="file-pdf-box" size={32} />
            <Text style={[styles.message, { color: mutedColor }]}>{currentFile.name}</Text>
          </View>
        )}
        {shareFeedback ? (
          <View pointerEvents="none" style={styles.shareToast}>
            <Text style={styles.shareToastText}>{shareFeedback}</Text>
          </View>
        ) : null}
      </View>

      <PdfFileBrowserModal
        currentPath={currentFile?.path}
        files={files}
        onClose={() => setBrowserVisible(false)}
        onDelete={handleDeleteFile}
        onSelect={handleSelectFile}
        visible={browserVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    flexShrink: 1,
  },
  counter: {
    fontSize: 12,
    marginRight: 4,
  },
  iconButton: {
    padding: 4,
  },
  body: {
    flex: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  message: {
    fontSize: 13,
    textAlign: "center",
  },
  shareToast: {
    position: "absolute",
    bottom: 10,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  shareToastText: {
    color: "#fff",
    fontSize: 12,
  },
});
