export const LEGACY_HEATING_STATE_DEFAULTS = {
  roomTemp: "viessmannapi.0.299550.0.features.heating.circuits.1.temperature.properties.value.value",
  dhwTemp: "viessmannapi.0.299550.0.features.heating.dhw.sensors.temperature.dhwCylinder.properties.value.value",
} as const;

export const HEATING_V2_STATE_DEFAULTS = {
  roomTemp: "sainlogic.0.weather.current.indoortemp",
  dhwTemp:
    "viessmannapi.0.299550.0.features.heating.dhw.sensors.temperature.hotWaterStorage.top.properties.value.value",
} as const;

export const HEATING_V2_STATE_DEFAULTS_VERSION = 1;
