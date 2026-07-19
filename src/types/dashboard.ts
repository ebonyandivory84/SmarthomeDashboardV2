export type WidgetType =
  | "state"
  | "camera"
  | "cameraTalk"
  | "cameraTalkReolink"
  | "energy"
  | "solar"
  | "grafana"
  | "weather"
  | "numpad"
  | "link"
  | "netflix"
  | "log"
  | "script"
  | "host"
  | "raspberryPiStats"
  | "coco"
  | "wallbox"
  | "goe"
  | "heating"
  | "heatingV2";

export type IconPair = {
  active: string;
  inactive: string;
};

export type GridPosition = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type WidgetAppearance = {
  widgetColor?: string;
  widgetColor2?: string;
  activeWidgetColor?: string;
  activeWidgetColor2?: string;
  inactiveWidgetColor?: string;
  inactiveWidgetColor2?: string;
  textColor?: string;
  mutedTextColor?: string;
  iconColor?: string;
  iconColor2?: string;
  cardColor?: string;
  cardColor2?: string;
  statColor?: string;
  statColor2?: string;
  pvCardColor?: string;
  homeCardColor?: string;
  batteryCardColor?: string;
  gridCardColor?: string;
  carCardColor?: string;
};

export type WidgetBase = {
  id: string;
  type: WidgetType;
  title: string;
  showTitle?: boolean;
  iconPair?: IconPair;
  position: GridPosition;
  mobilePosition?: GridPosition;
  mobileOverride?: Record<string, unknown>;
  appearance?: WidgetAppearance;
  interactionSounds?: WidgetInteractionSounds;
};

export type WidgetInteractionSounds = {
  press?: string[];
  confirm?: string[];
  slider?: string[];
  open?: string[];
  close?: string[];
  scroll?: string[];
  notify?: string[];
  notifyWarn?: string[];
  notifyError?: string[];
};

export type StateWidgetConfig = WidgetBase & {
  type: "state";
  stateId: string;
  writeable: boolean;
  iconImage?: string;
  iconImageCrop?: "none" | "rounded" | "circle";
  iconImageSizeMode?: "standard" | "maximized";
  iconImageBorderless?: boolean;
  onLabel?: string;
  offLabel?: string;
  activeValue?: string;
  inactiveValue?: string;
  valueLabels?: Record<string, string>;
  format?: "boolean" | "number" | "text";
  addonMode?: "none" | "circle" | "text" | "icon" | "bars";
  addonValue?: string;
  addonStateId?: string;
  addonColor?: string;
  addonIcon?: string;
  addonUseStateValue?: boolean;
};

export type CameraWidgetConfig = WidgetBase & {
  type: "camera";
  titleFontSize?: number;
  manualHeightOverride?: boolean;
  previewSourceMode?: "snapshot" | "mjpeg" | "flv" | "fmp4";
  fullscreenSourceMode?: "snapshot" | "mjpeg" | "flv" | "fmp4" | "webrtc";
  snapshotUrl?: string;
  fullscreenSnapshotUrl?: string;
  mjpegUrl?: string;
  fullscreenMjpegUrl?: string;
  flvUrl?: string;
  fullscreenFlvUrl?: string;
  fmp4Url?: string;
  fullscreenFmp4Url?: string;
  fullscreenWebrtcUrl?: string;
  refreshMs?: number;
  fullscreenRefreshMs?: number;
  audioEnabled?: boolean;
  snapshotAspectRatio?: number;
  maximizeStateId?: string;
  maximizeTriggerFormat?: "boolean" | "number" | "text";
  maximizeTriggerValue?: string;
};

export type CameraTalkWidgetConfig = Omit<CameraWidgetConfig, "type"> & {
  type: "cameraTalk" | "cameraTalkReolink";
  talkbackWebrtcUrl?: string;
  talkbackPushToTalk?: boolean;
  talkbackAutoEnableVideo?: boolean;
  instarTalkbackEnabled?: boolean;
  instarBaseUrl?: string;
  instarUsername?: string;
  instarPassword?: string;
  reolinkTalkbackEnabled?: boolean;
  reolinkBaseUrl?: string;
  reolinkUsername?: string;
  reolinkPassword?: string;
  reolinkChannel?: number;
};

export type GrafanaWidgetConfig = WidgetBase & {
  type: "grafana";
  manualHeightOverride?: boolean;
  url: string;
  renderUrl?: string;
  refreshMs?: number;
  allowInteractions?: boolean;
};

export type WeatherWidgetConfig = WidgetBase & {
  type: "weather";
  manualHeightOverride?: boolean;
  latitude: number;
  longitude: number;
  locationName?: string;
  locationQuery?: string;
  timezone?: string;
  refreshMs?: number;
};

export type NumpadWidgetConfig = WidgetBase & {
  type: "numpad";
};

export type LinkWidgetConfig = WidgetBase & {
  type: "link";
  url?: string;
  iconImage?: string;
  iconImageCrop?: "none" | "rounded" | "circle";
  iconImageSizeMode?: "standard" | "maximized";
  iconImageBorderless?: boolean;
};

export type NetflixWidgetConfig = Omit<LinkWidgetConfig, "type"> & {
  type: "netflix";
};

export type LogWidgetSeverity = "silly" | "debug" | "info" | "warn" | "error";

export type LogWidgetConfig = WidgetBase & {
  type: "log";
  manualHeightOverride?: boolean;
  refreshMs?: number;
  maxEntries?: number;
  minSeverity?: LogWidgetSeverity;
  sourceFilter?: string;
  textFilter?: string;
};

export type ScriptWidgetConfig = WidgetBase & {
  type: "script";
  manualHeightOverride?: boolean;
  refreshMs?: number;
  maxEntries?: number;
  instanceFilter?: string;
  textFilter?: string;
};

export type HostStatsWidgetConfig = WidgetBase & {
  type: "host";
  manualHeightOverride?: boolean;
  refreshMs?: number;
  hostLabel?: string;
};

export type RaspberryPiStatsWidgetConfig = WidgetBase & {
  type: "raspberryPiStats";
  manualHeightOverride?: boolean;
  label?: string;
  cpuTempStateId: string;
  cpuLoadStateId: string;
  ramFreeStateId: string;
  ramFreeUnit?: "auto" | "B" | "kB" | "MB" | "GB" | "percent";
  diskFreeStateId: string;
  diskFreeUnit?: "auto" | "B" | "kB" | "MB" | "GB" | "percent";
  onlineStateId: string;
};

export type CocoLockValueType = "number" | "string";

export type CocoWidgetConfig = WidgetBase & {
  type: "coco";
  manualHeightOverride?: boolean;
  refreshMs?: number;
  catName?: string;
  profileImage?: string;
  fullscreenMediaMode?: "snapshot" | "mjpeg" | "flv" | "video" | "iframe";
  insideStateId: string;
  lastDirectionStateId?: string;
  lastFlapStateId?: string;
  lastTimeStateId: string;
  timesOutsideStateId?: string;
  timeSpentOutsideStateId?: string;
  flapBatteryStateId?: string;
  flapOnlineStateId?: string;
  hubOnlineStateId?: string;
  adapterConnectedStateId?: string;
  allDevicesOnlineStateId?: string;
  offlineDevicesStateId?: string;
  lockModeStateId?: string;
  lockWriteStateId?: string;
  lockValueType?: CocoLockValueType;
  lockUnlockedValue?: string;
  lockInOnlyValue?: string;
  lockOutOnlyValue?: string;
  lockLockedValue?: string;
  snapshotUrl?: string;
  streamUrl?: string;
};

export type WallboxWidgetConfig = WidgetBase & {
  type: "wallbox";
  manualHeightOverride?: boolean;
  refreshMs?: number;
  showStatusSubtitle?: boolean;
  showGridAmpereControl?: boolean;
  targetMode?: "soc" | "km";
  highlightOpacity?: number;
  backgroundImage?: string;
  backgroundImageBlur?: number;
  stopWriteStateId?: string;
  stopSecondaryWriteStateId?: string;
  stopStateId?: string;
  pvWriteStateId?: string;
  pvStateId?: string;
  pvPriorityWriteStateId?: string;
  pvPriorityStateId?: string;
  gridWriteStateId?: string;
  gridStateId?: string;
  manualCurrentWriteStateId?: string;
  manualCurrentStateId?: string;
  ampereCardsWriteStateId?: string;
  ampereCardsStateId?: string;
  phaseCardsWriteStateId?: string;
  phaseCardsStateId?: string;
  stopWriteValueType?: "boolean" | "number" | "string";
  stopWriteValue?: string;
  stopSecondaryWriteValueType?: "boolean" | "number" | "string";
  stopSecondaryWriteValue?: string;
  stopStateValueType?: "boolean" | "number" | "string";
  stopStateValue?: string;
  pvWriteValueType?: "boolean" | "number" | "string";
  pvWriteValue?: string;
  pvStateValueType?: "boolean" | "number" | "string";
  pvStateValue?: string;
  pvPriorityWriteValueType?: "boolean" | "number" | "string";
  pvPriorityWriteValue?: string;
  pvPriorityStateValueType?: "boolean" | "number" | "string";
  pvPriorityStateValue?: string;
  gridWriteValueType?: "boolean" | "number" | "string";
  gridWriteValue?: string;
  gridStateValueType?: "boolean" | "number" | "string";
  gridStateValue?: string;
  manualCurrentWriteValueType?: "boolean" | "number" | "string";
  manualCurrentStateValueType?: "boolean" | "number" | "string";
  ampereCardsWriteValueType?: "boolean" | "number" | "string";
  ampereCardsStateValueType?: "boolean" | "number" | "string";
  ampere6WriteValue?: string;
  ampere10WriteValue?: string;
  ampere12WriteValue?: string;
  ampere14WriteValue?: string;
  ampere16WriteValue?: string;
  ampere6StateValue?: string;
  ampere10StateValue?: string;
  ampere12StateValue?: string;
  ampere14StateValue?: string;
  ampere16StateValue?: string;
  phaseCardsWriteValueType?: "boolean" | "number" | "string";
  phaseCardsStateValueType?: "boolean" | "number" | "string";
  phase1WriteValue?: string;
  phase3WriteValue?: string;
  phase1StateValue?: string;
  phase3StateValue?: string;
  targetChargeValueType?: "boolean" | "number" | "string";
  modeStateId: string;
  gridAmpereStateId: string;
  limit80StateId: string;
  targetSocAutoApiStateId?: string;
  targetKmStateId?: string;
  allowChargingStateId?: string;
  emergencyStopStateId?: string;
  solarLoadOnlyStateId?: string;
  phaseSwitchModeStateId?: string;
  phaseSwitchModeEnabledStateId?: string;
  ampereStateId?: string;
  carStateId?: string;
  batterySocStateId?: string;
  carRangeStateId?: string;
  chargePowerStateId?: string;
  chargedEnergyStateId?: string;
  stopChargeingAtCarSoc80StateId?: string;
};

export type GoEWidgetConfig = Omit<WallboxWidgetConfig, "type"> & {
  type: "goe";
};

export type HeatingWidgetConfig = WidgetBase & {
  type: "heating";
  manualHeightOverride?: boolean;
  refreshMs?: number;
  showStatusSubtitle?: boolean;
  detailsTickerSpeedPxPerS?: number;
  backgroundImage?: string;
  backgroundImageBlur?: number;
  modeSetStateId: string;
  modeValueStateId?: string;
  activeProgramStateId?: string;
  normalSetTempStateId: string;
  reducedSetTempStateId?: string;
  comfortSetTempStateId?: string;
  dhwSetTempStateId: string;
  comfortActivateStateId?: string;
  comfortDeactivateStateId?: string;
  ecoSetActiveStateId?: string;
  oneTimeChargeSetActiveStateId?: string;
  oneTimeChargeActiveStateId?: string;
  heatingModeActiveStateId?: string;
  dhwChargingActiveStateId?: string;
  dhwChargingProgramStateId?: string;
  boostBlinkActiveStateId?: string;
  ventilationAutoSetActiveStateId?: string;
  ventilationAutoActiveStateId?: string;
  ventilationLevelSetStateId?: string;
  ventilationLevelStateId?: string;
  roomTempStateId?: string;
  heatingTempStateId?: string;
  supplyTempStateId?: string;
  outsideTempStateId?: string;
  returnTempStateId?: string;
  dhwTempStateId?: string;
  compressorPowerStateId?: string;
  compressorSensorPowerStateId?: string;
  showInfoProgram?: boolean;
  showInfoTargets?: boolean;
  showInfoOutsideTemp?: boolean;
  showInfoSupplyTemp?: boolean;
  showInfoReturnTemp?: boolean;
  showInfoHeatingTemp?: boolean;
  showInfoCompressorPower?: boolean;
  standbyIcon?: string;
  dhwIcon?: string;
  heatingIcon?: string;
  comfortIcon?: string;
  ecoIcon?: string;
  oneTimeChargeIcon?: string;
};

export type HeatingWidgetV2Config = Omit<HeatingWidgetConfig, "type"> & {
  type: "heatingV2";
};

export type SolarNodeLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type SolarLayoutConfig = {
  pv: SolarNodeLayout;
  home: SolarNodeLayout;
  battery: SolarNodeLayout;
  grid: SolarNodeLayout;
  car: SolarNodeLayout;
};

export type SolarStatConfig = {
  label: string;
  stateId?: string;
};

export type SolarTapAction =
  | {
      type: "dashboard";
      dashboardId: string;
    }
  | {
      type: "url";
      url: string;
    };

export type EnergyWidgetConfig = WidgetBase & {
  type: "energy";
  pvStateId: string;
  houseStateId: string;
  batteryStateId?: string;
  gridStateId?: string;
};

export type SolarWidgetConfig = WidgetBase & {
  type: "solar";
  manualHeightOverride?: boolean;
  backgroundMode?: "color" | "image";
  backgroundImage?: string;
  backgroundImageBlur?: number;
  wallboxCarStateId?: string;
  wallboxChargePowerStateId?: string;
  wallboxAmpereStateId?: string;
  wallboxPhaseModeStateId?: string;
  wallboxCarSocStateId?: string;
  wallboxCarRangeStateId?: string;
  statTextScale?: number;
  statePrefix: string;
  keys: {
    pvNow: string;
    homeNow: string;
    gridIn: string;
    gridOut: string;
    soc?: string;
    battIn?: string;
    battOut?: string;
    dayConsumed: string;
    daySelf: string;
    pvTotal?: string;
    battTemp?: string;
  };
  dailyEnergyUnit?: "auto" | "Wh" | "kWh";
  statValueUnit?: "none" | "W" | "kW" | "Wh" | "kWh";
  nodeLayout?: Partial<SolarLayoutConfig>;
  stats?: {
    count?: number;
    cards?: SolarStatConfig[];
    first?: SolarStatConfig;
    second?: SolarStatConfig;
    third?: SolarStatConfig;
  };
  tapAction?: SolarTapAction;
};

export type WidgetConfig =
  | StateWidgetConfig
  | CameraWidgetConfig
  | CameraTalkWidgetConfig
  | EnergyWidgetConfig
  | SolarWidgetConfig
  | GrafanaWidgetConfig
  | WeatherWidgetConfig
  | NumpadWidgetConfig
  | LinkWidgetConfig
  | NetflixWidgetConfig
  | LogWidgetConfig
  | ScriptWidgetConfig
  | HostStatsWidgetConfig
  | RaspberryPiStatsWidgetConfig
  | CocoWidgetConfig
  | WallboxWidgetConfig
  | GoEWidgetConfig
  | HeatingWidgetConfig
  | HeatingWidgetV2Config;

export type BackgroundMode = "gradient" | "mesh" | "solid";

export type ThemeSettings = {
  widgetTones: {
    stateStart: string;
    stateEnd: string;
    energyStart: string;
    energyEnd: string;
    cameraStart: string;
    cameraEnd: string;
    solarStart: string;
    solarEnd: string;
  };
  solar: {
    sceneCardBackground: string;
    sceneCardBorder: string;
    nodeCardBackground: string;
    nodeCardBorder: string;
    statCardBackground: string;
    statCardBorder: string;
  };
};

export type DashboardPageMode = "dashboard" | "url";

export type DashboardPage = {
  id: string;
  title: string;
  mode?: DashboardPageMode;
  url?: string;
  urlZoomPercent?: number;
  widgets: WidgetConfig[];
};

export type UiSoundSet = "voyager" | "ops" | "soft";

export type UiSoundSettings = {
  enabled: boolean;
  volume: number;
  soundSet: UiSoundSet;
  widgetTypeDefaults?: Partial<Record<WidgetType, WidgetInteractionSounds>>;
  pageSounds?: {
    tabPress?: string[];
    swipe?: string[];
    contentScroll?: string[];
    pullToRefresh?: string[];
    layoutToggle?: string[];
    addWidget?: string[];
    openSettings?: string[];
    widgetEdit?: string[];
    editorButton?: string[];
  };
};

export type DashboardSettings = {
  title: string;
  homeLabel?: string;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  backgroundAccent: string;
  theme?: ThemeSettings;
  grid: {
    columns: number;
    rowHeight: number;
    gap: number;
  };
  pollingMs: number;
  uiSounds?: UiSoundSettings;
  iobroker: {
    baseUrl: string;
    username?: string;
    password?: string;
    token?: string;
    adapterBasePath?: string;
  };
  pages?: DashboardPage[];
  activePageId?: string;
  widgets: WidgetConfig[];
};

export type StateSnapshot = Record<string, unknown>;

export type IoBrokerObjectEntry = {
  id: string;
  name?: string;
  type?: string;
  role?: string;
  valueType?: string;
};

export type WidgetImageEntry = {
  name: string;
  url: string;
};

export type WidgetSoundEntry = {
  name: string;
  url: string;
};

export type IoBrokerLogEntry = {
  id: number;
  from: string;
  severity: LogWidgetSeverity;
  ts: number;
  message: string;
};

export type IoBrokerScriptEntry = {
  stateId: string;
  name: string;
  instance: string;
  enabled: boolean;
};

export type IoBrokerHostStats = {
  hostName: string;
  ts: number;
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
  ramTotalBytes: number | null;
  ramFreeBytes: number | null;
  cpuUsagePercent: number | null;
  cpuTemperatureC: number | null;
  processes: number | null;
};
