import { createElement, useState } from "react";
import { Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { LinkWidgetConfig, NetflixWidgetConfig } from "../../types/dashboard";
import { playConfiguredUiSound } from "../../utils/uiSounds";
import { palette } from "../../utils/theme";

type LinkWidgetProps = {
  config: LinkWidgetConfig | NetflixWidgetConfig;
};

export function LinkWidget({ config }: LinkWidgetProps) {
  const [open, setOpen] = useState(false);
  const textColor = config.appearance?.textColor || palette.text;
  const mutedTextColor = config.appearance?.mutedTextColor || palette.textMuted;
  const resolvedUrl = normalizeUrl(config.url);
  const iconUri = config.iconImage
    ? `/smarthome-dashboard-v2/widget-assets/${encodeURIComponent(config.iconImage)}`
    : null;
  const iconImageCrop = normalizeIconImageCrop(config.iconImageCrop);
  const iconImageSizeMode = normalizeIconImageSizeMode(config.iconImageSizeMode);
  const iconImageBorderless = config.iconImageBorderless === true;
  const hasIconImage = Boolean(iconUri);
  const maximizedImage = Boolean(iconUri && iconImageSizeMode === "maximized");

  const close = () => {
    playConfiguredUiSound(config.interactionSounds?.close, "close", `${config.id}:close`);
    setOpen(false);
  };

  const openOverlay = () => {
    if (!resolvedUrl) {
      return;
    }
    playConfiguredUiSound(config.interactionSounds?.open, "open", `${config.id}:open`);
    setOpen(true);
  };

  if (!resolvedUrl) {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyTitle, { color: textColor }]}>Link-URL fehlt</Text>
        <Text style={[styles.emptyMeta, { color: mutedTextColor }]}>Trage im Widget eine URL ein.</Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.container}>
        <Pressable
          onPress={() => {
            playConfiguredUiSound(config.interactionSounds?.press, "tap", `${config.id}:press`);
            openOverlay();
          }}
          style={[
            styles.openButton,
            hasIconImage ? styles.openButtonWithImage : null,
            maximizedImage && iconImageBorderless ? styles.openButtonImageMode : null,
          ]}
        >
          {iconUri ? (
            <Image
              resizeMode={iconImageCrop === "circle" ? "cover" : "contain"}
              source={{ uri: iconUri }}
              style={[
                maximizedImage ? styles.fullImage : styles.standardImage,
                maximizedImage && iconImageCrop === "rounded" ? styles.fullImageRounded : null,
                maximizedImage && iconImageCrop === "circle" ? styles.fullImageCircle : null,
                !maximizedImage && iconImageCrop === "rounded" ? styles.standardImageRounded : null,
                !maximizedImage && iconImageCrop === "circle" ? styles.standardImageCircle : null,
              ]}
            />
          ) : (
            <>
              <View style={styles.iconFallback} />
              <Text numberOfLines={1} style={[styles.openButtonLabel, { color: textColor }]}>{config.title || "Link"}</Text>
            </>
          )}
        </Pressable>
      </View>

      <Modal animationType={Platform.OS === "web" ? "fade" : "slide"} transparent visible={open}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSurface}>
            <View style={styles.modalHeader}>
              <Text numberOfLines={1} style={[styles.modalTitle, { color: textColor }]}>
                {config.title || "Link"}
              </Text>
              <View style={styles.modalActions}>
                {Platform.OS !== "web" ? (
                  <Pressable
                    onPress={() => Linking.openURL(resolvedUrl)}
                    style={[styles.modalButton, styles.modalButtonSecondary]}
                  >
                    <Text style={[styles.modalButtonLabel, { color: textColor }]}>Im Browser</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={close} style={styles.modalButton}>
                  <Text style={[styles.modalButtonLabel, { color: textColor }]}>Schliessen</Text>
                </Pressable>
              </View>
            </View>

            {Platform.OS === "web"
              ? createElement("iframe", {
                  src: resolvedUrl,
                  style: webFrameStyle,
                  allow: "fullscreen; autoplay; clipboard-read; clipboard-write",
                  allowFullScreen: true,
                  loading: "eager",
                  referrerPolicy: "no-referrer",
                })
              : (
                  <View style={styles.nativeFallback}>
                    <Text style={[styles.emptyMeta, { color: mutedTextColor }]}>
                      In Native bitte im Browser oeffnen.
                    </Text>
                    <Pressable onPress={() => Linking.openURL(resolvedUrl)} style={[styles.modalButton, styles.modalButtonSecondary]}>
                      <Text style={[styles.modalButtonLabel, { color: textColor }]}>URL oeffnen</Text>
                    </Pressable>
                  </View>
                )}
          </View>
        </View>
      </Modal>
    </>
  );
}

function normalizeUrl(raw?: string) {
  const value = (raw || "").trim();
  if (!value) {
    return "";
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return `https://${value}`;
}

function normalizeIconImageCrop(value: LinkWidgetConfig["iconImageCrop"]) {
  if (value === "rounded" || value === "circle") {
    return value;
  }
  return "none";
}

function normalizeIconImageSizeMode(value: LinkWidgetConfig["iconImageSizeMode"]) {
  if (value === "maximized") {
    return value;
  }
  return "standard";
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 0,
  },
  openButton: {
    width: "100%",
    height: "100%",
    borderRadius: 0,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(8, 18, 36, 0.62)",
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  openButtonImageMode: {
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    paddingVertical: 0,
    gap: 0,
  },
  openButtonWithImage: {
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  fullImage: {
    width: "100%",
    height: "100%",
    borderRadius: 0,
  },
  standardImage: {
    width: "82%",
    height: "82%",
    borderRadius: 0,
  },
  fullImageRounded: {
    borderRadius: 12,
  },
  fullImageCircle: {
    borderRadius: 999,
  },
  standardImageRounded: {
    borderRadius: 12,
  },
  standardImageCircle: {
    borderRadius: 999,
  },
  iconFallback: {
    width: 34,
    height: 34,
    borderRadius: 8,
    marginBottom: 2,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  openButtonLabel: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  emptyTitle: {
    color: palette.text,
    fontSize: 16,
    fontWeight: "700",
  },
  emptyMeta: {
    marginTop: 6,
    color: palette.textMuted,
    textAlign: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
    padding: 18,
  },
  modalSurface: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(4, 10, 18, 1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  modalHeader: {
    height: 56,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  modalTitle: {
    flex: 1,
    marginRight: 12,
    color: palette.text,
    fontSize: 16,
    fontWeight: "800",
  },
  modalActions: {
    flexDirection: "row",
    gap: 8,
  },
  modalButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalButtonSecondary: {
    backgroundColor: "rgba(76, 134, 255, 0.16)",
    borderColor: "rgba(76, 134, 255, 0.35)",
  },
  modalButtonLabel: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "700",
  },
  nativeFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 16,
  },
});

const webFrameStyle = {
  width: "100%",
  height: "calc(100% - 56px)",
  border: "0",
  display: "block",
  background: "transparent",
} as const;
