const WIDGET_ASSET_BASE_PATH = "/smarthome-dashboard-v2/widget-assets";

/**
 * URL eines Widget-Hintergrundbilds. Mit blur > 0 liefert der Adapter eine
 * serverseitig vorgeblurrte, dauerhaft cachebare Variante - der Browser braucht
 * dann keinen permanenten CSS-filter: blur() mehr, der auf schwacher GPU bei
 * jedem Compositing-Durchlauf zu Buche schlaegt.
 *
 * Aeltere Adapter-Versionen ignorieren den Parameter und liefern das Original;
 * die Oberflaeche bleibt in dem Fall funktionsfaehig, nur eben scharf.
 */
export function buildWidgetAssetUrl(imageName: string, blur = 0) {
  const base = `${WIDGET_ASSET_BASE_PATH}/${encodeURIComponent(imageName)}`;
  const normalized = Math.round(Math.max(0, Math.min(40, Number.isFinite(blur) ? blur : 0)));
  return normalized > 0 ? `${base}?blur=${normalized}` : base;
}
