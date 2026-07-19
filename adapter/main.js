const utils = require("@iobroker/adapter-core");
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { resolveWebRoot } = require("./lib/static");
let WebSocketClient = null;
try {
  WebSocketClient = require("ws");
} catch {
  WebSocketClient = null;
}
let UndiciAgent = null;
try {
  ({ Agent: UndiciAgent } = require("undici"));
} catch {
  UndiciAgent = null;
}
let Sharp = null;
try {
  Sharp = require("sharp");
} catch {
  Sharp = null;
}

let objectEntriesCache = [];
let objectEntriesCacheTimestamp = 0;
let objectEntriesPromise = null;
let insecureHttpsDispatcher = null;
let runningAdapter = null;
const OBJECT_CACHE_TTL_MS = 5 * 60 * 1000;
const API_JSON_LIMIT = "2mb";
const CONFIG_STATE_ID = "dashboardConfig";
const SAVED_DASHBOARDS_STATE_ID = "savedDashboards";
const LOG_BUFFER_LIMIT = 2000;
let webShellCache = null;
let logEntriesBuffer = [];
let logListenerRegistered = false;
const instarTalkSessions = new Map();
const reolinkTalkSessions = new Map();
let statePushShutdown = null;
let cameraSnapshotPushShutdown = null;
let logPushShutdown = null;
let scriptPushShutdown = null;
let logPushBroadcast = null;
const STATE_PUSH_WS_PATH = "/smarthome-dashboard-v2/ws";
const CAMERA_SNAPSHOT_WS_PATH = "/smarthome-dashboard-v2/ws-camera-snapshot";
const LOG_PUSH_WS_PATH = "/smarthome-dashboard-v2/ws-logs";
const SCRIPT_PUSH_WS_PATH = "/smarthome-dashboard-v2/ws-scripts";
const STATE_PUSH_MAX_STATES_PER_CLIENT = 4000;
const STATE_PUSH_BATCH_MS = 100;
const CAMERA_SNAPSHOT_MIN_REFRESH_MS = 2000;
const CAMERA_SNAPSHOT_MAX_REFRESH_MS = 60000;
const CAMERA_SNAPSHOT_WIDTH = 640;
const CAMERA_SNAPSHOT_HEIGHT = 360;
const CAMERA_SNAPSHOT_JPEG_QUALITY = 65;
const LOG_PUSH_MAX_ENTRIES_PER_CLIENT = 200;
const SCRIPT_PUSH_MAX_ENTRIES_PER_CLIENT = 1000;

const LOG_LEVEL_ORDER = {
  silly: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

function startAdapter(options) {
  const adapter = new utils.Adapter({
    ...options,
    logTransporter: true,
    name: "smarthome-dashboard-v2",
    ready: () => main(adapter),
    unload: (callback) => {
      const stopLogPromise = Promise.resolve(stopLogCapture(adapter)).catch((error) => {
        adapter.log.warn(`Log capture cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      const statePushPromise = Promise.resolve(statePushShutdown?.()).catch((error) => {
        adapter.log.warn(`State push cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      const cameraPushPromise = Promise.resolve(cameraSnapshotPushShutdown?.()).catch((error) => {
        adapter.log.warn(`Camera snapshot push cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      const logPushPromise = Promise.resolve(logPushShutdown?.()).catch((error) => {
        adapter.log.warn(`Log push cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      const scriptPushPromise = Promise.resolve(scriptPushShutdown?.()).catch((error) => {
        adapter.log.warn(`Script push cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      });

      Promise.allSettled([stopLogPromise, statePushPromise, cameraPushPromise, logPushPromise, scriptPushPromise]).finally(
        () => {
          statePushShutdown = null;
          cameraSnapshotPushShutdown = null;
          logPushShutdown = null;
          scriptPushShutdown = null;
          logPushBroadcast = null;
          for (const token of instarTalkSessions.keys()) {
            closeInstarTalkSession(token);
          }
          reolinkTalkSessions.clear();
          callback();
        }
      );
    },
  });

  return adapter;
}

async function main(adapter) {
  runningAdapter = adapter;
  const app = express();
  app.use(express.json({ limit: API_JSON_LIMIT }));
  app.use((error, _req, res, next) => {
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: `Request entity too large (limit ${API_JSON_LIMIT})` });
      return;
    }
    next(error);
  });
  const webRoot = resolveWebRoot(adapter);
  const widgetAssetsRoot = path.resolve(__dirname, "..", "assets");
  if (!Sharp) {
    adapter.log.warn("Optional sharp module unavailable; camera snapshots will be forwarded without max-size conversion.");
  }
  const devProxyEnabled = Boolean(adapter.config?.enableDevProxy);
  const configuredDevServerUrl =
    adapter.config && typeof adapter.config.devServerUrl === "string" ? adapter.config.devServerUrl.trim() : "";
  const devServerUrl = devProxyEnabled ? configuredDevServerUrl : "";

  if (!devProxyEnabled && configuredDevServerUrl) {
    adapter.log.info("Dev server URL is configured but ignored because dev proxy is disabled.");
  }

  await adapter.setObjectNotExistsAsync(CONFIG_STATE_ID, {
    type: "state",
    common: {
      name: "Dashboard configuration JSON",
      type: "string",
      role: "json",
      read: true,
      write: true,
      def: "",
    },
    native: {},
  });

  await adapter.setObjectNotExistsAsync(SAVED_DASHBOARDS_STATE_ID, {
    type: "state",
    common: {
      name: "Saved dashboard configurations",
      type: "string",
      role: "json",
      read: true,
      write: true,
      def: "{}",
    },
    native: {},
  });

  refreshObjectEntries(adapter).catch((error) => {
    adapter.log.warn(`Object cache warmup failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  startLogCapture(adapter);

  app.get("/smarthome-dashboard-v2/api/config", async (_req, res) => {
    try {
      const state = await adapter.getStateAsync(CONFIG_STATE_ID);
      const configJson = typeof state?.val === "string" ? state.val : "";
      res.json({ configJson });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Config read failed" });
    }
  });

  app.put("/smarthome-dashboard-v2/api/config", async (req, res) => {
    const configJson = typeof req.body?.configJson === "string" ? req.body.configJson : "";
    if (!configJson) {
      res.status(400).json({ error: "configJson missing" });
      return;
    }

    try {
      JSON.parse(configJson);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid JSON" });
      return;
    }

    try {
      await adapter.setStateAsync(CONFIG_STATE_ID, {
        val: configJson,
        ack: true,
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Config save failed" });
    }
  });

  app.get("/smarthome-dashboard-v2/api/dashboards", async (_req, res) => {
    try {
      const dashboards = await readSavedDashboards(adapter);
      res.json({ dashboards: Object.keys(dashboards).sort((a, b) => a.localeCompare(b, "de")) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Saved dashboards read failed" });
    }
  });

  app.get("/smarthome-dashboard-v2/api/dashboards/:name", async (req, res) => {
    const name = normalizeDashboardName(req.params?.name);
    if (!name) {
      res.status(400).json({ error: "name missing" });
      return;
    }

    try {
      const dashboards = await readSavedDashboards(adapter);
      const configJson = dashboards[name];
      if (!configJson) {
        res.status(404).json({ error: "Dashboard not found" });
        return;
      }

      res.json({ configJson });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Saved dashboard read failed" });
    }
  });

  app.put("/smarthome-dashboard-v2/api/dashboards/:name", async (req, res) => {
    const name = normalizeDashboardName(req.params?.name);
    const configJson = typeof req.body?.configJson === "string" ? req.body.configJson : "";

    if (!name) {
      res.status(400).json({ error: "name missing" });
      return;
    }

    if (!configJson) {
      res.status(400).json({ error: "configJson missing" });
      return;
    }

    try {
      JSON.parse(configJson);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid JSON" });
      return;
    }

    try {
      const dashboards = await readSavedDashboards(adapter);
      dashboards[name] = configJson;
      await writeSavedDashboards(adapter, dashboards);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Saved dashboard save failed" });
    }
  });

  app.delete("/smarthome-dashboard-v2/api/dashboards/:name", async (req, res) => {
    const name = normalizeDashboardName(req.params?.name);
    if (!name) {
      res.status(400).json({ error: "name missing" });
      return;
    }

    try {
      const dashboards = await readSavedDashboards(adapter);
      delete dashboards[name];
      await writeSavedDashboards(adapter, dashboards);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Saved dashboard delete failed" });
    }
  });

  app.post("/smarthome-dashboard-v2/api/states", async (req, res) => {
    const stateIds = Array.isArray(req.body?.stateIds) ? req.body.stateIds : [];
    const entries = await Promise.all(
      stateIds.map(async (stateId) => {
        const state = await adapter.getForeignStateAsync(stateId);
        return [stateId, state ? state.val : null];
      })
    );

    res.json(Object.fromEntries(entries));
  });

  app.put("/smarthome-dashboard-v2/api/state", async (req, res) => {
    const { stateId, value } = req.body || {};
    if (!stateId) {
      res.status(400).json({ error: "stateId missing" });
      return;
    }

    await adapter.setForeignStateAsync(stateId, value, false);
    res.json({ ok: true });
  });

  app.post("/smarthome-dashboard-v2/api/objects", async (req, res) => {
    const query = typeof req.body?.query === "string" ? req.body.query.trim().toLowerCase() : "";
    const entries = await getCachedObjectEntries(adapter);
    const filteredEntries = entries.filter((entry) => {
      if (!query) {
        return true;
      }

      return (
        entry.id.toLowerCase().includes(query) ||
        (entry.name && entry.name.toLowerCase().includes(query)) ||
        (entry.role && entry.role.toLowerCase().includes(query))
      );
    });

    const limitedEntries = filteredEntries.slice(0, 60000);

    res.json(limitedEntries);
  });

  app.get("/smarthome-dashboard-v2/api/logs", async (req, res) => {
    try {
      const limit = clampInt(req.query?.limit, 100, 1, 200);
      const minSeverity = normalizeLogSeverity(req.query?.minSeverity);
      const source = normalizeFilter(req.query?.source);
      const contains = normalizeFilter(req.query?.contains);
      const logs = readBufferedLogs({
        limit,
        minSeverity,
        source,
        contains,
      });

      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Log read failed" });
    }
  });

  app.get("/smarthome-dashboard-v2/api/scripts", async (req, res) => {
    try {
      const limit = clampInt(req.query?.limit, 200, 1, 1000);
      const instance = normalizeFilter(req.query?.instance);
      const contains = normalizeFilter(req.query?.contains);
      const scripts = await listJavaScriptEntries(adapter, {
        limit,
        instance,
        contains,
      });

      res.json(scripts);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Script list failed" });
    }
  });

  app.get("/smarthome-dashboard-v2/api/host-stats", async (_req, res) => {
    try {
      const stats = await readHostStats(adapter);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Host stats read failed" });
    }
  });

  app.get("/smarthome-dashboard-v2/api/images", async (_req, res) => {
    try {
      const files = await fs.promises.readdir(widgetAssetsRoot, { withFileTypes: true });
      const images = files
        .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(entry.name))
        .map((entry) => ({
          name: entry.name,
          url: `/smarthome-dashboard-v2/widget-assets/${encodeURIComponent(entry.name)}`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "de"));

      res.json(images);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Image list failed" });
    }
  });

  app.get("/smarthome-dashboard-v2/api/camera-snapshot", async (req, res) => {
    const targetUrl = typeof req.query?.url === "string" ? req.query.url : "";
    if (!targetUrl) {
      res.status(400).json({ error: "url missing" });
      return;
    }

    try {
      const requestConfig = buildCameraRequestConfig(targetUrl);
      const response = await fetch(requestConfig.url, {
        cache: "no-store",
        headers: requestConfig.headers,
        ...buildCameraFetchOptions(requestConfig.url),
      });

      if (!response.ok) {
        res.status(response.status).json({ error: `Snapshot fetch failed (${response.status})` });
        return;
      }

      const sourceBuffer = Buffer.from(await response.arrayBuffer());
      const buffer = await optimizeSnapshotBuffer(sourceBuffer);
      res.setHeader("Content-Type", Sharp ? "image/jpeg" : response.headers.get("content-type") || "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.send(buffer);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Snapshot proxy failed" });
    }
  });

  const handleCameraStreamProxy = async (req, res) => {
    const targetUrl = typeof req.query?.url === "string" ? req.query.url : "";
    const streamType = typeof req.query?.streamType === "string" ? req.query.streamType.toLowerCase() : "";
    if (!targetUrl) {
      res.status(400).json({ error: "url missing" });
      return;
    }

    try {
      const requestConfig = buildCameraRequestConfig(targetUrl);
      proxyCameraStream(requestConfig, req, res, streamType, 0);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Stream proxy failed" });
    }
  };

  app.get("/smarthome-dashboard-v2/api/camera-stream", handleCameraStreamProxy);
  app.get("/smarthome-dashboard-v2/api/camera-mjpeg", handleCameraStreamProxy);
  app.post("/smarthome-dashboard-v2/api/instar-talk/start", async (req, res) => {
    adapter.log.info("[instar-talk] start request received");
    if (!WebSocketClient) {
      res.status(500).json({ error: "ws dependency missing in adapter runtime" });
      return;
    }

    const cameraBaseUrl = normalizeUrl(req.body?.cameraBaseUrl);
    const username = String(req.body?.username || "");
    const password = String(req.body?.password || "");
    const allowInsecure = req.body?.allowInsecure !== false;
    if (!cameraBaseUrl || !username || !password) {
      adapter.log.warn("[instar-talk] start rejected: missing cameraBaseUrl/username/password");
      res.status(400).json({ error: "cameraBaseUrl, username, password required" });
      return;
    }

    try {
      const invite = await requestInstarCallInvite(cameraBaseUrl, username, password, allowInsecure);
      const wsUrl = `${cameraBaseUrl.replace(/^http/i, "ws")}/ws`;
      const token = crypto.randomBytes(16).toString("hex");
      const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      const ws = new WebSocketClient(wsUrl, {
        headers: {
          Authorization: authHeader,
        },
        rejectUnauthorized: !allowInsecure,
      });

      ws.on("error", (error) => {
        adapter.log.warn(`INSTAR talkback socket error: ${error instanceof Error ? error.message : String(error)}`);
      });
      ws.on("close", () => {
        instarTalkSessions.delete(token);
      });

      await waitForSocketOpen(ws, 8000);
      ws.send(`call_ack?session_id=${invite.sessionId}`);
      instarTalkSessions.set(token, {
        ws,
        frameSize: invite.frameSize || 640,
        sessionId: invite.sessionId,
        timestamp: invite.initialTimestamp,
        aencFormat: invite.aencFormat || "pcm16",
        audioSampleRate: invite.audioSampleRate || 16000,
      });
      adapter.log.info(`[instar-talk] start ok session=${invite.sessionId} token=${token.slice(0, 8)}... codec=${invite.aencFormat || "pcm16"} frameSize=${invite.frameSize || 640}`);
      res.json({ ok: true, token, frameSize: invite.frameSize || 640 });
    } catch (error) {
      adapter.log.warn(`[instar-talk] start failed: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: error instanceof Error ? error.message : "INSTAR talk start failed" });
    }
  });
  app.post("/smarthome-dashboard-v2/api/instar-talk/chunk", async (req, res) => {
    const token = String(req.body?.token || "");
    const pcmBase64 = String(req.body?.pcmBase64 || "");
    if (!token || !pcmBase64) {
      res.status(400).json({ error: "token and pcmBase64 required" });
      return;
    }
    const session = instarTalkSessions.get(token);
    if (!session || !session.ws || session.ws.readyState !== WebSocketClient.OPEN) {
      adapter.log.warn("[instar-talk] chunk rejected: session not active");
      res.status(404).json({ error: "talk session not active" });
      return;
    }

    try {
      const pcm = Buffer.from(pcmBase64, "base64");
      if (!pcm.length) {
        res.json({ ok: true, sent: 0 });
        return;
      }
      const payload = session.aencFormat === "pcma"
        ? pcm16leToPcma(pcm, session.audioSampleRate === 8000 ? 2 : 1)
        : pcm;

      let offset = 0;
      let sent = 0;
      while (offset < payload.length) {
        const remaining = payload.length - offset;
        const size = Math.min(session.frameSize, remaining);
        const chunk = payload.subarray(offset, offset + size);
        const header = Buffer.from(
          `Session: ${session.sessionId}\r\nTimestamp: ${session.timestamp}\r\nFrame-Length: ${size}\r\n\r\n`,
          "ascii"
        );
        session.ws.send(Buffer.concat([header, chunk]));
        const durationMs = session.aencFormat === "pcma"
          ? Math.max(1, Math.round((size / (session.audioSampleRate || 16000)) * 1000))
          : Math.max(1, Math.round((size / 2 / (session.audioSampleRate || 16000)) * 1000));
        session.timestamp += durationMs;
        offset += size;
        sent += size;
      }

      res.json({ ok: true, sent });
    } catch (error) {
      adapter.log.warn(`[instar-talk] chunk failed: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: error instanceof Error ? error.message : "INSTAR talk chunk failed" });
    }
  });
  app.post("/smarthome-dashboard-v2/api/instar-talk/stop", async (req, res) => {
    const token = String(req.body?.token || "");
    if (!token) {
      adapter.log.warn("[instar-talk] stop rejected: missing token");
      res.status(400).json({ error: "token required" });
      return;
    }
    adapter.log.info(`[instar-talk] stop token=${token.slice(0, 8)}...`);
    closeInstarTalkSession(token);
    res.json({ ok: true });
  });
  app.post("/smarthome-dashboard-v2/api/instar-control", async (req, res) => {
    const cameraBaseUrl = normalizeUrl(req.body?.cameraBaseUrl);
    const username = String(req.body?.username || "");
    const password = String(req.body?.password || "");
    const allowInsecure = req.body?.allowInsecure !== false;
    const query = req.body?.query && typeof req.body.query === "object" ? req.body.query : null;
    const cmd = typeof query?.cmd === "string" ? query.cmd.trim() : "";
    const allowedCommands = new Set([
      "ptzmove",
      "getptzstate",
      "gotoRelPosition",
      "getaudioattr",
      "setaudioattr",
      "setalarmattr",
      "setaudioaction",
      "playalarmsound",
      "stopalarmsound",
      "setmutealarm",
      "setlampctrl",
      "illuminate",
    ]);

    if (!cameraBaseUrl || !username || !password || !query || !cmd) {
      res.status(400).json({ error: "cameraBaseUrl, username, password and query.cmd required" });
      return;
    }
    if (!allowedCommands.has(cmd)) {
      res.status(400).json({ error: `unsupported cmd: ${cmd}` });
      return;
    }

    try {
      const url = new URL(`${cameraBaseUrl}/param.cgi`);
      Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null) {
          return;
        }
        url.searchParams.set(key, String(value));
      });
      // Add both auth methods for better compatibility with INSTAR firmware variants.
      url.searchParams.set("user", username);
      url.searchParams.set("pwd", password);
      const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "*/*",
          Authorization: authHeader,
        },
        ...(allowInsecure ? buildCameraFetchOptions(url.toString()) : { redirect: "follow" }),
      });
      const text = await response.text();
      if (!response.ok) {
        res.status(response.status).json({ error: text || `instar control failed (${response.status})` });
        return;
      }
      res.json({ ok: true, cmd, response: text });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "instar control failed" });
    }
  });
  app.post("/smarthome-dashboard-v2/api/reolink-control", async (req, res) => {
    const cameraBaseUrl = normalizeUrl(req.body?.cameraBaseUrl);
    const username = String(req.body?.username || "");
    const password = String(req.body?.password || "");
    const allowInsecure = req.body?.allowInsecure !== false;
    const cmd = typeof req.body?.cmd === "string" ? req.body.cmd.trim() : "";
    const param = req.body?.param && typeof req.body.param === "object" ? req.body.param : {};
    const action = Number.isFinite(Number(req.body?.action)) ? Number(req.body.action) : 0;

    const allowedCommands = new Set([
      "SetWhiteLed",
      "GetWhiteLed",
      "AudioAlarmPlay",
      "GetAudioCfg",
      "SetAudioCfg",
    ]);

    if (!cameraBaseUrl || !username || !password || !cmd) {
      res.status(400).json({ error: "cameraBaseUrl, username, password and cmd required" });
      return;
    }
    if (!allowedCommands.has(cmd)) {
      res.status(400).json({ error: `unsupported cmd: ${cmd}` });
      return;
    }

    try {
      const url = new URL(`${cameraBaseUrl}/cgi-bin/api.cgi`);
      url.searchParams.set("cmd", cmd);
      url.searchParams.set("user", username);
      url.searchParams.set("password", password);
      const body = [{ cmd, action, param }];
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        ...(allowInsecure ? buildCameraFetchOptions(url.toString()) : { redirect: "follow" }),
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }
      if (!response.ok) {
        res.status(response.status).json({ error: text || `reolink control failed (${response.status})` });
        return;
      }
      const first = Array.isArray(payload) ? payload[0] : payload;
      const code = Number(first?.code);
      if (Number.isFinite(code) && code !== 0) {
        const detail = first?.error?.detail || first?.error?.rspCode || `code ${code}`;
        res.status(400).json({ error: `reolink ${cmd} failed: ${detail}`, payload });
        return;
      }
      res.json({ ok: true, cmd, payload: payload ?? text });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "reolink control failed" });
    }
  });
  app.post("/smarthome-dashboard-v2/api/reolink-talk/start", async (req, res) => {
    const cameraBaseUrl = normalizeUrl(req.body?.cameraBaseUrl);
    const username = String(req.body?.username || "");
    const talkbackWebrtcUrl = String(req.body?.talkbackWebrtcUrl || "");
    if (!cameraBaseUrl || !username || !talkbackWebrtcUrl) {
      res.status(400).json({ error: "cameraBaseUrl, username and talkbackWebrtcUrl required" });
      return;
    }
    const token = crypto.randomBytes(12).toString("hex");
    reolinkTalkSessions.set(token, {
      startedAt: Date.now(),
      cameraBaseUrl,
      username,
      talkbackWebrtcUrl,
    });
    adapter.log.info(
      `[reolink-talk] start ok token=${token.slice(0, 8)}... camera=${sanitizeCameraUrlForLog(cameraBaseUrl)} url=${sanitizeCameraUrlForLog(talkbackWebrtcUrl)}`
    );
    res.json({ ok: true, token });
  });
  app.post("/smarthome-dashboard-v2/api/reolink-talk/stop", async (req, res) => {
    const token = String(req.body?.token || "");
    if (!token) {
      res.status(400).json({ error: "token required" });
      return;
    }
    const hadSession = reolinkTalkSessions.delete(token);
    adapter.log.info(`[reolink-talk] stop token=${token.slice(0, 8)}... active=${hadSession ? "yes" : "no"}`);
    res.json({ ok: true });
  });

  app.use("/smarthome-dashboard-v2/widget-assets", express.static(widgetAssetsRoot));

  if (devServerUrl) {
    const target = devServerUrl.replace(/\/+$/, "");
    app.use(
      "/assets",
      createProxyMiddleware({
        target,
        changeOrigin: true,
        ws: true,
      })
    );
    app.use(
      "/_expo",
      createProxyMiddleware({
        target,
        changeOrigin: true,
        ws: true,
      })
    );
    app.use(
      "/smarthome-dashboard-v2",
      createProxyMiddleware({
        target,
        changeOrigin: true,
        ws: true,
        pathRewrite: {
          "^/smarthome-dashboard-v2": "",
        },
      })
    );
  } else {
    app.use("/assets", express.static(path.join(webRoot, "assets"), immutableStaticOptions()));
    app.use("/_expo", express.static(path.join(webRoot, "_expo"), immutableStaticOptions()));
    app.get(["/smarthome-dashboard-v2", "/smarthome-dashboard-v2/"], (req, res, next) => {
      sendWebShell(webRoot, res, next);
    });
    app.use("/smarthome-dashboard-v2", express.static(webRoot, immutableStaticOptions()));
    app.get("/smarthome-dashboard-v2/*", (req, res, next) => {
      sendWebShell(webRoot, res, next);
    });
  }

  const REOLINK_SESSION_TTL = 2 * 60 * 60 * 1000;
  setInterval(() => {
    const cutoff = Date.now() - REOLINK_SESSION_TTL;
    for (const [token, s] of reolinkTalkSessions) {
      if (s.startedAt < cutoff) {
        reolinkTalkSessions.delete(token);
        adapter.log.info(`[reolink-talk] expired session cleaned up token=${token.slice(0, 8)}...`);
      }
    }
  }, 60 * 60 * 1000);

  const port = Number(adapter.config.port) || 8109;
  const server = app.listen(port, () => {
    if (devServerUrl) {
      adapter.log.info(`SmartHome Dashboard V2 dev proxy enabled: ${devServerUrl}`);
    } else {
      adapter.log.info(`SmartHome Dashboard V2 static web root: ${webRoot}`);
    }
    adapter.log.info(`SmartHome Dashboard V2 available on http://0.0.0.0:${port}/smarthome-dashboard-v2`);
  });

  statePushShutdown = setupStatePushWebSocket(adapter, server);
  cameraSnapshotPushShutdown = setupCameraSnapshotWebSocket(adapter, server);
  logPushShutdown = setupLogWebSocket(adapter, server);
  scriptPushShutdown = setupScriptWebSocket(adapter, server);
}

function normalizeDashboardName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUrl(value) {
  const input = String(value || "").trim().replace(/\/+$/, "");
  if (!input) {
    return "";
  }
  if (/^https?:\/\//i.test(input)) {
    return input;
  }
  return `https://${input}`;
}

async function requestInstarCallInvite(cameraBaseUrl, username, password, allowInsecure) {
  const inviteUrl = `${cameraBaseUrl}/call_invite`;
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const response = await fetch(inviteUrl, {
    method: "GET",
    headers: {
      Accept: "*/*",
      Authorization: authHeader,
    },
    ...(allowInsecure ? buildCameraFetchOptions(inviteUrl) : { redirect: "follow" }),
  });
  if (!response.ok) {
    throw new Error(`call_invite failed (${response.status})`);
  }
  let text = await response.text();
  const normalized = text.trim();
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(normalized) && normalized.length % 4 === 0) {
    try {
      const decoded = Buffer.from(normalized, "base64").toString("utf8");
      if (decoded.includes("Session:")) {
        text = decoded;
      }
    } catch {
      // keep original body
    }
  }

  const sessionMatch = text.match(/Session:\s*(\d+)/i);
  if (!sessionMatch) {
    throw new Error("call_invite response without Session id");
  }
  const frameSizeMatch = text.match(/Frame-Size:\s*(\d+)/i);
  const aencMatch = text.match(/AEnc-Format:\s*([^\r\n]+)/i);
  const aencRaw = (aencMatch ? aencMatch[1] : "").trim().toLowerCase();
  const frameSize = frameSizeMatch ? Number(frameSizeMatch[1]) : 640;
  let aencFormat = /a-?law|pcma|g\.?711a/.test(aencRaw) ? "pcma" : "pcm16";
  let audioSampleRate = 16000;
  // INSTAR often reports Frame-Size 640 for wideband PCM frames. In that case,
  // forcing PCMA transcode can produce chipmunk-like playback. Keep PCM16 path.
  if (aencFormat === "pcma") {
    // For G.711 payload cameras, Frame-Size can indicate 8k vs 16k framing.
    // 640 bytes commonly maps to 16kHz @ 40ms, 320 bytes to 8kHz @ 40ms.
    audioSampleRate = Number.isFinite(frameSize) && frameSize >= 640 ? 16000 : 8000;
  } else if (Number.isFinite(frameSize) && frameSize <= 320) {
    audioSampleRate = 8000;
  }
  return {
    sessionId: Number(sessionMatch[1]),
    frameSize,
    initialTimestamp: Math.floor(Date.now() / 10),
    aencFormat,
    audioSampleRate,
  };
}

function pcm16leToPcma(input, downsampleFactor = 2) {
  if (!Buffer.isBuffer(input) || input.length < 4) {
    return Buffer.alloc(0);
  }
  const factor = downsampleFactor === 1 ? 1 : 2;
  const sampleCount = Math.floor(input.length / 2);
  const outCount = Math.floor(sampleCount / factor);
  const out = Buffer.allocUnsafe(outCount);
  let o = 0;
  if (factor === 1) {
    for (let i = 0; i + 1 < input.length; i += 2) {
      out[o++] = linearToALaw(input.readInt16LE(i));
    }
    return out;
  }
  for (let i = 0; i + 3 < input.length; i += 4) {
    const avg = (input.readInt16LE(i) + input.readInt16LE(i + 2)) >> 1;
    out[o++] = linearToALaw(avg);
  }
  return out;
}

function linearToALaw(sample) {
  let pcm = sample;
  let mask;
  if (pcm >= 0) {
    mask = 0xd5;
  } else {
    mask = 0x55;
    pcm = -pcm - 1;
  }
  if (pcm > 0x7fff) {
    pcm = 0x7fff;
  }

  let seg = 0;
  let value = pcm >> 4;
  while (value > 15 && seg < 7) {
    seg += 1;
    value >>= 1;
  }
  const aval = seg >= 1 ? ((seg << 4) | ((pcm >> (seg + 3)) & 0x0f)) : (pcm >> 4);
  return aval ^ mask;
}

function waitForSocketOpen(ws, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("INSTAR websocket connect timeout"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("open", onOpen);
      ws.off("error", onError);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    ws.on("open", onOpen);
    ws.on("error", onError);
  });
}

function closeInstarTalkSession(token) {
  const session = instarTalkSessions.get(token);
  if (!session) {
    return;
  }
  instarTalkSessions.delete(token);
  try {
    session.ws.close();
  } catch {
    // ignore socket close errors
  }
}

const webSocketUpgradeRouters = new WeakMap();

function createPathWebSocketServer(server, routePath, WebSocketServerCtor) {
  let router = webSocketUpgradeRouters.get(server);
  if (!router) {
    const routes = new Map();
    const handleUpgrade = (request, socket, head) => {
      let pathname = "";
      try {
        pathname = new URL(request.url || "", "http://localhost").pathname;
      } catch {
        socket.destroy();
        return;
      }

      const target = routes.get(pathname);
      if (!target) {
        socket.destroy();
        return;
      }

      target.handleUpgrade(request, socket, head, (webSocket) => {
        target.emit("connection", webSocket, request);
      });
    };

    router = { routes, handleUpgrade };
    webSocketUpgradeRouters.set(server, router);
    server.on("upgrade", handleUpgrade);
  }

  if (router.routes.has(routePath)) {
    throw new Error(`WebSocket route already registered: ${routePath}`);
  }

  const wss = new WebSocketServerCtor({
    noServer: true,
    perMessageDeflate: false,
  });
  router.routes.set(routePath, wss);
  let closed = false;

  return {
    wss,
    close() {
      if (closed) {
        return;
      }
      closed = true;
      if (router.routes.get(routePath) === wss) {
        router.routes.delete(routePath);
      }
      wss.close();
      if (!router.routes.size) {
        server.removeListener("upgrade", router.handleUpgrade);
        webSocketUpgradeRouters.delete(server);
      }
    },
  };
}

function setupStatePushWebSocket(adapter, server) {
  const WebSocketServerCtor = WebSocketClient?.WebSocketServer || WebSocketClient?.Server;
  if (!WebSocketClient || !WebSocketServerCtor) {
    adapter.log.warn("WebSocket state push disabled: ws server dependency unavailable.");
    return () => undefined;
  }

  const wsOpenState = typeof WebSocketClient.OPEN === "number" ? WebSocketClient.OPEN : 1;
  const clients = new Set();
  const stateRefCount = new Map();

  const sendJson = (socket, payload) => {
    if (!socket || socket.readyState !== wsOpenState) {
      return;
    }
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // ignore socket send failures
    }
  };

  const retainStateIds = async (stateIds) => {
    for (const stateId of stateIds) {
      const current = stateRefCount.get(stateId) || 0;
      stateRefCount.set(stateId, current + 1);
      if (current > 0) {
        continue;
      }

      try {
        await adapter.subscribeForeignStatesAsync(stateId);
      } catch (error) {
        const nextCount = stateRefCount.get(stateId) || 1;
        if (nextCount <= 1) {
          stateRefCount.delete(stateId);
        } else {
          stateRefCount.set(stateId, nextCount - 1);
        }
        adapter.log.warn(
          `State push subscribe failed for ${stateId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  };

  const releaseStateIds = async (stateIds) => {
    for (const stateId of stateIds) {
      const current = stateRefCount.get(stateId) || 0;
      if (current <= 0) {
        continue;
      }

      if (current > 1) {
        stateRefCount.set(stateId, current - 1);
        continue;
      }

      stateRefCount.delete(stateId);
      try {
        await adapter.unsubscribeForeignStatesAsync(stateId);
      } catch (error) {
        adapter.log.warn(
          `State push unsubscribe failed for ${stateId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  };

  const readSnapshot = async (stateIds) => {
    const entries = await Promise.all(
      stateIds.map(async (stateId) => {
        try {
          const state = await adapter.getForeignStateAsync(stateId);
          return [stateId, state ? state.val : null];
        } catch {
          return [stateId, null];
        }
      })
    );
    return Object.fromEntries(entries);
  };

  const normalizeWatchStateIds = (rawStateIds) => {
    if (!Array.isArray(rawStateIds)) {
      return [];
    }

    const unique = new Set();
    for (const raw of rawStateIds) {
      const stateId = typeof raw === "string" ? raw.trim() : "";
      if (!stateId) {
        continue;
      }
      unique.add(stateId);
      if (unique.size >= STATE_PUSH_MAX_STATES_PER_CLIENT) {
        break;
      }
    }

    return Array.from(unique);
  };

  const applyWatchStateIds = async (context, nextStateIds, requestId) => {
    const nextSet = new Set(normalizeWatchStateIds(nextStateIds));
    const currentSet = context.stateIds;
    const toAdd = [];
    const toRemove = [];

    for (const stateId of nextSet) {
      if (!currentSet.has(stateId)) {
        toAdd.push(stateId);
      }
    }
    for (const stateId of currentSet) {
      if (!nextSet.has(stateId)) {
        toRemove.push(stateId);
      }
    }

    if (toAdd.length) {
      await retainStateIds(toAdd);
    }
    if (toRemove.length) {
      await releaseStateIds(toRemove);
    }

    context.stateIds = nextSet;
    sendJson(context.socket, {
      type: "watchAck",
      count: nextSet.size,
      requestId: requestId || null,
      ts: Date.now(),
    });

    const snapshot = await readSnapshot(Array.from(nextSet));
    sendJson(context.socket, {
      type: "stateBatch",
      source: "snapshot",
      states: snapshot,
      requestId: requestId || null,
      ts: Date.now(),
    });
  };

  const releaseContext = (context) => {
    if (!clients.has(context)) {
      return;
    }
    clients.delete(context);
    if (context.batchTimer) {
      clearTimeout(context.batchTimer);
      context.batchTimer = null;
    }
    context.pendingStates = {};
    const watched = Array.from(context.stateIds);
    context.stateIds.clear();
    if (watched.length) {
      void releaseStateIds(watched);
    }
  };

  const stateChangeHandler = (stateId, state) => {
    if (!stateRefCount.has(stateId)) {
      return;
    }

    const value = state ? state.val : null;
    for (const context of clients) {
      if (!context.stateIds.has(stateId)) {
        continue;
      }
      context.pendingStates[stateId] = value;
      if (!context.batchTimer) {
        context.batchTimer = setTimeout(() => {
          context.batchTimer = null;
          const states = context.pendingStates;
          context.pendingStates = {};
          sendJson(context.socket, {
            type: "stateBatch",
            source: "delta",
            states,
            ts: Date.now(),
          });
        }, STATE_PUSH_BATCH_MS);
      }
    }
  };

  adapter.on("stateChange", stateChangeHandler);

  const { wss, close: closeWebSocketServer } = createPathWebSocketServer(
    server,
    STATE_PUSH_WS_PATH,
    WebSocketServerCtor
  );

  wss.on("connection", (socket) => {
    const context = {
      socket,
      stateIds: new Set(),
      pendingStates: {},
      batchTimer: null,
    };
    clients.add(context);

    sendJson(socket, {
      type: "hello",
      transport: "websocket",
      path: STATE_PUSH_WS_PATH,
      ts: Date.now(),
    });

    socket.on("message", (raw) => {
      let payload;
      try {
        payload = JSON.parse(String(raw || ""));
      } catch {
        sendJson(socket, {
          type: "error",
          message: "Invalid JSON payload",
          ts: Date.now(),
        });
        return;
      }

      const messageType = typeof payload?.type === "string" ? payload.type : "";
      if (messageType === "ping") {
        sendJson(socket, { type: "pong", ts: Date.now() });
        return;
      }

      if (messageType === "watch") {
        void applyWatchStateIds(context, payload?.stateIds, payload?.requestId).catch((error) => {
          sendJson(socket, {
            type: "error",
            message: error instanceof Error ? error.message : "State watch update failed",
            requestId: payload?.requestId || null,
            ts: Date.now(),
          });
        });
        return;
      }

      sendJson(socket, {
        type: "error",
        message: `Unsupported message type: ${messageType || "unknown"}`,
        ts: Date.now(),
      });
    });

    socket.on("close", () => {
      releaseContext(context);
    });

    socket.on("error", () => {
      releaseContext(context);
    });
  });

  adapter.log.info(`WebSocket state push enabled on ${STATE_PUSH_WS_PATH}`);

  return () => {
    adapter.removeListener("stateChange", stateChangeHandler);
    for (const context of Array.from(clients)) {
      try {
        context.socket.close();
      } catch {
        // ignore socket close failures
      }
      releaseContext(context);
    }
    for (const stateId of Array.from(stateRefCount.keys())) {
      void adapter.unsubscribeForeignStatesAsync(stateId).catch(() => undefined);
    }
    stateRefCount.clear();

    closeWebSocketServer();
  };
}

function setupCameraSnapshotWebSocket(adapter, server) {
  const WebSocketServerCtor = WebSocketClient?.WebSocketServer || WebSocketClient?.Server;
  if (!WebSocketClient || !WebSocketServerCtor) {
    adapter.log.warn("Camera snapshot websocket disabled: ws server dependency unavailable.");
    return () => undefined;
  }

  const wsOpenState = typeof WebSocketClient.OPEN === "number" ? WebSocketClient.OPEN : 1;
  const sessions = new Set();

  const sendJson = (socket, payload) => {
    if (!socket || socket.readyState !== wsOpenState) {
      return;
    }
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // ignore send failures
    }
  };

  const sendBinary = (socket, buffer) => {
    if (!socket || socket.readyState !== wsOpenState) {
      return;
    }
    try {
      socket.send(buffer, { binary: true });
    } catch {
      // ignore send failures
    }
  };

  const clearSessionTimer = (session) => {
    if (session.timer) {
      clearInterval(session.timer);
      session.timer = null;
    }
    if (session.delayTimer) {
      clearTimeout(session.delayTimer);
      session.delayTimer = null;
    }
  };

  const normalizeRefreshMs = (rawValue) => {
    const parsed = Number.parseInt(String(rawValue || ""), 10);
    if (!Number.isFinite(parsed)) {
      return 2000;
    }
    return Math.max(CAMERA_SNAPSHOT_MIN_REFRESH_MS, Math.min(CAMERA_SNAPSHOT_MAX_REFRESH_MS, parsed));
  };

  const sendSnapshot = async (session) => {
    if (!session.activeUrl || !session.socket || session.socket.readyState !== wsOpenState) {
      return;
    }
    if (session.inFlight) {
      return;
    }
    session.inFlight = true;

    try {
      const requestConfig = buildCameraRequestConfig(session.activeUrl);
      const response = await fetch(requestConfig.url, {
        cache: "no-store",
        headers: requestConfig.headers,
        ...buildCameraFetchOptions(requestConfig.url),
      });

      if (!response.ok) {
        sendJson(session.socket, {
          type: "error",
          source: "cameraSnapshot",
          message: `Snapshot fetch failed (${response.status})`,
          ts: Date.now(),
        });
        return;
      }

      const sourceBuffer = Buffer.from(await response.arrayBuffer());
      const buffer = await optimizeSnapshotBuffer(sourceBuffer);
      sendBinary(session.socket, buffer);
    } catch (error) {
      sendJson(session.socket, {
        type: "error",
        source: "cameraSnapshot",
        message: error instanceof Error ? error.message : "Snapshot websocket fetch failed",
        ts: Date.now(),
      });
    } finally {
      session.inFlight = false;
    }
  };

  const applyStartPayload = async (session, payload) => {
    const targetUrl = typeof payload?.url === "string" ? payload.url.trim() : "";
    if (!targetUrl) {
      sendJson(session.socket, {
        type: "error",
        source: "cameraSnapshot",
        message: "url missing",
        ts: Date.now(),
      });
      return;
    }

    session.activeUrl = targetUrl;
    session.refreshMs = normalizeRefreshMs(payload?.refreshMs);
    clearSessionTimer(session);
    const staggerKey = typeof payload?.staggerKey === "string" ? payload.staggerKey : targetUrl;
    const staggerDelay = stableHash(staggerKey) % session.refreshMs;
    session.delayTimer = setTimeout(() => {
      session.delayTimer = null;
      void sendSnapshot(session);
      session.timer = setInterval(() => {
        void sendSnapshot(session);
      }, session.refreshMs);
    }, staggerDelay);

    sendJson(session.socket, {
      type: "startAck",
      source: "cameraSnapshot",
      refreshMs: session.refreshMs,
      staggerDelay,
      width: CAMERA_SNAPSHOT_WIDTH,
      height: CAMERA_SNAPSHOT_HEIGHT,
      quality: CAMERA_SNAPSHOT_JPEG_QUALITY,
      ts: Date.now(),
    });
  };

  const releaseSession = (session) => {
    if (!sessions.has(session)) {
      return;
    }
    sessions.delete(session);
    clearSessionTimer(session);
    session.activeUrl = "";
  };

  const { wss, close: closeWebSocketServer } = createPathWebSocketServer(
    server,
    CAMERA_SNAPSHOT_WS_PATH,
    WebSocketServerCtor
  );

  wss.on("connection", (socket) => {
    const session = {
      socket,
      timer: null,
      delayTimer: null,
      inFlight: false,
      activeUrl: "",
      refreshMs: 2000,
    };
    sessions.add(session);

    sendJson(socket, {
      type: "hello",
      source: "cameraSnapshot",
      path: CAMERA_SNAPSHOT_WS_PATH,
      ts: Date.now(),
    });

    socket.on("message", (raw) => {
      let payload;
      try {
        payload = JSON.parse(String(raw || ""));
      } catch {
        sendJson(socket, {
          type: "error",
          source: "cameraSnapshot",
          message: "Invalid JSON payload",
          ts: Date.now(),
        });
        return;
      }

      const messageType = typeof payload?.type === "string" ? payload.type : "";
      if (messageType === "ping") {
        sendJson(socket, { type: "pong", source: "cameraSnapshot", ts: Date.now() });
        return;
      }

      if (messageType === "start") {
        void applyStartPayload(session, payload);
        return;
      }

      if (messageType === "stop") {
        clearSessionTimer(session);
        sendJson(socket, { type: "stopAck", source: "cameraSnapshot", ts: Date.now() });
        return;
      }

      sendJson(socket, {
        type: "error",
        source: "cameraSnapshot",
        message: `Unsupported message type: ${messageType || "unknown"}`,
        ts: Date.now(),
      });
    });

    socket.on("close", () => {
      releaseSession(session);
    });

    socket.on("error", () => {
      releaseSession(session);
    });
  });

  adapter.log.info(`Camera snapshot websocket enabled on ${CAMERA_SNAPSHOT_WS_PATH}`);

  return () => {
    for (const session of Array.from(sessions)) {
      try {
        session.socket.close();
      } catch {
        // ignore socket close failures
      }
      releaseSession(session);
    }
    closeWebSocketServer();
  };
}

function stableHash(value) {
  let hash = 2166136261;
  const normalized = String(value || "");
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function optimizeSnapshotBuffer(sourceBuffer) {
  if (!Sharp) {
    return sourceBuffer;
  }
  return Sharp(sourceBuffer)
    .rotate()
    .resize(CAMERA_SNAPSHOT_WIDTH, CAMERA_SNAPSHOT_HEIGHT, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: CAMERA_SNAPSHOT_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

function setupLogWebSocket(adapter, server) {
  const WebSocketServerCtor = WebSocketClient?.WebSocketServer || WebSocketClient?.Server;
  if (!WebSocketClient || !WebSocketServerCtor) {
    adapter.log.warn("Log websocket disabled: ws server dependency unavailable.");
    return () => undefined;
  }

  const wsOpenState = typeof WebSocketClient.OPEN === "number" ? WebSocketClient.OPEN : 1;
  const sessions = new Set();

  const sendJson = (socket, payload) => {
    if (!socket || socket.readyState !== wsOpenState) {
      return;
    }
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // ignore send failures
    }
  };

  const normalizeLogWatchPayload = (payload) => ({
    limit: clampInt(payload?.limit, 100, 1, LOG_PUSH_MAX_ENTRIES_PER_CLIENT),
    minSeverity: normalizeLogSeverity(payload?.minSeverity),
    source: normalizeFilter(payload?.source),
    contains: normalizeFilter(payload?.contains),
  });

  const sendSnapshot = (session, requestId) => {
    const entries = readBufferedLogs(session.filter);
    sendJson(session.socket, {
      type: "snapshot",
      source: "logBuffer",
      requestId: requestId || null,
      entries,
      ts: Date.now(),
    });
  };

  const applyWatchPayload = (session, payload) => {
    session.filter = normalizeLogWatchPayload(payload);
    sendJson(session.socket, {
      type: "watchAck",
      source: "logBuffer",
      requestId: payload?.requestId || null,
      limit: session.filter.limit,
      ts: Date.now(),
    });
    sendSnapshot(session, payload?.requestId || null);
  };

  const releaseSession = (session) => {
    if (!sessions.has(session)) {
      return;
    }
    sessions.delete(session);
  };

  const broadcastLogEntry = (entry) => {
    for (const session of sessions) {
      if (!matchesLogEntryFilter(entry, session.filter)) {
        continue;
      }
      sendJson(session.socket, {
        type: "entry",
        source: "logBuffer",
        entry,
        ts: Date.now(),
      });
    }
  };

  logPushBroadcast = broadcastLogEntry;

  const { wss, close: closeWebSocketServer } = createPathWebSocketServer(
    server,
    LOG_PUSH_WS_PATH,
    WebSocketServerCtor
  );

  wss.on("connection", (socket) => {
    const session = {
      socket,
      filter: normalizeLogWatchPayload({}),
    };
    sessions.add(session);

    sendJson(socket, {
      type: "hello",
      source: "logBuffer",
      path: LOG_PUSH_WS_PATH,
      ts: Date.now(),
    });

    socket.on("message", (raw) => {
      let payload;
      try {
        payload = JSON.parse(String(raw || ""));
      } catch {
        sendJson(socket, {
          type: "error",
          source: "logBuffer",
          message: "Invalid JSON payload",
          ts: Date.now(),
        });
        return;
      }

      const messageType = typeof payload?.type === "string" ? payload.type : "";
      if (messageType === "ping") {
        sendJson(socket, { type: "pong", source: "logBuffer", ts: Date.now() });
        return;
      }

      if (messageType === "watch") {
        applyWatchPayload(session, payload);
        return;
      }

      sendJson(socket, {
        type: "error",
        source: "logBuffer",
        message: `Unsupported message type: ${messageType || "unknown"}`,
        ts: Date.now(),
      });
    });

    socket.on("close", () => {
      releaseSession(session);
    });

    socket.on("error", () => {
      releaseSession(session);
    });
  });

  adapter.log.info(`Log websocket enabled on ${LOG_PUSH_WS_PATH}`);

  return () => {
    if (logPushBroadcast === broadcastLogEntry) {
      logPushBroadcast = null;
    }
    for (const session of Array.from(sessions)) {
      try {
        session.socket.close();
      } catch {
        // ignore socket close failures
      }
      releaseSession(session);
    }
    closeWebSocketServer();
  };
}

function setupScriptWebSocket(adapter, server) {
  const WebSocketServerCtor = WebSocketClient?.WebSocketServer || WebSocketClient?.Server;
  if (!WebSocketClient || !WebSocketServerCtor) {
    adapter.log.warn("Script websocket disabled: ws server dependency unavailable.");
    return () => undefined;
  }

  const wsOpenState = typeof WebSocketClient.OPEN === "number" ? WebSocketClient.OPEN : 1;
  const sessions = new Set();

  const sendJson = (socket, payload) => {
    if (!socket || socket.readyState !== wsOpenState) {
      return;
    }
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // ignore send failures
    }
  };

  const normalizeScriptWatchPayload = (payload) => ({
    limit: clampInt(payload?.limit, 200, 1, SCRIPT_PUSH_MAX_ENTRIES_PER_CLIENT),
    instance: normalizeFilter(payload?.instance),
    contains: normalizeFilter(payload?.contains),
  });

  const sendSnapshot = async (session, requestId) => {
    const entries = await listJavaScriptEntries(adapter, session.filter);
    sendJson(session.socket, {
      type: "snapshot",
      source: "scripts",
      requestId: requestId || null,
      entries,
      ts: Date.now(),
    });
  };

  const applyWatchPayload = async (session, payload) => {
    session.filter = normalizeScriptWatchPayload(payload);
    sendJson(session.socket, {
      type: "watchAck",
      source: "scripts",
      requestId: payload?.requestId || null,
      limit: session.filter.limit,
      ts: Date.now(),
    });
    await sendSnapshot(session, payload?.requestId || null);
  };

  const releaseSession = (session) => {
    if (!sessions.has(session)) {
      return;
    }
    sessions.delete(session);
  };

  const broadcastScriptStateChange = async (stateId, state) => {
    const stateValue = state ? state.val : null;
    const instance = resolveScriptInstance(stateId);
    const scriptEntry = state
      ? await readScriptEntryForStateId(adapter, stateId, stateValue)
      : {
          stateId,
          name: resolveScriptName({ id: stateId, name: "" }),
          instance,
          enabled: false,
        };

    for (const session of sessions) {
      if (!matchesScriptInstance(session.filter, instance)) {
        continue;
      }

      if (!state) {
        sendJson(session.socket, {
          type: "entry",
          source: "scripts",
          action: "remove",
          entry: scriptEntry,
          ts: Date.now(),
        });
        continue;
      }

      if (!matchesScriptEntryFilter(scriptEntry, session.filter)) {
        sendJson(session.socket, {
          type: "entry",
          source: "scripts",
          action: "remove",
          entry: scriptEntry,
          ts: Date.now(),
        });
        continue;
      }

      sendJson(session.socket, {
        type: "entry",
        source: "scripts",
        action: "upsert",
        entry: scriptEntry,
        ts: Date.now(),
      });
    }
  };

  const stateChangeHandler = (stateId, state) => {
    if (!isScriptEnabledStateId(stateId)) {
      return;
    }
    void broadcastScriptStateChange(stateId, state).catch(() => undefined);
  };

  adapter.on("stateChange", stateChangeHandler);

  const { wss, close: closeWebSocketServer } = createPathWebSocketServer(
    server,
    SCRIPT_PUSH_WS_PATH,
    WebSocketServerCtor
  );

  wss.on("connection", (socket) => {
    const session = {
      socket,
      filter: normalizeScriptWatchPayload({}),
    };
    sessions.add(session);

    sendJson(socket, {
      type: "hello",
      source: "scripts",
      path: SCRIPT_PUSH_WS_PATH,
      ts: Date.now(),
    });

    socket.on("message", (raw) => {
      let payload;
      try {
        payload = JSON.parse(String(raw || ""));
      } catch {
        sendJson(socket, {
          type: "error",
          source: "scripts",
          message: "Invalid JSON payload",
          ts: Date.now(),
        });
        return;
      }

      const messageType = typeof payload?.type === "string" ? payload.type : "";
      if (messageType === "ping") {
        sendJson(socket, { type: "pong", source: "scripts", ts: Date.now() });
        return;
      }

      if (messageType === "watch") {
        void applyWatchPayload(session, payload).catch((error) => {
          sendJson(socket, {
            type: "error",
            source: "scripts",
            message: error instanceof Error ? error.message : "Script watch update failed",
            requestId: payload?.requestId || null,
            ts: Date.now(),
          });
        });
        return;
      }

      sendJson(socket, {
        type: "error",
        source: "scripts",
        message: `Unsupported message type: ${messageType || "unknown"}`,
        ts: Date.now(),
      });
    });

    socket.on("close", () => {
      releaseSession(session);
    });

    socket.on("error", () => {
      releaseSession(session);
    });
  });

  adapter.log.info(`Script websocket enabled on ${SCRIPT_PUSH_WS_PATH}`);

  return () => {
    adapter.removeListener("stateChange", stateChangeHandler);
    for (const session of Array.from(sessions)) {
      try {
        session.socket.close();
      } catch {
        // ignore socket close failures
      }
      releaseSession(session);
    }
    closeWebSocketServer();
  };
}

function buildCameraRequestConfig(rawUrl) {
  const parsed = new URL(rawUrl);
  const headers = {};

  const authFromUserInfo = parsed.username || parsed.password;
  const queryUser =
    parsed.searchParams.get("user") ||
    parsed.searchParams.get("username") ||
    parsed.searchParams.get("User") ||
    parsed.searchParams.get("Username") ||
    "";
  const queryPassword =
    parsed.searchParams.get("password") ||
    parsed.searchParams.get("pass") ||
    parsed.searchParams.get("pwd") ||
    parsed.searchParams.get("Password") ||
    parsed.searchParams.get("Pass") ||
    parsed.searchParams.get("Pwd") ||
    "";
  const resolvedUsername = decodeURIComponent(parsed.username || queryUser || "");
  const resolvedPassword = decodeURIComponent(parsed.password || queryPassword || "");

  if (authFromUserInfo || queryUser || queryPassword) {
    const auth = Buffer.from(`${resolvedUsername}:${resolvedPassword}`).toString("base64");
    headers.Authorization = `Basic ${auth}`;
    if (authFromUserInfo) {
      parsed.username = "";
      parsed.password = "";
    }
  }

  return {
    url: parsed.toString(),
    headers,
    auth: {
      username: resolvedUsername,
      password: resolvedPassword,
      hasQueryCredentials: Boolean(queryUser || queryPassword),
    },
  };
}

function sanitizeCameraUrlForLog(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.username = "";
    parsed.password = "";
    ["password", "pass", "pwd", "token", "auth"].forEach((key) => {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, "***");
      }
      const upper = key.charAt(0).toUpperCase() + key.slice(1);
      if (parsed.searchParams.has(upper)) {
        parsed.searchParams.set(upper, "***");
      }
    });
    return parsed.toString();
  } catch {
    return "<invalid-url>";
  }
}

function buildCameraFetchOptions(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const options = {
      redirect: "follow",
    };

    if (parsed.protocol === "https:" && isLikelyLocalHost(parsed.hostname)) {
      const dispatcher = getInsecureHttpsDispatcher();
      if (dispatcher) {
        options.dispatcher = dispatcher;
      }
    }

    return options;
  } catch {
    return {
      redirect: "follow",
    };
  }
}

function proxyCameraStream(requestConfig, req, res, streamType, redirects, authRetries = 0) {
  const sanitizedUrl = sanitizeCameraUrlForLog(requestConfig.url);
  const log = runningAdapter?.log;
  let parsed;
  try {
    parsed = new URL(requestConfig.url);
  } catch {
    if (!res.headersSent) {
      res.status(400).json({ error: "Invalid camera stream URL" });
    } else {
      res.end();
    }
    return;
  }

  const useHttps = parsed.protocol === "https:";
  const transport = useHttps ? https : http;
  let upstreamResponseRef = null;
  let closed = false;
  const forwardedRange = typeof req.headers.range === "string" ? req.headers.range : "";
  const forwardedIfRange = typeof req.headers["if-range"] === "string" ? req.headers["if-range"] : "";
  const forwardedUserAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "";
  const forwardedAccept = typeof req.headers.accept === "string" ? req.headers.accept : "";
  const allowRangeForwarding = streamType !== "fmp4";
  const upstreamRequest = transport.request(
    {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (useHttps ? 443 : 80),
      method: "GET",
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        Accept: forwardedAccept || "*/*",
        ...(allowRangeForwarding && forwardedRange ? { Range: forwardedRange } : {}),
        ...(allowRangeForwarding && forwardedIfRange ? { "If-Range": forwardedIfRange } : {}),
        "User-Agent": forwardedUserAgent || "ioBroker-smart-dashboard-camera-proxy/1.0",
        ...requestConfig.headers,
      },
      rejectUnauthorized: !(useHttps && isLikelyLocalHost(parsed.hostname)),
    },
    (upstreamResponse) => {
      upstreamResponseRef = upstreamResponse;
      const statusCode = upstreamResponse.statusCode || 502;
      const location = upstreamResponse.headers.location;
      const upstreamContentType = upstreamResponse.headers["content-type"] || "";

      if (
        location &&
        [301, 302, 303, 307, 308].includes(statusCode) &&
        redirects < 5
      ) {
        log?.debug(
          `[camera-proxy] redirect streamType=${streamType || "unknown"} status=${statusCode} from=${sanitizedUrl} to=${sanitizeCameraUrlForLog(
            new URL(location, requestConfig.url).toString()
          )}`
        );
        upstreamResponse.resume();
        const redirectedUrl = new URL(location, requestConfig.url).toString();
        const redirectedConfig = buildCameraRequestConfig(redirectedUrl);
        if (!redirectedConfig.headers.Authorization && requestConfig.headers.Authorization) {
          redirectedConfig.headers.Authorization = requestConfig.headers.Authorization;
        }
        proxyCameraStream(redirectedConfig, req, res, streamType, redirects + 1, authRetries);
        return;
      }

      if (statusCode >= 400) {
        if (
          (statusCode === 401 || statusCode === 403) &&
          streamType === "mjpeg" &&
          authRetries < 3 &&
          requestConfig.auth?.username &&
          requestConfig.auth?.password !== undefined
        ) {
          try {
            const variant = authRetries === 0 ? "userPwd" : authRetries === 1 ? "usernamePassword" : "both";
            const retryUrl = withCameraQueryCredentials(
              requestConfig.url,
              requestConfig.auth.username,
              requestConfig.auth.password || "",
              variant
            );
            const retryConfig = buildCameraRequestConfig(retryUrl);
            if (authRetries >= 2) {
              delete retryConfig.headers.Authorization;
            } else if (!retryConfig.headers.Authorization && requestConfig.headers.Authorization) {
              retryConfig.headers.Authorization = requestConfig.headers.Authorization;
            }
            log?.warn(
              `[camera-proxy] upstream ${statusCode} streamType=mjpeg, retry auth strategy=${variant} url=${sanitizeCameraUrlForLog(
                retryConfig.url
              )}`
            );
            upstreamResponse.resume();
            proxyCameraStream(retryConfig, req, res, streamType, redirects, authRetries + 1);
            return;
          } catch {
            // fall through to normal error handling
          }
        }

        log?.warn(
          `[camera-proxy] upstream error streamType=${streamType || "unknown"} status=${statusCode} contentType=${String(
            upstreamContentType
          )} url=${sanitizedUrl}`
        );
        const chunks = [];
        upstreamResponse.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        upstreamResponse.on("end", () => {
          if (res.headersSent) {
            return;
          }
          const body = Buffer.concat(chunks).toString("utf8");
          res.status(statusCode).json({ error: body || `Stream fetch failed (${statusCode})` });
        });
        return;
      }

      log?.debug(
        `[camera-proxy] stream ok streamType=${streamType || "unknown"} status=${statusCode} contentType=${String(
          upstreamContentType
        )} url=${sanitizedUrl}`
      );

      const sourceContentType = upstreamResponse.headers["content-type"];
      const contentType =
        sourceContentType ||
        (streamType === "flv" || looksLikeFlvUrl(requestConfig.url)
          ? "video/x-flv"
          : streamType === "fmp4"
            ? "video/mp4"
            : "multipart/x-mixed-replace");

      res.status(statusCode);
      for (const [header, value] of Object.entries(upstreamResponse.headers)) {
        if (value === undefined) {
          continue;
        }
        if (isHopByHopProxyHeader(header)) {
          continue;
        }
        res.setHeader(header, value);
      }
      if (!res.hasHeader("Content-Type")) {
        res.setHeader("Content-Type", contentType);
      }
      if (!res.hasHeader("Cache-Control")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      }
      res.setHeader("X-Accel-Buffering", "no");

      upstreamResponse.on("error", () => {
        if (!res.headersSent) {
          res.status(502).end();
          return;
        }
        res.end();
      });
      upstreamResponse.pipe(res);
    }
  );

  const closeUpstream = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (upstreamResponseRef) {
      try {
        upstreamResponseRef.unpipe(res);
      } catch {
        // ignore
      }
      try {
        upstreamResponseRef.destroy();
      } catch {
        // ignore
      }
    }
    try {
      upstreamRequest.destroy();
    } catch {
      // ignore
    }
  };

  req.on("aborted", closeUpstream);
  req.on("close", closeUpstream);
  res.on("close", closeUpstream);

  upstreamRequest.on("error", (error) => {
    log?.warn(
      `[camera-proxy] request failed streamType=${streamType || "unknown"} url=${sanitizedUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    if (!res.headersSent) {
      res.status(502).json({ error: error instanceof Error ? error.message : "Stream proxy request failed" });
      return;
    }
    res.end();
  });

  upstreamRequest.end();
}

function isHopByHopProxyHeader(headerName) {
  const normalized = String(headerName || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "connection" ||
    normalized === "keep-alive" ||
    normalized === "proxy-authenticate" ||
    normalized === "proxy-authorization" ||
    normalized === "te" ||
    normalized === "trailer" ||
    normalized === "transfer-encoding" ||
    normalized === "upgrade"
  );
}

function withCameraQueryCredentials(rawUrl, username, password, variant = "userPwd") {
  const parsed = new URL(rawUrl);
  const user = String(username || "");
  const pass = String(password || "");

  if (variant === "userPwd" || variant === "both") {
    parsed.searchParams.set("user", user);
    parsed.searchParams.set("pwd", pass);
  }

  if (variant === "usernamePassword" || variant === "both") {
    parsed.searchParams.set("username", user);
    parsed.searchParams.set("password", pass);
  }

  return parsed.toString();
}

function getInsecureHttpsDispatcher() {
  if (!UndiciAgent) {
    return null;
  }
  if (insecureHttpsDispatcher) {
    return insecureHttpsDispatcher;
  }
  insecureHttpsDispatcher = new UndiciAgent({
    connect: {
      rejectUnauthorized: false,
    },
  });
  return insecureHttpsDispatcher;
}

function isLikelyLocalHost(hostname) {
  if (!hostname) {
    return false;
  }

  const host = String(hostname).toLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) {
    return true;
  }

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return false;
  }

  const octets = ipv4Match.slice(1).map((value) => Number(value));
  if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return false;
  }

  const [a, b] = octets;
  if (a === 10) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 127) {
    return true;
  }

  return false;
}

function looksLikeFlvUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.endsWith(".flv") || pathname.includes("/flv")) {
      return true;
    }
    const streamParam = parsed.searchParams.get("stream");
    if (streamParam && streamParam.toLowerCase().includes(".bcs")) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function startLogCapture(adapter) {
  if (!logListenerRegistered) {
    adapter.on("log", handleAdapterLogMessage);
    logListenerRegistered = true;
  }

  if (typeof adapter.requireLog === "function") {
    Promise.resolve(adapter.requireLog(true)).catch((error) => {
      adapter.log.warn(`Log subscription activation failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  } else {
    adapter.log.warn("Log transporter is not available; Log-Widget may stay empty.");
  }

  appendLogEntry({
    _id: Date.now(),
    from: `system.adapter.${adapter.namespace}`,
    severity: "info",
    ts: Date.now(),
    message: "SmartHome Dashboard V2 log capture active",
  });
}

function stopLogCapture(adapter) {
  if (logListenerRegistered) {
    adapter.removeListener("log", handleAdapterLogMessage);
    logListenerRegistered = false;
  }

  if (typeof adapter.requireLog === "function") {
    return adapter.requireLog(false);
  }

  return undefined;
}

function handleAdapterLogMessage(message) {
  appendLogEntry(message);
}

function appendLogEntry(message) {
  if (!message || typeof message !== "object") {
    return;
  }

  const entry = {
    id: Number.isFinite(message._id) ? message._id : Date.now(),
    from: typeof message.from === "string" ? message.from : "",
    severity: normalizeLogSeverity(message.severity),
    ts: Number.isFinite(message.ts) ? Number(message.ts) : Date.now(),
    message: normalizeLogText(message.message),
  };

  logEntriesBuffer.push(entry);
  if (logEntriesBuffer.length > LOG_BUFFER_LIMIT) {
    logEntriesBuffer = logEntriesBuffer.slice(-LOG_BUFFER_LIMIT);
  }

  if (typeof logPushBroadcast === "function") {
    try {
      logPushBroadcast(entry);
    } catch {
      // ignore broadcast failures
    }
  }
}

function normalizeLogText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeLogSeverity(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (value in LOG_LEVEL_ORDER) {
    return value;
  }
  return "info";
}

function severityRank(severity) {
  const normalized = normalizeLogSeverity(severity);
  return LOG_LEVEL_ORDER[normalized] ?? LOG_LEVEL_ORDER.info;
}

function normalizeFilter(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clampInt(raw, fallback, min, max) {
  const parsed = Number.parseInt(String(raw || ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function readBufferedLogs({ limit, minSeverity, source, contains }) {
  const minSeverityRank = severityRank(minSeverity);
  const sourceFilter = String(source || "").toLowerCase();
  const textFilter = String(contains || "").toLowerCase();

  const filtered = logEntriesBuffer.filter((entry) => {
    if (severityRank(entry.severity) < minSeverityRank) {
      return false;
    }
    if (sourceFilter && !String(entry.from || "").toLowerCase().includes(sourceFilter)) {
      return false;
    }
    if (textFilter && !String(entry.message || "").toLowerCase().includes(textFilter)) {
      return false;
    }
    return true;
  });

  return filtered.slice(-limit).reverse();
}

function matchesLogEntryFilter(entry, options) {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  if (!options || typeof options !== "object") {
    return true;
  }

  if (severityRank(entry.severity) < severityRank(options.minSeverity)) {
    return false;
  }

  const sourceFilter = String(options.source || "").trim().toLowerCase();
  if (sourceFilter && !String(entry.from || "").toLowerCase().includes(sourceFilter)) {
    return false;
  }

  const textFilter = String(options.contains || "").trim().toLowerCase();
  if (textFilter && !String(entry.message || "").toLowerCase().includes(textFilter)) {
    return false;
  }

  return true;
}

async function listJavaScriptEntries(adapter, options) {
  const limit = clampInt(options?.limit, 200, 1, 1000);
  const containsFilter = String(options?.contains || "")
    .trim()
    .toLowerCase();
  const instanceFilter = String(options?.instance || "")
    .trim()
    .toLowerCase();
  const entries = await getCachedObjectEntries(adapter);
  const candidates = entries.filter((entry) => {
    if (!isScriptEnabledStateId(entry.id)) {
      return false;
    }

    if (instanceFilter) {
      const instance = resolveScriptInstance(entry.id).toLowerCase();
      if (instance !== instanceFilter) {
        return false;
      }
    }

    if (!containsFilter) {
      return true;
    }

    return (
      String(entry.id || "").toLowerCase().includes(containsFilter) ||
      String(entry.name || "").toLowerCase().includes(containsFilter)
    );
  });

  // Avoid wildcard-in-the-middle lookups because they trigger expensive fallback scans.
  const states = await adapter.getForeignStatesAsync("javascript.*");
  const fetched = candidates.slice(0, 1500).map((entry) => ({
    stateId: entry.id,
    name: resolveScriptName(entry),
    instance: resolveScriptInstance(entry.id),
    enabled: normalizeScriptEnabledValue(states?.[entry.id]?.val),
  }));

  return fetched
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name, "de");
      if (byName !== 0) {
        return byName;
      }
      return a.stateId.localeCompare(b.stateId, "de");
    })
    .slice(0, limit);
}

async function readScriptEntryForStateId(adapter, stateId, stateValue) {
  const entries = await getCachedObjectEntries(adapter);
  const cachedObject = entries.find((entry) => entry.id === stateId);
  const name = resolveScriptName({
    id: stateId,
    name: cachedObject?.name || "",
  });

  return {
    stateId,
    name,
    instance: resolveScriptInstance(stateId),
    enabled: normalizeScriptEnabledValue(stateValue),
  };
}

function matchesScriptInstance(options, instance) {
  const filter = String(options?.instance || "").trim().toLowerCase();
  if (!filter) {
    return true;
  }
  return String(instance || "").trim().toLowerCase() === filter;
}

function matchesScriptEntryFilter(entry, options) {
  if (!matchesScriptInstance(options, entry.instance)) {
    return false;
  }

  const containsFilter = String(options?.contains || "").trim().toLowerCase();
  if (!containsFilter) {
    return true;
  }

  return (
    String(entry.stateId || "").toLowerCase().includes(containsFilter) ||
    String(entry.name || "").toLowerCase().includes(containsFilter)
  );
}

function isScriptEnabledStateId(stateId) {
  const id = String(stateId || "");
  return id.startsWith("javascript.") && id.includes(".scriptEnabled.");
}

function resolveScriptInstance(stateId) {
  const parts = String(stateId || "").split(".");
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[1]}`;
  }
  return "javascript.0";
}

function resolveScriptName(entry) {
  const friendlyName = typeof entry?.name === "string" ? entry.name.trim() : "";
  if (friendlyName) {
    return friendlyName;
  }

  const id = String(entry?.id || "");
  const marker = ".scriptEnabled.";
  const markerIndex = id.indexOf(marker);
  if (markerIndex >= 0) {
    const suffix = id.slice(markerIndex + marker.length);
    if (suffix) {
      return suffix;
    }
  }

  return id;
}

function normalizeScriptEnabledValue(value) {
  if (value === true || value === 1) {
    return true;
  }
  if (value === false || value === 0) {
    return false;
  }

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on" || normalized === "enabled";
}

async function readHostStats(adapter) {
  const hostName = String(adapter.host || os.hostname() || "host");
  const disk = readDiskStats();
  const ramTotalBytes = toFiniteNumber(os.totalmem());
  const ramFreeBytes = toFiniteNumber(os.freemem());
  const cpuUsagePercent = sampleCpuUsagePercent();
  const cpuTemperatureC = await resolveCpuTemperature(adapter, hostName);
  const processes = await resolveProcessCount(adapter);

  return {
    hostName,
    ts: Date.now(),
    diskTotalBytes: disk.totalBytes,
    diskFreeBytes: disk.freeBytes,
    ramTotalBytes,
    ramFreeBytes,
    cpuUsagePercent,
    cpuTemperatureC,
    processes,
  };
}

let previousCpuSnapshot = null;

function sampleCpuUsagePercent() {
  const cpuList = os.cpus();
  if (!Array.isArray(cpuList) || !cpuList.length) {
    return null;
  }

  let total = 0;
  let idle = 0;
  for (const core of cpuList) {
    const times = core?.times || {};
    const user = toFiniteNumber(times.user);
    const nice = toFiniteNumber(times.nice);
    const sys = toFiniteNumber(times.sys);
    const irq = toFiniteNumber(times.irq);
    const currentIdle = toFiniteNumber(times.idle);
    total += user + nice + sys + irq + currentIdle;
    idle += currentIdle;
  }

  const now = Date.now();
  if (!previousCpuSnapshot) {
    previousCpuSnapshot = { total, idle, now };
    return null;
  }

  const deltaTotal = total - previousCpuSnapshot.total;
  const deltaIdle = idle - previousCpuSnapshot.idle;
  previousCpuSnapshot = { total, idle, now };

  if (!Number.isFinite(deltaTotal) || deltaTotal <= 0) {
    return null;
  }

  const usage = ((deltaTotal - deltaIdle) / deltaTotal) * 100;
  return clampNumber(usage, 0, 100);
}

function readDiskStats() {
  const fallback = {
    totalBytes: null,
    freeBytes: null,
  };

  if (typeof fs.statfsSync !== "function") {
    return fallback;
  }

  try {
    const stats = fs.statfsSync("/");
    const blockSize = toFiniteNumber(stats.bsize || stats.frsize);
    const blocks = toFiniteNumber(stats.blocks);
    const freeBlocks = toFiniteNumber(stats.bavail ?? stats.bfree);

    if (!blockSize || !blocks || !Number.isFinite(freeBlocks)) {
      return fallback;
    }

    return {
      totalBytes: blockSize * blocks,
      freeBytes: blockSize * freeBlocks,
    };
  } catch {
    return fallback;
  }
}

async function resolveCpuTemperature(adapter, hostName) {
  const stateIds = [
    `system.host.${hostName}.cpuTemperature`,
    `system.host.${hostName}.temp`,
  ];

  for (const stateId of stateIds) {
    try {
      const state = await adapter.getForeignStateAsync(stateId);
      const parsed = parseTemperatureValue(state?.val);
      if (parsed !== null) {
        return parsed;
      }
    } catch {
      // continue
    }
  }

  const files = [
    "/sys/class/thermal/thermal_zone0/temp",
    "/sys/devices/virtual/thermal/thermal_zone0/temp",
    "/sys/class/hwmon/hwmon0/temp1_input",
  ];

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, "utf8");
      const parsed = parseTemperatureValue(content);
      if (parsed !== null) {
        return parsed;
      }
    } catch {
      // continue
    }
  }

  return null;
}

function parseTemperatureValue(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  if (numeric > 1000) {
    return clampNumber(numeric / 1000, 0, 150);
  }
  return clampNumber(numeric, 0, 150);
}

async function resolveProcessCount(adapter) {
  try {
    const view = await adapter.getObjectViewAsync("system", "instance", {
      startkey: "system.adapter.",
      endkey: "system.adapter.\u9999",
    });
    const count = Array.isArray(view?.rows) ? view.rows.length : null;
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

function toFiniteNumber(value) {
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

async function readSavedDashboards(adapter) {
  const state = await adapter.getStateAsync(SAVED_DASHBOARDS_STATE_ID);
  const raw = typeof state?.val === "string" ? state.val : "";
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => typeof key === "string" && key.trim() && typeof value === "string" && value
      )
    );
  } catch {
    return {};
  }
}

async function writeSavedDashboards(adapter, dashboards) {
  await adapter.setStateAsync(SAVED_DASHBOARDS_STATE_ID, {
    val: JSON.stringify(dashboards, null, 2),
    ack: true,
  });
}

function immutableStaticOptions() {
  return {
    setHeaders(res, filePath) {
      const fileName = path.basename(filePath);
      if (/[.-][a-f0-9]{8,}\.(?:js|css|png|jpe?g|webp|gif|svg|mp3|wav)$/i.test(fileName)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  };
}

async function sendWebShell(webRoot, res, next) {
  try {
    if (!webShellCache) {
      const indexPath = path.join(webRoot, "index.html");
      const html = await fs.promises.readFile(indexPath, "utf8");
      webShellCache = injectStandaloneMeta(html);
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.send(webShellCache);
  } catch (error) {
    next(error);
  }
}

function injectStandaloneMeta(html) {
  const standaloneMeta = [
    '<meta name="theme-color" content="#040811" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    '<meta name="apple-mobile-web-app-title" content="SmartHome Dashboard V2" />',
  ].join("\n    ");

  return html
    .replace(
      /<meta name="viewport"[^>]*>/i,
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, shrink-to-fit=no" />'
    )
    .replace("</head>", `    ${standaloneMeta}\n  </head>`);
}

async function getCachedObjectEntries(adapter) {
  const cacheIsFresh = objectEntriesCache.length > 0 && Date.now() - objectEntriesCacheTimestamp < OBJECT_CACHE_TTL_MS;
  if (cacheIsFresh) {
    return objectEntriesCache;
  }

  return refreshObjectEntries(adapter);
}

async function refreshObjectEntries(adapter) {
  if (objectEntriesPromise) {
    return objectEntriesPromise;
  }

  objectEntriesPromise = adapter
    .getObjectViewAsync("system", "state", {
      startkey: "",
      endkey: "\u9999",
    })
    .then((view) => {
      objectEntriesCache = (view?.rows || []).map((row) => ({
        id: row.id,
        name:
          row.value &&
          row.value.common &&
          typeof row.value.common.name === "string"
            ? row.value.common.name
            : undefined,
        type:
          row.value &&
          row.value.common &&
          typeof row.value.common.type === "string"
            ? row.value.common.type
            : undefined,
        role:
          row.value &&
          row.value.common &&
          typeof row.value.common.role === "string"
            ? row.value.common.role
            : undefined,
      }));
      objectEntriesCacheTimestamp = Date.now();
      return objectEntriesCache;
    })
    .finally(() => {
      objectEntriesPromise = null;
    });

  return objectEntriesPromise;
}

if (require.main !== module) {
  module.exports = startAdapter;
} else {
  startAdapter();
}
