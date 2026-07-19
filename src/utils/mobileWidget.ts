import { DashboardSettings, WidgetConfig } from "../types/dashboard";

type WidgetWithMobileMeta = WidgetConfig & {
  mobileOverride?: Record<string, unknown>;
  mobilePosition?: WidgetConfig["position"];
};

export function resolveMobileWidget(widget: WidgetConfig): WidgetConfig {
  const source = widget as WidgetWithMobileMeta;
  const override =
    source.mobileOverride && typeof source.mobileOverride === "object"
      ? (source.mobileOverride as Partial<WidgetConfig>)
      : null;
  const merged = override ? ({ ...widget, ...override } as WidgetConfig) : widget;
  const position = source.mobilePosition || merged.position;
  return { ...merged, position };
}

export function stripMobileWidgetMeta(widget: WidgetConfig): WidgetConfig {
  const source = widget as WidgetWithMobileMeta;
  const { mobileOverride, mobilePosition, ...rest } = source;
  void mobileOverride;
  void mobilePosition;
  return rest as WidgetConfig;
}

export function buildMobileOverrideFromWidget(widget: WidgetConfig) {
  const source = widget as WidgetWithMobileMeta & Record<string, unknown>;
  const payload: Record<string, unknown> = { ...source };
  delete payload.id;
  delete payload.type;
  delete payload.position;
  delete payload.mobilePosition;
  delete payload.mobileOverride;
  return payload;
}

export function applyMobileOverridesToSettings(config: DashboardSettings): DashboardSettings {
  return {
    ...config,
    widgets: config.widgets.map((widget) => resolveMobileWidget(widget)),
  };
}
