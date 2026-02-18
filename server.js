const fs = require("fs");
const http = require("http");
const path = require("path");

loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 8080);
const CONFIG = {
  provider: process.env.CTF_PROVIDER || "ctftime",
  baseUrl: process.env.CTF_API_BASE_URL || "https://ctftime.org/api/v1",
  userAgent: process.env.CTF_USER_AGENT || "Mozilla/5.0 (CTF-Live-Viewer)",
  apiKey: process.env.CTF_API_KEY || "",
  apiKeyHeader: process.env.CTF_API_KEY_HEADER || "Authorization",
  apiKeyPrefix: process.env.CTF_API_KEY_PREFIX || "Bearer",
  apiKeyQuery: process.env.CTF_API_KEY_QUERY || "",
  refreshMs: toInt(process.env.CTF_REFRESH_MS, 45000),
  lookaheadDays: toInt(process.env.CTF_LOOKAHEAD_DAYS, 120),
  eventsLimit: toInt(process.env.CTF_EVENTS_LIMIT, 200)
};

const state = {
  meta: {
    provider: CONFIG.provider,
    source: CONFIG.baseUrl,
    lastUpdatedAt: null,
    lastError: null
  },
  stats: emptyStats(),
  events: [],
  rankings: {
    kr: [],
    global: []
  }
};

const sseClients = new Set();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === "/api/dashboard") {
      const view = (url.searchParams.get("view") || "all").toLowerCase();
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const filtered = filterEvents(state.events, view, q);
      return sendJson(res, 200, {
        meta: state.meta,
        stats: recalcStats(filtered),
        events: filtered,
        rankings: state.rankings
      });
    }

    if (pathname === "/api/status") {
      return sendJson(res, 200, state.meta);
    }

    if (pathname === "/api/refresh" && req.method === "POST") {
      await refreshState();
      return sendJson(res, 200, { ok: true, updatedAt: state.meta.lastUpdatedAt });
    }

    if (pathname === "/api/stream") {
      return openSse(req, res);
    }

    return serveStatic(pathname, res);
  } catch (error) {
    return sendJson(res, 500, {
      error: "unexpected_error",
      message: error.message
    });
  }
});

server.listen(PORT, () => {
  console.log(`CTF live viewer listening on http://localhost:${PORT}`);
});

void refreshState();
setInterval(() => {
  void refreshState();
}, CONFIG.refreshMs);

async function refreshState() {
  try {
    const [events, rankingKr, rankingGlobal] = await Promise.all([
      fetchUpcomingEvents(),
      fetchTopByCountry("kr", 10),
      fetchTopGlobal(10)
    ]);

    state.events = events;
    state.rankings.kr = rankingKr;
    state.rankings.global = rankingGlobal;
    state.stats = recalcStats(events);
    state.meta.lastUpdatedAt = new Date().toISOString();
    state.meta.lastError = null;

    broadcastSse("snapshot", {
      meta: state.meta,
      stats: state.stats,
      events: state.events,
      rankings: state.rankings
    });
  } catch (error) {
    state.meta.lastError = error.message;
    broadcastSse("error", { message: error.message, at: new Date().toISOString() });
    console.error("refreshState failed:", error);
  }
}

async function fetchUpcomingEvents() {
  const now = Math.floor(Date.now() / 1000);
  const finish = now + CONFIG.lookaheadDays * 86400;
  const json = await fetchJson("/events/", {
    limit: String(CONFIG.eventsLimit),
    start: String(now),
    finish: String(finish)
  });

  if (!Array.isArray(json)) {
    throw new Error("Unexpected /events response shape");
  }

  return json
    .map(normalizeEvent)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

async function fetchTopByCountry(countryCode, limit) {
  const json = await fetchJson(`/top-by-country/${countryCode}/`, { limit: String(limit) });
  if (!Array.isArray(json)) return [];
  return json.slice(0, limit).map((entry, idx) => ({
    rank: idx + 1,
    teamName: String(entry.team_name || "Unknown"),
    points: Number(entry.points || 0)
  }));
}

async function fetchTopGlobal(limit) {
  const json = await fetchJson("/top/", { limit: String(limit) });
  const rows = Array.isArray(json)
    ? json
    : Array.isArray(json?.[String(new Date().getUTCFullYear())])
      ? json[String(new Date().getUTCFullYear())]
      : [];
  return rows.slice(0, limit).map((entry, idx) => ({
    rank: idx + 1,
    teamName: String(entry.team_name || "Unknown"),
    points: Number(entry.points || 0)
  }));
}

function normalizeEvent(item) {
  const start = String(item.start || "");
  const finish = String(item.finish || "");
  const status = eventStatus(start, finish);
  const title = String(item.title || "Untitled CTF");
  const location = String(item.location || "");
  const url = String(item.url || "");
  const description = String(item.description || "");
  const keywords = `${title} ${location} ${url} ${description}`.toLowerCase();

  return {
    id: Number(item.id || 0),
    ctfId: Number(item.ctf_id || 0),
    title,
    status,
    format: String(item.format || ""),
    start,
    finish,
    durationHours: Number(item?.duration?.hours || 0) + Number(item?.duration?.days || 0) * 24,
    participants: Number(item.participants || 0),
    weight: Number(item.weight || 0),
    onsite: Boolean(item.onsite),
    location,
    restrictions: String(item.restrictions || ""),
    prizes: String(item.prizes || ""),
    ctftimeUrl: String(item.ctftime_url || ""),
    eventUrl: url,
    koreaRelated: /korea|seoul|dreamhack|codegate|whitehat|bob|kr/.test(keywords)
  };
}

function filterEvents(events, view, q) {
  return events.filter((event) => {
    if (view === "korea" && !event.koreaRelated) return false;
    if (view === "live" && event.status !== "live") return false;
    if (view === "upcoming" && event.status !== "upcoming") return false;
    if (q && !`${event.title} ${event.location}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function eventStatus(start, finish) {
  const now = Date.now();
  const startTs = Date.parse(start);
  const finishTs = Date.parse(finish);
  if (Number.isNaN(startTs) || Number.isNaN(finishTs)) return "unknown";
  if (now < startTs) return "upcoming";
  if (now > finishTs) return "ended";
  return "live";
}

async function fetchJson(endpoint, query) {
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  const url = new URL(cleanEndpoint, CONFIG.baseUrl.endsWith("/") ? CONFIG.baseUrl : `${CONFIG.baseUrl}/`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value) url.searchParams.set(key, value);
  }

  if (CONFIG.apiKey && CONFIG.apiKeyQuery) {
    url.searchParams.set(CONFIG.apiKeyQuery, CONFIG.apiKey);
  }

  const headers = {
    Accept: "application/json",
    "User-Agent": CONFIG.userAgent
  };

  if (CONFIG.apiKey && CONFIG.apiKeyHeader) {
    const apiValue = CONFIG.apiKeyPrefix
      ? `${CONFIG.apiKeyPrefix} ${CONFIG.apiKey}`
      : CONFIG.apiKey;
    headers[CONFIG.apiKeyHeader] = apiValue.trim();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const response = await fetch(url, { headers, signal: controller.signal });
  clearTimeout(timer);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upstream ${response.status}: ${text.slice(0, 120)}`);
  }

  return response.json();
}

function openSse(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("retry: 5000\n\n");

  sseClients.add(res);
  sendSseEvent(res, "snapshot", {
    meta: state.meta,
    stats: state.stats,
    events: state.events,
    rankings: state.rankings
  });

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

function broadcastSse(event, data) {
  for (const client of sseClients) {
    sendSseEvent(client, event, data);
  }
}

function sendSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const fullPath = path.join(__dirname, "public", safePath);
  const normalized = path.normalize(fullPath);
  const publicRoot = path.join(__dirname, "public");

  if (!normalized.startsWith(publicRoot)) {
    return sendJson(res, 403, { error: "forbidden" });
  }

  fs.readFile(normalized, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") return sendJson(res, 404, { error: "not_found" });
      return sendJson(res, 500, { error: "read_error", message: err.message });
    }

    res.writeHead(200, { "Content-Type": mimeType(normalized) });
    res.end(content);
  });
}

function recalcStats(events) {
  const stats = emptyStats();
  stats.total = events.length;
  for (const event of events) {
    if (event.status === "live") stats.live += 1;
    if (event.status === "upcoming") stats.upcoming += 1;
    if (event.status === "ended") stats.ended += 1;
    if (event.onsite) stats.onsite += 1;
    if (event.koreaRelated) stats.koreaRelated += 1;
  }
  return stats;
}

function emptyStats() {
  return {
    total: 0,
    live: 0,
    upcoming: 0,
    ended: 0,
    onsite: 0,
    koreaRelated: 0
  };
}

function sendJson(res, code, payload) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function mimeType(filePath) {
  const ext = path.extname(filePath);
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function toInt(raw, fallback) {
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const lineRaw of content.split("\n")) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
