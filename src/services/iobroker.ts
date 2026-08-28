import {
  DashboardSettings,
  IoBrokerHostStats,
  IoBrokerLogEntry,
  IoBrokerObjectEntry,
  IoBrokerScriptEntry,
  PdfSlideshowWidgetConfig,
  StateSnapshot,
  TelegramWidgetHistoryEntry,
  WaterMeterIntradayRangeValue,
  WaterMeterSummary,
  WebdavFolder,
  WebdavPdfFile,
  WidgetImageEntry,
  WidgetSoundEntry,
} from "../types/dashboard";

type WebdavConfigLike = Pick<PdfSlideshowWidgetConfig, "webdavBaseUrl" | "webdavUsername" | "webdavPassword" | "folderPath">;

type ObjectCacheEntry = {
  items: IoBrokerObjectEntry[];
  timestamp: number;
};

const OBJECT_CACHE_TTL_MS = 5 * 60 * 1000;
const objectCache = new Map<string, ObjectCacheEntry>();

const buildAuthHeader = (settings: DashboardSettings) => {
  const headers: Record<string, string> = {};

  if (settings.iobroker.token) {
    headers.Authorization = `Bearer ${settings.iobroker.token}`;
    return headers;
  }

  if (settings.iobroker.username && settings.iobroker.password) {
    const raw = `${settings.iobroker.username}:${settings.iobroker.password}`;
    if (typeof btoa === "function") {
      headers.Authorization = `Basic ${btoa(raw)}`;
    }
  }

  return headers;
};

export class IoBrokerClient {
  constructor(private readonly settings: DashboardSettings) {}

  private resolveBaseUrl() {
    const configuredBase = this.settings.iobroker.baseUrl.trim();
    if (configuredBase) {
      return configuredBase.replace(/\/$/, "");
    }

    if (typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin.replace(/\/$/, "");
    }

    return "";
  }

  private endpoint(path: string) {
    const base = this.resolveBaseUrl();
    const adapterPath = (this.settings.iobroker.adapterBasePath || "").replace(/\/$/, "");
    return `${base}${adapterPath}${path}`;
  }

  private cacheKey() {
    return this.endpoint("/objects");
  }

  async readStates(stateIds: string[]): Promise<StateSnapshot> {
    const uniqueStateIds = [...new Set(stateIds.filter(Boolean))];
    if (uniqueStateIds.length === 0) {
      return {};
    }

    const response = await fetch(this.endpoint("/states"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeader(this.settings),
      },
      body: JSON.stringify({ stateIds: uniqueStateIds }),
    });

    if (!response.ok) {
      throw new Error(`State read failed (${response.status})`);
    }

    return (await response.json()) as StateSnapshot;
  }

  async writeState(stateId: string, value: unknown) {
    try {
      const response = await fetch(this.endpoint("/state"), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeader(this.settings),
        },
        body: JSON.stringify({ stateId, value }),
      });

      if (!response.ok) {
        throw new Error(`State write failed (${response.status})`);
      }
    } catch (error) {
      console.warn("ioBroker writeState failed", error);
    }
  }

  async listObjects(query = "", options: { forceRefresh?: boolean } = {}): Promise<IoBrokerObjectEntry[]> {
    const normalizedQuery = query.trim().toLowerCase();
    const cacheKey = this.cacheKey();
    const cached = objectCache.get(cacheKey);
    const cacheIsFresh = cached && Date.now() - cached.timestamp < OBJECT_CACHE_TTL_MS;

    if (cacheIsFresh && !options.forceRefresh) {
      return filterObjects(cached.items, normalizedQuery);
    }

    const response = await fetch(this.endpoint("/objects"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeader(this.settings),
      },
      body: JSON.stringify({ query: "" }),
    });

    if (!response.ok) {
      throw new Error(`Object list failed (${response.status})`);
    }

    const items = (await response.json()) as IoBrokerObjectEntry[];
    objectCache.set(cacheKey, {
      items,
      timestamp: Date.now(),
    });

    return filterObjects(items, normalizedQuery);
  }

  async primeObjectCache() {
    try {
      await this.listObjects("");
    } catch (error) {
      console.warn("Object cache warmup failed", error);
    }
  }

  async listWidgetImages(): Promise<WidgetImageEntry[]> {
    const response = await fetch(this.endpoint("/images"), {
      method: "GET",
      headers: {
        ...buildAuthHeader(this.settings),
      },
    });

    if (!response.ok) {
      throw new Error(`Image list failed (${response.status})`);
    }

    return (await response.json()) as WidgetImageEntry[];
  }

  async listWidgetSounds(): Promise<WidgetSoundEntry[]> {
    const response = await fetch(this.endpoint("/sounds"), {
      method: "GET",
      headers: {
        ...buildAuthHeader(this.settings),
      },
    });

    if (!response.ok) {
      throw new Error(`Sound list failed (${response.status})`);
    }

    return (await response.json()) as WidgetSoundEntry[];
  }

  async uploadWidgetImage(name: string, dataUrl: string): Promise<WidgetImageEntry> {
    return this.uploadWidgetFile<WidgetImageEntry>("/images/upload", name, dataUrl);
  }

  async uploadWidgetSound(name: string, dataUrl: string): Promise<WidgetSoundEntry> {
    return this.uploadWidgetFile<WidgetSoundEntry>("/sounds/upload", name, dataUrl);
  }

  async listWebdavPdfFiles(config: WebdavConfigLike): Promise<WebdavPdfFile[]> {
    const params = new URLSearchParams({
      baseUrl: config.webdavBaseUrl || "",
      username: config.webdavUsername || "",
      password: config.webdavPassword || "",
      path: config.folderPath || "",
    });
    const response = await fetch(this.endpoint(`/webdav/list?${params.toString()}`), {
      method: "GET",
      headers: {
        ...buildAuthHeader(this.settings),
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || `WebDAV-Liste konnte nicht geladen werden (${response.status})`);
    }

    return (await response.json()) as WebdavPdfFile[];
  }

  async deleteWebdavFile(config: WebdavConfigLike, filePath: string): Promise<void> {
    const params = new URLSearchParams({
      baseUrl: config.webdavBaseUrl || "",
      username: config.webdavUsername || "",
      password: config.webdavPassword || "",
      path: filePath,
    });
    const response = await fetch(this.endpoint(`/webdav/file?${params.toString()}`), {
      method: "DELETE",
      headers: {
        ...buildAuthHeader(this.settings),
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || `Datei konnte nicht gelöscht werden (${response.status})`);
    }
  }

  async createWebdavShareLink(config: WebdavConfigLike, filePath: string): Promise<{ url: string }> {
    const response = await fetch(this.endpoint("/webdav/share-link"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeader(this.settings),
      },
      body: JSON.stringify({
        baseUrl: config.webdavBaseUrl || "",
        username: config.webdavUsername || "",
        password: config.webdavPassword || "",
        path: filePath,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || `Teilen-Link konnte nicht erstellt werden (${response.status})`);
    }

    const data = (await response.json()) as { token: string; url: string };
    return { url: this.resolveBaseUrl() + data.url };
  }

  async fetchWebdavFile(config: WebdavConfigLike, filePath: string, signal?: AbortSignal): Promise<Blob> {
    const response = await fetch(this.endpoint("/webdav/file"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeader(this.settings),
      },
      body: JSON.stringify({
        baseUrl: config.webdavBaseUrl || "",
        username: config.webdavUsername || "",
        password: config.webdavPassword || "",
        path: filePath,
      }),
      signal,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || `PDF konnte nicht geladen werden (${response.status})`);
    }

    return await response.blob();
  }

  async listWebdavFolders(config: WebdavConfigLike, folderPath: string): Promise<WebdavFolder[]> {
    const params = new URLSearchParams({
      baseUrl: config.webdavBaseUrl || "",
      username: config.webdavUsername || "",
      password: config.webdavPassword || "",
      path: folderPath,
    });
    const response = await fetch(this.endpoint(`/webdav/folders?${params.toString()}`), {
      method: "GET",
      headers: {
        ...buildAuthHeader(this.settings),
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || `Ordner konnten nicht geladen werden (${response.status})`);
    }

    return (await response.json()) as WebdavFolder[];
  }

  async moveWebdavFile(config: WebdavConfigLike, fromPath: string, toFolderPath: string): Promise<{ path: string }> {
    const response = await fetch(this.endpoint("/webdav/move"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeader(this.settings),
      },
      body: JSON.stringify({
        baseUrl: config.webdavBaseUrl || "",
        username: config.webdavUsername || "",
        password: config.webdavPassword || "",
        fromPath,
        toFolderPath,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || `Datei konnte nicht verschoben werden (${response.status})`);
    }

    return (await response.json()) as { path: string };
  }

  async readLogs(options?: {
    limit?: number;
    minSeverity?: string;
    source?: string;
    contains?: string;
  }): Promise<IoBrokerLogEntry[]> {
    const limit = Math.max(1, Math.min(200, Math.round(options?.limit || 100)));
    const params = new URLSearchParams({
      limit: String(limit),
    });
    if (options?.minSeverity) {
      params.set("minSeverity", options.minSeverity);
    }
    if (options?.source) {
      params.set("source", options.source);
    }
    if (options?.contains) {
      params.set("contains", options.contains);
    }

    const response = await fetch(this.endpoint(`/logs?${params.toString()}`), {
      method: "GET",
      headers: {
        ...buildAuthHeader(this.settings),
      },
    });

    if (!response.ok) {
      throw new Error(`Log read failed (${response.status})`);
    }

    return (await response.json()) as IoBrokerLogEntry[];
  }

  async readTelegramHistory(): Promise<TelegramWidgetHistoryEntry[]> {
    const response = await fetch(this.endpoint("/telegram/history"), {
      method: "GET",
      headers: {
        ...buildAuthHeader(this.settings),
      },
    });

    if (!response.ok) {
      throw new Error(`Telegram history read failed (${response.status})`);
    }

    return (await response.json()) as TelegramWidgetHistoryEntry[];
  }

  async sendTelegramMessage(text: string): Promise<void> {
    const response = await fetch(this.endpoint("/telegram/send"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeader(this.settings),
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`Telegram send failed (${response.status})`);
    }
  }

  async pressTelegramButton(callbackData: string): Promise<void> {
    const response = await fetch(this.endpoint("/telegram/button"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeader(this.settings),
      },
      body: JSON.stringify({ callbackData }),
    });

    if (!response.ok) {
      throw new Error(`Telegram button press failed (${response.status})`);
    }
  }

  telegramThumbUrl(fileUniqueId: string, fileId: string): string {
    return this.endpoint(`/telegram/thumb/${encodeURIComponent(fileUniqueId)}?fileId=${encodeURIComponent(fileId)}`);
  }

  telegramLocalSnapshotUrl(cameraKey: string, ts: number): string {
    return this.endpoint(`/telegram/local-snapshot/${encodeURIComponent(cameraKey)}?ts=${ts}`);
  }

  async listScripts(options?: {
    limit?: number;
    instance?: string;
    contains?: string;
  }): Promise<IoBrokerScriptEntry[]> {
    const limit = Math.max(1, Math.min(1000, Math.round(options?.limit || 200)));
    const params = new URLSearchParams({
      limit: String(limit),
    });
    if (options?.instance) {
      params.set("instance", options.instance);
    }
    if (options?.contains) {
      params.set("contains", options.contains);
    }

    const response = await fetch(this.endpoint(`/scripts?${params.toString()}`), {
      method: "GET",
      headers: {
        ...buildAuthHeader(this.settings),
      },
    });

    if (!response.ok) {
      throw new Error(`Script list failed (${response.status})`);
    }

    return (await response.json()) as IoBrokerScriptEntry[];
  }

  async readHostStats(): Promise<IoBrokerHostStats> {
    const response = await fetch(this.endpoint("/host-stats"), {
      method: "GET",
      headers: {
        ...buildAuthHeader(this.settings),
      },
    });

    if (!response.ok) {
      throw new Error(`Host stats read failed (${response.status})`);
    }

    return (await response.json()) as IoBrokerHostStats;
  }

  async readRoomSensorHistory(
    ids: string[],
    hours: number
  ): Promise<Record<string, Array<{ t: number; v: number | null }>>> {
    const params = new URLSearchParams({
      ids: ids.join(","),
      hours: String(hours),
    });

    const response = await fetch(this.endpoint(`/room-sensor-history?${params.toString()}`), {
      method: "GET",
      headers: {
        ...buildAuthHeader(this.settings),
      },
    });

    if (!response.ok) {
      throw new Error(`Room sensor history read failed (${response.status})`);
    }

    return (await response.json()) as Record<string, Array<{ t: number; v: number | null }>>;
  }

  async readRoomSensorHistoryRange(
    ids: string[],
    fromMs: number,
    toMs: number
  ): Promise<Record<string, Array<{ t: number; v: number | null }>>> {
    const params = new URLSearchParams({
      ids: ids.join(","),
      from: String(Math.round(fromMs)),
      to: String(Math.round(toMs)),
    });

    const response = await fetch(this.endpoint(`/room-sensor-history?${params.toString()}`), {
      method: "GET",
      headers: {
        ...buildAuthHeader(this.settings),
      },
    });

    if (!response.ok) {
      throw new Error(`Room sensor history read failed (${response.status})`);
    }

    return (await response.json()) as Record<string, Array<{ t: number; v: number | null }>>;
  }

  async readRoomSensorHistoryYear(
    ids: string[]
  ): Promise<Record<string, Array<{ t: number; v: number | null }>>> {
    const params = new URLSearchParams({
      ids: ids.join(","),
      period: "year",
    });

    const response = await fetch(this.endpoint(`/room-sensor-history?${params.toString()}`), {
      method: "GET",
      headers: {
        ...buildAuthHeader(this.settings),
      },
    });

    if (!response.ok) {
      throw new Error(`Room sensor history read failed (${response.status})`);
    }

    return (await response.json()) as Record<string, Array<{ t: number; v: number | null }>>;
  }

  async readWaterSummary(options: {
    stateId: string;
    days: number;
    multiplier: number;
    maxFlowLitersPerMinute: number;
    timezone: string;
  }): Promise<WaterMeterSummary> {
    const params = new URLSearchParams({
      stateId: options.stateId,
      days: String(options.days),
      multiplier: String(options.multiplier),
      maxFlow: String(options.maxFlowLitersPerMinute),
      timezone: options.timezone,
    });
    const response = await fetch(this.endpoint(`/water-summary?${params.toString()}`), {
      method: "GET",
      headers: {
        ...buildAuthHeader(this.settings),
      },
    });

    if (!response.ok) {
      throw new Error(`Water summary read failed (${response.status})`);
    }

    return (await response.json()) as WaterMeterSummary;
  }

  async readWaterIntradayRange(options: {
    stateId: string;
    fromMs: number;
    toMs: number;
    bucketMs: number;
    multiplier: number;
    maxFlowLitersPerMinute: number;
  }): Promise<WaterMeterIntradayRangeValue[]> {
    const params = new URLSearchParams({
      stateId: options.stateId,
      from: String(options.fromMs),
      to: String(options.toMs),
      bucketMs: String(options.bucketMs),
      multiplier: String(options.multiplier),
      maxFlow: String(options.maxFlowLitersPerMinute),
    });
    const response = await fetch(this.endpoint(`/water-intraday?${params.toString()}`), {
      method: "GET",
      headers: {
        ...buildAuthHeader(this.settings),
      },
    });

    if (!response.ok) {
      throw new Error(`Water intraday read failed (${response.status})`);
    }

    return (await response.json()) as WaterMeterIntradayRangeValue[];
  }

  private async uploadWidgetFile<T>(path: string, name: string, dataUrl: string): Promise<T> {
    const response = await fetch(this.endpoint(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeader(this.settings),
      },
      body: JSON.stringify({ name, dataUrl }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      const message = payload?.error || `Upload failed (${response.status})`;
      throw new Error(message);
    }

    return (await response.json()) as T;
  }
}

function filterObjects(items: IoBrokerObjectEntry[], query: string) {
  if (!query) {
    return items;
  }

  return items.filter((entry) => {
    return (
      entry.id.toLowerCase().includes(query) ||
      (entry.name && entry.name.toLowerCase().includes(query)) ||
      (entry.role && entry.role.toLowerCase().includes(query))
    );
  });
}
