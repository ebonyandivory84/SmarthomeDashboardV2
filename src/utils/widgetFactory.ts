import { WidgetConfig, WidgetType } from "../types/dashboard";

type GridSettings = {
  columns: number;
};

export function buildWidgetTemplate(
  type: WidgetType,
  count: number,
  grid: GridSettings
): WidgetConfig {
  const suffix = count + 1;
  const basePosition = {
    x: 0,
    y: count + 2,
    w:
      type === "camera"
        ? 6
        : type === "cameraTalk"
        ? 6
        : type === "cameraTalkReolink"
        ? 6
        : type === "solar"
          ? 8
            : type === "grafana"
              ? 6
              : type === "log"
                ? 6
                : type === "script"
                  ? 6
                    : type === "host"
                      ? 6
                    : type === "raspberryPiStats"
                      ? 6
                    : type === "coco"
                      ? 6
                    : type === "wallbox" || type === "goe"
                      ? 6
                    : type === "heating" || type === "heatingV2"
                      ? 6
                    : type === "weather"
                      ? 4
                : type === "numpad"
                  ? 6
                : type === "netflix"
                  ? 3
                : 3,
    h:
      type === "camera"
        ? 4
        : type === "cameraTalk"
        ? 4
        : type === "cameraTalkReolink"
        ? 4
        : type === "solar"
          ? 4
          : type === "energy"
            ? 3
            : type === "grafana"
              ? 4
              : type === "log"
                ? 3
                : type === "script"
                  ? 3
                    : type === "host"
                      ? 3
                      : type === "raspberryPiStats"
                        ? 3
                      : type === "coco"
                        ? 3
                      : type === "wallbox" || type === "goe"
                        ? 3
                        : type === "heating" || type === "heatingV2"
                          ? 3
                      : type === "weather"
                        ? 3
                : type === "numpad"
                  ? 4
                : type === "netflix"
                  ? 2
                : 2,
  };

  if (type === "state") {
    return {
      id: `state-${suffix}`,
      type: "state",
      title: `Schalter ${suffix}`,
      stateId: `0_userdata.0.widgets.state_${suffix}`,
      writeable: true,
      onLabel: "Ein",
      offLabel: "Aus",
      activeValue: "true",
      inactiveValue: "false",
      iconPair: {
        active: "toggle-switch",
        inactive: "toggle-switch-off-outline",
      },
      position: basePosition,
    };
  }

  if (type === "camera") {
    return {
      id: `camera-${suffix}`,
      type: "camera",
      title: `Kamera ${suffix}`,
      titleFontSize: 14,
      previewSourceMode: "snapshot",
      fullscreenSourceMode: "fmp4",
      snapshotUrl: "",
      mjpegUrl: "",
      flvUrl: "",
      fmp4Url: "",
      refreshMs: 2000,
      audioEnabled: false,
      position: {
        ...basePosition,
        w: Math.min(6, grid.columns),
      },
    };
  }

  if (type === "cameraTalk") {
    return {
      id: `camera-talk-${suffix}`,
      type: "cameraTalk",
      title: `INSTAR Cam ${suffix}`,
      titleFontSize: 14,
      previewSourceMode: "snapshot",
      fullscreenSourceMode: "webrtc",
      snapshotUrl: "",
      mjpegUrl: "",
      flvUrl: "",
      fmp4Url: "",
      refreshMs: 2000,
      audioEnabled: false,
      talkbackWebrtcUrl: "",
      talkbackPushToTalk: true,
      talkbackAutoEnableVideo: false,
      instarTalkbackEnabled: false,
      instarBaseUrl: "",
      instarUsername: "",
      instarPassword: "",
      position: {
        ...basePosition,
        w: Math.min(6, grid.columns),
      },
    };
  }

  if (type === "cameraTalkReolink") {
    return {
      id: `camera-talk-reolink-${suffix}`,
      type: "cameraTalkReolink",
      title: `Reolink Cam ${suffix}`,
      titleFontSize: 14,
      previewSourceMode: "snapshot",
      fullscreenSourceMode: "webrtc",
      snapshotUrl: "",
      mjpegUrl: "",
      flvUrl: "",
      fmp4Url: "",
      refreshMs: 2000,
      audioEnabled: false,
      talkbackWebrtcUrl: "",
      talkbackPushToTalk: true,
      talkbackAutoEnableVideo: false,
      reolinkTalkbackEnabled: true,
      reolinkBaseUrl: "",
      reolinkUsername: "",
      reolinkPassword: "",
      reolinkChannel: 0,
      position: {
        ...basePosition,
        w: Math.min(6, grid.columns),
      },
    };
  }

  if (type === "energy") {
    return {
      id: `energy-${suffix}`,
      type: "energy",
      title: `Energie ${suffix}`,
      pvStateId: `0_userdata.0.energy_${suffix}.pv`,
      houseStateId: `0_userdata.0.energy_${suffix}.house`,
      batteryStateId: `0_userdata.0.energy_${suffix}.battery`,
      gridStateId: `0_userdata.0.energy_${suffix}.grid`,
      position: {
        ...basePosition,
        w: Math.min(6, grid.columns),
      },
    };
  }

  if (type === "grafana") {
    return {
      id: `grafana-${suffix}`,
      type: "grafana",
      title: `Grafana ${suffix}`,
      url: "http://127.0.0.1:3000/d/example/example?viewPanel=1&kiosk",
      refreshMs: 60000,
      allowInteractions: true,
      position: {
        ...basePosition,
        w: Math.min(6, grid.columns),
      },
    };
  }

  if (type === "weather") {
    return {
      id: `weather-${suffix}`,
      type: "weather",
      title: `Wetter ${suffix}`,
      locationName: "Zuhause",
      locationQuery: "",
      latitude: 52.52,
      longitude: 13.41,
      timezone: "auto",
      refreshMs: 300000,
      position: {
        ...basePosition,
        w: Math.min(4, grid.columns),
      },
    };
  }

  if (type === "numpad") {
    return {
      id: `numpad-${suffix}`,
      type: "numpad",
      title: `Numpad ${suffix}`,
      position: {
        ...basePosition,
        w: Math.min(6, grid.columns),
      },
    };
  }

  if (type === "link") {
    return {
      id: `link-${suffix}`,
      type: "link",
      title: `Link ${suffix}`,
      url: "",
      position: {
        ...basePosition,
      },
    };
  }

  if (type === "netflix") {
    return {
      id: `netflix-${suffix}`,
      type: "netflix",
      title: `Netflix ${suffix}`,
      url: "https://www.netflix.com/browse",
      iconImage: "",
      position: {
        ...basePosition,
      },
    };
  }

  if (type === "log") {
    return {
      id: `log-${suffix}`,
      type: "log",
      title: `Log ${suffix}`,
      refreshMs: 2000,
      maxEntries: 80,
      minSeverity: "info",
      sourceFilter: "",
      textFilter: "",
      position: {
        ...basePosition,
        w: Math.min(6, grid.columns),
      },
    };
  }

  if (type === "script") {
    return {
      id: `script-${suffix}`,
      type: "script",
      title: `Skripte ${suffix}`,
      refreshMs: 3000,
      maxEntries: 120,
      instanceFilter: "",
      textFilter: "",
      position: {
        ...basePosition,
        w: Math.min(6, grid.columns),
      },
    };
  }

  if (type === "host") {
    return {
      id: `host-${suffix}`,
      type: "host",
      title: `Host ${suffix}`,
      refreshMs: 5000,
      hostLabel: "",
      position: {
        ...basePosition,
        w: Math.min(6, grid.columns),
      },
    };
  }

  if (type === "raspberryPiStats") {
    return {
      id: `raspberry-pi-stats-${suffix}`,
      type: "raspberryPiStats",
      title: `Raspberry-Pi Stats ${suffix}`,
      label: "NAS Pi",
      cpuTempStateId: "0_userdata.0.NAS-pi.cpuTemp",
      cpuLoadStateId: "0_userdata.0.NAS-pi.cpuLoad",
      ramFreeStateId: "0_userdata.0.NAS-pi.ramFreePercent",
      ramFreeUnit: "percent",
      diskFreeStateId: "0_userdata.0.NAS-pi.diskFreePercent",
      diskFreeUnit: "percent",
      onlineStateId: "0_userdata.0.NAS-pi.online",
      position: {
        ...basePosition,
        w: Math.min(6, grid.columns),
      },
    };
  }

  if (type === "coco") {
    return {
      id: `coco-${suffix}`,
      type: "coco",
      title: "Coco",
      catName: "Coco",
      profileImage: "coco-face.webp",
      refreshMs: 30000,
      insideStateId: "sureflap.0.Home.pets.Coco.inside",
      lastDirectionStateId: "sureflap.0.Home.pets.Coco.movement.last_direction",
      lastFlapStateId: "sureflap.0.Home.pets.Coco.movement.last_flap",
      lastTimeStateId: "sureflap.0.Home.pets.Coco.movement.last_time",
      timesOutsideStateId: "sureflap.0.Home.pets.Coco.movement.times_outside",
      timeSpentOutsideStateId: "sureflap.0.Home.pets.Coco.movement.time_spent_outside",
      flapBatteryStateId: "sureflap.0.Home.Coco.Coco_Klappe.battery_percentage",
      flapOnlineStateId: "sureflap.0.Home.Coco.Coco_Klappe.online",
      hubOnlineStateId: "sureflap.0.Home.Coco.online",
      adapterConnectedStateId: "sureflap.0.info.connection",
      allDevicesOnlineStateId: "sureflap.0.info.all_devices_online",
      offlineDevicesStateId: "sureflap.0.info.offline_devices",
      lockModeStateId: "",
      lockWriteStateId: "",
      lockValueType: "number",
      lockUnlockedValue: "0",
      lockInOnlyValue: "1",
      lockOutOnlyValue: "2",
      lockLockedValue: "3",
      snapshotUrl: "",
      streamUrl: "",
      fullscreenMediaMode: "snapshot",
      position: {
        ...basePosition,
        w: Math.min(6, grid.columns),
      },
    };
  }

  if (type === "wallbox" || type === "goe") {
    const isGoE = type === "goe";
    return {
      id: `${isGoE ? "goe" : "wallbox"}-${suffix}`,
      type,
      title: `${isGoE ? "go-e" : "Wallbox"} ${suffix}`,
      refreshMs: 2000,
      showStatusSubtitle: false,
      showGridAmpereControl: true,
      targetMode: "soc",
      highlightOpacity: 0.32,
      backgroundImage: "",
      backgroundImageBlur: 8,
      stopWriteStateId: "go-e-gemini-adapter.0.control.allowCharging",
      stopSecondaryWriteStateId: "",
      stopStateId: "go-e-gemini-adapter.0.status.effectiveAllowCharging",
      pvWriteStateId: "go-e-gemini-adapter.0.control.mode",
      pvStateId: "go-e-gemini-adapter.0.status.activeMode",
      pvPriorityWriteStateId: "go-e-gemini-adapter.0.control.mode",
      pvPriorityStateId: "go-e-gemini-adapter.0.status.activeMode",
      gridWriteStateId: "go-e-gemini-adapter.0.control.mode",
      gridStateId: "go-e-gemini-adapter.0.status.activeMode",
      manualCurrentWriteStateId: "go-e-gemini-adapter.0.control.gridManual.currentA",
      manualCurrentStateId: "go-e-gemini-adapter.0.status.setCurrentA",
      ampereCardsWriteStateId: "go-e-gemini-adapter.0.control.gridManual.currentA",
      ampereCardsStateId: "go-e-gemini-adapter.0.status.setCurrentA",
      phaseCardsWriteStateId: "go-e-gemini-adapter.0.control.gridManual.phaseMode",
      phaseCardsStateId: "go-e-gemini-adapter.0.status.targetPhaseMode",
      stopWriteValueType: "boolean",
      stopWriteValue: "",
      stopSecondaryWriteValueType: "boolean",
      stopSecondaryWriteValue: "",
      stopStateValueType: "boolean",
      stopStateValue: "",
      pvWriteValueType: "number",
      pvWriteValue: "1",
      pvStateValueType: "string",
      pvStateValue: "pv only",
      pvPriorityWriteValueType: "number",
      pvPriorityWriteValue: "2",
      pvPriorityStateValueType: "string",
      pvPriorityStateValue: "pv only (go-e = priority)",
      gridWriteValueType: "number",
      gridWriteValue: "3",
      gridStateValueType: "string",
      gridStateValue: "grid mode",
      manualCurrentWriteValueType: "number",
      manualCurrentStateValueType: "number",
      ampereCardsWriteValueType: "number",
      ampereCardsStateValueType: "number",
      ampere6WriteValue: "6",
      ampere10WriteValue: "10",
      ampere12WriteValue: "12",
      ampere14WriteValue: "14",
      ampere16WriteValue: "16",
      ampere6StateValue: "6",
      ampere10StateValue: "10",
      ampere12StateValue: "12",
      ampere14StateValue: "14",
      ampere16StateValue: "16",
      phaseCardsWriteValueType: "number",
      phaseCardsStateValueType: "number",
      phase1WriteValue: "1",
      phase3WriteValue: "2",
      phase1StateValue: "1",
      phase3StateValue: "2",
      targetChargeValueType: "number",
      modeStateId: "go-e-gemini-adapter.0.control.mode",
      gridAmpereStateId: "go-e-gemini-adapter.0.control.gridManual.currentA",
      limit80StateId: "go-e-gemini-adapter.0.control.targetSocPercent",
      targetSocAutoApiStateId: "bmw.0.WBY11CF080CP51905.stream.vehicle.drivetrain.batteryManagement.maxEnergy.value",
      targetKmStateId: "",
      allowChargingStateId: "go-e-gemini-adapter.0.control.allowCharging",
      emergencyStopStateId: "go-e-gemini-adapter.0.control.emergencyStop",
      solarLoadOnlyStateId: "",
      phaseSwitchModeStateId: "go-e-gemini-adapter.0.control.gridManual.phaseMode",
      phaseSwitchModeEnabledStateId: "go-e-gemini-adapter.0.status.enabledPhases",
      ampereStateId: "go-e-gemini-adapter.0.status.setCurrentA",
      carStateId: "go-e-gemini-adapter.0.status.carState",
      batterySocStateId: "go-e-gemini-adapter.0.status.carSocPercent",
      carRangeStateId: "",
      chargePowerStateId: "go-e-gemini-adapter.0.status.chargerPowerW",
      chargedEnergyStateId: "go-e.0.eto",
      stopChargeingAtCarSoc80StateId: "go-e-gemini-adapter.0.control.targetSocEnabled",
      position: {
        ...basePosition,
        w: Math.min(6, grid.columns),
      },
    };
  }

  if (type === "heating" || type === "heatingV2") {
    const isV2 = type === "heatingV2";
    return {
      id: isV2 ? `heating-v2-${suffix}` : `heating-${suffix}`,
      type,
      title: isV2 ? `Heizung V2 ${suffix}` : `Heizung ${suffix}`,
      refreshMs: 3000,
      showStatusSubtitle: true,
      detailsTickerSpeedPxPerS: 46,
      backgroundImage: "",
      backgroundImageBlur: 8,
      modeSetStateId: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.modes.active.commands.setMode.setValue",
      modeValueStateId: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.modes.active.properties.value.value",
      activeProgramStateId: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.active.properties.value.value",
      normalSetTempStateId: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.normal.commands.setTemperature.setValue",
      reducedSetTempStateId: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.reduced.commands.setTemperature.setValue",
      comfortSetTempStateId: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.comfort.commands.setTemperature.setValue",
      dhwSetTempStateId: "viessmannapi.0.299550.0.features.heating.dhw.temperature.main.commands.setTargetTemperature.setValue",
      comfortActivateStateId: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.comfort.commands.activate.setValue",
      comfortDeactivateStateId: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.comfort.commands.deactivate.setValue",
      ecoSetActiveStateId: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.programs.eco.commands.setActive.setValue",
      oneTimeChargeSetActiveStateId: "viessmannapi.0.299550.0.features.heating.dhw.oneTimeCharge.commands.setActive.setValue",
      oneTimeChargeActiveStateId: "viessmannapi.0.299550.0.features.heating.dhw.oneTimeCharge.properties.active.value",
      heatingModeActiveStateId: "viessmannapi.0.299550.0.features.heating.circuits.1.operating.modes.active.properties.value.value",
      dhwChargingActiveStateId: "viessmannapi.0.299550.0.features.heating.dhw.charging.properties.active.value",
      dhwChargingProgramStateId: "viessmannapi.0.299550.0.features.heating.dhw.temperature.main.commands.setTargetTemperature.setValue",
      boostBlinkActiveStateId: "viessmannapi.0.299550.0.features.heating.dhw.oneTimeCharge.properties.active.value",
      ventilationAutoSetActiveStateId: "",
      ventilationAutoActiveStateId: "",
      ventilationLevelSetStateId: "",
      ventilationLevelStateId: "",
      roomTempStateId: "viessmannapi.0.299550.0.features.heating.circuits.1.temperature.properties.value.value",
      heatingTempStateId: "viessmannapi.0.299550.0.features.heating.circuits.1.temperature.properties.value.value",
      supplyTempStateId: "viessmannapi.0.299550.0.features.heating.circuits.1.sensors.temperature.supply.properties.value.value",
      outsideTempStateId: "viessmannapi.0.299550.0.features.heating.sensors.temperature.outside.properties.value.value",
      returnTempStateId: "viessmannapi.0.299550.0.features.heating.sensors.temperature.return.properties.value.value",
      dhwTempStateId: "viessmannapi.0.299550.0.features.heating.dhw.sensors.temperature.dhwCylinder.properties.value.value",
      compressorPowerStateId: "viessmannapi.0.299550.0.features.heating.compressors.0.power.properties.value.value",
      compressorSensorPowerStateId: "viessmannapi.0.299550.0.features.heating.compressors.0.sensors.power.properties.value.value",
      showInfoProgram: true,
      showInfoTargets: true,
      showInfoOutsideTemp: true,
      showInfoSupplyTemp: true,
      showInfoReturnTemp: true,
      showInfoHeatingTemp: true,
      showInfoCompressorPower: true,
      standbyIcon: "power-standby",
      dhwIcon: "water",
      heatingIcon: "radiator",
      comfortIcon: "white-balance-sunny",
      ecoIcon: "leaf",
      oneTimeChargeIcon: "shower-head",
      position: {
        ...basePosition,
        w: Math.min(6, grid.columns),
      },
    };
  }

  return {
    id: `solar-${suffix}`,
    type: "solar",
    title: `Solar ${suffix}`,
    statePrefix: `0_userdata.0.solar_${suffix}`,
    wallboxCarStateId: "go-e.0.car",
    wallboxChargePowerStateId: "go-e.0.nrg.11",
    wallboxAmpereStateId: "go-e.0.ampere",
    wallboxPhaseModeStateId: "go-e.0.phaseSwitchMode",
    wallboxCarSocStateId: "go-e.0.carBatterySoc",
    wallboxCarRangeStateId: "",
    keys: {
      pvNow: "pv_now",
      homeNow: "home_now",
      gridIn: "grid_in",
      gridOut: "grid_out",
      soc: "soc",
      battIn: "battery_charge",
      battOut: "battery_discharge",
      dayConsumed: "day_consumed",
      daySelf: "day_self",
      pvTotal: "pv_total",
      battTemp: "battery_temp",
    },
    dailyEnergyUnit: "auto",
    statValueUnit: "none",
    position: {
      ...basePosition,
      w: Math.min(8, grid.columns),
    },
  };
}
