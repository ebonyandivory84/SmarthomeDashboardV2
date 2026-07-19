const utils = require("@iobroker/adapter-core");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const os = require("os");

let child = null;
let stopping = false;
let invalidBinaryDetected = false;
let restartTimer = null;

// Agent 2: Binary-Validation-Cache + Config-Diff-Cache
let validatedBinaryPath = null;
let lastWrittenYaml = null;

// Agent 3: Health-Check
let healthCheckTimer = null;
let healthCheckGrace = null;
let healthFailCount = 0;

// Agent 1: State-Update-Debounce-Factory (Modul-Scope, prozesslokal)
function makeDebounced(stateId, delayMs) {
  let timer = null;
  let lastWritten = undefined;
  let pending = undefined;

  function flush() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (pending !== undefined && pending !== lastWritten) {
      lastWritten = pending;
      void adapter.setStateAsync(stateId, pending, true);
    }
    pending = undefined;
  }

  function push(value) {
    pending = value;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  }

  return { push, flush };
}

function startAdapter(options) {
  return new utils.Adapter({
    ...options,
    name: "go2rtc-host",
    ready: () => {
      void main().catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        adapter.log.error(message);
        await setStatus("error", Boolean(child), message);
      });
    },
    stateChange: (id, state) => onStateChange(id, state),
    unload: (callback) => {
      stopping = true;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      stopHealthCheck();
      stopGo2rtc("adapter unload")
        .catch(() => undefined)
        .finally(() => callback());
    },
  });
}

const adapter = startAdapter();

async function main() {
  await ensureObjects();
  await setStatus("stopped", false, "Adapter started");
  await adapter.subscribeStatesAsync("control.*");

  if (adapter.config.autoStart) {
    await startGo2rtc("autoStart");
  }
}

async function onStateChange(id, state) {
  if (!state || state.ack) return;
  if (!id.startsWith(`${adapter.namespace}.control.`)) return;

  const command = id.slice(`${adapter.namespace}.control.`.length);

  try {
    if (command === "start" && state.val === true) {
      await adapter.setStateAsync("control.start", false, true);
      await startGo2rtc("manual start");
      return;
    }
    if (command === "stop" && state.val === true) {
      await adapter.setStateAsync("control.stop", false, true);
      await stopGo2rtc("manual stop");
      return;
    }
    if (command === "restart" && state.val === true) {
      await adapter.setStateAsync("control.restart", false, true);
      await restartGo2rtc();
      return;
    }
    if (command === "install" && state.val === true) {
      await adapter.setStateAsync("control.install", false, true);
      await installBinary();
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    adapter.log.error(`Command ${command} failed: ${message}`);
    await setStatus("error", Boolean(child), message);
  }
}

function parseExtraArgs(input) {
  const raw = String(input || "").trim();
  if (!raw) return [];
  return raw.split(/\s+/g).filter(Boolean);
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function startGo2rtc(reason) {
  if (child) {
    adapter.log.info("go2rtc is already running");
    await setStatus("running", true, "Already running");
    return;
  }

  const binaryPath = String(adapter.config.binaryPath || "").trim();
  const configPath = String(adapter.config.configPath || "").trim();
  const workingDir = String(adapter.config.workingDir || "").trim() || path.dirname(binaryPath);

  if (!binaryPath || !configPath) {
    throw new Error("binaryPath and configPath must be configured");
  }

  await fsp.mkdir(workingDir, { recursive: true });
  await ensureGo2rtcConfig();

  if (!await fileExists(binaryPath)) {
    if (adapter.config.autoDownload) {
      await installBinary();
    } else {
      throw new Error(`go2rtc binary not found at ${binaryPath}`);
    }
  }

  if (!await fileExists(configPath)) {
    throw new Error(`go2rtc config not found at ${configPath}`);
  }

  await fsp.chmod(binaryPath, 0o755).catch(() => undefined);
  await validateBinary(binaryPath);
  invalidBinaryDetected = false;

  const args = ["-config", configPath, ...parseExtraArgs(adapter.config.extraArgs)];
  adapter.log.info(`Starting go2rtc (${reason}) with: ${binaryPath} ${args.join(" ")}`);

  const proc = spawn(binaryPath, args, {
    cwd: workingDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = proc;

  // Agent 1: debounced state updates, lastValue-Cache verhindert redundante Writes
  const logDebounce = makeDebounced("status.lastLog", 300);
  const errorDebounce = makeDebounced("status.lastError", 300);

  proc.stdout.on("data", (chunk) => {
    const lines = String(chunk).split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    for (const line of lines) adapter.log.info(`[go2rtc] ${line}`);
    logDebounce.push(lines[lines.length - 1]);
  });

  proc.stderr.on("data", (chunk) => {
    const lines = String(chunk).split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    for (const line of lines) adapter.log.warn(`[go2rtc] ${line}`);
    errorDebounce.push(lines[lines.length - 1]);
  });

  proc.once("exit", (code, signal) => {
    stopHealthCheck();
    logDebounce.flush();
    errorDebounce.flush();

    const expected = stopping;
    child = null;
    const message = `go2rtc exited (code=${code ?? "null"}, signal=${signal || "none"})`;
    adapter.log.warn(message);
    void setStatus(expected ? "stopped" : "error", false, message);

    if (!stopping && adapter.config.autoStart) {
      if (invalidBinaryDetected) {
        adapter.log.error("Skipping auto-restart: go2rtc binary appears invalid");
        return;
      }
      const restartMs = 3000;
      adapter.log.info(`Restarting go2rtc in ${restartMs}ms`);
      restartTimer = setTimeout(() => {
        restartTimer = null;
        void startGo2rtc("auto-restart").catch((error) => {
          const text = error instanceof Error ? error.message : String(error);
          void setStatus("error", false, text);
          adapter.log.error(`Auto-restart failed: ${text}`);
        });
      }, restartMs);
    }
  });

  await setStatus("running", true, "go2rtc running");
  await adapter.setStateAsync("status.pid", proc.pid || 0, true);

  // Agent 3: Health-Check startet nach 10s Grace-Period, Intervall 30s
  startHealthCheck(proc);
}

// Agent 2: validateBinary mit Pfad-Cache — kein erneuter Prozess-Spawn bei auto-restart
async function validateBinary(binaryPath) {
  if (!invalidBinaryDetected && validatedBinaryPath === binaryPath) return;

  await new Promise((resolve, reject) => {
    const probe = spawn(binaryPath, ["-version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    probe.stdout.resume();
    let stderr = "";
    probe.stderr.on("data", (chunk) => { stderr += String(chunk); });
    probe.once("error", reject);
    probe.once("exit", (code) => {
      if (code === 0) { resolve(); return; }
      const hint = stderr.trim() || `exit code ${code}`;
      invalidBinaryDetected = true;
      reject(new Error(`invalid go2rtc binary at ${binaryPath}: ${hint}`));
    });
  });

  invalidBinaryDetected = false;
  validatedBinaryPath = binaryPath;
}

// Agent 2: ensureGo2rtcConfig mit YAML-Diff — kein Disk-Write wenn Inhalt gleich
async function ensureGo2rtcConfig() {
  const configPath = String(adapter.config.configPath || "").trim();
  if (!configPath) throw new Error("configPath must be configured");
  if (adapter.config.autoGenerateConfig === false) return;

  const yaml = buildGo2rtcYamlFromConfig();
  if (yaml === lastWrittenYaml) return;

  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, yaml, "utf8");
  lastWrittenYaml = yaml;
}

function buildGo2rtcYamlFromConfig() {
  const apiListen = String(adapter.config.apiListen || "").trim() || ":1984";
  const webrtcListen = String(adapter.config.webrtcListen || "").trim() || ":8555";
  const rtspListen = String(adapter.config.rtspListen || "").trim() || ":8554";
  const rawStreams = String(adapter.config.streamsJson || "").trim();

  if (!rawStreams) {
    throw new Error("streamsJson is empty - configure at least one stream");
  }

  let parsed;
  try {
    parsed = JSON.parse(rawStreams);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`streamsJson is invalid JSON: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error('streamsJson must be a JSON object: {"name": ["rtsp://..."]}');
  }

  const streamEntries = Object.entries(parsed);
  if (!streamEntries.length) {
    throw new Error("streamsJson must contain at least one stream entry");
  }

  const lines = [
    "api:",
    `  listen: "${escapeYamlDoubleQuoted(apiListen)}"`,
    "",
    "webrtc:",
    `  listen: "${escapeYamlDoubleQuoted(webrtcListen)}"`,
    "",
    "rtsp:",
    `  listen: "${escapeYamlDoubleQuoted(rtspListen)}"`,
    "",
    "streams:",
  ];

  for (const [name, value] of streamEntries) {
    const streamName = String(name || "").trim();
    if (!streamName) throw new Error("streamsJson contains an empty stream name");
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`stream '${streamName}' must be a non-empty array`);
    }
    lines.push(`  ${streamName}:`);
    for (const item of value) {
      const url = String(item || "").trim();
      if (!url) throw new Error(`stream '${streamName}' contains empty url`);
      lines.push(`    - "${escapeYamlDoubleQuoted(url)}"`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function escapeYamlDoubleQuoted(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Agent 3: Health-Check-Mechanismus
function parseApiPort(apiListen) {
  const raw = String(apiListen || "").trim() || ":1984";
  const colon = raw.lastIndexOf(":");
  const port = parseInt(raw.slice(colon + 1), 10);
  return port > 0 && port < 65536 ? port : 1984;
}

function startHealthCheck(proc) {
  stopHealthCheck();
  healthFailCount = 0;
  const port = parseApiPort(adapter.config.apiListen);

  healthCheckGrace = setTimeout(() => {
    healthCheckGrace = null;
    healthCheckTimer = setInterval(() => {
      if (stopping || child !== proc) return;

      const req = http.get(
        { hostname: "127.0.0.1", port, path: "/", timeout: 3000 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) {
            healthFailCount = 0;
          } else {
            onHealthFail(proc, `HTTP ${res.statusCode}`);
          }
        }
      );
      req.on("timeout", () => { req.destroy(); onHealthFail(proc, "timeout"); });
      req.on("error", (err) => onHealthFail(proc, err.message));
    }, 30_000);
  }, 10_000);
}

function onHealthFail(proc, reason) {
  healthFailCount++;
  adapter.log.warn(`[healthcheck] go2rtc not responding (${reason}), consecutive failures: ${healthFailCount}`);
  if (healthFailCount >= 2 && !stopping && child === proc) {
    adapter.log.error("[healthcheck] go2rtc zombie detected — triggering restart");
    stopHealthCheck();
    proc.kill("SIGKILL");
  }
}

function stopHealthCheck() {
  if (healthCheckGrace) { clearTimeout(healthCheckGrace); healthCheckGrace = null; }
  if (healthCheckTimer) { clearInterval(healthCheckTimer); healthCheckTimer = null; }
  healthFailCount = 0;
}

async function stopGo2rtc(reason) {
  if (!child) {
    await setStatus("stopped", false, "Already stopped");
    return;
  }

  adapter.log.info(`Stopping go2rtc (${reason})`);
  stopping = true;
  stopHealthCheck();

  const current = child;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const forceTimer = setTimeout(() => {
      if (current.exitCode == null) current.kill("SIGKILL");
    }, 5000);

    current.once("exit", () => {
      clearTimeout(forceTimer);
      finish();
    });

    current.kill("SIGTERM");
  });

  stopping = false;
  await setStatus("stopped", false, "go2rtc stopped");
  await adapter.setStateAsync("status.pid", 0, true);
}

async function restartGo2rtc() {
  await stopGo2rtc("restart");
  await startGo2rtc("restart");
}

async function installBinary() {
  const targetPath = String(adapter.config.binaryPath || "").trim();
  const downloadUrl = resolveDownloadUrl(String(adapter.config.downloadUrl || "").trim());

  if (!targetPath || !downloadUrl) {
    throw new Error("binaryPath and downloadUrl must be configured for install");
  }

  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await downloadFile(downloadUrl, targetPath);
  await fsp.chmod(targetPath, 0o755);

  validatedBinaryPath = null; // Cache invalidieren nach neuem Download

  const msg = `go2rtc binary installed at ${targetPath}`;
  adapter.log.info(msg);
  await setStatus("stopped", Boolean(child), msg);
}

function resolveDownloadUrl(configuredUrl) {
  const trimmed = configuredUrl.trim();
  const defaultX64 = "https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_amd64";
  if (trimmed && trimmed !== defaultX64) return trimmed;

  const arch = os.arch();
  if (arch === "arm64") return "https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_arm64";
  if (arch === "arm") return "https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_arm";
  return defaultX64;
}

function downloadFile(url, targetPath, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error("Too many redirects")); return; }

    const client = url.startsWith("https:") ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).toString();
        res.resume();
        resolve(downloadFile(nextUrl, targetPath, redirects + 1));
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        res.resume();
        return;
      }

      const tempPath = `${targetPath}.download`;
      const out = fs.createWriteStream(tempPath, { mode: 0o755 });

      res.pipe(out);

      out.on("finish", () => {
        out.close((closeErr) => {
          if (closeErr) { reject(closeErr); return; }
          fsp.rename(tempPath, targetPath).then(resolve, reject);
        });
      });

      out.on("error", (error) => {
        fsp.unlink(tempPath).catch(() => undefined).finally(() => reject(error));
      });
    });

    req.on("error", reject);
  });
}

async function setStatus(mode, running, message) {
  await Promise.all([
    adapter.setStateAsync("status.mode", mode, true),
    adapter.setStateAsync("status.running", running, true),
    adapter.setStateAsync("status.message", message || "", true),
  ]);
}

async function ensureObjects() {
  await Promise.all([
    adapter.setObjectNotExistsAsync("control", { type: "channel", common: { name: "Controls" }, native: {} }),
    adapter.setObjectNotExistsAsync("control.start", boolState("Start go2rtc", true)),
    adapter.setObjectNotExistsAsync("control.stop", boolState("Stop go2rtc", true)),
    adapter.setObjectNotExistsAsync("control.restart", boolState("Restart go2rtc", true)),
    adapter.setObjectNotExistsAsync("control.install", boolState("Install/Download binary", true)),
    adapter.setObjectNotExistsAsync("status", { type: "channel", common: { name: "Status" }, native: {} }),
    adapter.setObjectNotExistsAsync("status.running", boolState("go2rtc running", false, true)),
    adapter.setObjectNotExistsAsync("status.mode", strState("Mode", false, true)),
    adapter.setObjectNotExistsAsync("status.message", strState("Status message", false, true)),
    adapter.setObjectNotExistsAsync("status.lastLog", strState("Last go2rtc log line", false, true)),
    adapter.setObjectNotExistsAsync("status.lastError", strState("Last go2rtc error line", false, true)),
    adapter.setObjectNotExistsAsync("status.pid", numState("Process ID", false, true)),
  ]);
}

function boolState(name, write, read = true) {
  return { type: "state", common: { name, type: "boolean", role: "button", read, write, def: false }, native: {} };
}

function strState(name, write, read = true) {
  return { type: "state", common: { name, type: "string", role: "text", read, write, def: "" }, native: {} };
}

function numState(name, write, read = true) {
  return { type: "state", common: { name, type: "number", role: "value", read, write, def: 0 }, native: {} };
}
