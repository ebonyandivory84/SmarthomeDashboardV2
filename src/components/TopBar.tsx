import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { playConfiguredUiSound } from "../utils/uiSounds";
import { palette } from "../utils/theme";

type TopBarProps = {
  homeLabel: string;
  pageTitles: Array<{ id: string; title: string }>;
  activePageId: string;
  isOnline: boolean;
  isLayoutMode: boolean;
  onToggleLayoutMode: () => void;
  onOpenSettings: () => void;
  onAddWidget: () => void;
  onSelectPage: (pageId: string) => void;
  onMovePage?: (pageId: string, direction: "left" | "right") => void;
  onRenamePage?: (pageId: string) => void;
  onDeletePage?: (pageId: string) => void;
  pageTabSounds?: string[];
  layoutToggleSounds?: string[];
  addWidgetSounds?: string[];
  openSettingsSounds?: string[];
};

export function TopBar({
  homeLabel,
  pageTitles,
  activePageId,
  isOnline,
  isLayoutMode,
  onToggleLayoutMode,
  onOpenSettings,
  onAddWidget,
  onSelectPage,
  onMovePage,
  onRenamePage,
  onDeletePage,
  pageTabSounds,
  layoutToggleSounds,
  addWidgetSounds,
  openSettingsSounds,
}: TopBarProps) {
  const { width } = useWindowDimensions();
  const isCompact = width < 700;
  const pageTabButtons = pageTitles.map((page, index) => {
    const activePage = page.id === activePageId;
    const canMoveLeft = index > 0;
    const canMoveRight = index < pageTitles.length - 1;
    const canDelete = pageTitles.length > 1 && Boolean(onDeletePage);
    return (
      <View key={page.id} style={[styles.pageTab, activePage ? styles.pageTabActive : null, isLayoutMode ? styles.pageTabLayout : null]}>
        {isLayoutMode ? (
          <Pressable
            disabled={!canMoveLeft || !onMovePage}
            onPress={() => {
              playConfiguredUiSound(pageTabSounds, "swipe", `page-tab:move-left:${page.id}`);
              onMovePage?.(page.id, "left");
            }}
            style={[styles.pageMoveButton, !canMoveLeft || !onMovePage ? styles.pageMoveButtonDisabled : null]}
          >
            <MaterialCommunityIcons color={canMoveLeft && onMovePage ? palette.text : palette.textMuted} name="chevron-left" size={14} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => {
            playConfiguredUiSound(pageTabSounds, "page", `page-tab:${page.id}`);
            onSelectPage(page.id);
          }}
          style={styles.pageTabMainButton}
        >
          <Text numberOfLines={1} style={[styles.pageTabLabel, activePage ? styles.pageTabLabelActive : null]}>
            {page.title}
          </Text>
        </Pressable>
        {isLayoutMode ? (
          <Pressable
            disabled={!onRenamePage}
            onPress={() => {
              playConfiguredUiSound(pageTabSounds, "panel", `page-tab:rename:${page.id}`);
              onRenamePage?.(page.id);
            }}
            style={[styles.pageMoveButton, !onRenamePage ? styles.pageMoveButtonDisabled : null]}
          >
            <MaterialCommunityIcons color={onRenamePage ? palette.text : palette.textMuted} name="pencil" size={12} />
          </Pressable>
        ) : null}
        {isLayoutMode ? (
          <Pressable
            disabled={!canDelete}
            onPress={() => {
              playConfiguredUiSound(pageTabSounds, "panel", `page-tab:delete:${page.id}`);
              onDeletePage?.(page.id);
            }}
            style={[styles.pageMoveButton, styles.pageDeleteButton, !canDelete ? styles.pageDeleteButtonDisabled : null]}
          >
            <MaterialCommunityIcons color={canDelete ? "#fda4af" : palette.textMuted} name="trash-can-outline" size={12} />
          </Pressable>
        ) : null}
        {isLayoutMode ? (
          <Pressable
            disabled={!canMoveRight || !onMovePage}
            onPress={() => {
              playConfiguredUiSound(pageTabSounds, "swipe", `page-tab:move-right:${page.id}`);
              onMovePage?.(page.id, "right");
            }}
            style={[styles.pageMoveButton, !canMoveRight || !onMovePage ? styles.pageMoveButtonDisabled : null]}
          >
            <MaterialCommunityIcons color={canMoveRight && onMovePage ? palette.text : palette.textMuted} name="chevron-right" size={14} />
          </Pressable>
        ) : null}
      </View>
    );
  });

  return (
    <View style={[styles.container, isCompact ? styles.containerCompact : null]}>
      <View>
        <View style={[styles.titleRow, isCompact ? styles.titleRowCompact : null]}>
          <Text style={styles.kicker}>{homeLabel}</Text>
          <View style={[styles.statusDot, isOnline ? styles.statusOnline : styles.statusOffline]} />
          {isCompact ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pageTabsCompactContent}
              style={styles.pageTabsCompactScroll}
            >
              {pageTabButtons}
            </ScrollView>
          ) : (
            <View style={styles.pageTabs}>{pageTabButtons}</View>
          )}
        </View>
      </View>
      <View style={[styles.actions, isCompact ? styles.actionsCompact : null]}>
        <Pressable
          onPress={() => {
            playConfiguredUiSound(layoutToggleSounds, "panel", "topbar:layoutToggle");
            onToggleLayoutMode();
          }}
          style={[styles.actionButton, isLayoutMode ? styles.layoutActiveButton : null]}
        >
          <MaterialCommunityIcons color={palette.text} name="pencil-outline" size={18} />
        </Pressable>
        <Pressable
          onPress={() => {
            playConfiguredUiSound(addWidgetSounds, "tap", "topbar:addWidget");
            onAddWidget();
          }}
          style={styles.actionButton}
        >
          <MaterialCommunityIcons color={palette.text} name="plus" size={18} />
        </Pressable>
        <Pressable
          onPress={() => {
            playConfiguredUiSound(openSettingsSounds, "open", "topbar:openSettings");
            onOpenSettings();
          }}
          style={styles.actionButton}
        >
          <MaterialCommunityIcons color={palette.text} name="cog-outline" size={18} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 26,
    marginHorizontal: 16,
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: "transparent",
    borderWidth: 0,
    zIndex: 30,
  },
  containerCompact: {
    marginHorizontal: 10,
    marginTop: 10,
    paddingHorizontal: 8,
    flexDirection: "column",
    alignItems: "stretch",
    gap: 10,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  titleRowCompact: {
    flexWrap: "nowrap",
  },
  kicker: {
    color: palette.text,
    fontSize: 22,
    fontWeight: "800",
  },
  pageTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    flexShrink: 1,
  },
  pageTabsCompactScroll: {
    flex: 1,
    minWidth: 0,
  },
  pageTabsCompactContent: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 4,
  },
  pageTab: {
    maxWidth: 320,
    borderRadius: 999,
    minHeight: 34,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  pageTabLayout: {
    minHeight: 36,
  },
  pageTabMainButton: {
    flex: 1,
    flexShrink: 1,
    minWidth: 72,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTabActive: {
    backgroundColor: palette.accent,
    borderColor: "rgba(77, 226, 177, 0.55)",
  },
  pageMoveButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  pageMoveButtonDisabled: {
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  pageDeleteButton: {
    backgroundColor: "rgba(220, 38, 38, 0.18)",
  },
  pageDeleteButtonDisabled: {
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  pageTabLabel: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  pageTabLabelActive: {
    color: "#041019",
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 99,
  },
  statusOnline: {
    backgroundColor: "#34d399",
  },
  statusOffline: {
    backgroundColor: palette.danger,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    alignSelf: "flex-start",
  },
  actionsCompact: {
    alignSelf: "flex-end",
  },
  actionButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: palette.border,
  },
  layoutActiveButton: {
    backgroundColor: "rgba(92, 124, 255, 0.16)",
    borderColor: "rgba(92, 124, 255, 0.3)",
  },
});
