import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import mqtt from "mqtt";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";


const PORT = Number(process.env.PORT || 9980);
const HOST = process.env.HOST || "0.0.0.0";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to UI build
const UI_DIST = path.resolve(__dirname, "../../ui/dist");

// -------------------------
// Load printer config
// -------------------------
function loadPrintersConfig() {
  const url = new URL("../config/printers.json", import.meta.url);
  const raw = fs.readFileSync(url, "utf8");
  const cfg = JSON.parse(raw);

  if (!Array.isArray(cfg)) throw new Error("config/printers.json must be an array");
  for (const p of cfg) {
    if (!p?.id || !p?.name || !p?.serial || !p?.accessCode || !p?.ip) {
      throw new Error(
        "Each printer must include: id, name, serial, accessCode, ip in config/printers.json"
      );
    }
  }
  return cfg;
}

const printersConfig = loadPrintersConfig();

// -------------------------
// In-memory state
// -------------------------
let printers = printersConfig.map((p) => ({
  id: p.id,
  name: p.name,
  online: false,
  status: "unknown",
  progress: 0,
  temps: { nozzle: null, bed: null },
  updatedAt: null,

  // optional extras we can fill later
  hms: [],
  errors: [],
  raw: null,
}));

const printersById = new Map(printers.map((p) => [p.id, p]));

// -------------------------
// Express HTTP
// -------------------------
const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("Bambu Gateway running ✅"));
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/printers", (req, res) => {
  const safe = printers.map(({ raw, ...p }) => p);
  res.json({ ok: true, printers: safe });
});

// Serve static files
app.use(express.static(UI_DIST));

// SPA fallback
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(UI_DIST, "index.html"));
});

// -------------------------
// HTTP Server + WebSocket
// -------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/events" });

function safeSend(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(obj));
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

wss.on("connection", (ws) => {
  // Initial snapshot
  safeSend(ws, { type: "printers.list", printers });

  ws.on("message", (buf) => {
    // Later: accept UI commands here (pause/resume/etc.)
    // For now: ignore
    // console.log("WS message:", buf.toString("utf8"));
  });
});

// -------------------------
// MQTT -> State parser
// -------------------------
function parseReportToState(report) {
  const p = report?.print || {};

  const status = p.gcode_state ?? p.gcode_state_str ?? "unknown";

  // Use percent fields that actually exist on your printer
  const rawPercent =
    (typeof p.percent === "number" ? p.percent : null) ??
    (typeof p.mc_percent === "number" ? p.mc_percent : null) ??
    (typeof p.print_percent === "number" ? p.print_percent : null);

  const progress =
    typeof rawPercent === "number"
      ? Math.max(0, Math.min(100, Math.round(rawPercent)))
      : 0;

  // Current temps + targets (you have both)
  const nozzle = typeof p.nozzle_temper === "number" ? p.nozzle_temper : null;
  const bed = typeof p.bed_temper === "number" ? p.bed_temper : null;

  const nozzleTarget =
    typeof p.nozzle_target_temper === "number" ? p.nozzle_target_temper : null;
  const bedTarget =
    typeof p.bed_target_temper === "number" ? p.bed_target_temper : null;

  // Job info from your payload
  const job = {
    file: p.subtask_name ?? p.gcode_file ?? null,
    etaSec: typeof p.remain_time === "number" ? p.remain_time : null,
    layer: typeof p.layer_num === "number" ? p.layer_num : null,
    totalLayers: typeof p.total_layer_num === "number" ? p.total_layer_num : null,
  };

  return {
    online: true,
    status,
    progress,
    temps: { nozzle, bed, nozzleTarget, bedTarget },
    job,
    updatedAt: new Date().toISOString(),
    raw: report, // you can remove from WS later
  };
}


// -------------------------
// MQTT connection per printer
// -------------------------
const mqttClients = new Map();

function connectPrinterMQTT(cfg) {
  const { id, serial, accessCode, ip } = cfg;

  const url = `mqtts://${ip}:8883`;
  const client = mqtt.connect(url, {
    username: "bblp",
    password: String(accessCode).trim(),
    // Bambu printers commonly present self-signed certs
    rejectUnauthorized: false,
    // Stability:
    keepalive: 30,
    reconnectPeriod: 3000,
    connectTimeout: 10_000,
  });

  mqttClients.set(id, client);

  client.on("connect", () => {
    console.log(`[MQTT] ${id} connected -> ${url}`);
    // Status pushes (report)
    client.subscribe(`device/${serial}/report`, (err) => {
      if (err) console.error(`[MQTT] ${id} subscribe error:`, err.message);
    });

    // Mark online (even before first report)
    const current = printersById.get(id);
    if (current && !current.online) {
      current.online = true;
      current.updatedAt = new Date().toISOString();
      broadcast({ type: "printer.update", printer: current });
      broadcast({ type: "printers.update", printers });
    }
  });

  client.on("reconnect", () => {
    console.log(`[MQTT] ${id} reconnecting...`);
  });

  client.on("close", () => {
    console.log(`[MQTT] ${id} connection closed`);
    const current = printersById.get(id);
    if (current && current.online) {
      current.online = false;
      current.updatedAt = new Date().toISOString();
      broadcast({ type: "printer.update", printer: current });
      broadcast({ type: "printers.update", printers });
    }
  });

  client.on("error", (err) => {
    console.error(`[MQTT] ${id} error:`, err.message);
  });

  client.on("message", (topic, payload) => {
    // Only parse report topics we subscribed to
    if (!topic.endsWith("/report")) return;

    let report;
    try {
      report = JSON.parse(payload.toString("utf8"));
    } catch (e) {
      console.error(`[MQTT] ${id} JSON parse error:`, e.message);
      return;
    }

    const current = printersById.get(id);
    if (!current) return;

    const next = parseReportToState(report);

    Object.assign(current, next);

    broadcast({ type: "printer.update", printer: current });
    broadcast({ type: "printers.update", printers });
  });
}


for (const cfg of printersConfig) connectPrinterMQTT(cfg);


server.listen(PORT, HOST, () => {
  console.log(`HTTP  http://${HOST}:${PORT}`);
  console.log(`WS    ws://${HOST}:${PORT}/events`);
  console.log(`Printers loaded: ${printersConfig.length}`);
});


function shutdown() {
  console.log("Shutting down...");
  for (const [, client] of mqttClients) {
    try {
      client.end(true);
    } catch {}
  }
  try {
    server.close(() => process.exit(0));
  } catch {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
