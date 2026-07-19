import { MaterialCommunityIcons } from "@expo/vector-icons";
import { createElement, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { ImagePickerModal } from "./ImagePickerModal";
import { ObjectPickerModal } from "./ObjectPickerModal";
import { SoundPickerField } from "./SoundPickerField";
import { IoBrokerClient } from "../services/iobroker";
import { WidgetAppearance, WidgetConfig, WidgetInteractionSounds } from "../types/dashboard";
import { useDashboardConfig } from "../context/DashboardConfigContext";
import { normalizeSoundSelection } from "../utils/lcarsSounds";
import { playConfiguredUiSound } from "../utils/uiSounds";
import { resolveThemeSettings } from "../utils/themeConfig";
import { stateIconOptions } from "../utils/stateIcons";
import { palette } from "../utils/theme";

type WidgetEditorModalProps = {
  client: IoBrokerClient;
  widget: WidgetConfig | null;
  visible: boolean;
  onClose: () => void;
  onSave: (widgetId: string, partial: Partial<WidgetConfig>) => void;
};

export function WidgetEditorModal({ client, widget, visible, onClose, onSave }: WidgetEditorModalProps) {
  const { config, patchConfig, dashboardPages, copyWidgetToPage } = useDashboardConfig();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [soundDraft, setSoundDraft] = useState<Record<string, string[]>>({});
  const [weatherSuggestions, setWeatherSuggestions] = useState<Array<{
    label: string;
    latitude: number;
    longitude: number;
    query: string;
  }>>([]);
  const [weatherSearchBusy, setWeatherSearchBusy] = useState(false);
  const [pickerField, setPickerField] = useState<string | null>(null);
  const [imagePickerField, setImagePickerField] = useState<"backgroundImage" | "iconImage" | "cocoProfileImage" | null>(null);
  const theme = resolveThemeSettings(config.theme);
  const iconPreview = useMemo(() => {
    const active = (draft.iconActive || widget?.iconPair?.active || "toggle-switch-outline") as keyof typeof MaterialCommunityIcons.glyphMap;
    const inactive = (draft.iconInactive || widget?.iconPair?.inactive || "toggle-switch-off-outline") as keyof typeof MaterialCommunityIcons.glyphMap;
    return { active, inactive };
  }, [draft.iconActive, draft.iconInactive, widget?.iconPair?.active, widget?.iconPair?.inactive]);
  const editorTargetKey = visible && widget ? `${widget.type}:${widget.id}` : null;
  const sourcePageId = useMemo(() => {
    if (!widget) {
      return null;
    }
    const sourcePage = dashboardPages.find((page) => page.widgets.some((entry) => entry.id === widget.id));
    return sourcePage?.id || null;
  }, [dashboardPages, widget]);
  const copyTargetPages = useMemo(
    () =>
      widget
        ? dashboardPages.filter((page) => page.id !== sourcePageId && (page.mode || "dashboard") !== "url")
        : [],
    [dashboardPages, sourcePageId, widget]
  );

  useEffect(() => {
    if (!widget || !editorTargetKey) {
      return;
    }

    const appearanceDraft = buildAppearanceDraft(widget, theme);

    if (widget.type === "state") {
      setSoundDraft({
        press: resolveDraftSoundValue(
          widget.interactionSounds?.press,
          config.uiSounds?.widgetTypeDefaults?.state?.press
        ),
        confirm: resolveDraftSoundValue(
          widget.interactionSounds?.confirm,
          config.uiSounds?.widgetTypeDefaults?.state?.confirm
        ),
      });
      setDraft({
        title: widget.title,
        showTitle: widget.showTitle === false ? "false" : "true",
        stateId: widget.stateId,
        iconImage: widget.iconImage || "",
        iconImageCrop: widget.iconImageCrop || "none",
        iconImageSizeMode: widget.iconImageSizeMode || "standard",
        iconImageBorderless: widget.iconImageBorderless ? "true" : "false",
        onLabel: widget.onLabel || "",
        offLabel: widget.offLabel || "",
        activeValue: widget.activeValue || "",
        inactiveValue: widget.inactiveValue || "",
        valueLabelsJson:
          widget.valueLabels && Object.keys(widget.valueLabels).length
            ? JSON.stringify(widget.valueLabels, null, 2)
            : "",
        writeable: widget.writeable ? "true" : "false",
        format: widget.format || "boolean",
        iconActive: widget.iconPair?.active || "toggle-switch",
        iconInactive: widget.iconPair?.inactive || "toggle-switch-off-outline",
        addonMode: widget.addonMode || "none",
        addonValue: widget.addonValue || "",
        addonStateId: widget.addonStateId || "",
        addonColor: widget.addonColor || "",
        addonIcon: widget.addonIcon || "",
        addonUseStateValue: widget.addonUseStateValue ? "true" : "false",
        ...appearanceDraft,
      });
      return;
    }

    if (widget.type === "camera" || widget.type === "cameraTalk" || widget.type === "cameraTalkReolink") {
      setSoundDraft({
        press: resolveDraftSoundValue(
          widget.interactionSounds?.press,
          config.uiSounds?.widgetTypeDefaults?.camera?.press
        ),
        open: resolveDraftSoundValue(
          widget.interactionSounds?.open,
          config.uiSounds?.widgetTypeDefaults?.camera?.open
        ),
        close: resolveDraftSoundValue(
          widget.interactionSounds?.close,
          config.uiSounds?.widgetTypeDefaults?.camera?.close
        ),
        scroll: resolveDraftSoundValue(
          widget.interactionSounds?.scroll,
          config.uiSounds?.widgetTypeDefaults?.camera?.scroll
        ),
      });
      setDraft({
        title: widget.title,
        showTitle: widget.showTitle === false ? "false" : "true",
        titleFontSize: String(widget.titleFontSize || 14),
        previewSourceMode: "snapshot",
        fullscreenSourceMode: widget.fullscreenSourceMode || widget.previewSourceMode || "snapshot",
        snapshotUrl: widget.snapshotUrl || "",
        fullscreenSnapshotUrl: widget.fullscreenSnapshotUrl || widget.snapshotUrl || "",
        mjpegUrl: widget.mjpegUrl || "",
        fullscreenMjpegUrl: widget.fullscreenMjpegUrl || widget.mjpegUrl || "",
        flvUrl: widget.flvUrl || "",
        fullscreenFlvUrl: widget.fullscreenFlvUrl || widget.flvUrl || "",
        fmp4Url: widget.fmp4Url || "",
        fullscreenFmp4Url: widget.fullscreenFmp4Url || widget.fmp4Url || "",
        fullscreenWebrtcUrl: widget.fullscreenWebrtcUrl || "",
        refreshMs: String(widget.refreshMs || 2000),
        fullscreenRefreshMs: String(widget.fullscreenRefreshMs || widget.refreshMs || 2000),
        audioEnabled: widget.audioEnabled === true ? "true" : "false",
        maximizeStateId: widget.maximizeStateId || "",
        maximizeTriggerFormat: widget.maximizeTriggerFormat || "boolean",
        maximizeTriggerValue: widget.maximizeTriggerValue || "",
        talkbackWebrtcUrl: widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? widget.talkbackWebrtcUrl || "" : "",
        talkbackPushToTalk: widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? (widget.talkbackPushToTalk !== false ? "true" : "false") : "true",
        talkbackAutoEnableVideo: widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? (widget.talkbackAutoEnableVideo ? "true" : "false") : "false",
        instarTalkbackEnabled: widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? (widget.instarTalkbackEnabled ? "true" : "false") : "false",
        instarBaseUrl: widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? widget.instarBaseUrl || "" : "",
        instarUsername: widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? widget.instarUsername || "" : "",
        instarPassword: widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? widget.instarPassword || "" : "",
        reolinkTalkbackEnabled: widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? (widget.reolinkTalkbackEnabled ? "true" : "false") : "false",
        reolinkBaseUrl: widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? widget.reolinkBaseUrl || "" : "",
        reolinkUsername: widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? widget.reolinkUsername || "" : "",
        reolinkPassword: widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? widget.reolinkPassword || "" : "",
        reolinkChannel: widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? String(widget.reolinkChannel ?? 0) : "0",
        ...appearanceDraft,
      });
      return;
    }

    if (widget.type === "energy") {
      setSoundDraft({});
      setWeatherSuggestions([]);
      setWeatherSearchBusy(false);
      setDraft({
        title: widget.title,
        showTitle: widget.showTitle === false ? "false" : "true",
        pvStateId: widget.pvStateId,
        houseStateId: widget.houseStateId,
        batteryStateId: widget.batteryStateId || "",
        gridStateId: widget.gridStateId || "",
        ...appearanceDraft,
      });
      return;
    }

    if (widget.type === "grafana") {
      setSoundDraft({
        press: resolveDraftSoundValue(
          widget.interactionSounds?.press,
          config.uiSounds?.widgetTypeDefaults?.grafana?.press
        ),
        open: resolveDraftSoundValue(
          widget.interactionSounds?.open,
          config.uiSounds?.widgetTypeDefaults?.grafana?.open
        ),
        close: resolveDraftSoundValue(
          widget.interactionSounds?.close,
          config.uiSounds?.widgetTypeDefaults?.grafana?.close
        ),
      });
      setDraft({
        title: widget.title,
        showTitle: widget.showTitle === false ? "false" : "true",
        url: widget.url || "",
        renderUrl: widget.renderUrl || "",
        refreshMs: String(widget.refreshMs || 60000),
        allowInteractions: widget.allowInteractions === false ? "false" : "true",
        ...appearanceDraft,
      });
      return;
    }

    if (widget.type === "numpad") {
      setSoundDraft({
        press: resolveDraftSoundValue(
          widget.interactionSounds?.press,
          config.uiSounds?.widgetTypeDefaults?.numpad?.press
        ),
      });
      setDraft({
        title: widget.title,
        showTitle: widget.showTitle === false ? "false" : "true",
        ...appearanceDraft,
      });
      return;
    }

    if (widget.type === "link" || widget.type === "netflix") {
      setSoundDraft({
        press: resolveDraftSoundValue(
          widget.interactionSounds?.press,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]?.press
        ),
        open: resolveDraftSoundValue(
          widget.interactionSounds?.open,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]?.open
        ),
        close: resolveDraftSoundValue(
          widget.interactionSounds?.close,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]?.close
        ),
      });
      setDraft({
        title: widget.title,
        showTitle: widget.showTitle === false ? "false" : "true",
        url: widget.url || "",
        iconImage: widget.iconImage || "",
        iconImageCrop: widget.iconImageCrop || "none",
        iconImageSizeMode: widget.iconImageSizeMode || "standard",
        iconImageBorderless: widget.iconImageBorderless ? "true" : "false",
        ...appearanceDraft,
      });
      return;
    }

    if (widget.type === "log") {
      setSoundDraft({
        press: resolveDraftSoundValue(
          widget.interactionSounds?.press,
          config.uiSounds?.widgetTypeDefaults?.log?.press
        ),
        scroll: resolveDraftSoundValue(
          widget.interactionSounds?.scroll,
          config.uiSounds?.widgetTypeDefaults?.log?.scroll
        ),
        notify: resolveDraftSoundValue(
          widget.interactionSounds?.notify,
          config.uiSounds?.widgetTypeDefaults?.log?.notify
        ),
        notifyWarn: resolveDraftSoundValue(
          widget.interactionSounds?.notifyWarn,
          config.uiSounds?.widgetTypeDefaults?.log?.notifyWarn
        ),
        notifyError: resolveDraftSoundValue(
          widget.interactionSounds?.notifyError,
          config.uiSounds?.widgetTypeDefaults?.log?.notifyError
        ),
      });
      setWeatherSuggestions([]);
      setWeatherSearchBusy(false);
      setDraft({
        title: widget.title,
        showTitle: widget.showTitle === false ? "false" : "true",
        refreshMs: String(widget.refreshMs || 2000),
        maxEntries: String(widget.maxEntries || 80),
        minSeverity: widget.minSeverity || "info",
        sourceFilter: widget.sourceFilter || "",
        textFilter: widget.textFilter || "",
        ...appearanceDraft,
      });
      return;
    }

    if (widget.type === "script") {
      setSoundDraft({
        press: resolveDraftSoundValue(
          widget.interactionSounds?.press,
          config.uiSounds?.widgetTypeDefaults?.script?.press
        ),
        scroll: resolveDraftSoundValue(
          widget.interactionSounds?.scroll,
          config.uiSounds?.widgetTypeDefaults?.script?.scroll
        ),
      });
      setWeatherSuggestions([]);
      setWeatherSearchBusy(false);
      setDraft({
        title: widget.title,
        showTitle: widget.showTitle === false ? "false" : "true",
        refreshMs: String(widget.refreshMs || 3000),
        maxEntries: String(widget.maxEntries || 120),
        instanceFilter: widget.instanceFilter || "",
        textFilter: widget.textFilter || "",
        ...appearanceDraft,
      });
      return;
    }

    if (widget.type === "host") {
      setSoundDraft({});
      setWeatherSuggestions([]);
      setWeatherSearchBusy(false);
      setDraft({
        title: widget.title,
        showTitle: widget.showTitle === false ? "false" : "true",
        refreshMs: String(widget.refreshMs || 5000),
        hostLabel: widget.hostLabel || "",
        ...appearanceDraft,
      });
      return;
    }

    if (widget.type === "raspberryPiStats") {
      setSoundDraft({});
      setWeatherSuggestions([]);
      setWeatherSearchBusy(false);
      setDraft({
        title: widget.title,
        showTitle: widget.showTitle === false ? "false" : "true",
        label: widget.label || "",
        cpuTempStateId: widget.cpuTempStateId || "0_userdata.0.NAS-pi.cpuTemp",
        cpuLoadStateId: widget.cpuLoadStateId || "0_userdata.0.NAS-pi.cpuLoad",
        ramFreeStateId: widget.ramFreeStateId || "0_userdata.0.NAS-pi.ramFreePercent",
        ramFreeUnit: widget.ramFreeUnit || "percent",
        diskFreeStateId: widget.diskFreeStateId || "0_userdata.0.NAS-pi.diskFreePercent",
        diskFreeUnit: widget.diskFreeUnit || "percent",
        onlineStateId: widget.onlineStateId || "0_userdata.0.NAS-pi.online",
        ...appearanceDraft,
      });
      return;
    }

    if (widget.type === "coco") {
      setSoundDraft({
        press: resolveDraftSoundValue(
          widget.interactionSounds?.press,
          config.uiSounds?.widgetTypeDefaults?.coco?.press
        ),
        confirm: resolveDraftSoundValue(
          widget.interactionSounds?.confirm,
          config.uiSounds?.widgetTypeDefaults?.coco?.confirm
        ),
        open: resolveDraftSoundValue(
          widget.interactionSounds?.open,
          config.uiSounds?.widgetTypeDefaults?.coco?.open
        ),
        close: resolveDraftSoundValue(
          widget.interactionSounds?.close,
          config.uiSounds?.widgetTypeDefaults?.coco?.close
        ),
      });
      setWeatherSuggestions([]);
      setWeatherSearchBusy(false);
      setDraft({
        title: widget.title,
        showTitle: widget.showTitle === false ? "false" : "true",
        catName: widget.catName || widget.title || "Coco",
        profileImage: widget.profileImage || "coco-face.webp",
        refreshMs: String(widget.refreshMs || 30000),
        insideStateId: widget.insideStateId || "sureflap.0.Home.pets.Coco.inside",
        lastDirectionStateId: widget.lastDirectionStateId || "sureflap.0.Home.pets.Coco.movement.last_direction",
        lastFlapStateId: widget.lastFlapStateId || "sureflap.0.Home.pets.Coco.movement.last_flap",
        lastTimeStateId: widget.lastTimeStateId || "sureflap.0.Home.pets.Coco.movement.last_time",
        timesOutsideStateId: widget.timesOutsideStateId || "sureflap.0.Home.pets.Coco.movement.times_outside",
        timeSpentOutsideStateId: widget.timeSpentOutsideStateId || "sureflap.0.Home.pets.Coco.movement.time_spent_outside",
        flapBatteryStateId: widget.flapBatteryStateId || "sureflap.0.Home.Coco.Coco_Klappe.battery_percentage",
        flapOnlineStateId: widget.flapOnlineStateId || "sureflap.0.Home.Coco.Coco_Klappe.online",
        hubOnlineStateId: widget.hubOnlineStateId || "sureflap.0.Home.Coco.online",
        adapterConnectedStateId: widget.adapterConnectedStateId || "sureflap.0.info.connection",
        allDevicesOnlineStateId: widget.allDevicesOnlineStateId || "sureflap.0.info.all_devices_online",
        offlineDevicesStateId: widget.offlineDevicesStateId || "sureflap.0.info.offline_devices",
        lockModeStateId: widget.lockModeStateId || "",
        lockWriteStateId: widget.lockWriteStateId || "",
        lockValueType: widget.lockValueType || "number",
        lockUnlockedValue: widget.lockUnlockedValue || "0",
        lockInOnlyValue: widget.lockInOnlyValue || "1",
        lockOutOnlyValue: widget.lockOutOnlyValue || "2",
        lockLockedValue: widget.lockLockedValue || "3",
        snapshotUrl: widget.snapshotUrl || "",
        streamUrl: widget.streamUrl || "",
        fullscreenMediaMode: widget.fullscreenMediaMode || "snapshot",
        ...appearanceDraft,
      });
      return;
    }

    if (widget.type === "wallbox" || widget.type === "goe") {
      const allowChargingWriteStateId =
        widget.stopWriteStateId || widget.allowChargingStateId || "go-e-gemini-adapter.0.control.allowCharging";
      const emergencyStopStateId =
        widget.emergencyStopStateId ||
        resolveLegacyEmergencyStopFromSecondary(widget.stopSecondaryWriteStateId, allowChargingWriteStateId) ||
        "go-e-gemini-adapter.0.control.emergencyStop";
      setSoundDraft({
        press: resolveDraftSoundValue(
          widget.interactionSounds?.press,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]?.press
        ),
        confirm: resolveDraftSoundValue(
          widget.interactionSounds?.confirm,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]?.confirm
        ),
        slider: resolveDraftSoundValue(
          widget.interactionSounds?.slider,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]?.slider
        ),
      });
      setWeatherSuggestions([]);
      setWeatherSearchBusy(false);
      setDraft({
        title: widget.title,
        showTitle: widget.showTitle === false ? "false" : "true",
        showStatusSubtitle: widget.showStatusSubtitle === true ? "true" : "false",
        showGridAmpereControl: widget.showGridAmpereControl === false ? "false" : "true",
        targetMode: widget.targetMode === "km" ? "km" : "soc",
        highlightOpacity: String(widget.highlightOpacity ?? 0.32),
        refreshMs: String(widget.refreshMs || 2000),
        backgroundImage: widget.backgroundImage || "",
        backgroundImageBlur: String(widget.backgroundImageBlur ?? 8),
        stopWriteStateId: allowChargingWriteStateId,
        stopSecondaryWriteStateId: "",
        stopStateId:
          widget.stopStateId ||
          resolveMappedStateId(allowChargingWriteStateId, ".control.allowCharging", ".status.effectiveAllowCharging") ||
          "go-e-gemini-adapter.0.status.effectiveAllowCharging",
        pvWriteStateId: widget.pvWriteStateId || widget.modeStateId || "go-e-gemini-adapter.0.control.mode",
        pvStateId:
          widget.pvStateId ||
          resolveMappedStateId(
            widget.pvWriteStateId || widget.modeStateId || "go-e-gemini-adapter.0.control.mode",
            ".control.mode",
            ".status.activeMode"
          ) ||
          "go-e-gemini-adapter.0.status.activeMode",
        pvPriorityWriteStateId: widget.pvPriorityWriteStateId || widget.modeStateId || "go-e-gemini-adapter.0.control.mode",
        pvPriorityStateId:
          widget.pvPriorityStateId ||
          resolveMappedStateId(
            widget.pvPriorityWriteStateId || widget.modeStateId || "go-e-gemini-adapter.0.control.mode",
            ".control.mode",
            ".status.activeMode"
          ) ||
          "go-e-gemini-adapter.0.status.activeMode",
        gridWriteStateId: widget.gridWriteStateId || widget.modeStateId || "go-e-gemini-adapter.0.control.mode",
        gridStateId:
          widget.gridStateId ||
          resolveMappedStateId(
            widget.gridWriteStateId || widget.modeStateId || "go-e-gemini-adapter.0.control.mode",
            ".control.mode",
            ".status.activeMode"
          ) ||
          "go-e-gemini-adapter.0.status.activeMode",
        manualCurrentWriteStateId:
          widget.manualCurrentWriteStateId || widget.gridAmpereStateId || "go-e-gemini-adapter.0.control.gridManual.currentA",
        manualCurrentStateId: widget.manualCurrentStateId || widget.ampereStateId || "go-e-gemini-adapter.0.status.setCurrentA",
        ampereCardsWriteStateId:
          widget.ampereCardsWriteStateId || widget.gridAmpereStateId || "go-e-gemini-adapter.0.control.gridManual.currentA",
        ampereCardsStateId: widget.ampereCardsStateId || widget.ampereStateId || "go-e-gemini-adapter.0.status.setCurrentA",
        phaseCardsWriteStateId:
          widget.phaseCardsWriteStateId || widget.phaseSwitchModeStateId || "go-e-gemini-adapter.0.control.gridManual.phaseMode",
        phaseCardsStateId:
          widget.phaseCardsStateId ||
          resolveMappedStateId(
            widget.phaseCardsWriteStateId || widget.phaseSwitchModeStateId || "go-e-gemini-adapter.0.control.gridManual.phaseMode",
            ".control.gridManual.phaseMode",
            ".status.targetPhaseMode"
          ) ||
          "go-e-gemini-adapter.0.status.targetPhaseMode",
        stopWriteValueType: widget.stopWriteValueType || "boolean",
        stopWriteValue: widget.stopWriteValue ?? "",
        stopSecondaryWriteValueType: widget.stopSecondaryWriteValueType || "boolean",
        stopSecondaryWriteValue: widget.stopSecondaryWriteValue ?? "",
        stopStateValueType: widget.stopStateValueType || "boolean",
        stopStateValue: widget.stopStateValue ?? "",
        pvWriteValueType: widget.pvWriteValueType || "number",
        pvWriteValue: widget.pvWriteValue || "1",
        pvStateValueType: widget.pvStateValueType || "string",
        pvStateValue: widget.pvStateValue || "pv only",
        pvPriorityWriteValueType: widget.pvPriorityWriteValueType || "number",
        pvPriorityWriteValue: widget.pvPriorityWriteValue || "2",
        pvPriorityStateValueType: widget.pvPriorityStateValueType || "string",
        pvPriorityStateValue: widget.pvPriorityStateValue || "pv only (go-e = priority)",
        gridWriteValueType: widget.gridWriteValueType || "number",
        gridWriteValue: widget.gridWriteValue || "3",
        gridStateValueType: widget.gridStateValueType || "string",
        gridStateValue: widget.gridStateValue || "grid mode",
        manualCurrentWriteValueType: widget.manualCurrentWriteValueType || "number",
        manualCurrentStateValueType: widget.manualCurrentStateValueType || "number",
        ampereCardsWriteValueType: widget.ampereCardsWriteValueType || "number",
        ampereCardsStateValueType: widget.ampereCardsStateValueType || "number",
        ampere6WriteValue: widget.ampere6WriteValue || "6",
        ampere10WriteValue: widget.ampere10WriteValue || "10",
        ampere12WriteValue: widget.ampere12WriteValue || "12",
        ampere14WriteValue: widget.ampere14WriteValue || "14",
        ampere16WriteValue: widget.ampere16WriteValue || "16",
        ampere6StateValue: widget.ampere6StateValue || "6",
        ampere10StateValue: widget.ampere10StateValue || "10",
        ampere12StateValue: widget.ampere12StateValue || "12",
        ampere14StateValue: widget.ampere14StateValue || "14",
        ampere16StateValue: widget.ampere16StateValue || "16",
        phaseCardsWriteValueType: widget.phaseCardsWriteValueType || "number",
        phaseCardsStateValueType: widget.phaseCardsStateValueType || "number",
        phase1WriteValue: widget.phase1WriteValue || "1",
        phase3WriteValue: widget.phase3WriteValue || "2",
        phase1StateValue: widget.phase1StateValue || "1",
        phase3StateValue: widget.phase3StateValue || "2",
        targetChargeValueType: widget.targetChargeValueType || "number",
        modeStateId: widget.modeStateId || "go-e-gemini-adapter.0.control.mode",
        gridAmpereStateId: widget.gridAmpereStateId || "go-e-gemini-adapter.0.control.gridManual.currentA",
        limit80StateId: widget.limit80StateId || "go-e-gemini-adapter.0.control.targetSocPercent",
        targetSocAutoApiStateId:
          widget.targetSocAutoApiStateId ||
          "bmw.0.WBY11CF080CP51905.stream.vehicle.drivetrain.batteryManagement.maxEnergy.value",
        targetKmStateId: widget.targetKmStateId || "",
        allowChargingStateId: allowChargingWriteStateId,
        emergencyStopStateId,
        solarLoadOnlyStateId: widget.solarLoadOnlyStateId || "",
        phaseSwitchModeStateId: widget.phaseSwitchModeStateId || "go-e-gemini-adapter.0.control.gridManual.phaseMode",
        phaseSwitchModeEnabledStateId:
          widget.phaseSwitchModeEnabledStateId || "go-e-gemini-adapter.0.status.enabledPhases",
        ampereStateId: widget.ampereStateId || "go-e-gemini-adapter.0.status.setCurrentA",
        carStateId: widget.carStateId || "go-e-gemini-adapter.0.status.carState",
        batterySocStateId: widget.batterySocStateId || "go-e-gemini-adapter.0.status.carSocPercent",
        carRangeStateId: widget.carRangeStateId || "",
        chargePowerStateId: widget.chargePowerStateId || "go-e-gemini-adapter.0.status.chargerPowerW",
        chargedEnergyStateId: widget.chargedEnergyStateId || "go-e.0.eto",
        stopChargeingAtCarSoc80StateId:
          widget.stopChargeingAtCarSoc80StateId || "go-e-gemini-adapter.0.control.targetSocEnabled",
        ...appearanceDraft,
      });
      return;
    }

    if (widget.type === "heating" || widget.type === "heatingV2") {
      setSoundDraft({
        press: resolveDraftSoundValue(
          widget.interactionSounds?.press,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]?.press
        ),
        confirm: resolveDraftSoundValue(
          widget.interactionSounds?.confirm,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]?.confirm
        ),
        slider: resolveDraftSoundValue(
          widget.interactionSounds?.slider,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]?.slider
        ),
      });
      setWeatherSuggestions([]);
      setWeatherSearchBusy(false);
      setDraft({
        title: widget.title,
        showTitle: widget.showTitle === false ? "false" : "true",
        showStatusSubtitle: widget.showStatusSubtitle === false ? "false" : "true",
        refreshMs: String(widget.refreshMs || 3000),
        detailsTickerSpeedPxPerS: String(widget.detailsTickerSpeedPxPerS ?? 46),
        backgroundImage: widget.backgroundImage || "",
        backgroundImageBlur: String(widget.backgroundImageBlur ?? 8),
        modeSetStateId: widget.modeSetStateId,
        modeValueStateId: widget.modeValueStateId || "",
        activeProgramStateId: widget.activeProgramStateId || "",
        normalSetTempStateId: widget.normalSetTempStateId,
        reducedSetTempStateId: widget.reducedSetTempStateId || "",
        comfortSetTempStateId: widget.comfortSetTempStateId || "",
        dhwSetTempStateId: widget.dhwSetTempStateId,
        comfortActivateStateId: widget.comfortActivateStateId || "",
        comfortDeactivateStateId: widget.comfortDeactivateStateId || "",
        ecoSetActiveStateId: widget.ecoSetActiveStateId || "",
        oneTimeChargeSetActiveStateId: widget.oneTimeChargeSetActiveStateId || "",
        oneTimeChargeActiveStateId: widget.oneTimeChargeActiveStateId || "",
        heatingModeActiveStateId:
          widget.heatingModeActiveStateId ||
          widget.modeValueStateId ||
          "viessmannapi.0.299550.0.features.heating.circuits.1.operating.modes.active.properties.value.value",
        dhwChargingActiveStateId:
          widget.dhwChargingActiveStateId ||
          "viessmannapi.0.299550.0.features.heating.dhw.charging.properties.active.value",
        dhwChargingProgramStateId:
          widget.dhwChargingProgramStateId ||
          widget.dhwSetTempStateId ||
          "viessmannapi.0.299550.0.features.heating.dhw.temperature.main.commands.setTargetTemperature.setValue",
        boostBlinkActiveStateId:
          widget.boostBlinkActiveStateId ||
          widget.oneTimeChargeActiveStateId ||
          "viessmannapi.0.299550.0.features.heating.dhw.oneTimeCharge.properties.active.value",
        ventilationAutoSetActiveStateId: widget.ventilationAutoSetActiveStateId || "",
        ventilationAutoActiveStateId: widget.ventilationAutoActiveStateId || "",
        ventilationLevelSetStateId: widget.ventilationLevelSetStateId || "",
        ventilationLevelStateId: widget.ventilationLevelStateId || "",
        roomTempStateId: widget.roomTempStateId || "",
        heatingTempStateId: widget.heatingTempStateId || "",
        supplyTempStateId: widget.supplyTempStateId || "",
        outsideTempStateId: widget.outsideTempStateId || "",
        returnTempStateId: widget.returnTempStateId || "",
        dhwTempStateId: widget.dhwTempStateId || "",
        compressorPowerStateId: widget.compressorPowerStateId || "",
        compressorSensorPowerStateId: widget.compressorSensorPowerStateId || "",
        showInfoProgram: widget.showInfoProgram === false ? "false" : "true",
        showInfoTargets: widget.showInfoTargets === false ? "false" : "true",
        showInfoOutsideTemp: widget.showInfoOutsideTemp === false ? "false" : "true",
        showInfoSupplyTemp: widget.showInfoSupplyTemp === false ? "false" : "true",
        showInfoReturnTemp: widget.showInfoReturnTemp === false ? "false" : "true",
        showInfoHeatingTemp: widget.showInfoHeatingTemp === false ? "false" : "true",
        showInfoCompressorPower: widget.showInfoCompressorPower === false ? "false" : "true",
        standbyIcon: widget.standbyIcon || "power-standby",
        dhwIcon: widget.dhwIcon || "water",
        heatingIcon: widget.heatingIcon || "radiator",
        comfortIcon: widget.comfortIcon || "white-balance-sunny",
        ecoIcon: widget.ecoIcon || "leaf",
        oneTimeChargeIcon: normalizeHeatingOneTimeIcon(widget.oneTimeChargeIcon),
        ...appearanceDraft,
      });
      return;
    }

    if (widget.type === "weather") {
      setSoundDraft({});
      setDraft({
        title: widget.title,
        showTitle: widget.showTitle === false ? "false" : "true",
        locationName: widget.locationName || "",
        locationQuery: widget.locationQuery || "",
        latitude: String(widget.latitude),
        longitude: String(widget.longitude),
        timezone: widget.timezone || "auto",
        refreshMs: String(widget.refreshMs || 300000),
        ...appearanceDraft,
      });
      return;
    }

    if (widget.type !== "solar") {
      return;
    }
    const solarStatDraft = buildSolarStatEditorDraft(widget.stats);
    setSoundDraft({});
    setWeatherSuggestions([]);
    setWeatherSearchBusy(false);
    setDraft({
      title: widget.title,
      showTitle: widget.showTitle === false ? "false" : "true",
      backgroundMode: widget.backgroundMode || "color",
      backgroundImage: widget.backgroundImage || "",
      backgroundImageBlur: String(widget.backgroundImageBlur ?? 8),
      wallboxCarStateId: widget.wallboxCarStateId || "go-e.0.car",
      wallboxChargePowerStateId: widget.wallboxChargePowerStateId || "go-e.0.nrg.11",
      wallboxAmpereStateId: widget.wallboxAmpereStateId || "go-e.0.ampere",
      wallboxPhaseModeStateId: widget.wallboxPhaseModeStateId || "go-e.0.phaseSwitchMode",
      wallboxCarSocStateId: widget.wallboxCarSocStateId || "go-e.0.carBatterySoc",
      wallboxCarRangeStateId: widget.wallboxCarRangeStateId || "",
      statePrefix: widget.statePrefix,
      dailyEnergyUnit: widget.dailyEnergyUnit || "auto",
      statValueUnit: widget.statValueUnit || "none",
      keyPvNow: widget.keys.pvNow,
      keyHomeNow: widget.keys.homeNow,
      keyGridIn: widget.keys.gridIn,
      keyGridOut: widget.keys.gridOut,
      keySoc: widget.keys.soc || "",
      keyBattIn: widget.keys.battIn || "",
      keyBattOut: widget.keys.battOut || "",
      keyDayConsumed: widget.keys.dayConsumed,
      keyDaySelf: widget.keys.daySelf,
      keyPvTotal: widget.keys.pvTotal || "",
      keyBattTemp: widget.keys.battTemp || "",
      statTextScalePct: String(Math.round((widget.statTextScale ?? 1) * 100)),
      statCount: String(solarStatDraft.count),
      stat1Label: solarStatDraft.cards[0].label,
      stat1StateId: solarStatDraft.cards[0].stateId,
      stat2Label: solarStatDraft.cards[1].label,
      stat2StateId: solarStatDraft.cards[1].stateId,
      stat3Label: solarStatDraft.cards[2].label,
      stat3StateId: solarStatDraft.cards[2].stateId,
      stat4Label: solarStatDraft.cards[3].label,
      stat4StateId: solarStatDraft.cards[3].stateId,
      stat5Label: solarStatDraft.cards[4].label,
      stat5StateId: solarStatDraft.cards[4].stateId,
      stat6Label: solarStatDraft.cards[5].label,
      stat6StateId: solarStatDraft.cards[5].stateId,
      solarTapType: widget.tapAction?.type || "none",
      solarTapDashboardId: widget.tapAction?.type === "dashboard" ? widget.tapAction.dashboardId : "",
      solarTapUrl: widget.tapAction?.type === "url" ? widget.tapAction.url : "",
      ...appearanceDraft,
    });
  }, [editorTargetKey]);

  useEffect(() => {
    if (!visible || widget?.type !== "weather") {
      return;
    }

    const query = (draft.locationQuery || "").trim();
    if (query.length < 2) {
      setWeatherSuggestions([]);
      setWeatherSearchBusy(false);
      return;
    }

    let active = true;
    setWeatherSearchBusy(true);

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          name: query,
          count: "5",
          language: "de",
          format: "json",
        });
        const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Geocoding failed (${response.status})`);
        }

        const payload = (await response.json()) as {
          results?: Array<{
            name: string;
            latitude: number;
            longitude: number;
            country?: string;
            admin1?: string;
          }>;
        };

        if (!active) {
          return;
        }

        setWeatherSuggestions(
          (payload.results || []).map((entry) => ({
            label: [entry.name, entry.admin1, entry.country].filter(Boolean).join(", "),
            latitude: entry.latitude,
            longitude: entry.longitude,
            query: entry.name,
          }))
        );
      } catch {
        if (active) {
          setWeatherSuggestions([]);
        }
      } finally {
        if (active) {
          setWeatherSearchBusy(false);
        }
      }
    }, 260);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [draft.locationQuery, visible, widget?.type]);

  if (!widget) {
    return null;
  }

  const previewCameraMode = "snapshot" as const;
  const fullscreenCameraMode = normalizeCameraSourceMode(draft.fullscreenSourceMode || draft.previewSourceMode);
  const previewCameraUrl = getCameraUrlByMode(draft, previewCameraMode, "preview");
  const fullscreenCameraUrl = getCameraUrlByMode(draft, fullscreenCameraMode, "fullscreen");
  const solarStatCount = clampSolarStatCount(draft.statCount);

  const save = () => {
    const appearance = buildAppearance(draft);

    if (widget.type === "state") {
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        stateId: draft.stateId || widget.stateId,
        iconImage: draft.iconImage || undefined,
        iconImageCrop: normalizeIconImageCrop(draft.iconImageCrop),
        iconImageSizeMode: normalizeIconImageSizeMode(draft.iconImageSizeMode),
        iconImageBorderless: draft.iconImageBorderless === "true",
        onLabel: draft.onLabel || undefined,
        offLabel: draft.offLabel || undefined,
        activeValue: draft.activeValue || undefined,
        inactiveValue: draft.inactiveValue || undefined,
        valueLabels: parseValueLabels(draft.valueLabelsJson),
        writeable: draft.writeable !== "false",
        format: normalizeStateFormat(draft.format),
        iconPair: {
          active: (draft.iconActive || widget.iconPair?.active || "toggle-switch") as never,
          inactive: (draft.iconInactive || widget.iconPair?.inactive || "toggle-switch-off-outline") as never,
        },
        addonMode: normalizeAddonMode(draft.addonMode),
        addonValue: draft.addonValue || undefined,
        addonStateId: draft.addonStateId || undefined,
        addonColor: draft.addonColor || undefined,
        addonIcon: draft.addonIcon || undefined,
        addonUseStateValue: draft.addonUseStateValue === "true",
        interactionSounds: buildStoredInteractionSounds(
          widget.type,
          soundDraft,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]
        ),
        appearance,
      });
    } else if (widget.type === "camera" || widget.type === "cameraTalk" || widget.type === "cameraTalkReolink") {
      const previewSourceMode = previewCameraMode;
      const fullscreenSourceMode = fullscreenCameraMode;
      const snapshotUrl = normalizeOptionalInput(draft.snapshotUrl);
      const fullscreenSnapshotUrl = normalizeOptionalInput(draft.fullscreenSnapshotUrl);
      const mjpegUrl = normalizeOptionalInput(draft.mjpegUrl);
      const fullscreenMjpegUrl = normalizeOptionalInput(draft.fullscreenMjpegUrl);
      const flvUrl = normalizeOptionalInput(draft.flvUrl);
      const fullscreenFlvUrl = normalizeOptionalInput(draft.fullscreenFlvUrl);
      const fmp4Url = normalizeOptionalInput(draft.fmp4Url);
      const fullscreenFmp4Url = normalizeOptionalInput(draft.fullscreenFmp4Url);
      const fullscreenWebrtcUrl = normalizeOptionalInput(draft.fullscreenWebrtcUrl);
      const cameraSourceChanged =
        normalizeCameraSourceMode(widget.previewSourceMode) !== previewSourceMode ||
        normalizeCameraSourceMode(widget.fullscreenSourceMode || widget.previewSourceMode) !== fullscreenSourceMode ||
        normalizeOptionalInput(widget.snapshotUrl) !== snapshotUrl ||
        normalizeOptionalInput(widget.fullscreenSnapshotUrl) !== fullscreenSnapshotUrl ||
        normalizeOptionalInput(widget.mjpegUrl) !== mjpegUrl ||
        normalizeOptionalInput(widget.fullscreenMjpegUrl) !== fullscreenMjpegUrl ||
        normalizeOptionalInput(widget.flvUrl) !== flvUrl ||
        normalizeOptionalInput(widget.fullscreenFlvUrl) !== fullscreenFlvUrl ||
        normalizeOptionalInput(widget.fmp4Url) !== fmp4Url ||
        normalizeOptionalInput(widget.fullscreenFmp4Url) !== fullscreenFmp4Url ||
        normalizeOptionalInput(widget.fullscreenWebrtcUrl) !== fullscreenWebrtcUrl;
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        titleFontSize: clampInt(draft.titleFontSize, widget.titleFontSize || 14, 11),
        previewSourceMode,
        fullscreenSourceMode,
        snapshotUrl,
        fullscreenSnapshotUrl,
        mjpegUrl,
        fullscreenMjpegUrl,
        flvUrl,
        fullscreenFlvUrl,
        fmp4Url,
        fullscreenFmp4Url,
        fullscreenWebrtcUrl,
        refreshMs: clampInt(draft.refreshMs, widget.refreshMs || 2000, 2000),
        fullscreenRefreshMs: clampInt(draft.fullscreenRefreshMs, widget.fullscreenRefreshMs || widget.refreshMs || 2000, 2000),
        audioEnabled: draft.audioEnabled === "true",
        manualHeightOverride: cameraSourceChanged ? false : widget.manualHeightOverride,
        snapshotAspectRatio: cameraSourceChanged ? undefined : widget.snapshotAspectRatio,
        maximizeStateId: draft.maximizeStateId || undefined,
        maximizeTriggerFormat: normalizeStateFormat(draft.maximizeTriggerFormat),
        maximizeTriggerValue: draft.maximizeTriggerValue || undefined,
        ...(widget.type === "cameraTalk" || widget.type === "cameraTalkReolink"
          ? {
              talkbackWebrtcUrl: normalizeOptionalInput(draft.talkbackWebrtcUrl),
              talkbackPushToTalk: draft.talkbackPushToTalk !== "false",
              talkbackAutoEnableVideo: draft.talkbackAutoEnableVideo === "true",
              instarTalkbackEnabled: draft.instarTalkbackEnabled === "true",
              instarBaseUrl: normalizeOptionalInput(draft.instarBaseUrl),
              instarUsername: normalizeOptionalInput(draft.instarUsername),
              instarPassword: normalizeOptionalInput(draft.instarPassword),
              reolinkTalkbackEnabled: draft.reolinkTalkbackEnabled === "true",
              reolinkBaseUrl: normalizeOptionalInput(draft.reolinkBaseUrl),
              reolinkUsername: normalizeOptionalInput(draft.reolinkUsername),
              reolinkPassword: normalizeOptionalInput(draft.reolinkPassword),
              reolinkChannel: clampInt(draft.reolinkChannel, 0, 0),
            }
          : null),
        interactionSounds: buildStoredInteractionSounds(
          widget.type,
          soundDraft,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]
        ),
        appearance,
      });
    } else if (widget.type === "energy") {
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        pvStateId: draft.pvStateId || widget.pvStateId,
        houseStateId: draft.houseStateId || widget.houseStateId,
        batteryStateId: draft.batteryStateId || undefined,
        gridStateId: draft.gridStateId || undefined,
        appearance,
      });
    } else if (widget.type === "grafana") {
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        url: draft.url || widget.url,
        renderUrl: normalizeOptionalInput(draft.renderUrl),
        refreshMs: clampInt(draft.refreshMs, widget.refreshMs || 60000, 30000),
        allowInteractions: draft.allowInteractions !== "false",
        interactionSounds: buildStoredInteractionSounds(
          widget.type,
          soundDraft,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]
        ),
        appearance,
      });
    } else if (widget.type === "numpad") {
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        interactionSounds: buildStoredInteractionSounds(
          widget.type,
          soundDraft,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]
        ),
        appearance,
      });
    } else if (widget.type === "link" || widget.type === "netflix") {
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        url: draft.url || undefined,
        iconImage: draft.iconImage || undefined,
        iconImageCrop: normalizeIconImageCrop(draft.iconImageCrop),
        iconImageSizeMode: normalizeIconImageSizeMode(draft.iconImageSizeMode),
        iconImageBorderless: draft.iconImageBorderless === "true",
        interactionSounds: buildStoredInteractionSounds(
          widget.type,
          soundDraft,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]
        ),
        appearance,
      });
    } else if (widget.type === "log") {
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        refreshMs: clampInt(draft.refreshMs, widget.refreshMs || 2000, 500),
        maxEntries: clampIntMax(draft.maxEntries, widget.maxEntries || 80, 5, 200),
        minSeverity: normalizeLogSeverity(draft.minSeverity),
        sourceFilter: draft.sourceFilter?.trim() || undefined,
        textFilter: draft.textFilter?.trim() || undefined,
        interactionSounds: buildStoredInteractionSounds(
          widget.type,
          soundDraft,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]
        ),
        appearance,
      });
    } else if (widget.type === "script") {
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        refreshMs: clampInt(draft.refreshMs, widget.refreshMs || 3000, 500),
        maxEntries: clampInt(draft.maxEntries, widget.maxEntries || 120, 1),
        instanceFilter: draft.instanceFilter?.trim() || undefined,
        textFilter: draft.textFilter?.trim() || undefined,
        interactionSounds: buildStoredInteractionSounds(
          widget.type,
          soundDraft,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]
        ),
        appearance,
      });
    } else if (widget.type === "host") {
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        refreshMs: clampInt(draft.refreshMs, widget.refreshMs || 5000, 1500),
        hostLabel: draft.hostLabel?.trim() || undefined,
        appearance,
      });
    } else if (widget.type === "raspberryPiStats") {
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        label: draft.label?.trim() || undefined,
        cpuTempStateId: draft.cpuTempStateId?.trim() || widget.cpuTempStateId,
        cpuLoadStateId: draft.cpuLoadStateId?.trim() || widget.cpuLoadStateId,
        ramFreeStateId: draft.ramFreeStateId?.trim() || widget.ramFreeStateId,
        ramFreeUnit: normalizeRaspberryDataUnit(draft.ramFreeUnit, widget.ramFreeUnit || "percent"),
        diskFreeStateId: draft.diskFreeStateId?.trim() || widget.diskFreeStateId,
        diskFreeUnit: normalizeRaspberryDataUnit(draft.diskFreeUnit, widget.diskFreeUnit || "percent"),
        onlineStateId: draft.onlineStateId?.trim() || widget.onlineStateId,
        appearance,
      });
    } else if (widget.type === "coco") {
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        catName: draft.catName?.trim() || undefined,
        profileImage: draft.profileImage?.trim() || undefined,
        refreshMs: clampInt(draft.refreshMs, widget.refreshMs || 30000, 1000),
        insideStateId: draft.insideStateId?.trim() || widget.insideStateId,
        lastDirectionStateId: draft.lastDirectionStateId?.trim() || undefined,
        lastFlapStateId: draft.lastFlapStateId?.trim() || undefined,
        lastTimeStateId: draft.lastTimeStateId?.trim() || widget.lastTimeStateId,
        timesOutsideStateId: draft.timesOutsideStateId?.trim() || undefined,
        timeSpentOutsideStateId: draft.timeSpentOutsideStateId?.trim() || undefined,
        flapBatteryStateId: draft.flapBatteryStateId?.trim() || undefined,
        flapOnlineStateId: draft.flapOnlineStateId?.trim() || undefined,
        hubOnlineStateId: draft.hubOnlineStateId?.trim() || undefined,
        adapterConnectedStateId: draft.adapterConnectedStateId?.trim() || undefined,
        allDevicesOnlineStateId: draft.allDevicesOnlineStateId?.trim() || undefined,
        offlineDevicesStateId: draft.offlineDevicesStateId?.trim() || undefined,
        lockModeStateId: draft.lockModeStateId?.trim() || undefined,
        lockWriteStateId: draft.lockWriteStateId?.trim() || undefined,
        lockValueType: draft.lockValueType === "string" ? "string" : "number",
        lockUnlockedValue: draft.lockUnlockedValue?.trim() || undefined,
        lockInOnlyValue: draft.lockInOnlyValue?.trim() || undefined,
        lockOutOnlyValue: draft.lockOutOnlyValue?.trim() || undefined,
        lockLockedValue: draft.lockLockedValue?.trim() || undefined,
        snapshotUrl: draft.snapshotUrl?.trim() || undefined,
        streamUrl: draft.streamUrl?.trim() || undefined,
        fullscreenMediaMode: normalizeCocoFullscreenMediaMode(draft.fullscreenMediaMode),
        interactionSounds: buildStoredInteractionSounds(
          widget.type,
          soundDraft,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]
        ),
        appearance,
      });
    } else if (widget.type === "wallbox" || widget.type === "goe") {
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        showStatusSubtitle: draft.showStatusSubtitle === "true",
        showGridAmpereControl: draft.showGridAmpereControl !== "false",
        targetMode: draft.targetMode === "km" ? "km" : "soc",
        highlightOpacity: clampFloatRange(draft.highlightOpacity, widget.highlightOpacity ?? 0.32, 0.08, 0.9),
        refreshMs: clampInt(draft.refreshMs, widget.refreshMs || 2000, 500),
        backgroundImage: draft.backgroundImage?.trim() || undefined,
        backgroundImageBlur: clampInt(draft.backgroundImageBlur, widget.backgroundImageBlur ?? 8, 0),
        stopWriteStateId: draft.stopWriteStateId?.trim() || undefined,
        stopSecondaryWriteStateId: undefined,
        stopStateId: draft.stopStateId?.trim() || undefined,
        pvWriteStateId: draft.pvWriteStateId?.trim() || undefined,
        pvStateId: draft.pvStateId?.trim() || undefined,
        pvPriorityWriteStateId: draft.pvPriorityWriteStateId?.trim() || undefined,
        pvPriorityStateId: draft.pvPriorityStateId?.trim() || undefined,
        gridWriteStateId: draft.gridWriteStateId?.trim() || undefined,
        gridStateId: draft.gridStateId?.trim() || undefined,
        manualCurrentWriteStateId: draft.manualCurrentWriteStateId?.trim() || undefined,
        manualCurrentStateId: draft.manualCurrentStateId?.trim() || undefined,
        ampereCardsWriteStateId: draft.ampereCardsWriteStateId?.trim() || undefined,
        ampereCardsStateId: draft.ampereCardsStateId?.trim() || undefined,
        phaseCardsWriteStateId: draft.phaseCardsWriteStateId?.trim() || undefined,
        phaseCardsStateId: draft.phaseCardsStateId?.trim() || undefined,
        stopWriteValueType: normalizeWallboxValueType(draft.stopWriteValueType, "boolean"),
        stopWriteValue: draft.stopWriteValue?.trim() || undefined,
        stopSecondaryWriteValueType: undefined,
        stopSecondaryWriteValue: undefined,
        stopStateValueType: normalizeWallboxValueType(draft.stopStateValueType, "boolean"),
        stopStateValue: draft.stopStateValue?.trim() || undefined,
        pvWriteValueType: normalizeWallboxValueType(draft.pvWriteValueType, "number"),
        pvWriteValue: draft.pvWriteValue?.trim() || undefined,
        pvStateValueType: normalizeWallboxValueType(draft.pvStateValueType, "string"),
        pvStateValue: draft.pvStateValue?.trim() || undefined,
        pvPriorityWriteValueType: normalizeWallboxValueType(draft.pvPriorityWriteValueType, "number"),
        pvPriorityWriteValue: draft.pvPriorityWriteValue?.trim() || undefined,
        pvPriorityStateValueType: normalizeWallboxValueType(draft.pvPriorityStateValueType, "string"),
        pvPriorityStateValue: draft.pvPriorityStateValue?.trim() || undefined,
        gridWriteValueType: normalizeWallboxValueType(draft.gridWriteValueType, "number"),
        gridWriteValue: draft.gridWriteValue?.trim() || undefined,
        gridStateValueType: normalizeWallboxValueType(draft.gridStateValueType, "string"),
        gridStateValue: draft.gridStateValue?.trim() || undefined,
        manualCurrentWriteValueType: normalizeWallboxValueType(draft.manualCurrentWriteValueType, "number"),
        manualCurrentStateValueType: normalizeWallboxValueType(draft.manualCurrentStateValueType, "number"),
        ampereCardsWriteValueType: normalizeWallboxValueType(draft.ampereCardsWriteValueType, "number"),
        ampereCardsStateValueType: normalizeWallboxValueType(draft.ampereCardsStateValueType, "number"),
        ampere6WriteValue: draft.ampere6WriteValue?.trim() || undefined,
        ampere10WriteValue: draft.ampere10WriteValue?.trim() || undefined,
        ampere12WriteValue: draft.ampere12WriteValue?.trim() || undefined,
        ampere14WriteValue: draft.ampere14WriteValue?.trim() || undefined,
        ampere16WriteValue: draft.ampere16WriteValue?.trim() || undefined,
        ampere6StateValue: draft.ampere6StateValue?.trim() || undefined,
        ampere10StateValue: draft.ampere10StateValue?.trim() || undefined,
        ampere12StateValue: draft.ampere12StateValue?.trim() || undefined,
        ampere14StateValue: draft.ampere14StateValue?.trim() || undefined,
        ampere16StateValue: draft.ampere16StateValue?.trim() || undefined,
        phaseCardsWriteValueType: normalizeWallboxValueType(draft.phaseCardsWriteValueType, "number"),
        phaseCardsStateValueType: normalizeWallboxValueType(draft.phaseCardsStateValueType, "number"),
        phase1WriteValue: draft.phase1WriteValue?.trim() || undefined,
        phase3WriteValue: draft.phase3WriteValue?.trim() || undefined,
        phase1StateValue: draft.phase1StateValue?.trim() || undefined,
        phase3StateValue: draft.phase3StateValue?.trim() || undefined,
        targetChargeValueType: normalizeWallboxValueType(draft.targetChargeValueType, "number"),
        modeStateId: draft.pvWriteStateId?.trim() || draft.modeStateId?.trim() || widget.modeStateId,
        gridAmpereStateId:
          draft.manualCurrentWriteStateId?.trim() || draft.gridAmpereStateId?.trim() || widget.gridAmpereStateId,
        limit80StateId: draft.limit80StateId?.trim() || widget.limit80StateId,
        targetSocAutoApiStateId: draft.targetSocAutoApiStateId?.trim() || undefined,
        targetKmStateId: draft.targetKmStateId?.trim() || undefined,
        allowChargingStateId:
          draft.stopWriteStateId?.trim() ||
          draft.allowChargingStateId?.trim() ||
          undefined,
        emergencyStopStateId: draft.emergencyStopStateId?.trim() || undefined,
        solarLoadOnlyStateId: draft.solarLoadOnlyStateId?.trim() || undefined,
        phaseSwitchModeStateId:
          draft.phaseCardsWriteStateId?.trim() || draft.phaseSwitchModeStateId?.trim() || undefined,
        phaseSwitchModeEnabledStateId: draft.phaseSwitchModeEnabledStateId?.trim() || undefined,
        ampereStateId: draft.manualCurrentStateId?.trim() || draft.ampereStateId?.trim() || undefined,
        carStateId: draft.carStateId?.trim() || undefined,
        batterySocStateId: draft.batterySocStateId?.trim() || undefined,
        carRangeStateId: draft.carRangeStateId?.trim() || undefined,
        chargePowerStateId: draft.chargePowerStateId?.trim() || undefined,
        chargedEnergyStateId: draft.chargedEnergyStateId?.trim() || undefined,
        stopChargeingAtCarSoc80StateId: draft.stopChargeingAtCarSoc80StateId?.trim() || undefined,
        interactionSounds: buildStoredInteractionSounds(
          widget.type,
          soundDraft,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]
        ),
        appearance,
      });
    } else if (widget.type === "heating" || widget.type === "heatingV2") {
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        showStatusSubtitle: draft.showStatusSubtitle !== "false",
        refreshMs: clampInt(draft.refreshMs, widget.refreshMs || 3000, 500),
        detailsTickerSpeedPxPerS: clampInt(draft.detailsTickerSpeedPxPerS, widget.detailsTickerSpeedPxPerS ?? 46, 16),
        backgroundImage: draft.backgroundImage?.trim() || undefined,
        backgroundImageBlur: clampInt(draft.backgroundImageBlur, widget.backgroundImageBlur ?? 8, 0),
        modeSetStateId: draft.modeSetStateId?.trim() || widget.modeSetStateId,
        modeValueStateId: draft.modeValueStateId?.trim() || undefined,
        activeProgramStateId: draft.activeProgramStateId?.trim() || undefined,
        normalSetTempStateId: draft.normalSetTempStateId?.trim() || widget.normalSetTempStateId,
        reducedSetTempStateId: draft.reducedSetTempStateId?.trim() || undefined,
        comfortSetTempStateId: draft.comfortSetTempStateId?.trim() || undefined,
        dhwSetTempStateId: draft.dhwSetTempStateId?.trim() || widget.dhwSetTempStateId,
        comfortActivateStateId: draft.comfortActivateStateId?.trim() || undefined,
        comfortDeactivateStateId: draft.comfortDeactivateStateId?.trim() || undefined,
        ecoSetActiveStateId: draft.ecoSetActiveStateId?.trim() || undefined,
        oneTimeChargeSetActiveStateId: draft.oneTimeChargeSetActiveStateId?.trim() || undefined,
        oneTimeChargeActiveStateId: draft.oneTimeChargeActiveStateId?.trim() || undefined,
        heatingModeActiveStateId: draft.heatingModeActiveStateId?.trim() || undefined,
        dhwChargingActiveStateId: draft.dhwChargingActiveStateId?.trim() || undefined,
        dhwChargingProgramStateId: draft.dhwChargingProgramStateId?.trim() || undefined,
        boostBlinkActiveStateId: draft.boostBlinkActiveStateId?.trim() || undefined,
        ventilationAutoSetActiveStateId: draft.ventilationAutoSetActiveStateId?.trim() || undefined,
        ventilationAutoActiveStateId: draft.ventilationAutoActiveStateId?.trim() || undefined,
        ventilationLevelSetStateId: draft.ventilationLevelSetStateId?.trim() || undefined,
        ventilationLevelStateId: draft.ventilationLevelStateId?.trim() || undefined,
        roomTempStateId: draft.roomTempStateId?.trim() || undefined,
        heatingTempStateId: draft.heatingTempStateId?.trim() || undefined,
        supplyTempStateId: draft.supplyTempStateId?.trim() || undefined,
        outsideTempStateId: draft.outsideTempStateId?.trim() || undefined,
        returnTempStateId: draft.returnTempStateId?.trim() || undefined,
        dhwTempStateId: draft.dhwTempStateId?.trim() || undefined,
        compressorPowerStateId: draft.compressorPowerStateId?.trim() || undefined,
        compressorSensorPowerStateId: draft.compressorSensorPowerStateId?.trim() || undefined,
        showInfoProgram: draft.showInfoProgram !== "false",
        showInfoTargets: draft.showInfoTargets !== "false",
        showInfoOutsideTemp: draft.showInfoOutsideTemp !== "false",
        showInfoSupplyTemp: draft.showInfoSupplyTemp !== "false",
        showInfoReturnTemp: draft.showInfoReturnTemp !== "false",
        showInfoHeatingTemp: draft.showInfoHeatingTemp !== "false",
        showInfoCompressorPower: draft.showInfoCompressorPower !== "false",
        standbyIcon: draft.standbyIcon?.trim() || undefined,
        dhwIcon: draft.dhwIcon?.trim() || undefined,
        heatingIcon: draft.heatingIcon?.trim() || undefined,
        comfortIcon: draft.comfortIcon?.trim() || undefined,
        ecoIcon: draft.ecoIcon?.trim() || undefined,
        oneTimeChargeIcon: draft.oneTimeChargeIcon?.trim() || undefined,
        interactionSounds: buildStoredInteractionSounds(
          widget.type,
          soundDraft,
          config.uiSounds?.widgetTypeDefaults?.[widget.type]
        ),
        appearance,
      });
    } else if (widget.type === "weather") {
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        locationName: draft.locationName || undefined,
        locationQuery: draft.locationQuery || undefined,
        latitude: clampFloat(draft.latitude, widget.latitude),
        longitude: clampFloat(draft.longitude, widget.longitude),
        timezone: draft.timezone || "auto",
        refreshMs: clampInt(draft.refreshMs, widget.refreshMs || 300000, 60000),
        appearance,
      });
    } else if (widget.type === "solar") {
      onSave(widget.id, {
        title: draft.title,
        showTitle: draft.showTitle !== "false",
        backgroundMode: draft.backgroundMode === "image" ? "image" : "color",
        backgroundImage: draft.backgroundImage || undefined,
        backgroundImageBlur: clampInt(draft.backgroundImageBlur, widget.backgroundImageBlur ?? 8, 0),
        wallboxCarStateId: draft.wallboxCarStateId?.trim() || undefined,
        wallboxChargePowerStateId: draft.wallboxChargePowerStateId?.trim() || undefined,
        wallboxAmpereStateId: draft.wallboxAmpereStateId?.trim() || undefined,
        wallboxPhaseModeStateId: draft.wallboxPhaseModeStateId?.trim() || undefined,
        wallboxCarSocStateId: draft.wallboxCarSocStateId?.trim() || undefined,
        wallboxCarRangeStateId: draft.wallboxCarRangeStateId?.trim() || undefined,
        statePrefix: draft.statePrefix || widget.statePrefix,
        dailyEnergyUnit:
          draft.dailyEnergyUnit === "Wh" || draft.dailyEnergyUnit === "kWh" ? draft.dailyEnergyUnit : "auto",
        statValueUnit:
          draft.statValueUnit === "W" ||
          draft.statValueUnit === "kW" ||
          draft.statValueUnit === "Wh" ||
          draft.statValueUnit === "kWh"
            ? draft.statValueUnit
            : "none",
        keys: {
          pvNow: draft.keyPvNow || widget.keys.pvNow,
          homeNow: draft.keyHomeNow || widget.keys.homeNow,
          gridIn: draft.keyGridIn || widget.keys.gridIn,
          gridOut: draft.keyGridOut || widget.keys.gridOut,
          soc: draft.keySoc || undefined,
          battIn: draft.keyBattIn || undefined,
          battOut: draft.keyBattOut || undefined,
          dayConsumed: draft.keyDayConsumed || widget.keys.dayConsumed,
          daySelf: draft.keyDaySelf || widget.keys.daySelf,
          pvTotal: draft.keyPvTotal || undefined,
          battTemp: draft.keyBattTemp || undefined,
        },
        statTextScale: clampFloatRange(
          draft.statTextScalePct,
          (widget.statTextScale ?? 1) * 100,
          60,
          200
        ) / 100,
        stats: buildSolarStats(draft),
        tapAction: buildSolarTapAction(draft),
        appearance,
      });
    } else {
      return;
    }

    onClose();
  };

  const saveSoundsAsTypeDefault = () => {
    if (
      widget.type !== "state" &&
      widget.type !== "camera" &&
      widget.type !== "grafana" &&
      widget.type !== "numpad" &&
      widget.type !== "link" &&
      widget.type !== "netflix" &&
      widget.type !== "log" &&
      widget.type !== "script" &&
      widget.type !== "wallbox" &&
      widget.type !== "goe" &&
      widget.type !== "heating" &&
      widget.type !== "heatingV2"
    ) {
      return;
    }

    const nextDefault: WidgetInteractionSounds = {
      press: normalizeSoundSelection(soundDraft.press),
      confirm: normalizeSoundSelection(soundDraft.confirm),
      slider: normalizeSoundSelection(soundDraft.slider),
      open: normalizeSoundSelection(soundDraft.open),
      close: normalizeSoundSelection(soundDraft.close),
      scroll: normalizeSoundSelection(soundDraft.scroll),
      notify: normalizeSoundSelection(soundDraft.notify),
      notifyWarn: normalizeSoundSelection(soundDraft.notifyWarn),
      notifyError: normalizeSoundSelection(soundDraft.notifyError),
    };

    patchConfig({
      uiSounds: {
        enabled: config.uiSounds?.enabled !== false,
        volume: config.uiSounds?.volume ?? 55,
        soundSet: config.uiSounds?.soundSet || "voyager",
        widgetTypeDefaults: {
          ...(config.uiSounds?.widgetTypeDefaults || {}),
          [widget.type]: nextDefault,
        },
        pageSounds: config.uiSounds?.pageSounds,
      },
    });
  };

  return (
    <Modal animationType="fade" transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Widget bearbeiten</Text>
            <EditorButtonPressable onPress={onClose}>
              <Text style={styles.close}>Schliessen</Text>
            </EditorButtonPressable>
          </View>
          <ScrollView>
            <Field label="Titel">
              <TextInput
                onChangeText={(value) => setDraft((current) => ({ ...current, title: value }))}
                style={styles.input}
                value={draft.title || ""}
              />
            </Field>
            <Field label="Titel anzeigen">
              <ChoiceRow
                options={["true", "false"]}
                value={draft.showTitle || "true"}
                onSelect={(value) => setDraft((current) => ({ ...current, showTitle: value }))}
              />
            </Field>
            <Field label="Darstellung">
              <ColorInputRow
                firstKey="widgetColor"
                firstLabel="Widget"
                secondKey="widgetColor2"
                secondLabel="Verlauf 2"
                values={draft}
                onChange={setDraft}
              />
              <ColorInputRow
                firstKey="textColor"
                firstLabel="Text"
                secondKey="mutedTextColor"
                secondLabel="Sekundaer"
                values={draft}
                onChange={setDraft}
              />
              {widget.type === "state" ? (
                <>
                  <ColorInputRow
                    firstKey="activeWidgetColor"
                    firstLabel="Widget aktiv"
                    secondKey="inactiveWidgetColor"
                    secondLabel="Widget inaktiv"
                    values={draft}
                    onChange={setDraft}
                  />
                  <ColorInputRow
                    firstKey="iconColor"
                    firstLabel="Icon aktiv"
                    secondKey="iconColor2"
                    secondLabel="Icon inaktiv"
                    values={draft}
                    onChange={setDraft}
                  />
                </>
              ) : null}
              {widget.type === "energy" || widget.type === "solar" ? (
                <ColorInputRow
                  firstKey="cardColor"
                  firstLabel="Cards"
                  secondKey="cardColor2"
                  secondLabel="Verlauf 2"
                  values={draft}
                  onChange={setDraft}
                />
              ) : null}
              {widget.type === "solar" ? (
                <>
                  <ColorInputRow
                    firstKey="statColor"
                    firstLabel="Stats"
                    secondKey="statColor2"
                    secondLabel="Verlauf 2"
                    values={draft}
                    onChange={setDraft}
                  />
                  <ColorInputRow
                    firstKey="pvCardColor"
                    firstLabel="PV"
                    secondKey="homeCardColor"
                    secondLabel="Haus"
                    values={draft}
                    onChange={setDraft}
                  />
                  <ColorInputRow
                    firstKey="batteryCardColor"
                    firstLabel="Akku"
                    secondKey="gridCardColor"
                    secondLabel="Netz"
                    values={draft}
                    onChange={setDraft}
                  />
                  <ColorInputRow
                    firstKey="carCardColor"
                    firstLabel="Auto"
                    secondKey="cardColor"
                    secondLabel="Alle Cards"
                    values={draft}
                    onChange={setDraft}
                  />
                  <Field label="Solar Hintergrund">
                    <ChoiceRow
                      options={["color", "image"]}
                      value={draft.backgroundMode || "color"}
                      onSelect={(value) => setDraft((current) => ({ ...current, backgroundMode: value }))}
                    />
                    {draft.backgroundMode === "image" ? (
                      <>
                        <View style={styles.stateFieldRow}>
                          <TextInput
                            editable={false}
                            style={[styles.input, styles.stateFieldInput]}
                            value={draft.backgroundImage || ""}
                          />
                          <EditorButtonPressable
                            onPress={() => setImagePickerField("backgroundImage")}
                            style={styles.stateBrowseButton}
                          >
                            <Text style={styles.stateBrowseLabel}>Bild waehlen</Text>
                          </EditorButtonPressable>
                        </View>
                        <Field label="Bild Unschärfe">
                          <BlurControl
                            value={draft.backgroundImageBlur || "8"}
                            onChange={(value) => setDraft((current) => ({ ...current, backgroundImageBlur: value }))}
                          />
                        </Field>
                      </>
                    ) : null}
                  </Field>
                </>
              ) : null}
              {widget.type === "host" || widget.type === "raspberryPiStats" ? (
                <>
                  <ColorInputRow
                    firstKey="cardColor"
                    firstLabel="Pie Disk genutzt"
                    secondKey="cardColor2"
                    secondLabel="Pie Disk frei"
                    values={draft}
                    onChange={setDraft}
                  />
                  <ColorInputRow
                    firstKey="pvCardColor"
                    firstLabel="Pie RAM genutzt"
                    secondKey="homeCardColor"
                    secondLabel="Pie RAM frei"
                    values={draft}
                    onChange={setDraft}
                  />
                  <ColorInputRow
                    firstKey="activeWidgetColor"
                    firstLabel="CPU Balken Start"
                    secondKey="activeWidgetColor2"
                    secondLabel="CPU Balken Ende"
                    values={draft}
                    onChange={setDraft}
                  />
                  <ColorInputRow
                    firstKey="inactiveWidgetColor"
                    firstLabel="Temp Balken Start"
                    secondKey="inactiveWidgetColor2"
                    secondLabel="Temp Balken Ende"
                    values={draft}
                    onChange={setDraft}
                  />
                  <ColorInputRow
                    firstKey="statColor"
                    firstLabel="Prozess Badge Start"
                    secondKey="statColor2"
                    secondLabel="Prozess Badge Ende"
                    values={draft}
                    onChange={setDraft}
                  />
                </>
              ) : null}
              {widget.type === "wallbox" || widget.type === "goe" ? (
                <>
                  <ColorInputRow
                    firstKey="cardColor"
                    firstLabel="Modus Aus Start"
                    secondKey="cardColor2"
                    secondLabel="Modus Aus Ende"
                    values={draft}
                    onChange={setDraft}
                  />
                  <ColorInputRow
                    firstKey="activeWidgetColor"
                    firstLabel="Modus PV Start"
                    secondKey="activeWidgetColor2"
                    secondLabel="Modus PV Ende"
                    values={draft}
                    onChange={setDraft}
                  />
                  <ColorInputRow
                    firstKey="statColor"
                    firstLabel="Modus Netz Start"
                    secondKey="statColor2"
                    secondLabel="Modus Netz Ende"
                    values={draft}
                    onChange={setDraft}
                  />
                  <ColorInputRow
                    firstKey="iconColor"
                    firstLabel="Slider Start"
                    secondKey="iconColor2"
                    secondLabel="Slider Ende"
                    values={draft}
                    onChange={setDraft}
                  />
                  <ColorInputRow
                    firstKey="inactiveWidgetColor"
                    firstLabel="Toggle 80% Start"
                    secondKey="inactiveWidgetColor2"
                    secondLabel="Toggle 80% Ende"
                    values={draft}
                    onChange={setDraft}
                  />
                </>
              ) : null}
              {widget.type === "heating" || widget.type === "heatingV2" ? (
                <>
                  <ColorInputRow
                    firstKey="cardColor"
                    firstLabel="Panel Hintergrund"
                    secondKey="iconColor"
                    secondLabel="Slider Start"
                    values={draft}
                    onChange={setDraft}
                  />
                  <ColorInputRow
                    firstKey="iconColor2"
                    firstLabel="Slider Ende"
                    secondKey="activeWidgetColor"
                    secondLabel="Komfort Akzent"
                    values={draft}
                    onChange={setDraft}
                  />
                  <ColorInputRow
                    firstKey="activeWidgetColor2"
                    firstLabel="Eco Akzent"
                    secondKey="statColor"
                    secondLabel="Einmalladung Akzent"
                    values={draft}
                    onChange={setDraft}
                  />
                </>
              ) : null}
            </Field>
            {widget.type === "state" ? (
              <>
                <Field label="State ID">
                  <StateFieldInput
                    onBrowse={() => setPickerField("stateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, stateId: value }))}
                    value={draft.stateId || ""}
                  />
                </Field>
                <View style={styles.splitRow}>
                  <Field label="Anzeigetext aktiv">
                    <TextInput
                      onChangeText={(value) => setDraft((current) => ({ ...current, onLabel: value }))}
                      style={styles.input}
                      value={draft.onLabel || ""}
                    />
                  </Field>
                  <Field label="Anzeigetext inaktiv">
                    <TextInput
                      onChangeText={(value) => setDraft((current) => ({ ...current, offLabel: value }))}
                      style={styles.input}
                      value={draft.offLabel || ""}
                    />
                  </Field>
                </View>
                <View style={styles.splitRow}>
                  <Field label="Rohwert aktiv">
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={(value) => setDraft((current) => ({ ...current, activeValue: value }))}
                      placeholder="z. B. open / 1 / true"
                      placeholderTextColor={palette.textMuted}
                      style={styles.input}
                      value={draft.activeValue || ""}
                    />
                  </Field>
                  <Field label="Rohwert inaktiv">
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={(value) => setDraft((current) => ({ ...current, inactiveValue: value }))}
                      placeholder="z. B. closed / 0 / false"
                      placeholderTextColor={palette.textMuted}
                      style={styles.input}
                      value={draft.inactiveValue || ""}
                    />
                  </Field>
                </View>
                <Text style={styles.mappingHint}>
                  Beispiel Reedkontakt: `Rohwert aktiv = open`, `Anzeigetext aktiv = Offen`, `Rohwert inaktiv = closed`,
                  `Anzeigetext inaktiv = Geschlossen`.
                </Text>
                <Field label="Schreibzugriff">
                  <ChoiceRow
                    options={["true", "false"]}
                    value={draft.writeable || "true"}
                    onSelect={(value) => setDraft((current) => ({ ...current, writeable: value }))}
                  />
                </Field>
                <Field label="Format">
                  <ChoiceRow
                    options={["boolean", "number", "text"]}
                    value={draft.format || "boolean"}
                    onSelect={(value) => setDraft((current) => ({ ...current, format: value }))}
                  />
                </Field>
                <Field label="Wert-Labels (JSON)">
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    onChangeText={(value) => setDraft((current) => ({ ...current, valueLabelsJson: value }))}
                    placeholder={
                      draft.format === "number"
                        ? '{\n  "0": "Zu",\n  "1": "Offen"\n}'
                        : '{\n  "open": "Offen",\n  "closed": "Geschlossen"\n}'
                    }
                    placeholderTextColor={palette.textMuted}
                    style={[styles.input, styles.mappingEditor]}
                    textAlignVertical="top"
                    value={draft.valueLabelsJson || ""}
                  />
                  <Text style={styles.mappingHint}>
                    Optional. Hier kannst du Rohwerte wie `open`, `closed`, `0` oder `1` auf lesbare Labels abbilden.
                    Besonders sinnvoll bei `text` und `number`.
                  </Text>
                </Field>
                <Field label="Symbole">
                  <View style={styles.iconPreviewRow}>
                    <View style={styles.iconPreviewCard}>
                      <MaterialCommunityIcons color={palette.accent} name={iconPreview.active} size={22} />
                      <Text style={styles.iconPreviewLabel}>Aktiv</Text>
                    </View>
                    <View style={styles.iconPreviewCard}>
                      <MaterialCommunityIcons color={palette.textMuted} name={iconPreview.inactive} size={22} />
                      <Text style={styles.iconPreviewLabel}>Inaktiv</Text>
                    </View>
                  </View>
                  <IconPickerRow
                    label="Aktiv"
                    selected={draft.iconActive || "toggle-switch"}
                    onSelect={(value) => setDraft((current) => ({ ...current, iconActive: value }))}
                  />
                  <IconPickerRow
                    label="Inaktiv"
                    selected={draft.iconInactive || "toggle-switch-off-outline"}
                    onSelect={(value) => setDraft((current) => ({ ...current, iconInactive: value }))}
                  />
                </Field>
                <Field label="Bild (optional)">
                  <View style={styles.stateFieldRow}>
                    <TextInput
                      editable={false}
                      style={[styles.input, styles.stateFieldInput]}
                      value={draft.iconImage || ""}
                    />
                    <EditorButtonPressable onPress={() => setImagePickerField("iconImage")} style={styles.stateBrowseButton}>
                      <Text style={styles.stateBrowseLabel}>Bild waehlen</Text>
                    </EditorButtonPressable>
                  </View>
                  <Field label="Bildform">
                    <ChoiceRow
                      options={["none", "rounded", "circle"]}
                      value={draft.iconImageCrop || "none"}
                      onSelect={(value) => setDraft((current) => ({ ...current, iconImageCrop: value }))}
                    />
                  </Field>
                  <Field label="Bildgroesse">
                    <ChoiceRow
                      options={["standard", "maximized"]}
                      value={draft.iconImageSizeMode || "standard"}
                      onSelect={(value) => setDraft((current) => ({ ...current, iconImageSizeMode: value }))}
                    />
                  </Field>
                  <Field label="Borderless">
                    <ChoiceRow
                      options={["false", "true"]}
                      value={draft.iconImageBorderless || "false"}
                      onSelect={(value) => setDraft((current) => ({ ...current, iconImageBorderless: value }))}
                    />
                  </Field>
                </Field>
                <Field label="Addon">
                  <ChoiceRow
                    options={["none", "circle", "text", "icon", "bars"]}
                    value={draft.addonMode || "none"}
                    onSelect={(value) => setDraft((current) => ({ ...current, addonMode: value }))}
                  />
                  {(draft.addonMode || "none") !== "none" ? (
                    <>
                      <Field label="Addon nutzt State-Wert">
                        <ChoiceRow
                          options={["false", "true"]}
                          value={draft.addonUseStateValue || "false"}
                          onSelect={(value) => setDraft((current) => ({ ...current, addonUseStateValue: value }))}
                        />
                      </Field>
                      {draft.addonUseStateValue === "true" ? (
                        <Field label="Addon State ID">
                          <StateFieldInput
                            onBrowse={() => setPickerField("addonStateId")}
                            onChangeText={(value) => setDraft((current) => ({ ...current, addonStateId: value }))}
                            value={draft.addonStateId || ""}
                          />
                        </Field>
                      ) : null}
                      <Field label="Addon Text / Wert">
                        <TextInput
                          onChangeText={(value) => setDraft((current) => ({ ...current, addonValue: value }))}
                          placeholder="z. B. 21 / 420 W / Schloss"
                          placeholderTextColor={palette.textMuted}
                          style={styles.input}
                          value={draft.addonValue || ""}
                        />
                      </Field>
                      <ColorField
                        label="Addon Farbe"
                        value={draft.addonColor || ""}
                        onChange={(value) => setDraft((current) => ({ ...current, addonColor: value }))}
                      />
                      {draft.addonMode === "icon" ? (
                        <Field label="Addon Icon">
                          <IconPickerRow
                            label="Addon"
                            selected={draft.addonIcon || "lock"}
                            onSelect={(value) => setDraft((current) => ({ ...current, addonIcon: value }))}
                          />
                        </Field>
                      ) : null}
                    </>
                  ) : null}
                </Field>
                <Field label="Sounds bei Interaktion">
                  <Field label="Beim Druecken">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, press: value }))}
                      value={soundDraft.press}
                    />
                  </Field>
                  <Field label="Bei Bestaetigung">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, confirm: value }))}
                      value={soundDraft.confirm}
                    />
                  </Field>
                  <EditorButtonPressable onPress={saveSoundsAsTypeDefault} style={styles.inlineActionButton}>
                    <Text style={styles.inlineActionLabel}>Als Default fuer alle State-Widgets verwenden</Text>
                  </EditorButtonPressable>
                </Field>
              </>
            ) : null}
            {widget.type === "camera" || widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? (
              <>
                <Field label="Titelgroesse (px)">
                  <TextInput
                    keyboardType="numeric"
                    onChangeText={(value) => setDraft((current) => ({ ...current, titleFontSize: value }))}
                    style={styles.input}
                    value={draft.titleFontSize || "14"}
                  />
                </Field>
                <ColorField
                  label="Titelfarbe Overlay"
                  value={draft.textColor || ""}
                  onChange={(value) => setDraft((current) => ({ ...current, textColor: value }))}
                />
                <View style={styles.groupCard}>
                  <Text style={styles.groupTitle}>Miniaturansicht</Text>
                  <Field label="Darstellung">
                    <ChoiceRow
                      options={["snapshot"]}
                      value={previewCameraMode}
                      onSelect={(value) => setDraft((current) => ({ ...current, previewSourceMode: value }))}
                    />
                  </Field>
                  <Field label="URL fuer gewaehlte Darstellung">
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={(value) =>
                        setDraft((current) => setCameraUrlByMode(current, previewCameraMode, value, "preview"))
                      }
                      style={styles.input}
                      value={previewCameraUrl}
                    />
                  </Field>
                  <Field label="Snapshot Refresh (ms)">
                    <TextInput
                      editable={previewCameraMode === "snapshot"}
                      keyboardType="numeric"
                      onChangeText={(value) => setDraft((current) => ({ ...current, refreshMs: value }))}
                      style={[
                        styles.input,
                        previewCameraMode !== "snapshot" ? styles.disabledInput : null,
                      ]}
                      value={draft.refreshMs || ""}
                    />
                    {previewCameraMode !== "snapshot" ? (
                      <Text style={styles.mappingHint}>Nur relevant, wenn Miniatur auf Snapshot steht.</Text>
                    ) : null}
                  </Field>
                </View>
                <View style={styles.groupCard}>
                  <Text style={styles.groupTitle}>Maximierte Ansicht</Text>
                  <Field label="Darstellung">
                    <ChoiceRow
                      options={["webrtc", "fmp4", "flv", "mjpeg", "snapshot"]}
                      value={fullscreenCameraMode}
                      onSelect={(value) => setDraft((current) => ({ ...current, fullscreenSourceMode: value }))}
                    />
                  </Field>
                  <Field label="URL fuer gewaehlte Darstellung">
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={(value) =>
                        setDraft((current) => setCameraUrlByMode(current, fullscreenCameraMode, value, "fullscreen"))
                      }
                      style={styles.input}
                      value={fullscreenCameraUrl}
                    />
                  </Field>
                  <Field label="Snapshot Refresh (ms)">
                    <TextInput
                      editable={fullscreenCameraMode === "snapshot"}
                      keyboardType="numeric"
                      onChangeText={(value) => setDraft((current) => ({ ...current, fullscreenRefreshMs: value }))}
                      style={[
                        styles.input,
                        fullscreenCameraMode !== "snapshot" ? styles.disabledInput : null,
                      ]}
                      value={draft.fullscreenRefreshMs || ""}
                    />
                    {fullscreenCameraMode !== "snapshot" ? (
                      <Text style={styles.mappingHint}>Nur relevant, wenn Vollbild auf Snapshot steht.</Text>
                    ) : null}
                  </Field>
                </View>
                <Text style={styles.mappingHint}>
                  FLV-Hinweis: Bei `CodecUnsupported` liefert der Stream meist kein browser-kompatibles H.264. Falls
                  vorhanden, statt `main` den `ext`/Substream verwenden (z. B. `channel0_ext.bcs`).
                </Text>
                <Field label="Ton standardmaessig aktiv">
                  <ChoiceRow
                    options={["true", "false"]}
                    value={draft.audioEnabled || "false"}
                    onSelect={(value) => setDraft((current) => ({ ...current, audioEnabled: value }))}
                  />
                  <Text style={styles.mappingHint}>
                    Hinweis: Browser erlauben Autoplay mit Ton oft erst nach einer Nutzerinteraktion.
                  </Text>
                </Field>
                <Field label="Maximieren per Datenpunkt">
                  <StateFieldInput
                    onBrowse={() => setPickerField("maximizeStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, maximizeStateId: value }))}
                    value={draft.maximizeStateId || ""}
                  />
                </Field>
                <Field label="Trigger Format">
                  <ChoiceRow
                    options={["boolean", "number", "text"]}
                    value={draft.maximizeTriggerFormat || "boolean"}
                    onSelect={(value) => setDraft((current) => ({ ...current, maximizeTriggerFormat: value }))}
                  />
                </Field>
                <Field label="Trigger Wert">
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={(value) => setDraft((current) => ({ ...current, maximizeTriggerValue: value }))}
                    placeholder={
                      (draft.maximizeTriggerFormat || "boolean") === "boolean"
                        ? "true oder false"
                        : (draft.maximizeTriggerFormat || "boolean") === "number"
                          ? "z. B. 1"
                          : "z. B. Klingel"
                    }
                    placeholderTextColor={palette.textMuted}
                    style={styles.input}
                    value={draft.maximizeTriggerValue || ""}
                  />
                </Field>
                <Field label="Sounds bei Interaktion">
                  {widget.type === "cameraTalk" || widget.type === "cameraTalkReolink" ? (
                    <>
                      <Field label="WebRTC Talkback URL">
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={(value) => setDraft((current) => ({ ...current, talkbackWebrtcUrl: value }))}
                          placeholder="https://.../stream.html?src=cam&mode=webrtc&media=video,audio,microphone"
                          placeholderTextColor={palette.textMuted}
                          style={styles.input}
                          value={draft.talkbackWebrtcUrl || ""}
                        />
                      </Field>
                      <Field label="Push-to-Talk (halten)">
                        <ChoiceRow
                          options={["true", "false"]}
                          value={draft.talkbackPushToTalk || "true"}
                          onSelect={(value) => setDraft((current) => ({ ...current, talkbackPushToTalk: value }))}
                        />
                      </Field>
                      <Field label="Talkback-Video anzeigen">
                        <ChoiceRow
                          options={["false", "true"]}
                          value={draft.talkbackAutoEnableVideo || "false"}
                          onSelect={(value) => setDraft((current) => ({ ...current, talkbackAutoEnableVideo: value }))}
                        />
                      </Field>
                      {widget.type === "cameraTalk" ? (
                        <>
                          <Field label="INSTAR Talkback API nutzen">
                            <ChoiceRow
                              options={["false", "true"]}
                              value={draft.instarTalkbackEnabled || "false"}
                              onSelect={(value) => setDraft((current) => ({ ...current, instarTalkbackEnabled: value }))}
                            />
                          </Field>
                          <Field label="INSTAR Base URL">
                            <TextInput
                              autoCapitalize="none"
                              onChangeText={(value) => setDraft((current) => ({ ...current, instarBaseUrl: value }))}
                              placeholder="https://192.168.44.253"
                              placeholderTextColor={palette.textMuted}
                              style={styles.input}
                              value={draft.instarBaseUrl || ""}
                            />
                          </Field>
                          <Field label="INSTAR Benutzer">
                            <TextInput
                              autoCapitalize="none"
                              onChangeText={(value) => setDraft((current) => ({ ...current, instarUsername: value }))}
                              placeholderTextColor={palette.textMuted}
                              style={styles.input}
                              value={draft.instarUsername || ""}
                            />
                          </Field>
                          <Field label="INSTAR Passwort">
                            <TextInput
                              autoCapitalize="none"
                              onChangeText={(value) => setDraft((current) => ({ ...current, instarPassword: value }))}
                              placeholderTextColor={palette.textMuted}
                              secureTextEntry
                              style={styles.input}
                              value={draft.instarPassword || ""}
                            />
                          </Field>
                        </>
                      ) : null}
                      {widget.type === "cameraTalkReolink" ? (
                        <>
                          <Field label="Reolink API nutzen">
                            <ChoiceRow
                              options={["false", "true"]}
                              value={draft.reolinkTalkbackEnabled || "false"}
                              onSelect={(value) => setDraft((current) => ({ ...current, reolinkTalkbackEnabled: value }))}
                            />
                          </Field>
                          <Field label="Reolink Base URL">
                            <TextInput
                              autoCapitalize="none"
                              onChangeText={(value) => setDraft((current) => ({ ...current, reolinkBaseUrl: value }))}
                              placeholder="https://192.168.44.37"
                              placeholderTextColor={palette.textMuted}
                              style={styles.input}
                              value={draft.reolinkBaseUrl || ""}
                            />
                          </Field>
                          <Field label="Reolink Benutzer">
                            <TextInput
                              autoCapitalize="none"
                              onChangeText={(value) => setDraft((current) => ({ ...current, reolinkUsername: value }))}
                              placeholderTextColor={palette.textMuted}
                              style={styles.input}
                              value={draft.reolinkUsername || ""}
                            />
                          </Field>
                          <Field label="Reolink Passwort">
                            <TextInput
                              autoCapitalize="none"
                              onChangeText={(value) => setDraft((current) => ({ ...current, reolinkPassword: value }))}
                              placeholderTextColor={palette.textMuted}
                              secureTextEntry
                              style={styles.input}
                              value={draft.reolinkPassword || ""}
                            />
                          </Field>
                          <Field label="Reolink Channel">
                            <TextInput
                              autoCapitalize="none"
                              keyboardType="numeric"
                              onChangeText={(value) => setDraft((current) => ({ ...current, reolinkChannel: value }))}
                              placeholderTextColor={palette.textMuted}
                              style={styles.input}
                              value={draft.reolinkChannel || "0"}
                            />
                          </Field>
                        </>
                      ) : null}
                    </>
                  ) : null}
                  <Field label="Beim Tippen">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, press: value }))}
                      value={soundDraft.press}
                    />
                  </Field>
                  <Field label="Maximieren">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, open: value }))}
                      value={soundDraft.open}
                    />
                  </Field>
                  <Field label="Schliessen">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, close: value }))}
                      value={soundDraft.close}
                    />
                  </Field>
                  <Field label="Wischen">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, scroll: value }))}
                      value={soundDraft.scroll}
                    />
                  </Field>
                  <EditorButtonPressable onPress={saveSoundsAsTypeDefault} style={styles.inlineActionButton}>
                    <Text style={styles.inlineActionLabel}>Als Default fuer alle Camera-Widgets verwenden</Text>
                  </EditorButtonPressable>
                </Field>
              </>
            ) : null}
            {widget.type === "numpad" ? (
              <Field label="Sounds bei Interaktion">
                <Field label="Beim Druecken">
                  <SoundPickerField
                    onChange={(value) => setSoundDraft((current) => ({ ...current, press: value }))}
                    value={soundDraft.press}
                  />
                </Field>
                <EditorButtonPressable onPress={saveSoundsAsTypeDefault} style={styles.inlineActionButton}>
                  <Text style={styles.inlineActionLabel}>Als Default fuer alle Numpad-Widgets verwenden</Text>
                </EditorButtonPressable>
              </Field>
            ) : null}
            {widget.type === "link" || widget.type === "netflix" ? (
              <>
                <Field label="URL">
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={(value) => setDraft((current) => ({ ...current, url: value }))}
                    placeholder="https://example.com"
                    placeholderTextColor={palette.textMuted}
                    style={styles.input}
                    value={draft.url || ""}
                  />
                </Field>
                <Field label="Icon (PNG)">
                  <View style={styles.stateFieldRow}>
                    <TextInput
                      editable={false}
                      style={[styles.input, styles.stateFieldInput]}
                      value={draft.iconImage || ""}
                    />
                    <EditorButtonPressable onPress={() => setImagePickerField("iconImage")} style={styles.stateBrowseButton}>
                      <Text style={styles.stateBrowseLabel}>Bild waehlen</Text>
                    </EditorButtonPressable>
                  </View>
                </Field>
                <Field label="Bildform">
                  <ChoiceRow
                    options={["none", "rounded", "circle"]}
                    value={draft.iconImageCrop || "none"}
                    onSelect={(value) => setDraft((current) => ({ ...current, iconImageCrop: value }))}
                  />
                </Field>
                <Field label="Bildgroesse">
                  <ChoiceRow
                    options={["standard", "maximized"]}
                    value={draft.iconImageSizeMode || "standard"}
                    onSelect={(value) => setDraft((current) => ({ ...current, iconImageSizeMode: value }))}
                  />
                </Field>
                <Field label="Borderless">
                  <ChoiceRow
                    options={["false", "true"]}
                    value={draft.iconImageBorderless || "false"}
                    onSelect={(value) => setDraft((current) => ({ ...current, iconImageBorderless: value }))}
                  />
                </Field>
                <Field label="Sounds bei Interaktion">
                  <Field label="Beim Druecken">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, press: value }))}
                      value={soundDraft.press}
                    />
                  </Field>
                  <Field label="Beim Oeffnen">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, open: value }))}
                      value={soundDraft.open}
                    />
                  </Field>
                  <Field label="Beim Schliessen">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, close: value }))}
                      value={soundDraft.close}
                    />
                  </Field>
                  <EditorButtonPressable onPress={saveSoundsAsTypeDefault} style={styles.inlineActionButton}>
                    <Text style={styles.inlineActionLabel}>
                      {widget.type === "netflix"
                        ? "Als Default fuer alle Netflix-Widgets verwenden"
                        : "Als Default fuer alle Link-Widgets verwenden"}
                    </Text>
                  </EditorButtonPressable>
                </Field>
                {widget.type === "netflix" ? (
                  <Text style={styles.mappingHint}>
                    Login-Daten werden absichtlich nicht im Widget gespeichert. Bitte einmal direkt bei Netflix anmelden.
                  </Text>
                ) : null}
              </>
            ) : null}
            {widget.type === "energy" ? (
              <>
                <Field label="PV State ID">
                  <StateFieldInput
                    onBrowse={() => setPickerField("pvStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, pvStateId: value }))}
                    value={draft.pvStateId || ""}
                  />
                </Field>
                <Field label="Haus State ID">
                  <StateFieldInput
                    onBrowse={() => setPickerField("houseStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, houseStateId: value }))}
                    value={draft.houseStateId || ""}
                  />
                </Field>
                <Field label="Akku State ID">
                  <StateFieldInput
                    onBrowse={() => setPickerField("batteryStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, batteryStateId: value }))}
                    value={draft.batteryStateId || ""}
                  />
                </Field>
                <Field label="Netz State ID">
                  <StateFieldInput
                    onBrowse={() => setPickerField("gridStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, gridStateId: value }))}
                    value={draft.gridStateId || ""}
                  />
                </Field>
              </>
            ) : null}
            {widget.type === "grafana" ? (
              <>
                <Field label="Grafana URL">
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={(value) => setDraft((current) => ({ ...current, url: value }))}
                    style={styles.input}
                    value={draft.url || ""}
                  />
                </Field>
                <Field label="Grafana Render-URL (optional)">
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={(value) => setDraft((current) => ({ ...current, renderUrl: value }))}
                    placeholder="http://grafana/render/d-solo/..."
                    placeholderTextColor={palette.textMuted}
                    style={styles.input}
                    value={draft.renderUrl || ""}
                  />
                  <Text style={styles.mappingHint}>Ohne Angabe wird die Render-URL aus der Dashboard-URL abgeleitet.</Text>
                </Field>
                <Field label="Refresh (ms)">
                  <TextInput
                    keyboardType="numeric"
                    onChangeText={(value) => setDraft((current) => ({ ...current, refreshMs: value }))}
                    style={styles.input}
                    value={draft.refreshMs || ""}
                  />
                </Field>
                <Field label="Interaktionen">
                  <ChoiceRow
                    options={["true", "false"]}
                    value={draft.allowInteractions || "true"}
                    onSelect={(value) => setDraft((current) => ({ ...current, allowInteractions: value }))}
                  />
                </Field>
                <Field label="Sounds bei Interaktion">
                  <Field label="Beim Tippen/Klicken">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, press: value }))}
                      value={soundDraft.press}
                    />
                  </Field>
                  <Field label="Beim Oeffnen Vollbild">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, open: value }))}
                      value={soundDraft.open}
                    />
                  </Field>
                  <Field label="Beim Schliessen">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, close: value }))}
                      value={soundDraft.close}
                    />
                  </Field>
                  <EditorButtonPressable onPress={saveSoundsAsTypeDefault} style={styles.inlineActionButton}>
                    <Text style={styles.inlineActionLabel}>Als Default fuer alle Grafana-Widgets verwenden</Text>
                  </EditorButtonPressable>
                </Field>
              </>
            ) : null}
            {widget.type === "weather" ? (
              <>
                <Field label="Friendly Name">
                  <TextInput
                    onChangeText={(value) => setDraft((current) => ({ ...current, locationName: value }))}
                    placeholder="z. B. Zuhause, Buero, Ferienhaus"
                    placeholderTextColor={palette.textMuted}
                    style={styles.input}
                    value={draft.locationName || ""}
                  />
                </Field>
                <Field label="Ort suchen (statt Koordinaten)">
                  <TextInput
                    onChangeText={(value) => setDraft((current) => ({ ...current, locationQuery: value }))}
                    placeholder="z. B. Berlin, Hamburg, Muenchen"
                    placeholderTextColor={palette.textMuted}
                    style={styles.input}
                    value={draft.locationQuery || ""}
                  />
                  {weatherSearchBusy ? <Text style={styles.mappingHint}>Suche Orte...</Text> : null}
                  {weatherSuggestions.length ? (
                    <View style={styles.weatherSuggestionList}>
                      {weatherSuggestions.map((entry) => (
                        <EditorButtonPressable
                          key={`${entry.label}-${entry.latitude}-${entry.longitude}`}
                          onPress={() => {
                            setDraft((current) => ({
                              ...current,
                              locationQuery: entry.query,
                              latitude: String(entry.latitude),
                              longitude: String(entry.longitude),
                            }));
                            setWeatherSuggestions([]);
                          }}
                          style={styles.weatherSuggestionItem}
                        >
                          <Text style={styles.weatherSuggestionLabel}>{entry.label}</Text>
                          <Text style={styles.weatherSuggestionMeta}>
                            {entry.latitude.toFixed(2)}, {entry.longitude.toFixed(2)}
                          </Text>
                        </EditorButtonPressable>
                      ))}
                    </View>
                  ) : null}
                </Field>
                <View style={styles.splitRow}>
                  <Field label="Latitude">
                    <TextInput
                      autoCapitalize="none"
                      keyboardType="numeric"
                      onChangeText={(value) => setDraft((current) => ({ ...current, latitude: value }))}
                      style={styles.input}
                      value={draft.latitude || ""}
                    />
                  </Field>
                  <Field label="Longitude">
                    <TextInput
                      autoCapitalize="none"
                      keyboardType="numeric"
                      onChangeText={(value) => setDraft((current) => ({ ...current, longitude: value }))}
                      style={styles.input}
                      value={draft.longitude || ""}
                    />
                  </Field>
                </View>
                <Text style={styles.mappingHint}>
                  Wenn `Ort suchen` gesetzt ist, werden die Koordinaten automatisch ueber Open-Meteo ermittelt.
                  Latitude/Longitude bleiben dann nur als Fallback erhalten.
                </Text>
                <Field label="Timezone">
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={(value) => setDraft((current) => ({ ...current, timezone: value }))}
                    style={styles.input}
                    value={draft.timezone || "auto"}
                  />
                </Field>
                <Field label="Refresh (ms)">
                  <TextInput
                    keyboardType="numeric"
                    onChangeText={(value) => setDraft((current) => ({ ...current, refreshMs: value }))}
                    style={styles.input}
                    value={draft.refreshMs || ""}
                  />
                </Field>
              </>
            ) : null}
            {widget.type === "log" ? (
              <>
                <View style={styles.splitRow}>
                  <Field label="Refresh (ms)">
                    <TextInput
                      keyboardType="numeric"
                      onChangeText={(value) => setDraft((current) => ({ ...current, refreshMs: value }))}
                      style={styles.input}
                      value={draft.refreshMs || "2000"}
                    />
                  </Field>
                  <Field label="Zeilen">
                    <TextInput
                      keyboardType="numeric"
                      onChangeText={(value) => setDraft((current) => ({ ...current, maxEntries: value }))}
                      style={styles.input}
                      value={draft.maxEntries || "80"}
                    />
                    <Text style={styles.mappingHint}>Maximal 200 Eintraege.</Text>
                  </Field>
                </View>
                <Field label="Mindest-Level">
                  <ChoiceRow
                    options={["silly", "debug", "info", "warn", "error"]}
                    value={draft.minSeverity || "info"}
                    onSelect={(value) => setDraft((current) => ({ ...current, minSeverity: value }))}
                  />
                </Field>
                <Field label="Quell-Filter (optional)">
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={(value) => setDraft((current) => ({ ...current, sourceFilter: value }))}
                    placeholder="z. B. system.adapter.javascript.0"
                    placeholderTextColor={palette.textMuted}
                    style={styles.input}
                    value={draft.sourceFilter || ""}
                  />
                </Field>
                <Field label="Text-Filter (optional)">
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={(value) => setDraft((current) => ({ ...current, textFilter: value }))}
                    placeholder="z. B. timeout, error, reconnect"
                    placeholderTextColor={palette.textMuted}
                    style={styles.input}
                    value={draft.textFilter || ""}
                  />
                </Field>
                <Field label="Sounds bei Interaktion">
                  <Field label="Warn/Error Button">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, press: value }))}
                      value={soundDraft.press}
                    />
                  </Field>
                  <Field label="Scrollen im Widget">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, scroll: value }))}
                      value={soundDraft.scroll}
                    />
                  </Field>
                  <Field label="Neue Log-Meldung">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, notify: value }))}
                      value={soundDraft.notify}
                    />
                  </Field>
                  <Field label="Neue WARN-Meldung">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, notifyWarn: value }))}
                      value={soundDraft.notifyWarn}
                    />
                  </Field>
                  <Field label="Neue ERROR-Meldung">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, notifyError: value }))}
                      value={soundDraft.notifyError}
                    />
                  </Field>
                  <EditorButtonPressable onPress={saveSoundsAsTypeDefault} style={styles.inlineActionButton}>
                    <Text style={styles.inlineActionLabel}>Als Default fuer alle Log-Widgets verwenden</Text>
                  </EditorButtonPressable>
                </Field>
              </>
            ) : null}
            {widget.type === "script" ? (
              <>
                <View style={styles.splitRow}>
                  <Field label="Refresh (ms)">
                    <TextInput
                      keyboardType="numeric"
                      onChangeText={(value) => setDraft((current) => ({ ...current, refreshMs: value }))}
                      style={styles.input}
                      value={draft.refreshMs || "3000"}
                    />
                  </Field>
                  <Field label="Anzahl">
                    <TextInput
                      keyboardType="numeric"
                      onChangeText={(value) => setDraft((current) => ({ ...current, maxEntries: value }))}
                      style={styles.input}
                      value={draft.maxEntries || "120"}
                    />
                  </Field>
                </View>
                <Field label="Instanz-Filter (optional)">
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={(value) => setDraft((current) => ({ ...current, instanceFilter: value }))}
                    placeholder="z. B. javascript.0"
                    placeholderTextColor={palette.textMuted}
                    style={styles.input}
                    value={draft.instanceFilter || ""}
                  />
                </Field>
                <Field label="Text-Filter (optional)">
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={(value) => setDraft((current) => ({ ...current, textFilter: value }))}
                    placeholder="z. B. licht, alarm, heizung"
                    placeholderTextColor={palette.textMuted}
                    style={styles.input}
                    value={draft.textFilter || ""}
                  />
                </Field>
                <Field label="Sounds bei Interaktion">
                  <Field label="Play/Pause und Explorer">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, press: value }))}
                      value={soundDraft.press}
                    />
                  </Field>
                  <Field label="Scrollen im Widget">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, scroll: value }))}
                      value={soundDraft.scroll}
                    />
                  </Field>
                  <EditorButtonPressable onPress={saveSoundsAsTypeDefault} style={styles.inlineActionButton}>
                    <Text style={styles.inlineActionLabel}>Als Default fuer alle Script-Widgets verwenden</Text>
                  </EditorButtonPressable>
                </Field>
              </>
            ) : null}
            {widget.type === "host" ? (
              <>
                <Field label="Refresh (ms)">
                  <TextInput
                    keyboardType="numeric"
                    onChangeText={(value) => setDraft((current) => ({ ...current, refreshMs: value }))}
                    style={styles.input}
                    value={draft.refreshMs || "5000"}
                  />
                </Field>
                <Field label="Host Label (optional)">
                  <TextInput
                    onChangeText={(value) => setDraft((current) => ({ ...current, hostLabel: value }))}
                    placeholder="z. B. Proxmox-Host, Raspberry Pi"
                    placeholderTextColor={palette.textMuted}
                    style={styles.input}
                    value={draft.hostLabel || ""}
                  />
                </Field>
                <Text style={styles.mappingHint}>
                  Zeigt Festplatte, RAM, CPU-Auslastung, Prozessanzahl und CPU-Temperatur des ioBroker-Hosts.
                </Text>
              </>
            ) : null}
            {widget.type === "raspberryPiStats" ? (
              <>
                <Field label="Widget Label (optional)">
                  <TextInput
                    onChangeText={(value) => setDraft((current) => ({ ...current, label: value }))}
                    placeholder="z. B. NAS Pi"
                    placeholderTextColor={palette.textMuted}
                    style={styles.input}
                    value={draft.label || ""}
                  />
                </Field>
                <Field label="CPU Temperatur">
                  <StateFieldInput
                    onBrowse={() => setPickerField("cpuTempStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, cpuTempStateId: value }))}
                    value={draft.cpuTempStateId || ""}
                  />
                </Field>
                <Field label="CPU Last">
                  <StateFieldInput
                    onBrowse={() => setPickerField("cpuLoadStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, cpuLoadStateId: value }))}
                    value={draft.cpuLoadStateId || ""}
                  />
                </Field>
                <Field label="RAM frei">
                  <StateFieldInput
                    onBrowse={() => setPickerField("ramFreeStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, ramFreeStateId: value }))}
                    value={draft.ramFreeStateId || ""}
                  />
                </Field>
                <Field label="RAM Einheit">
                  <ChoiceRow
                    options={["auto", "B", "kB", "MB", "GB", "percent"]}
                    value={draft.ramFreeUnit || "percent"}
                    onSelect={(value) => setDraft((current) => ({ ...current, ramFreeUnit: value }))}
                  />
                </Field>
                <Field label="Disk frei">
                  <StateFieldInput
                    onBrowse={() => setPickerField("diskFreeStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, diskFreeStateId: value }))}
                    value={draft.diskFreeStateId || ""}
                  />
                </Field>
                <Field label="Disk Einheit">
                  <ChoiceRow
                    options={["auto", "B", "kB", "MB", "GB", "percent"]}
                    value={draft.diskFreeUnit || "percent"}
                    onSelect={(value) => setDraft((current) => ({ ...current, diskFreeUnit: value }))}
                  />
                </Field>
                <Field label="Online">
                  <StateFieldInput
                    onBrowse={() => setPickerField("onlineStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, onlineStateId: value }))}
                    value={draft.onlineStateId || ""}
                  />
                </Field>
                <Text style={styles.mappingHint}>
                  Design wie Host-Widget, aber voll ueber externe Datenpunkte steuerbar (z. B. Raspberry Pi im LAN).
                </Text>
              </>
            ) : null}
            {widget.type === "coco" ? (
              <>
                <View style={styles.splitRow}>
                  <Field label="Name">
                    <TextInput
                      onChangeText={(value) => setDraft((current) => ({ ...current, catName: value }))}
                      style={styles.input}
                      value={draft.catName || "Coco"}
                    />
                  </Field>
                  <Field label="Refresh (ms)">
                    <TextInput
                      keyboardType="numeric"
                      onChangeText={(value) => setDraft((current) => ({ ...current, refreshMs: value }))}
                      style={styles.input}
                      value={draft.refreshMs || "30000"}
                    />
                  </Field>
                </View>
                <Field label="Profilbild">
                  <View style={styles.stateFieldRow}>
                    <TextInput
                      editable={false}
                      style={[styles.input, styles.stateFieldInput]}
                      value={draft.profileImage || ""}
                    />
                    <EditorButtonPressable onPress={() => setImagePickerField("cocoProfileImage")} style={styles.stateBrowseButton}>
                      <Text style={styles.stateBrowseLabel}>Bild waehlen</Text>
                    </EditorButtonPressable>
                  </View>
                  <Text style={styles.mappingHint}>
                    Das Bild wird im Widget rund zugeschnitten. Ohne Auswahl wird `coco-face.webp` verwendet.
                  </Text>
                </Field>
                <View style={styles.groupCard}>
                  <Text style={styles.groupTitle}>SureFlap States</Text>
                  <Field label="Inside">
                    <StateFieldInput
                      onBrowse={() => setPickerField("insideStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, insideStateId: value }))}
                      value={draft.insideStateId || ""}
                    />
                  </Field>
                  <Field label="Last Time">
                    <StateFieldInput
                      onBrowse={() => setPickerField("lastTimeStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, lastTimeStateId: value }))}
                      value={draft.lastTimeStateId || ""}
                    />
                  </Field>
                  <View style={styles.splitRow}>
                    <Field label="Last Direction">
                      <StateFieldInput
                        onBrowse={() => setPickerField("lastDirectionStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, lastDirectionStateId: value }))}
                        value={draft.lastDirectionStateId || ""}
                      />
                    </Field>
                    <Field label="Last Flap">
                      <StateFieldInput
                        onBrowse={() => setPickerField("lastFlapStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, lastFlapStateId: value }))}
                        value={draft.lastFlapStateId || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="Times Outside">
                      <StateFieldInput
                        onBrowse={() => setPickerField("timesOutsideStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, timesOutsideStateId: value }))}
                        value={draft.timesOutsideStateId || ""}
                      />
                    </Field>
                    <Field label="Time Spent Outside">
                      <StateFieldInput
                        onBrowse={() => setPickerField("timeSpentOutsideStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, timeSpentOutsideStateId: value }))}
                        value={draft.timeSpentOutsideStateId || ""}
                      />
                    </Field>
                  </View>
                </View>
                <View style={styles.groupCard}>
                  <Text style={styles.groupTitle}>Status</Text>
                  <View style={styles.splitRow}>
                    <Field label="Klappen-Batterie">
                      <StateFieldInput
                        onBrowse={() => setPickerField("flapBatteryStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, flapBatteryStateId: value }))}
                        value={draft.flapBatteryStateId || ""}
                      />
                    </Field>
                    <Field label="Klappe Online">
                      <StateFieldInput
                        onBrowse={() => setPickerField("flapOnlineStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, flapOnlineStateId: value }))}
                        value={draft.flapOnlineStateId || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="Hub Online">
                      <StateFieldInput
                        onBrowse={() => setPickerField("hubOnlineStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, hubOnlineStateId: value }))}
                        value={draft.hubOnlineStateId || ""}
                      />
                    </Field>
                    <Field label="Adapter verbunden">
                      <StateFieldInput
                        onBrowse={() => setPickerField("adapterConnectedStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, adapterConnectedStateId: value }))}
                        value={draft.adapterConnectedStateId || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="Alle Devices Online">
                      <StateFieldInput
                        onBrowse={() => setPickerField("allDevicesOnlineStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, allDevicesOnlineStateId: value }))}
                        value={draft.allDevicesOnlineStateId || ""}
                      />
                    </Field>
                    <Field label="Offline Devices">
                      <StateFieldInput
                        onBrowse={() => setPickerField("offlineDevicesStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, offlineDevicesStateId: value }))}
                        value={draft.offlineDevicesStateId || ""}
                      />
                    </Field>
                  </View>
                </View>
                <View style={styles.groupCard}>
                  <Text style={styles.groupTitle}>Lock-Modus</Text>
                  <View style={styles.splitRow}>
                    <Field label="Lock Status State">
                      <StateFieldInput
                        onBrowse={() => setPickerField("lockModeStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, lockModeStateId: value }))}
                        value={draft.lockModeStateId || ""}
                      />
                    </Field>
                    <Field label="Lock Write State">
                      <StateFieldInput
                        onBrowse={() => setPickerField("lockWriteStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, lockWriteStateId: value }))}
                        value={draft.lockWriteStateId || ""}
                      />
                    </Field>
                  </View>
                  <Field label="Wertetyp">
                    <ChoiceRow
                      options={["number", "string"]}
                      value={draft.lockValueType || "number"}
                      onSelect={(value) => setDraft((current) => ({ ...current, lockValueType: value }))}
                    />
                  </Field>
                  <View style={styles.splitRow}>
                    <Field label="Offen">
                      <TextInput onChangeText={(value) => setDraft((current) => ({ ...current, lockUnlockedValue: value }))} style={styles.input} value={draft.lockUnlockedValue || "0"} />
                    </Field>
                    <Field label="Nur rein">
                      <TextInput onChangeText={(value) => setDraft((current) => ({ ...current, lockInOnlyValue: value }))} style={styles.input} value={draft.lockInOnlyValue || "1"} />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="Nur raus">
                      <TextInput onChangeText={(value) => setDraft((current) => ({ ...current, lockOutOnlyValue: value }))} style={styles.input} value={draft.lockOutOnlyValue || "2"} />
                    </Field>
                    <Field label="Gesperrt">
                      <TextInput onChangeText={(value) => setDraft((current) => ({ ...current, lockLockedValue: value }))} style={styles.input} value={draft.lockLockedValue || "3"} />
                    </Field>
                  </View>
                </View>
                <Field label="Snapshot URL">
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={(value) => setDraft((current) => ({ ...current, snapshotUrl: value }))}
                    placeholder="http://..."
                    placeholderTextColor={palette.textMuted}
                    style={styles.input}
                    value={draft.snapshotUrl || ""}
                  />
                </Field>
                <View style={styles.groupCard}>
                  <Text style={styles.groupTitle}>Vollbild / Stream</Text>
                  <Field label="Vollbild Quelle">
                    <ChoiceRow
                      options={["snapshot", "mjpeg", "flv", "video", "iframe"]}
                      value={draft.fullscreenMediaMode || "snapshot"}
                      onSelect={(value) => setDraft((current) => ({ ...current, fullscreenMediaMode: value }))}
                    />
                  </Field>
                  <Field label="Stream URL">
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={(value) => setDraft((current) => ({ ...current, streamUrl: value }))}
                      placeholder="http://... (MJPEG, fMP4/HLS/MP4 oder Embed-URL)"
                      placeholderTextColor={palette.textMuted}
                      style={styles.input}
                      value={draft.streamUrl || ""}
                    />
                  </Field>
                  <Text style={styles.mappingHint}>
                    Snapshot bleibt die Vorschau. Im Vollbild wird bei `mjpeg`, `video` oder `iframe` die Stream URL verwendet.
                    RTSP-URLs sind im Browser nicht direkt abspielbar.
                  </Text>
                </View>
                <Field label="Sounds bei Interaktion">
                  <Field label="Lock Button">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, press: value }))}
                      value={soundDraft.press}
                    />
                  </Field>
                  <Field label="Lock bestaetigt">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, confirm: value }))}
                      value={soundDraft.confirm}
                    />
                  </Field>
                  <Field label="Snapshot Vollbild">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, open: value }))}
                      value={soundDraft.open}
                    />
                  </Field>
                  <Field label="Snapshot schliessen">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, close: value }))}
                      value={soundDraft.close}
                    />
                  </Field>
                  <EditorButtonPressable onPress={saveSoundsAsTypeDefault} style={styles.inlineActionButton}>
                    <Text style={styles.inlineActionLabel}>Als Default fuer alle Coco-Widgets verwenden</Text>
                  </EditorButtonPressable>
                </Field>
              </>
            ) : null}
            {widget.type === "wallbox" || widget.type === "goe" ? (
              <>
                <View style={styles.groupCard}>
                  <Text style={styles.groupTitle}>Basis</Text>
                  <View style={styles.splitRow}>
                    <Field label="Refresh (ms)">
                      <TextInput
                        keyboardType="numeric"
                        onChangeText={(value) => setDraft((current) => ({ ...current, refreshMs: value }))}
                        style={styles.input}
                        value={draft.refreshMs || "2000"}
                      />
                    </Field>
                    <Field label="Status-Untertitel anzeigen">
                      <ChoiceRow
                        options={["true", "false"]}
                        value={draft.showStatusSubtitle || "false"}
                        onSelect={(value) => setDraft((current) => ({ ...current, showStatusSubtitle: value }))}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="Zielmodus">
                      <ChoiceRow
                        options={["soc", "km"]}
                        value={draft.targetMode || "soc"}
                        onSelect={(value) => setDraft((current) => ({ ...current, targetMode: value }))}
                      />
                    </Field>
                    <Field label="Highlight Transparenz (0.08-0.9)">
                      <TextInput
                        keyboardType="numeric"
                        onChangeText={(value) => setDraft((current) => ({ ...current, highlightOpacity: value }))}
                        style={styles.input}
                        value={draft.highlightOpacity || "0.32"}
                      />
                    </Field>
                  </View>
                  <Field label="Netzladen-Strom anzeigen">
                    <ChoiceRow
                      options={["true", "false"]}
                      value={draft.showGridAmpereControl || "true"}
                      onSelect={(value) => setDraft((current) => ({ ...current, showGridAmpereControl: value }))}
                    />
                  </Field>
                  <Field label="Widget-Hintergrundbild (optional)">
                    <View style={styles.stateFieldRow}>
                      <TextInput
                        editable={false}
                        style={[styles.input, styles.stateFieldInput]}
                        value={draft.backgroundImage || ""}
                      />
                      <EditorButtonPressable
                        onPress={() => setImagePickerField("backgroundImage")}
                        style={styles.stateBrowseButton}
                      >
                        <Text style={styles.stateBrowseLabel}>Bild waehlen</Text>
                      </EditorButtonPressable>
                    </View>
                    <Field label="Bild-Unschaerfe">
                      <BlurControl
                        value={draft.backgroundImageBlur || "8"}
                        onChange={(value) => setDraft((current) => ({ ...current, backgroundImageBlur: value }))}
                      />
                    </Field>
                  </Field>
                </View>

                <View style={styles.groupCard}>
                  <Text style={styles.groupTitle}>Schreiben + Status-Bestaetigung</Text>
                  <Text style={styles.sectionTitle}>Ladeautomatik</Text>
                  <View style={styles.splitRow}>
                    <Field label="Ladeautomatik - Write Value">
                      <StateFieldInput
                        onBrowse={() => setPickerField("stopWriteStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, stopWriteStateId: value }))}
                        value={draft.stopWriteStateId || ""}
                      />
                    </Field>
                    <Field label="Ladeautomatik - State Value">
                      <StateFieldInput
                        onBrowse={() => setPickerField("stopStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, stopStateId: value }))}
                        value={draft.stopStateId || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="Ladeautomatik - Write Typ">
                      <ChoiceRow
                        options={["boolean", "number", "string"]}
                        value={draft.stopWriteValueType || "boolean"}
                        onSelect={(value) => setDraft((current) => ({ ...current, stopWriteValueType: value }))}
                      />
                    </Field>
                    <Field label="Ladeautomatik - Write Wert">
                      <TextInput
                        autoCapitalize="none"
                        onChangeText={(value) => setDraft((current) => ({ ...current, stopWriteValue: value }))}
                        style={styles.input}
                        value={draft.stopWriteValue || ""}
                      />
                    </Field>
                  </View>
                  <Text style={styles.mappingHint}>Interne Lade-Logik nutzt ausschliesslich diesen Ladeautomatik-/AllowCharging-Datenpunkt.</Text>
                  <View style={styles.splitRow}>
                    <Field label="Ladeautomatik - State Typ">
                      <ChoiceRow
                        options={["boolean", "number", "string"]}
                        value={draft.stopStateValueType || "boolean"}
                        onSelect={(value) => setDraft((current) => ({ ...current, stopStateValueType: value }))}
                      />
                    </Field>
                    <Field label="Ladeautomatik - State Wert">
                      <TextInput
                        autoCapitalize="none"
                        onChangeText={(value) => setDraft((current) => ({ ...current, stopStateValue: value }))}
                        style={styles.input}
                        value={draft.stopStateValue || ""}
                      />
                    </Field>
                  </View>
                  <Text style={styles.sectionTitle}>Emergency Stop (global)</Text>
                  <Field label="Emergency Stop - Datenpunkt">
                    <StateFieldInput
                      onBrowse={() => setPickerField("emergencyStopStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, emergencyStopStateId: value }))}
                      value={draft.emergencyStopStateId || ""}
                    />
                  </Field>
                  <Text style={styles.mappingHint}>
                    Separater globaler Not-Aus-Schalter. Dieser Datenpunkt wird nicht fuer die interne Lade-Logik verwendet.
                  </Text>

                  <Text style={styles.sectionTitle}>PV</Text>
                  <View style={styles.splitRow}>
                    <Field label="PV - Write Value">
                      <StateFieldInput
                        onBrowse={() => setPickerField("pvWriteStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, pvWriteStateId: value }))}
                        value={draft.pvWriteStateId || ""}
                      />
                    </Field>
                    <Field label="PV - State Value">
                      <StateFieldInput
                        onBrowse={() => setPickerField("pvStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, pvStateId: value }))}
                        value={draft.pvStateId || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="PV - Write Typ">
                      <ChoiceRow
                        options={["boolean", "number", "string"]}
                        value={draft.pvWriteValueType || "number"}
                        onSelect={(value) => setDraft((current) => ({ ...current, pvWriteValueType: value }))}
                      />
                    </Field>
                    <Field label="PV - Write Wert">
                      <TextInput
                        autoCapitalize="none"
                        onChangeText={(value) => setDraft((current) => ({ ...current, pvWriteValue: value }))}
                        style={styles.input}
                        value={draft.pvWriteValue || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="PV - State Typ">
                      <ChoiceRow
                        options={["boolean", "number", "string"]}
                        value={draft.pvStateValueType || "string"}
                        onSelect={(value) => setDraft((current) => ({ ...current, pvStateValueType: value }))}
                      />
                    </Field>
                    <Field label="PV - State Wert">
                      <TextInput
                        autoCapitalize="none"
                        onChangeText={(value) => setDraft((current) => ({ ...current, pvStateValue: value }))}
                        style={styles.input}
                        value={draft.pvStateValue || ""}
                      />
                    </Field>
                  </View>

                  <Text style={styles.sectionTitle}>PV (go-e priority)</Text>
                  <View style={styles.splitRow}>
                    <Field label="PV (go-e priority) - Write Value">
                      <StateFieldInput
                        onBrowse={() => setPickerField("pvPriorityWriteStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, pvPriorityWriteStateId: value }))}
                        value={draft.pvPriorityWriteStateId || ""}
                      />
                    </Field>
                    <Field label="PV (go-e priority) - State Value">
                      <StateFieldInput
                        onBrowse={() => setPickerField("pvPriorityStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, pvPriorityStateId: value }))}
                        value={draft.pvPriorityStateId || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="PV Priority - Write Typ">
                      <ChoiceRow
                        options={["boolean", "number", "string"]}
                        value={draft.pvPriorityWriteValueType || "number"}
                        onSelect={(value) => setDraft((current) => ({ ...current, pvPriorityWriteValueType: value }))}
                      />
                    </Field>
                    <Field label="PV Priority - Write Wert">
                      <TextInput
                        autoCapitalize="none"
                        onChangeText={(value) => setDraft((current) => ({ ...current, pvPriorityWriteValue: value }))}
                        style={styles.input}
                        value={draft.pvPriorityWriteValue || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="PV Priority - State Typ">
                      <ChoiceRow
                        options={["boolean", "number", "string"]}
                        value={draft.pvPriorityStateValueType || "string"}
                        onSelect={(value) => setDraft((current) => ({ ...current, pvPriorityStateValueType: value }))}
                      />
                    </Field>
                    <Field label="PV Priority - State Wert">
                      <TextInput
                        autoCapitalize="none"
                        onChangeText={(value) => setDraft((current) => ({ ...current, pvPriorityStateValue: value }))}
                        style={styles.input}
                        value={draft.pvPriorityStateValue || ""}
                      />
                    </Field>
                  </View>

                  <Text style={styles.sectionTitle}>Netz</Text>
                  <View style={styles.splitRow}>
                    <Field label="Netz - Write Value">
                      <StateFieldInput
                        onBrowse={() => setPickerField("gridWriteStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, gridWriteStateId: value }))}
                        value={draft.gridWriteStateId || ""}
                      />
                    </Field>
                    <Field label="Netz - State Value">
                      <StateFieldInput
                        onBrowse={() => setPickerField("gridStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, gridStateId: value }))}
                        value={draft.gridStateId || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="Netz - Write Typ">
                      <ChoiceRow
                        options={["boolean", "number", "string"]}
                        value={draft.gridWriteValueType || "number"}
                        onSelect={(value) => setDraft((current) => ({ ...current, gridWriteValueType: value }))}
                      />
                    </Field>
                    <Field label="Netz - Write Wert">
                      <TextInput
                        autoCapitalize="none"
                        onChangeText={(value) => setDraft((current) => ({ ...current, gridWriteValue: value }))}
                        style={styles.input}
                        value={draft.gridWriteValue || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="Netz - State Typ">
                      <ChoiceRow
                        options={["boolean", "number", "string"]}
                        value={draft.gridStateValueType || "string"}
                        onSelect={(value) => setDraft((current) => ({ ...current, gridStateValueType: value }))}
                      />
                    </Field>
                    <Field label="Netz - State Wert">
                      <TextInput
                        autoCapitalize="none"
                        onChangeText={(value) => setDraft((current) => ({ ...current, gridStateValue: value }))}
                        style={styles.input}
                        value={draft.gridStateValue || ""}
                      />
                    </Field>
                  </View>

                  <Text style={styles.sectionTitle}>Wallbox-Strom (manuell)</Text>
                  <View style={styles.splitRow}>
                    <Field label="Wallbox-Strom (manuell) - Write Value">
                      <StateFieldInput
                        onBrowse={() => setPickerField("manualCurrentWriteStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, manualCurrentWriteStateId: value }))}
                        value={draft.manualCurrentWriteStateId || ""}
                      />
                    </Field>
                    <Field label="Wallbox-Strom (manuell) - State Value">
                      <StateFieldInput
                        onBrowse={() => setPickerField("manualCurrentStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, manualCurrentStateId: value }))}
                        value={draft.manualCurrentStateId || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="Manuell - Write Typ">
                      <ChoiceRow
                        options={["boolean", "number", "string"]}
                        value={draft.manualCurrentWriteValueType || "number"}
                        onSelect={(value) => setDraft((current) => ({ ...current, manualCurrentWriteValueType: value }))}
                      />
                    </Field>
                    <Field label="Manuell - State Typ">
                      <ChoiceRow
                        options={["boolean", "number", "string"]}
                        value={draft.manualCurrentStateValueType || "number"}
                        onSelect={(value) => setDraft((current) => ({ ...current, manualCurrentStateValueType: value }))}
                      />
                    </Field>
                  </View>

                  <Text style={styles.sectionTitle}>Ampere Cards</Text>
                  <View style={styles.splitRow}>
                    <Field label="Ampere-Cards - Write Value">
                      <StateFieldInput
                        onBrowse={() => setPickerField("ampereCardsWriteStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, ampereCardsWriteStateId: value }))}
                        value={draft.ampereCardsWriteStateId || ""}
                      />
                    </Field>
                    <Field label="Ampere-Cards - State Value">
                      <StateFieldInput
                        onBrowse={() => setPickerField("ampereCardsStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, ampereCardsStateId: value }))}
                        value={draft.ampereCardsStateId || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="Ampere-Cards - Write Typ">
                      <ChoiceRow
                        options={["boolean", "number", "string"]}
                        value={draft.ampereCardsWriteValueType || "number"}
                        onSelect={(value) => setDraft((current) => ({ ...current, ampereCardsWriteValueType: value }))}
                      />
                    </Field>
                    <Field label="Ampere-Cards - State Typ">
                      <ChoiceRow
                        options={["boolean", "number", "string"]}
                        value={draft.ampereCardsStateValueType || "number"}
                        onSelect={(value) => setDraft((current) => ({ ...current, ampereCardsStateValueType: value }))}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="6A Write / State">
                      <View style={styles.splitRow}>
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={(value) => setDraft((current) => ({ ...current, ampere6WriteValue: value }))}
                          style={styles.input}
                          value={draft.ampere6WriteValue || ""}
                        />
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={(value) => setDraft((current) => ({ ...current, ampere6StateValue: value }))}
                          style={styles.input}
                          value={draft.ampere6StateValue || ""}
                        />
                      </View>
                    </Field>
                    <Field label="10A Write / State">
                      <View style={styles.splitRow}>
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={(value) => setDraft((current) => ({ ...current, ampere10WriteValue: value }))}
                          style={styles.input}
                          value={draft.ampere10WriteValue || ""}
                        />
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={(value) => setDraft((current) => ({ ...current, ampere10StateValue: value }))}
                          style={styles.input}
                          value={draft.ampere10StateValue || ""}
                        />
                      </View>
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="12A Write / State">
                      <View style={styles.splitRow}>
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={(value) => setDraft((current) => ({ ...current, ampere12WriteValue: value }))}
                          style={styles.input}
                          value={draft.ampere12WriteValue || ""}
                        />
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={(value) => setDraft((current) => ({ ...current, ampere12StateValue: value }))}
                          style={styles.input}
                          value={draft.ampere12StateValue || ""}
                        />
                      </View>
                    </Field>
                    <Field label="14A Write / State">
                      <View style={styles.splitRow}>
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={(value) => setDraft((current) => ({ ...current, ampere14WriteValue: value }))}
                          style={styles.input}
                          value={draft.ampere14WriteValue || ""}
                        />
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={(value) => setDraft((current) => ({ ...current, ampere14StateValue: value }))}
                          style={styles.input}
                          value={draft.ampere14StateValue || ""}
                        />
                      </View>
                    </Field>
                  </View>
                  <Field label="16A Write / State">
                    <View style={styles.splitRow}>
                      <TextInput
                        autoCapitalize="none"
                        onChangeText={(value) => setDraft((current) => ({ ...current, ampere16WriteValue: value }))}
                        style={styles.input}
                        value={draft.ampere16WriteValue || ""}
                      />
                      <TextInput
                        autoCapitalize="none"
                        onChangeText={(value) => setDraft((current) => ({ ...current, ampere16StateValue: value }))}
                        style={styles.input}
                        value={draft.ampere16StateValue || ""}
                      />
                    </View>
                  </Field>

                  <Text style={styles.sectionTitle}>Phasen Cards</Text>
                  <View style={styles.splitRow}>
                    <Field label="Phasen-Cards - Write Value">
                      <StateFieldInput
                        onBrowse={() => setPickerField("phaseCardsWriteStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, phaseCardsWriteStateId: value }))}
                        value={draft.phaseCardsWriteStateId || ""}
                      />
                    </Field>
                    <Field label="Phasen-Cards - State Value">
                      <StateFieldInput
                        onBrowse={() => setPickerField("phaseCardsStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, phaseCardsStateId: value }))}
                        value={draft.phaseCardsStateId || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="Phasen-Cards - Write Typ">
                      <ChoiceRow
                        options={["boolean", "number", "string"]}
                        value={draft.phaseCardsWriteValueType || "number"}
                        onSelect={(value) => setDraft((current) => ({ ...current, phaseCardsWriteValueType: value }))}
                      />
                    </Field>
                    <Field label="Phasen-Cards - State Typ">
                      <ChoiceRow
                        options={["boolean", "number", "string"]}
                        value={draft.phaseCardsStateValueType || "number"}
                        onSelect={(value) => setDraft((current) => ({ ...current, phaseCardsStateValueType: value }))}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="1-phasig Write / State">
                      <View style={styles.splitRow}>
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={(value) => setDraft((current) => ({ ...current, phase1WriteValue: value }))}
                          style={styles.input}
                          value={draft.phase1WriteValue || ""}
                        />
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={(value) => setDraft((current) => ({ ...current, phase1StateValue: value }))}
                          style={styles.input}
                          value={draft.phase1StateValue || ""}
                        />
                      </View>
                    </Field>
                    <Field label="3-phasig Write / State">
                      <View style={styles.splitRow}>
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={(value) => setDraft((current) => ({ ...current, phase3WriteValue: value }))}
                          style={styles.input}
                          value={draft.phase3WriteValue || ""}
                        />
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={(value) => setDraft((current) => ({ ...current, phase3StateValue: value }))}
                          style={styles.input}
                          value={draft.phase3StateValue || ""}
                        />
                      </View>
                    </Field>
                  </View>

                  <View style={styles.splitRow}>
                    <Field label="Ziel-Ladung (0-100)">
                      <StateFieldInput
                        onBrowse={() => setPickerField("limit80StateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, limit80StateId: value }))}
                        value={draft.limit80StateId || ""}
                      />
                    </Field>
                    <Field label="Ziel-Ladung Typ">
                      <ChoiceRow
                        options={["number", "string", "boolean"]}
                        value={draft.targetChargeValueType || "number"}
                        onSelect={(value) => setDraft((current) => ({ ...current, targetChargeValueType: value }))}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="Ziel-km (frei waehlbarer Datenpunkt)">
                      <StateFieldInput
                        onBrowse={() => setPickerField("targetKmStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, targetKmStateId: value }))}
                        value={draft.targetKmStateId || ""}
                      />
                    </Field>
                    <Field label="TargetSOC Auto-API (optional)">
                      <StateFieldInput
                        onBrowse={() => setPickerField("targetSocAutoApiStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, targetSocAutoApiStateId: value }))}
                        value={draft.targetSocAutoApiStateId || ""}
                      />
                    </Field>
                  </View>
                  <Text style={styles.mappingHint}>
                    Fuer `control.targetSocPercent` gibt es keinen passenden Status-Spiegelwert. Dieser Datenpunkt wird
                    deshalb als write only genutzt. Optional wird der Slider-Wert zusaetzlich an `TargetSOC Auto-API` geschrieben.
                  </Text>
                </View>

                <View style={styles.groupCard}>
                  <Text style={styles.groupTitle}>Live-Infos und Stat-Cards</Text>
                  <View style={styles.splitRow}>
                    <Field label="Aktueller Sollstrom (status.setCurrentA)">
                      <StateFieldInput
                        onBrowse={() => setPickerField("ampereStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, ampereStateId: value }))}
                        value={draft.ampereStateId || ""}
                      />
                    </Field>
                    <Field label="Aktive Phasen (status.enabledPhases)">
                      <StateFieldInput
                        onBrowse={() => setPickerField("phaseSwitchModeEnabledStateId")}
                        onChangeText={(value) =>
                          setDraft((current) => ({ ...current, phaseSwitchModeEnabledStateId: value }))
                        }
                        value={draft.phaseSwitchModeEnabledStateId || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="Fahrzeugstatus (status.carState)">
                      <StateFieldInput
                        onBrowse={() => setPickerField("carStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, carStateId: value }))}
                        value={draft.carStateId || ""}
                      />
                    </Field>
                    <Field label="Fahrzeug-SoC (status.carSocPercent)">
                      <StateFieldInput
                        onBrowse={() => setPickerField("batterySocStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, batterySocStateId: value }))}
                        value={draft.batterySocStateId || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="Fahrzeug-km (optional, Ist-Wert)">
                      <StateFieldInput
                        onBrowse={() => setPickerField("carRangeStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, carRangeStateId: value }))}
                        value={draft.carRangeStateId || ""}
                      />
                    </Field>
                    <Field label="Ladeleistung (status.chargerPowerW)">
                      <StateFieldInput
                        onBrowse={() => setPickerField("chargePowerStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, chargePowerStateId: value }))}
                        value={draft.chargePowerStateId || ""}
                      />
                    </Field>
                  </View>
                  <View style={styles.splitRow}>
                    <Field label="chargedEnergy (kWh/Wh)">
                      <StateFieldInput
                        onBrowse={() => setPickerField("chargedEnergyStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, chargedEnergyStateId: value }))}
                        value={draft.chargedEnergyStateId || ""}
                      />
                    </Field>
                    <Field label="Legacy: solarLoadOnly (optional)">
                      <StateFieldInput
                        onBrowse={() => setPickerField("solarLoadOnlyStateId")}
                        onChangeText={(value) => setDraft((current) => ({ ...current, solarLoadOnlyStateId: value }))}
                        value={draft.solarLoadOnlyStateId || ""}
                      />
                    </Field>
                  </View>
                  <Text style={styles.mappingHint}>
                    `status.carSocPercent` und optional `Fahrzeug-km` dienen als Ist-Werte fuer Auto-Stop.
                  </Text>
                </View>

                <View style={styles.groupCard}>
                  <Text style={styles.groupTitle}>Sounds</Text>
                  <Field label="Sounds bei Interaktion">
                  <Field label="Button Press">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, press: value }))}
                      value={soundDraft.press}
                    />
                  </Field>
                  <Field label="Karten-Auswahl">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, slider: value }))}
                      value={soundDraft.slider}
                    />
                  </Field>
                  <Field label="Bestaetigt / geschrieben">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, confirm: value }))}
                      value={soundDraft.confirm}
                    />
                  </Field>
                  <EditorButtonPressable onPress={saveSoundsAsTypeDefault} style={styles.inlineActionButton}>
                    <Text style={styles.inlineActionLabel}>
                      {widget.type === "goe"
                        ? "Als Default fuer alle go-e-Widgets verwenden"
                        : "Als Default fuer alle Wallbox-Widgets verwenden"}
                    </Text>
                  </EditorButtonPressable>
                </Field>
                </View>
              </>
            ) : null}
            {widget.type === "heating" || widget.type === "heatingV2" ? (
              <>
                <View style={styles.splitRow}>
                  <Field label="Refresh (ms)">
                    <TextInput
                      keyboardType="numeric"
                      onChangeText={(value) => setDraft((current) => ({ ...current, refreshMs: value }))}
                      style={styles.input}
                      value={draft.refreshMs || "3000"}
                    />
                  </Field>
                  <Field label="Status-Untertitel anzeigen">
                    <ChoiceRow
                      options={["true", "false"]}
                      value={draft.showStatusSubtitle || "true"}
                      onSelect={(value) => setDraft((current) => ({ ...current, showStatusSubtitle: value }))}
                    />
                  </Field>
                </View>
                {widget.type === "heatingV2" ? (
                  <Field label="Laufschrift Geschwindigkeit (px/s)">
                    <TextInput
                      keyboardType="numeric"
                      onChangeText={(value) => setDraft((current) => ({ ...current, detailsTickerSpeedPxPerS: value }))}
                      style={styles.input}
                      value={draft.detailsTickerSpeedPxPerS || "46"}
                    />
                  </Field>
                ) : null}

                <Field label="Widget-Hintergrundbild (optional)">
                  <View style={styles.stateFieldRow}>
                    <TextInput
                      editable={false}
                      style={[styles.input, styles.stateFieldInput]}
                      value={draft.backgroundImage || ""}
                    />
                    <EditorButtonPressable
                      onPress={() => setImagePickerField("backgroundImage")}
                      style={styles.stateBrowseButton}
                    >
                      <Text style={styles.stateBrowseLabel}>Bild waehlen</Text>
                    </EditorButtonPressable>
                  </View>
                  <Field label="Bild-Unschaerfe">
                    <BlurControl
                      value={draft.backgroundImageBlur || "8"}
                      onChange={(value) => setDraft((current) => ({ ...current, backgroundImageBlur: value }))}
                    />
                  </Field>
                </Field>

                <Text style={styles.sectionTitle}>Steuerung</Text>
                <Field label="Mode setzen (setMode.setValue)">
                  <StateFieldInput
                    onBrowse={() => setPickerField("modeSetStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, modeSetStateId: value }))}
                    value={draft.modeSetStateId || ""}
                  />
                </Field>
                <Field label="Innentemperatur Soll setzen">
                  <StateFieldInput
                    onBrowse={() => setPickerField("normalSetTempStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, normalSetTempStateId: value }))}
                    value={draft.normalSetTempStateId || ""}
                  />
                </Field>
                <View style={styles.splitRow}>
                  <Field label="Reduziert Solltemperatur">
                    <StateFieldInput
                      onBrowse={() => setPickerField("reducedSetTempStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, reducedSetTempStateId: value }))}
                      value={draft.reducedSetTempStateId || ""}
                    />
                  </Field>
                  <Field label="Komfort Solltemperatur">
                    <StateFieldInput
                      onBrowse={() => setPickerField("comfortSetTempStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, comfortSetTempStateId: value }))}
                      value={draft.comfortSetTempStateId || ""}
                    />
                  </Field>
                </View>
                <Field label="Warmwasser Solltemperatur setzen">
                  <StateFieldInput
                    onBrowse={() => setPickerField("dhwSetTempStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, dhwSetTempStateId: value }))}
                    value={draft.dhwSetTempStateId || ""}
                  />
                </Field>
                <View style={styles.splitRow}>
                  <Field label="WW Einmalladung setActive">
                    <StateFieldInput
                      onBrowse={() => setPickerField("oneTimeChargeSetActiveStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, oneTimeChargeSetActiveStateId: value }))}
                      value={draft.oneTimeChargeSetActiveStateId || ""}
                    />
                  </Field>
                </View>
                <View style={styles.splitRow}>
                  <Field label="Lueftungsautomatik setActive">
                    <StateFieldInput
                      onBrowse={() => setPickerField("ventilationAutoSetActiveStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, ventilationAutoSetActiveStateId: value }))}
                      value={draft.ventilationAutoSetActiveStateId || ""}
                    />
                  </Field>
                  <Field label="Lueftungsstufe setzen">
                    <StateFieldInput
                      onBrowse={() => setPickerField("ventilationLevelSetStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, ventilationLevelSetStateId: value }))}
                      value={draft.ventilationLevelSetStateId || ""}
                    />
                  </Field>
                </View>

                <Text style={styles.sectionTitle}>Live-States (optional)</Text>
                <View style={styles.splitRow}>
                  <Field label="Aktueller Modus">
                    <StateFieldInput
                      onBrowse={() => setPickerField("modeValueStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, modeValueStateId: value }))}
                      value={draft.modeValueStateId || ""}
                    />
                  </Field>
                  <Field label="Aktives Programm">
                    <StateFieldInput
                      onBrowse={() => setPickerField("activeProgramStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, activeProgramStateId: value }))}
                      value={draft.activeProgramStateId || ""}
                    />
                  </Field>
                </View>
                <View style={styles.splitRow}>
                  <Field label="Blink: Heizmodus aktiv">
                    <StateFieldInput
                      onBrowse={() => setPickerField("heatingModeActiveStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, heatingModeActiveStateId: value }))}
                      value={draft.heatingModeActiveStateId || ""}
                    />
                  </Field>
                  <Field label="Blink: WW Aufbereitung aktiv">
                    <StateFieldInput
                      onBrowse={() => setPickerField("dhwChargingActiveStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, dhwChargingActiveStateId: value }))}
                      value={draft.dhwChargingActiveStateId || ""}
                    />
                  </Field>
                </View>
                <View style={styles.splitRow}>
                  <Field label="Blink: WW Programm normal/temp-2">
                    <StateFieldInput
                      onBrowse={() => setPickerField("dhwChargingProgramStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, dhwChargingProgramStateId: value }))}
                      value={draft.dhwChargingProgramStateId || ""}
                    />
                  </Field>
                  <Field label="Blink: Boost aktiv">
                    <StateFieldInput
                      onBrowse={() => setPickerField("boostBlinkActiveStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, boostBlinkActiveStateId: value }))}
                      value={draft.boostBlinkActiveStateId || ""}
                    />
                  </Field>
                </View>
                <View style={styles.splitRow}>
                  <Field label="Innentemperatur Ist">
                    <StateFieldInput
                      onBrowse={() => setPickerField("roomTempStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, roomTempStateId: value }))}
                      value={draft.roomTempStateId || ""}
                    />
                  </Field>
                  <Field label="Heizkreis Temp">
                    <StateFieldInput
                      onBrowse={() => setPickerField("heatingTempStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, heatingTempStateId: value }))}
                      value={draft.heatingTempStateId || ""}
                    />
                  </Field>
                  <Field label="Vorlauf Temp">
                    <StateFieldInput
                      onBrowse={() => setPickerField("supplyTempStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, supplyTempStateId: value }))}
                      value={draft.supplyTempStateId || ""}
                    />
                  </Field>
                </View>
                <View style={styles.splitRow}>
                  <Field label="Aussentemperatur">
                    <StateFieldInput
                      onBrowse={() => setPickerField("outsideTempStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, outsideTempStateId: value }))}
                      value={draft.outsideTempStateId || ""}
                    />
                  </Field>
                  <Field label="Ruecklauf Temp">
                    <StateFieldInput
                      onBrowse={() => setPickerField("returnTempStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, returnTempStateId: value }))}
                      value={draft.returnTempStateId || ""}
                    />
                  </Field>
                </View>
                <View style={styles.splitRow}>
                  <Field label="Warmwasser Ist">
                    <StateFieldInput
                      onBrowse={() => setPickerField("dhwTempStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, dhwTempStateId: value }))}
                      value={draft.dhwTempStateId || ""}
                    />
                  </Field>
                  <Field label="Einmalladung Aktiv">
                    <StateFieldInput
                      onBrowse={() => setPickerField("oneTimeChargeActiveStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, oneTimeChargeActiveStateId: value }))}
                      value={draft.oneTimeChargeActiveStateId || ""}
                    />
                  </Field>
                </View>
                <View style={styles.splitRow}>
                  <Field label="Lueftungsautomatik aktiv">
                    <StateFieldInput
                      onBrowse={() => setPickerField("ventilationAutoActiveStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, ventilationAutoActiveStateId: value }))}
                      value={draft.ventilationAutoActiveStateId || ""}
                    />
                  </Field>
                  <Field label="Lueftungsstufe Ist">
                    <StateFieldInput
                      onBrowse={() => setPickerField("ventilationLevelStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, ventilationLevelStateId: value }))}
                      value={draft.ventilationLevelStateId || ""}
                    />
                  </Field>
                </View>
                <View style={styles.splitRow}>
                  <Field label="Verdichter Leistung">
                    <StateFieldInput
                      onBrowse={() => setPickerField("compressorPowerStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, compressorPowerStateId: value }))}
                      value={draft.compressorPowerStateId || ""}
                    />
                  </Field>
                  <Field label="Verdichter Sensor Leistung">
                    <StateFieldInput
                      onBrowse={() => setPickerField("compressorSensorPowerStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, compressorSensorPowerStateId: value }))}
                      value={draft.compressorSensorPowerStateId || ""}
                    />
                  </Field>
                </View>

                <Text style={styles.sectionTitle}>Button-Icons (MaterialCommunityIcons)</Text>
                <View style={styles.splitRow}>
                  <Field label="Standby Icon">
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={(value) => setDraft((current) => ({ ...current, standbyIcon: value }))}
                      style={styles.input}
                      value={draft.standbyIcon || ""}
                    />
                  </Field>
                  <Field label="Nur WW Icon">
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={(value) => setDraft((current) => ({ ...current, dhwIcon: value }))}
                      style={styles.input}
                      value={draft.dhwIcon || ""}
                    />
                  </Field>
                </View>
                <View style={styles.splitRow}>
                  <Field label="Heizen+WW Icon">
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={(value) => setDraft((current) => ({ ...current, heatingIcon: value }))}
                      style={styles.input}
                      value={draft.heatingIcon || ""}
                    />
                  </Field>
                  <Field label="Einmalladung Icon">
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={(value) => setDraft((current) => ({ ...current, oneTimeChargeIcon: value }))}
                      style={styles.input}
                      value={draft.oneTimeChargeIcon || ""}
                    />
                  </Field>
                </View>

                <Text style={styles.sectionTitle}>Infobox-Textzeilen</Text>
                <View style={styles.splitRow}>
                  <CheckboxChoice
                    label="Programm"
                    value={draft.showInfoProgram || "true"}
                    onChange={(value) => setDraft((current) => ({ ...current, showInfoProgram: value }))}
                  />
                  <CheckboxChoice
                    label="Zielwerte"
                    value={draft.showInfoTargets || "true"}
                    onChange={(value) => setDraft((current) => ({ ...current, showInfoTargets: value }))}
                  />
                </View>
                <View style={styles.splitRow}>
                  <CheckboxChoice
                    label="Aussen"
                    value={draft.showInfoOutsideTemp || "true"}
                    onChange={(value) => setDraft((current) => ({ ...current, showInfoOutsideTemp: value }))}
                  />
                  <CheckboxChoice
                    label="Vorlauf"
                    value={draft.showInfoSupplyTemp || "true"}
                    onChange={(value) => setDraft((current) => ({ ...current, showInfoSupplyTemp: value }))}
                  />
                </View>
                <View style={styles.splitRow}>
                  <CheckboxChoice
                    label="Ruecklauf"
                    value={draft.showInfoReturnTemp || "true"}
                    onChange={(value) => setDraft((current) => ({ ...current, showInfoReturnTemp: value }))}
                  />
                  <CheckboxChoice
                    label="Heizkreis"
                    value={draft.showInfoHeatingTemp || "true"}
                    onChange={(value) => setDraft((current) => ({ ...current, showInfoHeatingTemp: value }))}
                  />
                </View>
                <View style={styles.splitRow}>
                  <CheckboxChoice
                    label="Verdichter"
                    value={draft.showInfoCompressorPower || "true"}
                    onChange={(value) => setDraft((current) => ({ ...current, showInfoCompressorPower: value }))}
                  />
                </View>

                <Field label="Sounds bei Interaktion">
                  <Field label="Button Press">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, press: value }))}
                      value={soundDraft.press}
                    />
                  </Field>
                  <Field label="Slider Bewegung">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, slider: value }))}
                      value={soundDraft.slider}
                    />
                  </Field>
                  <Field label="Bestaetigt / geschrieben">
                    <SoundPickerField
                      onChange={(value) => setSoundDraft((current) => ({ ...current, confirm: value }))}
                      value={soundDraft.confirm}
                    />
                  </Field>
                  <EditorButtonPressable onPress={saveSoundsAsTypeDefault} style={styles.inlineActionButton}>
                    <Text style={styles.inlineActionLabel}>Als Default fuer alle Heating-Widgets verwenden</Text>
                  </EditorButtonPressable>
                </Field>
              </>
            ) : null}
            {widget.type === "solar" ? (
              <>
                <Field label="State Prefix">
                  <StateFieldInput
                    browseLabel="Prefix"
                    onBrowse={() => setPickerField("statePrefix")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, statePrefix: value }))}
                    value={draft.statePrefix || ""}
                  />
                </Field>
                <Field label="Tageswerte Einheit">
                  <View style={styles.modeRow}>
                    {["auto", "Wh", "kWh"].map((unit) => (
                      <EditorButtonPressable
                        key={unit}
                        onPress={() => setDraft((current) => ({ ...current, dailyEnergyUnit: unit }))}
                        style={[
                          styles.modeButton,
                          draft.dailyEnergyUnit === unit ? styles.modeButtonActive : null,
                        ]}
                      >
                        <Text style={styles.modeLabel}>{unit}</Text>
                      </EditorButtonPressable>
                    ))}
                  </View>
                </Field>
                <Field label="Stat-Cards Einheit">
                  <View style={styles.modeRow}>
                    {["none", "W", "kW", "Wh", "kWh"].map((unit) => (
                      <EditorButtonPressable
                        key={`stat-unit-${unit}`}
                        onPress={() => setDraft((current) => ({ ...current, statValueUnit: unit }))}
                        style={[
                          styles.modeButton,
                          (draft.statValueUnit || "none") === unit ? styles.modeButtonActive : null,
                        ]}
                      >
                        <Text style={styles.modeLabel}>{unit}</Text>
                      </EditorButtonPressable>
                    ))}
                  </View>
                </Field>
                <Text style={styles.sectionTitle}>Key-Mapping</Text>
                <View style={styles.splitRow}>
                  <Field label="PV aktuell">
                    <StateFieldInput
                      browseLabel="Objekt"
                      onBrowse={() => setPickerField("keyPvNow")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, keyPvNow: value }))}
                      value={draft.keyPvNow || ""}
                    />
                  </Field>
                  <Field label="Haus aktuell">
                    <StateFieldInput
                      browseLabel="Objekt"
                      onBrowse={() => setPickerField("keyHomeNow")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, keyHomeNow: value }))}
                      value={draft.keyHomeNow || ""}
                    />
                  </Field>
                </View>
                <View style={styles.splitRow}>
                  <Field label="Netzbezug">
                    <StateFieldInput
                      browseLabel="Objekt"
                      onBrowse={() => setPickerField("keyGridIn")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, keyGridIn: value }))}
                      value={draft.keyGridIn || ""}
                    />
                  </Field>
                  <Field label="Einspeisung">
                    <StateFieldInput
                      browseLabel="Objekt"
                      onBrowse={() => setPickerField("keyGridOut")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, keyGridOut: value }))}
                      value={draft.keyGridOut || ""}
                    />
                  </Field>
                </View>
                <View style={styles.splitRow}>
                  <Field label="Akku SOC">
                    <StateFieldInput
                      browseLabel="Objekt"
                      onBrowse={() => setPickerField("keySoc")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, keySoc: value }))}
                      value={draft.keySoc || ""}
                    />
                  </Field>
                  <Field label="Akku Temp">
                    <StateFieldInput
                      browseLabel="Objekt"
                      onBrowse={() => setPickerField("keyBattTemp")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, keyBattTemp: value }))}
                      value={draft.keyBattTemp || ""}
                    />
                  </Field>
                </View>
                <View style={styles.splitRow}>
                  <Field label="Akku laden">
                    <StateFieldInput
                      browseLabel="Objekt"
                      onBrowse={() => setPickerField("keyBattIn")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, keyBattIn: value }))}
                      value={draft.keyBattIn || ""}
                    />
                  </Field>
                  <Field label="Akku entladen">
                    <StateFieldInput
                      browseLabel="Objekt"
                      onBrowse={() => setPickerField("keyBattOut")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, keyBattOut: value }))}
                      value={draft.keyBattOut || ""}
                    />
                  </Field>
                </View>
                <View style={styles.splitRow}>
                  <Field label="Tag Verbrauch">
                    <StateFieldInput
                      browseLabel="Objekt"
                      onBrowse={() => setPickerField("keyDayConsumed")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, keyDayConsumed: value }))}
                      value={draft.keyDayConsumed || ""}
                    />
                  </Field>
                  <Field label="Tag Eigen">
                    <StateFieldInput
                      browseLabel="Objekt"
                      onBrowse={() => setPickerField("keyDaySelf")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, keyDaySelf: value }))}
                      value={draft.keyDaySelf || ""}
                    />
                  </Field>
                </View>
                <Field label="PV Gesamt">
                  <StateFieldInput
                    browseLabel="Objekt"
                    onBrowse={() => setPickerField("keyPvTotal")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, keyPvTotal: value }))}
                    value={draft.keyPvTotal || ""}
                  />
                </Field>
                <Text style={styles.sectionTitle}>Auto / Wallbox (optional)</Text>
                <View style={styles.splitRow}>
                  <Field label="Wallbox Car State ID">
                    <StateFieldInput
                      browseLabel="Objekt"
                      onBrowse={() => setPickerField("wallboxCarStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, wallboxCarStateId: value }))}
                      value={draft.wallboxCarStateId || ""}
                    />
                  </Field>
                  <Field label="Auto Akku SoC State ID">
                    <StateFieldInput
                      browseLabel="Objekt"
                      onBrowse={() => setPickerField("wallboxCarSocStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, wallboxCarSocStateId: value }))}
                      value={draft.wallboxCarSocStateId || ""}
                    />
                  </Field>
                </View>
                <Field label="Auto Reichweite State ID (km)">
                  <StateFieldInput
                    browseLabel="Objekt"
                    onBrowse={() => setPickerField("wallboxCarRangeStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, wallboxCarRangeStateId: value }))}
                    value={draft.wallboxCarRangeStateId || ""}
                  />
                </Field>
                <View style={styles.splitRow}>
                  <Field label="Wallbox Ladeleistung State ID">
                    <StateFieldInput
                      browseLabel="Objekt"
                      onBrowse={() => setPickerField("wallboxChargePowerStateId")}
                      onChangeText={(value) =>
                        setDraft((current) => ({ ...current, wallboxChargePowerStateId: value }))
                      }
                      value={draft.wallboxChargePowerStateId || ""}
                    />
                  </Field>
                  <Field label="Wallbox Strom State ID">
                    <StateFieldInput
                      browseLabel="Objekt"
                      onBrowse={() => setPickerField("wallboxAmpereStateId")}
                      onChangeText={(value) => setDraft((current) => ({ ...current, wallboxAmpereStateId: value }))}
                      value={draft.wallboxAmpereStateId || ""}
                    />
                  </Field>
                </View>
                <Field label="Wallbox Phasenmodus State ID">
                  <StateFieldInput
                    browseLabel="Objekt"
                    onBrowse={() => setPickerField("wallboxPhaseModeStateId")}
                    onChangeText={(value) => setDraft((current) => ({ ...current, wallboxPhaseModeStateId: value }))}
                    value={draft.wallboxPhaseModeStateId || ""}
                  />
                </Field>
                <Text style={styles.mappingHint}>
                  Wird fuer Auto-Flow-Animation, Ladeleistung, SoC und Reichweite im Auto-Node genutzt.
                </Text>
                <Field label="Stat Textgroesse (%)">
                  <TextInput
                    keyboardType="numeric"
                    onChangeText={(value) => setDraft((current) => ({ ...current, statTextScalePct: value }))}
                    style={styles.input}
                    value={draft.statTextScalePct || "100"}
                  />
                </Field>
                <Text style={styles.sectionTitle}>Klick-Aktion</Text>
                <Field label="Aktion">
                  <ChoiceRow
                    options={["none", "dashboard", "url"]}
                    value={draft.solarTapType || "none"}
                    onSelect={(value) => setDraft((current) => ({ ...current, solarTapType: value }))}
                  />
                </Field>
                {draft.solarTapType === "dashboard" ? (
                  <Field label="Ziel-Dashboard">
                    <View style={styles.modeRow}>
                      {dashboardPages.map((page) => (
                        <EditorButtonPressable
                          key={`solar-target-${page.id}`}
                          onPress={() => setDraft((current) => ({ ...current, solarTapDashboardId: page.id }))}
                          style={[
                            styles.modeButton,
                            (draft.solarTapDashboardId || "") === page.id ? styles.modeButtonActive : null,
                          ]}
                        >
                          <Text style={styles.modeLabel}>{page.title}</Text>
                        </EditorButtonPressable>
                      ))}
                    </View>
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={(value) => setDraft((current) => ({ ...current, solarTapDashboardId: value }))}
                      placeholder="Dashboard ID"
                      placeholderTextColor={palette.textMuted}
                      style={styles.input}
                      value={draft.solarTapDashboardId || ""}
                    />
                  </Field>
                ) : null}
                {draft.solarTapType === "url" ? (
                  <Field label="Ziel-URL">
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={(value) => setDraft((current) => ({ ...current, solarTapUrl: value }))}
                      placeholder="https://example.com"
                      placeholderTextColor={palette.textMuted}
                      style={styles.input}
                      value={draft.solarTapUrl || ""}
                    />
                  </Field>
                ) : null}
                <Text style={styles.sectionTitle}>Stats</Text>
                <Field label="Anzahl Stat-Cards">
                  <ChoiceRow
                    options={["1", "2", "3", "4", "5", "6"]}
                    value={String(solarStatCount)}
                    onSelect={(value) => setDraft((current) => ({ ...current, statCount: value }))}
                  />
                </Field>
                {Array.from({ length: solarStatCount }, (_, index) => {
                  const item = index + 1;
                  const labelKey = `stat${item}Label`;
                  const stateKey = `stat${item}StateId`;
                  return (
                    <View key={`solar-stat-editor-${item}`} style={styles.splitRow}>
                      <Field label={`Stat ${item} Label`}>
                        <TextInput
                          onChangeText={(value) => setDraft((current) => ({ ...current, [labelKey]: value }))}
                          style={styles.input}
                          value={draft[labelKey] || ""}
                        />
                      </Field>
                      <Field label={`Stat ${item} Datenpunkt`}>
                        <StateFieldInput
                          browseLabel="Objekt"
                          onBrowse={() => setPickerField(stateKey)}
                          onChangeText={(value) => setDraft((current) => ({ ...current, [stateKey]: value }))}
                          value={draft[stateKey] || ""}
                        />
                      </Field>
                    </View>
                  );
                })}
                <Text style={styles.mappingHint}>
                  Leer lassen, um den bisherigen Standardwert des Solar-Widgets zu nutzen. Wenn ein Datenpunkt gesetzt ist,
                  wird dessen aktueller Wert direkt angezeigt.
                </Text>
              </>
            ) : null}
            {widget ? (
              <>
                <Text style={styles.sectionTitle}>Widget kopieren</Text>
                <Field label="Auf Side-Page kopieren">
                  {copyTargetPages.length ? (
                    <View style={styles.modeRow}>
                      {copyTargetPages.map((page) => (
                        <EditorButtonPressable
                          key={`copy-target-${widget.id}-${page.id}`}
                          onPress={() => copyWidgetToPage(widget.id, page.id)}
                          style={styles.modeButton}
                        >
                          <Text style={styles.modeLabel}>{page.title}</Text>
                        </EditorButtonPressable>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.mappingHint}>Keine weitere Side-Page vorhanden.</Text>
                  )}
                  <Text style={styles.mappingHint}>
                    Erstellt eine Kopie mit allen Widget-Einstellungen auf der gewaehlten Seite.
                  </Text>
                </Field>
              </>
            ) : null}
          </ScrollView>
          <View style={styles.footer}>
            <EditorButtonPressable onPress={save} style={styles.saveButton}>
              <Text style={styles.saveLabel}>Speichern</Text>
            </EditorButtonPressable>
          </View>
        </View>
      </View>
      <ObjectPickerModal
        client={client}
        onClose={() => setPickerField(null)}
        onSelect={(entry) => {
          applyObjectSelection(pickerField, entry.id, draft, setDraft);
          setPickerField(null);
        }}
        title="ioBroker Objektbaum"
        visible={Boolean(pickerField)}
      />
      <ImagePickerModal
        client={client}
        title={
          imagePickerField === "cocoProfileImage"
            ? "Coco-Profilbild waehlen"
            : imagePickerField === "iconImage"
            ? widget?.type === "state"
              ? "State-Bild waehlen"
              : "Link-Icon waehlen"
            : widget?.type === "wallbox" || widget?.type === "goe"
              ? "Wallbox-Hintergrund waehlen"
              : (widget?.type === "heating" || widget?.type === "heatingV2")
                ? "Heizung-Hintergrund waehlen"
              : "Solar-Hintergrund waehlen"
        }
        helperText={
          imagePickerField === "cocoProfileImage"
            ? "Waehle ein rund zugeschnittenes Profilbild aus dem Ordner `assets/` oder lade ein neues Bild hoch."
            : imagePickerField === "iconImage"
            ? "Waehle eine Bilddatei aus dem Ordner `assets/`."
            : widget?.type === "wallbox" || widget?.type === "goe"
              ? "Waehle ein Hintergrundbild. Drag&Drop, Datei-Upload und Browser-Auswahl sind verfuegbar."
              : (widget?.type === "heating" || widget?.type === "heatingV2")
                ? "Waehle ein Hintergrundbild fuer das Heizungs-Widget. Drag&Drop und Datei-Upload sind verfuegbar."
              : "Verwendet den festen Ordner `assets/` im Adapter-Paket."
        }
        onClose={() => setImagePickerField(null)}
        onSelect={(entry) => {
          setDraft((current) => {
            if (imagePickerField === "cocoProfileImage") {
              return {
                ...current,
                profileImage: entry.name,
              };
            }
            if (imagePickerField === "iconImage") {
              return {
                ...current,
                iconImage: entry.name,
              };
            }
            if (widget?.type === "wallbox" || widget?.type === "goe") {
              return {
                ...current,
                backgroundImage: entry.name,
              };
            }
            if (widget?.type === "heating" || widget?.type === "heatingV2") {
              return {
                ...current,
                backgroundImage: entry.name,
              };
            }
            return {
              ...current,
              backgroundMode: "image",
              backgroundImage: entry.name,
            };
          });
          setImagePickerField(null);
        }}
        selectedName={
          imagePickerField === "cocoProfileImage"
            ? draft.profileImage
            : imagePickerField === "iconImage"
              ? draft.iconImage
              : draft.backgroundImage
        }
        visible={Boolean(imagePickerField)}
      />
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function EditorButtonPressable({
  children,
  onPress,
  style,
}: {
  children: React.ReactNode;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { config } = useDashboardConfig();

  return (
    <Pressable
      onPress={() => {
        playConfiguredUiSound(config.uiSounds?.pageSounds?.editorButton, "panel", "global:widgetEditorButtons");
        onPress();
      }}
      style={style}
    >
      {children}
    </Pressable>
  );
}

function ChoiceRow({
  options,
  value,
  onSelect,
}: {
  options: string[];
  value: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={styles.modeRow}>
      {options.map((option) => (
        <EditorButtonPressable
          key={option}
          onPress={() => onSelect(option)}
          style={[styles.modeButton, value === option ? styles.modeButtonActive : null]}
        >
          <Text style={styles.modeLabel}>{option}</Text>
        </EditorButtonPressable>
      ))}
    </View>
  );
}

function CheckboxChoice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const active = value !== "false";

  return (
    <EditorButtonPressable
      onPress={() => onChange(active ? "false" : "true")}
      style={[styles.checkboxChoice, active ? styles.checkboxChoiceActive : null]}
    >
      <MaterialCommunityIcons
        color={active ? palette.accent : palette.textMuted}
        name={active ? "checkbox-marked-outline" : "checkbox-blank-outline"}
        size={18}
      />
      <Text style={styles.checkboxChoiceLabel}>{label}</Text>
    </EditorButtonPressable>
  );
}

function StateFieldInput({
  value,
  onChangeText,
  onBrowse,
  browseLabel = "Objekt waehlen",
}: {
  value: string;
  onChangeText: (value: string) => void;
  onBrowse: () => void;
  browseLabel?: string;
}) {
  return (
    <View style={styles.stateFieldRow}>
      <TextInput autoCapitalize="none" onChangeText={onChangeText} style={[styles.input, styles.stateFieldInput]} value={value} />
      <EditorButtonPressable onPress={onBrowse} style={styles.stateBrowseButton}>
        <Text style={styles.stateBrowseLabel}>{browseLabel}</Text>
      </EditorButtonPressable>
    </View>
  );
}

function IconPickerRow({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={styles.iconPickerBlock}>
      <Text style={styles.iconPickerLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.iconPickerRow}>
          {stateIconOptions.map((option) => {
            const value = label === "Aktiv" ? option.active : option.inactive;
            const active = selected === value;

            return (
              <EditorButtonPressable
                key={`${label}-${option.label}`}
                onPress={() => onSelect(value)}
                style={[styles.iconChip, active ? styles.iconChipActive : null]}
              >
                <MaterialCommunityIcons
                  color={active ? "#08111f" : palette.text}
                  name={value}
                  size={18}
                />
                <Text style={[styles.iconChipLabel, active ? styles.iconChipLabelActive : null]}>{option.label}</Text>
              </EditorButtonPressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function MiniNumberField({
  label,
  fieldKey,
  draft,
  setDraft,
}: {
  label: string;
  fieldKey: string;
  draft: Record<string, string>;
  setDraft: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  return (
    <View style={styles.quadField}>
      <Text style={styles.quadLabel}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        keyboardType="decimal-pad"
        onChangeText={(value) => setDraft((current) => ({ ...current, [fieldKey]: value }))}
        style={[styles.input, styles.quadInput]}
        value={draft[fieldKey] || ""}
      />
    </View>
  );
}

function BlurControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.blurControlRow}>
      {Platform.OS === "web"
        ? createElement("input", {
            type: "range",
            min: 0,
            max: 24,
            step: 1,
            value,
            onChange: (event: { target: { value: string } }) => onChange(event.target.value),
            style: webRangeInputStyle,
          })
        : null}
      <TextInput
        keyboardType="numeric"
        onChangeText={onChange}
        style={[styles.input, styles.blurInput]}
        value={value}
      />
      <Text style={styles.blurSuffix}>px</Text>
    </View>
  );
}

function clampInt(raw: string | undefined, fallback: number, min: number) {
  const parsed = Number.parseInt(raw || "", 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.max(min, parsed);
}

function clampIntMax(raw: string | undefined, fallback: number, min: number, max: number) {
  return Math.min(max, clampInt(raw, fallback, min));
}

function clampFloat(raw: string | undefined, fallback: number) {
  const parsed = Number.parseFloat(raw || "");
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
}

function clampFloatRange(raw: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseFloat(raw || "");
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

const SOLAR_STAT_LIMIT = 6;
const SOLAR_DEFAULT_STAT_LABELS = [
  "Eigenverbrauch",
  "Verbraucht",
  "Stat 3",
  "Stat 4",
  "Stat 5",
  "Stat 6",
];

function clampSolarStatCount(raw: string | number | undefined, fallback = 2) {
  const parsed = typeof raw === "number" ? raw : Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed)) {
    return Math.max(1, Math.min(SOLAR_STAT_LIMIT, fallback));
  }
  return Math.max(1, Math.min(SOLAR_STAT_LIMIT, Math.round(parsed)));
}

function getSolarDefaultStatLabel(index: number) {
  return SOLAR_DEFAULT_STAT_LABELS[index] || `Stat ${index + 1}`;
}

function buildSolarStatEditorDraft(stats: Extract<WidgetConfig, { type: "solar" }>["stats"] | undefined) {
  const legacyCards = [stats?.first, stats?.second, stats?.third].filter(Boolean) as Array<{
    label: string;
    stateId?: string;
  }>;
  const sourceCards = Array.isArray(stats?.cards) && stats.cards.length ? stats.cards : legacyCards;
  const count = clampSolarStatCount(stats?.count, sourceCards.length || 2);
  const cards = Array.from({ length: SOLAR_STAT_LIMIT }, (_, index) => {
    const source = sourceCards[index];
    return {
      label: (source?.label || getSolarDefaultStatLabel(index)).trim() || getSolarDefaultStatLabel(index),
      stateId: (source?.stateId || "").trim(),
    };
  });

  return { count, cards };
}

function buildSolarStats(draft: Record<string, string>) {
  const count = clampSolarStatCount(draft.statCount);
  const cards = Array.from({ length: count }, (_, index) => {
    const item = index + 1;
    const label = (draft[`stat${item}Label`] || getSolarDefaultStatLabel(index)).trim() || getSolarDefaultStatLabel(index);
    const stateId = (draft[`stat${item}StateId`] || "").trim() || undefined;
    return { label, stateId };
  });

  return {
    count,
    cards,
    first: cards[0],
    second: cards[1],
    third: cards[2],
  };
}

function buildSolarTapAction(draft: Record<string, string>) {
  const tapType = draft.solarTapType;
  if (tapType === "dashboard") {
    const dashboardId = (draft.solarTapDashboardId || "").trim();
    if (!dashboardId) {
      return undefined;
    }
    return { type: "dashboard", dashboardId } as const;
  }
  if (tapType === "url") {
    const url = normalizeOptionalInput(draft.solarTapUrl);
    if (!url) {
      return undefined;
    }
    return { type: "url", url } as const;
  }
  return undefined;
}

function buildAppearanceDraft(
  widget: WidgetConfig,
  theme: ReturnType<typeof resolveThemeSettings>
) {
  const appearance = widget.appearance;
  const widgetDefaults = getWidgetAppearanceDefaults(widget, theme);

  return {
    widgetColor: appearance?.widgetColor || widgetDefaults.widgetColor || "",
    widgetColor2: appearance?.widgetColor2 || widgetDefaults.widgetColor2 || "",
    activeWidgetColor: appearance?.activeWidgetColor || "",
    activeWidgetColor2: appearance?.activeWidgetColor2 || "",
    inactiveWidgetColor: appearance?.inactiveWidgetColor || "",
    inactiveWidgetColor2: appearance?.inactiveWidgetColor2 || "",
    textColor: appearance?.textColor || widgetDefaults.textColor || "",
    mutedTextColor: appearance?.mutedTextColor || widgetDefaults.mutedTextColor || "",
    iconColor: appearance?.iconColor || widgetDefaults.iconColor || "",
    iconColor2: appearance?.iconColor2 || widgetDefaults.iconColor2 || "",
    cardColor: appearance?.cardColor || widgetDefaults.cardColor || "",
    cardColor2: appearance?.cardColor2 || widgetDefaults.cardColor2 || "",
    statColor: appearance?.statColor || widgetDefaults.statColor || "",
    statColor2: appearance?.statColor2 || widgetDefaults.statColor2 || "",
    pvCardColor: appearance?.pvCardColor || "",
    homeCardColor: appearance?.homeCardColor || "",
    batteryCardColor: appearance?.batteryCardColor || "",
    gridCardColor: appearance?.gridCardColor || "",
    carCardColor: appearance?.carCardColor || "",
  };
}

function buildAppearance(draft: Record<string, string>): WidgetAppearance | undefined {
  const appearance: WidgetAppearance = {
    widgetColor: normalizeColor(draft.widgetColor),
    widgetColor2: normalizeColor(draft.widgetColor2),
    activeWidgetColor: normalizeColor(draft.activeWidgetColor),
    activeWidgetColor2: normalizeColor(draft.activeWidgetColor2),
    inactiveWidgetColor: normalizeColor(draft.inactiveWidgetColor),
    inactiveWidgetColor2: normalizeColor(draft.inactiveWidgetColor2),
    textColor: normalizeColor(draft.textColor),
    mutedTextColor: normalizeColor(draft.mutedTextColor),
    iconColor: normalizeColor(draft.iconColor),
    iconColor2: normalizeColor(draft.iconColor2),
    cardColor: normalizeColor(draft.cardColor),
    cardColor2: normalizeColor(draft.cardColor2),
    statColor: normalizeColor(draft.statColor),
    statColor2: normalizeColor(draft.statColor2),
    pvCardColor: normalizeColor(draft.pvCardColor),
    homeCardColor: normalizeColor(draft.homeCardColor),
    batteryCardColor: normalizeColor(draft.batteryCardColor),
    gridCardColor: normalizeColor(draft.gridCardColor),
    carCardColor: normalizeColor(draft.carCardColor),
  };

  return Object.values(appearance).some(Boolean) ? appearance : undefined;
}

function normalizeColor(value: string | undefined) {
  const trimmed = (value || "").trim();
  return trimmed || undefined;
}

function getWidgetAppearanceDefaults(
  widget: WidgetConfig,
  theme: ReturnType<typeof resolveThemeSettings>
): WidgetAppearance {
  if (widget.type === "state") {
    return {
      widgetColor: theme.widgetTones.stateStart,
      widgetColor2: theme.widgetTones.stateEnd,
      textColor: palette.text,
      mutedTextColor: palette.textMuted,
      iconColor: palette.accent,
      iconColor2: palette.textMuted,
    };
  }

  if (widget.type === "camera" || widget.type === "cameraTalk" || widget.type === "cameraTalkReolink") {
    return {
      widgetColor: theme.widgetTones.cameraStart,
      widgetColor2: theme.widgetTones.cameraEnd,
      textColor: palette.text,
      mutedTextColor: palette.textMuted,
    };
  }

  if (widget.type === "energy") {
    return {
      widgetColor: theme.widgetTones.energyStart,
      widgetColor2: theme.widgetTones.energyEnd,
      textColor: palette.text,
      mutedTextColor: palette.textMuted,
      cardColor: "rgba(255,255,255,0.03)",
    };
  }

  if (widget.type === "grafana") {
    return {
      widgetColor: "rgba(13, 19, 35, 0.96)",
      widgetColor2: "rgba(15, 24, 46, 0.94)",
      textColor: palette.text,
      mutedTextColor: palette.textMuted,
    };
  }

  if (widget.type === "weather") {
    return {
      widgetColor: "#2a86db",
      widgetColor2: "#1d4ea9",
      textColor: palette.text,
      mutedTextColor: "rgba(230, 243, 255, 0.82)",
    };
  }

  if (widget.type === "numpad") {
    return {
      widgetColor: "#d8bea7",
      widgetColor2: "#ad7a52",
      textColor: "#1f1207",
      mutedTextColor: "#5b3d27",
      cardColor: "#040404",
      cardColor2: "#c79e7a",
    };
  }

  if (widget.type === "link" || widget.type === "netflix") {
    return {
      widgetColor: "rgba(18, 42, 78, 0.95)",
      widgetColor2: "rgba(10, 24, 46, 0.98)",
      textColor: palette.text,
      mutedTextColor: palette.textMuted,
      cardColor: "rgba(8, 18, 36, 0.72)",
      cardColor2: "rgba(24, 48, 86, 0.8)",
    };
  }

  if (widget.type === "log") {
    return {
      widgetColor: "rgba(11, 22, 44, 0.95)",
      widgetColor2: "rgba(6, 12, 25, 0.97)",
      textColor: palette.text,
      mutedTextColor: palette.textMuted,
      cardColor: "rgba(5, 9, 17, 0.7)",
      cardColor2: "rgba(16, 30, 56, 0.8)",
    };
  }

  if (widget.type === "script") {
    return {
      widgetColor: "rgba(20, 40, 76, 0.95)",
      widgetColor2: "rgba(8, 18, 38, 0.98)",
      textColor: palette.text,
      mutedTextColor: palette.textMuted,
      cardColor: "rgba(7, 14, 29, 0.72)",
      cardColor2: "rgba(20, 42, 82, 0.82)",
    };
  }

  if (widget.type === "host" || widget.type === "raspberryPiStats") {
    return {
      widgetColor: "rgba(15, 34, 66, 0.95)",
      widgetColor2: "rgba(8, 18, 36, 0.98)",
      textColor: palette.text,
      mutedTextColor: palette.textMuted,
      cardColor: "#6ce8b4",
      cardColor2: "rgba(255,255,255,0.12)",
      pvCardColor: "#73b9ff",
      homeCardColor: "rgba(255,255,255,0.12)",
      activeWidgetColor: "#65d6ff",
      activeWidgetColor2: "#4d86ff",
      inactiveWidgetColor: "#ffcb67",
      inactiveWidgetColor2: "#ff7f66",
      statColor: "rgba(130, 182, 255, 0.24)",
      statColor2: "rgba(89, 132, 238, 0.18)",
    };
  }

  if (widget.type === "wallbox" || widget.type === "goe") {
    return {
      widgetColor: "rgba(20, 30, 44, 0.96)",
      widgetColor2: "rgba(12, 18, 30, 0.98)",
      textColor: "#f5f8ff",
      mutedTextColor: "rgba(214, 224, 244, 0.75)",
      cardColor: "rgba(166, 176, 194, 0.2)",
      cardColor2: "rgba(123, 135, 158, 0.2)",
      activeWidgetColor: "#3bbd83",
      activeWidgetColor2: "#2f976c",
      statColor: "#5f9eff",
      statColor2: "#4578e6",
      iconColor: "#7eb9ff",
      iconColor2: "#5f8cf0",
      inactiveWidgetColor: "#f5bd6c",
      inactiveWidgetColor2: "#e69b56",
    };
  }

  if (widget.type === "coco") {
    return {
      widgetColor: "rgba(20, 30, 44, 0.96)",
      widgetColor2: "rgba(10, 16, 27, 0.98)",
      textColor: "#f5f8ff",
      mutedTextColor: "rgba(214, 224, 244, 0.76)",
      cardColor: "rgba(255,255,255,0.05)",
      activeWidgetColor: "#58d68d",
      inactiveWidgetColor: "#f2bd66",
      iconColor: "#7eb9ff",
    };
  }

  if (widget.type === "heating" || widget.type === "heatingV2") {
    return {
      widgetColor: "rgba(18, 28, 42, 0.96)",
      widgetColor2: "rgba(10, 16, 27, 0.98)",
      textColor: "#f5f8ff",
      mutedTextColor: "rgba(214, 224, 244, 0.78)",
      cardColor: "rgba(255,255,255,0.035)",
      iconColor: "#79b5ff",
      iconColor2: "#5a85ef",
      activeWidgetColor: "#f6c869",
      activeWidgetColor2: "#4ed09a",
      statColor: "#7fb9ff",
    };
  }

  return {
    widgetColor: theme.widgetTones.solarStart,
    widgetColor2: theme.widgetTones.solarEnd,
    textColor: palette.text,
    mutedTextColor: palette.textMuted,
    cardColor: theme.solar.nodeCardBackground,
    statColor: theme.solar.statCardBackground,
  };
}

function applyObjectSelection(
  fieldKey: string | null,
  objectId: string,
  draft: Record<string, string>,
  onChange: Dispatch<SetStateAction<Record<string, string>>>
) {
  if (!fieldKey) {
    return;
  }

  if (fieldKey === "statePrefix") {
    const segments = objectId.split(".");
    const prefix = segments.slice(0, -1).join(".");
    onChange((current) => ({ ...current, statePrefix: prefix || objectId }));
    return;
  }

  if (fieldKey.startsWith("key")) {
    const prefix = (draft.statePrefix || "").trim();
    const nextValue = prefix && objectId.startsWith(`${prefix}.`) ? objectId.slice(prefix.length + 1) : objectId.split(".").pop() || objectId;
    onChange((current) => ({ ...current, [fieldKey]: nextValue }));
    return;
  }

  onChange((current) => ({ ...current, [fieldKey]: objectId }));
}

function resolveMappedStateId(sourceStateId: string | undefined, fromSegment: string, toSegment: string) {
  const source = (sourceStateId || "").trim();
  if (!source) {
    return "";
  }
  if (!source.includes(fromSegment)) {
    return "";
  }
  return source.replace(fromSegment, toSegment);
}

function resolveLegacyEmergencyStopFromSecondary(secondaryStateId: string | undefined, allowChargingStateId: string | undefined) {
  const secondary = (secondaryStateId || "").trim();
  if (!secondary) {
    return "";
  }
  const allowCharging = (allowChargingStateId || "").trim();
  if (allowCharging && secondary === allowCharging) {
    return "";
  }
  return secondary;
}

function ColorInputRow({
  firstKey,
  firstLabel,
  secondKey,
  secondLabel,
  values,
  onChange,
}: {
  firstKey: string;
  firstLabel: string;
  secondKey: string;
  secondLabel: string;
  values: Record<string, string>;
  onChange: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  return (
    <View style={styles.splitRow}>
      <ColorField
        label={firstLabel}
        value={values[firstKey] || ""}
        onChange={(value) => onChange((current) => ({ ...current, [firstKey]: value }))}
      />
      <ColorField
        label={secondLabel}
        value={values[secondKey] || ""}
        onChange={(value) => onChange((current) => ({ ...current, [secondKey]: value }))}
      />
    </View>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const previewColor = toColorPreview(value) || "#8892a6";

  return (
    <Field label={label}>
      <View style={styles.colorFieldWrap}>
        {Platform.OS === "web"
          ? createElement("input", {
              type: "color",
              value: previewColor,
              onChange: (event: { target: { value: string } }) => onChange(event.target.value),
              style: webColorInputStyle,
            })
          : null}
        <View style={[styles.colorSwatch, { backgroundColor: value || previewColor }]} />
        <TextInput
          autoCapitalize="none"
          onChangeText={onChange}
          placeholder="#4ade80"
          placeholderTextColor={palette.textMuted}
          style={[styles.input, styles.colorTextInput]}
          value={value}
        />
        <EditorButtonPressable onPress={() => onChange("transparent")} style={styles.colorActionButton}>
          <Text style={styles.colorActionLabel}>Transparent</Text>
        </EditorButtonPressable>
        <EditorButtonPressable onPress={() => onChange("")} style={styles.colorActionButton}>
          <Text style={styles.colorActionLabel}>Reset</Text>
        </EditorButtonPressable>
      </View>
    </Field>
  );
}

function isHexColor(value: string) {
  return /^#([0-9a-fA-F]{6})$/.test(value);
}

function toColorPreview(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (isHexColor(trimmed)) {
    return trimmed;
  }

  const rgbMatch = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(\d*\.?\d+))?\s*\)$/i
  );
  if (!rgbMatch) {
    return null;
  }

  const r = clampChannel(Number(rgbMatch[1]));
  const g = clampChannel(Number(rgbMatch[2]));
  const b = clampChannel(Number(rgbMatch[3]));

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Number.isFinite(value) ? value : 0));
}

function toHex(value: number) {
  return value.toString(16).padStart(2, "0");
}

function normalizeStateFormat(raw: string | undefined) {
  if (raw === "number" || raw === "text") {
    return raw;
  }
  return "boolean";
}

function normalizeWallboxValueType(raw: string | undefined, fallback: "boolean" | "number" | "string") {
  if (raw === "boolean" || raw === "string") {
    return raw;
  }
  if (raw === "number") {
    return "number";
  }
  return fallback;
}

function normalizeLogSeverity(raw: string | undefined) {
  if (raw === "silly" || raw === "debug" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function normalizeCameraSourceMode(raw: string | undefined) {
  if (raw === "mjpeg" || raw === "flv" || raw === "fmp4" || raw === "webrtc") {
    return raw;
  }
  return "snapshot";
}

function normalizeCocoFullscreenMediaMode(raw: string | undefined) {
  if (raw === "mjpeg" || raw === "flv" || raw === "video" || raw === "iframe") {
    return raw;
  }
  return "snapshot";
}

function getCameraUrlByMode(
  draft: Record<string, string>,
  mode: "snapshot" | "mjpeg" | "flv" | "fmp4" | "webrtc",
  scope: "preview" | "fullscreen" = "preview"
) {
  const suffix = scope === "fullscreen" ? "fullscreen" : "preview";
  if (mode === "snapshot") {
    return suffix === "fullscreen" ? draft.fullscreenSnapshotUrl || "" : draft.snapshotUrl || "";
  }
  if (mode === "mjpeg") {
    return suffix === "fullscreen" ? draft.fullscreenMjpegUrl || "" : draft.mjpegUrl || "";
  }
  if (mode === "flv") {
    return suffix === "fullscreen" ? draft.fullscreenFlvUrl || "" : draft.flvUrl || "";
  }
  if (mode === "webrtc") {
    return draft.fullscreenWebrtcUrl || "";
  }
  return suffix === "fullscreen" ? draft.fullscreenFmp4Url || "" : draft.fmp4Url || "";
}

function setCameraUrlByMode(
  draft: Record<string, string>,
  mode: "snapshot" | "mjpeg" | "flv" | "fmp4" | "webrtc",
  value: string,
  scope: "preview" | "fullscreen" = "preview"
) {
  const suffix = scope === "fullscreen" ? "fullscreen" : "preview";
  if (mode === "snapshot") {
    return suffix === "fullscreen" ? { ...draft, fullscreenSnapshotUrl: value } : { ...draft, snapshotUrl: value };
  }
  if (mode === "mjpeg") {
    return suffix === "fullscreen" ? { ...draft, fullscreenMjpegUrl: value } : { ...draft, mjpegUrl: value };
  }
  if (mode === "flv") {
    return suffix === "fullscreen" ? { ...draft, fullscreenFlvUrl: value } : { ...draft, flvUrl: value };
  }
  if (mode === "webrtc") {
    return { ...draft, fullscreenWebrtcUrl: value };
  }
  return suffix === "fullscreen" ? { ...draft, fullscreenFmp4Url: value } : { ...draft, fmp4Url: value };
}

function normalizeOptionalInput(value: string | undefined) {
  const normalized = (value || "").trim();
  return normalized || undefined;
}

function normalizeRaspberryDataUnit(
  raw: string | undefined,
  fallback: "auto" | "B" | "kB" | "MB" | "GB" | "percent"
) {
  if (raw === "auto" || raw === "B" || raw === "kB" || raw === "MB" || raw === "GB" || raw === "percent") {
    return raw;
  }
  return fallback;
}

function normalizeHeatingOneTimeIcon(value: string | undefined) {
  const normalized = (value || "").trim();
  if (!normalized) {
    return "shower-head";
  }
  if (normalized === "flash" || normalized === "flash-outline") {
    return "shower-head";
  }
  return normalized;
}

function normalizeAddonMode(raw: string | undefined) {
  if (raw === "circle" || raw === "text" || raw === "icon" || raw === "bars") {
    return raw;
  }
  return "none";
}

function normalizeIconImageCrop(raw: string | undefined) {
  if (raw === "rounded" || raw === "circle") {
    return raw;
  }
  return "none";
}

function normalizeIconImageSizeMode(raw: string | undefined) {
  if (raw === "maximized") {
    return raw;
  }
  return "standard";
}

function parseValueLabels(raw: string | undefined) {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const pairs = Object.entries(parsed).filter(
      ([key, value]) => typeof key === "string" && typeof value === "string"
    );

    if (!pairs.length) {
      return undefined;
    }

    const result: Record<string, string> = {};
    pairs.forEach(([key, value]) => {
      result[key] = value as string;
    });

    return result;
  } catch {
    return undefined;
  }
}

function buildStoredInteractionSounds(
  widgetType: WidgetConfig["type"],
  draft: Record<string, string[]>,
  defaults?: WidgetInteractionSounds
) {
  if (
    widgetType !== "state" &&
    widgetType !== "camera" &&
    widgetType !== "grafana" &&
    widgetType !== "numpad" &&
    widgetType !== "link" &&
    widgetType !== "netflix" &&
    widgetType !== "log" &&
    widgetType !== "script" &&
    widgetType !== "wallbox" &&
    widgetType !== "goe" &&
    widgetType !== "heating" &&
    widgetType !== "heatingV2"
  ) {
    return undefined;
  }

  const next: WidgetInteractionSounds = {};
  const press = normalizeSoundSelection(draft.press);
  const confirm = normalizeSoundSelection(draft.confirm);
  const slider = normalizeSoundSelection(draft.slider);
  const open = normalizeSoundSelection(draft.open);
  const close = normalizeSoundSelection(draft.close);
  const scroll = normalizeSoundSelection(draft.scroll);
  const notify = normalizeSoundSelection(draft.notify);
  const notifyWarn = normalizeSoundSelection(draft.notifyWarn);
  const notifyError = normalizeSoundSelection(draft.notifyError);

  if (!areSoundSelectionsEqual(press, defaults?.press)) {
    next.press = press;
  }
  if (!areSoundSelectionsEqual(confirm, defaults?.confirm)) {
    next.confirm = confirm;
  }
  if (!areSoundSelectionsEqual(slider, defaults?.slider)) {
    next.slider = slider;
  }
  if (!areSoundSelectionsEqual(open, defaults?.open)) {
    next.open = open;
  }
  if (!areSoundSelectionsEqual(close, defaults?.close)) {
    next.close = close;
  }
  if (!areSoundSelectionsEqual(scroll, defaults?.scroll)) {
    next.scroll = scroll;
  }
  if (!areSoundSelectionsEqual(notify, defaults?.notify)) {
    next.notify = notify;
  }
  if (!areSoundSelectionsEqual(notifyWarn, defaults?.notifyWarn)) {
    next.notifyWarn = notifyWarn;
  }
  if (!areSoundSelectionsEqual(notifyError, defaults?.notifyError)) {
    next.notifyError = notifyError;
  }

  return Object.keys(next).length ? next : undefined;
}

function areSoundSelectionsEqual(left?: string[], right?: string[]) {
  const normalizedLeft = normalizeSoundSelection(left);
  const normalizedRight = normalizeSoundSelection(right);

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function resolveDraftSoundValue(primary?: string[], fallback?: string[]) {
  const normalizedPrimary = normalizeSoundSelection(primary);
  if (normalizedPrimary.length) {
    return normalizedPrimary;
  }

  return normalizeSoundSelection(fallback);
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    padding: 22,
  },
  card: {
    maxHeight: "85%",
    borderRadius: 22,
    padding: 18,
    backgroundColor: palette.panelStrong,
    borderWidth: 1,
    borderColor: palette.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  title: {
    color: palette.text,
    fontSize: 22,
    fontWeight: "800",
  },
  close: {
    color: palette.textMuted,
    fontWeight: "600",
  },
  field: {
    gap: 6,
    marginBottom: 12,
  },
  sectionTitle: {
    marginTop: 4,
    marginBottom: 8,
    color: palette.text,
    fontSize: 14,
    fontWeight: "800",
  },
  groupCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.025)",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    marginBottom: 8,
  },
  groupTitle: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 8,
  },
  splitRow: {
    flexDirection: "row",
    gap: 10,
  },
  stateFieldRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  stateFieldInput: {
    flex: 1,
  },
  stateBrowseButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(92, 124, 255, 0.22)",
    backgroundColor: "rgba(92, 124, 255, 0.12)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  stateBrowseLabel: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "700",
  },
  weatherSuggestionList: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(255,255,255,0.03)",
    overflow: "hidden",
  },
  weatherSuggestionItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
    gap: 2,
  },
  weatherSuggestionLabel: {
    color: palette.text,
    fontWeight: "700",
  },
  weatherSuggestionMeta: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  inlineActionButton: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(92, 124, 255, 0.24)",
    backgroundColor: "rgba(92, 124, 255, 0.12)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  inlineActionLabel: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  iconPreviewRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  iconPreviewCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(255,255,255,0.03)",
    padding: 10,
    alignItems: "center",
    gap: 6,
  },
  iconPreviewLabel: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  iconPickerBlock: {
    gap: 6,
    marginBottom: 10,
  },
  iconPickerLabel: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  iconPickerRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 2,
  },
  iconChip: {
    minWidth: 88,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(255,255,255,0.03)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center",
    gap: 6,
  },
  iconChipActive: {
    backgroundColor: palette.accent,
    borderColor: "rgba(92,124,255,0.4)",
  },
  iconChipLabel: {
    color: palette.text,
    fontSize: 11,
    fontWeight: "700",
  },
  iconChipLabelActive: {
    color: "#08111f",
  },
  mappingHint: {
    marginTop: -2,
    marginBottom: 10,
    color: palette.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  mappingEditor: {
    minHeight: 110,
  },
  blurControlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  blurInput: {
    width: 74,
  },
  blurSuffix: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  quadRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  quadField: {
    flex: 1,
  },
  quadLabel: {
    color: palette.textMuted,
    fontSize: 12,
    marginBottom: 6,
  },
  quadInput: {
    minWidth: 0,
  },
  layoutRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  layoutStepperGrid: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 8,
  },
  fieldLabel: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.text,
    backgroundColor: "rgba(6, 12, 20, 0.9)",
    borderWidth: 1,
    borderColor: palette.border,
  },
  disabledInput: {
    opacity: 0.55,
  },
  colorFieldWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  colorSwatch: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  colorTextInput: {
    flex: 1,
  },
  colorActionButton: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: palette.border,
  },
  colorActionLabel: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "700",
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  modeButton: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: palette.border,
  },
  modeButtonActive: {
    backgroundColor: "rgba(77, 226, 177, 0.12)",
    borderColor: "rgba(77, 226, 177, 0.3)",
  },
  modeLabel: {
    color: palette.text,
    fontWeight: "700",
  },
  checkboxChoice: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkboxChoiceActive: {
    borderColor: "rgba(92,124,255,0.38)",
    backgroundColor: "rgba(92,124,255,0.12)",
  },
  checkboxChoiceLabel: {
    color: palette.text,
    fontWeight: "700",
    fontSize: 12,
  },
  footer: {
    marginTop: 8,
    alignItems: "flex-end",
  },
  saveButton: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: palette.accent,
  },
  saveLabel: {
    color: "#041019",
    fontWeight: "800",
  },
});

const webColorInputStyle = {
  width: 42,
  height: 42,
  padding: 0,
  border: "none",
  borderRadius: 10,
  background: "transparent",
  cursor: "pointer",
};

const webRangeInputStyle = {
  flex: 1,
  accentColor: palette.accent,
  cursor: "pointer",
};
