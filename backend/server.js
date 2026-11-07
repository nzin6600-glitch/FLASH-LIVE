
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEYS = [
  process.env.API_FOOTBALL_KEY,
  process.env.RAPIDAPI_KEY
].map(x => String(x || "").trim()).filter(Boolean);

const API_HOST = "free-api-live-football-data.p.rapidapi.com";
const API_URL = `https://${API_HOST}`;
const ADMIN_KEY = String(process.env.ADMIN_ACCESS_KEY || "").trim();

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "12mb" }));

// --------------------------------------------------
// STATIC FILES: public/ is preferred, root is fallback
// --------------------------------------------------

const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.static(PUBLIC_DIR));
app.use(express.static(__dirname));

function findFile(name) {
  const paths = [
    path.join(PUBLIC_DIR, name),
    path.join(__dirname, name)
  ];
  return paths.find(p => fs.existsSync(p) && fs.statSync(p).isFile());
}

function sendPage(name, res) {
  const file = findFile(name);
  if (!file) {
    return res.status(404).type("text/plain").send(
      `${name} missing. Put ${name} inside public/ folder.`
    );
  }
  return res.sendFile(file);
}

// --------------------------------------------------
// MEMORY FALLBACK
// Note: memory data is lost when Render restarts.
// --------------------------------------------------

const memoryNotifications = [];
const memoryNotificationReads = new Set();
const memorySupportMessages = [];
const memorySupportReplies = [];
const memoryStreams = [];

// --------------------------------------------------
// SUPABASE REST
// --------------------------------------------------

async function sbRequest(table, method = "GET", query = "", body, prefer = "") {
  if (!hasSupabase) throw new Error("Supabase is not configured");

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}${query}`,
    {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        ...(prefer ? { Prefer: prefer } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    }
  );

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase ${table} returned ${response.status}: ${raw.slice(0, 500)}`
    );
  }

  if (!raw) return [];

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// --------------------------------------------------
// ADMIN AUTH
// --------------------------------------------------

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(503).json({
      success: false,
      message: "ADMIN_ACCESS_KEY is missing in Render"
    });
  }

  const supplied = String(req.get("x-admin-key") || "");

  if (supplied !== ADMIN_KEY) {
    return res.status(401).json({
      success: false,
      message: "Invalid Admin Access Key"
    });
  }

  next();
}

// --------------------------------------------------
// COMMON HELPERS
// --------------------------------------------------

function safeUserId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 128) return "";
  return id;
}

function safeLanguage(value) {
  const lang = String(value || "my").toLowerCase();
  return ["my", "en", "th", "zh", "es"].includes(lang) ? lang : "my";
}

function publicError(res, error, label) {
  console.error(`[${label}]`, error.message);
  res.status(error.status || 502).json({
    success: false,
    error: label,
    message: error.message
  });
}

function isoNow() {
  return new Date().toISOString();
}

// --------------------------------------------------
// FOOTBALL API WITH TWO-KEY FAILOVER
// Both keys must belong to the same RapidAPI provider.
// --------------------------------------------------

async function footballRequest(endpoint, params = {}) {
  if (!API_KEYS.length) {
    const e = new Error("API_FOOTBALL_KEY and RAPIDAPI_KEY are missing");
    e.status = 503;
    throw e;
  }

  if (!/^football-[a-z0-9-]+$/.test(endpoint)) {
    const e = new Error("Invalid football endpoint");
    e.status = 400;
    throw e;
  }

  const url = new URL(`${API_URL}/${endpoint}`);

  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  let lastError;

  for (let i = 0; i < API_KEYS.length; i++) {
    try {
      const response = await fetch(url, {
        headers: {
          "x-rapidapi-key": API_KEYS[i],
          "x-rapidapi-host": API_HOST,
          accept: "application/json"
        },
        signal: AbortSignal.timeout(20000)
      });

      const raw = await response.text();
      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        const e = new Error("Football provider returned invalid JSON");
        e.status = response.status || 502;
        throw e;
      }

      if (!response.ok || data.status === "error") {
        const e = new Error(
          data.message || data.error || `Provider HTTP ${response.status}`
        );
        e.status = response.status || 502;
        throw e;
      }

      return data;

    } catch (error) {
      lastError = error;
      console.error(
        `Football API key ${i + 1} failed:`,
        error.message
      );

      // Try the second key for authentication, quota, rate-limit,
      // provider or network failures.
      if (i === API_KEYS.length - 1) break;
    }
  }

  throw lastError || new Error("All Football API keys failed");
}

// --------------------------------------------------
// HEALTH
// --------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({
    app: "FLASH LIVE API",
    status: "online",
    version: "5.0.0",
    footballKeysConfigured: API_KEYS.length,
    adminConfigured: Boolean(ADMIN_KEY),
    supabaseConfigured: hasSupabase,
    timestamp: isoNow()
  });
});

// --------------------------------------------------
// USER APP AND ADMIN APP LINKS
// --------------------------------------------------

app.get("/", (req, res) => sendPage("index.html", res));
app.get(["/app", "/app/"], (req, res) => sendPage("index.html", res));
app.get(["/admin", "/admin/"], (req, res) => sendPage("admin.html", res));

// --------------------------------------------------
// FOOTBALL PROVIDER ROUTES
// --------------------------------------------------

const ENDPOINTS = {
  countries: "football-get-all-countries",
  leagues: "football-popular-leagues",
  leaguesAll: "football-get-all-leagues",
  live: "football-current-live",
  fixtures: "football-get-matches-by-date"
};

app.get("/api/provider/:endpoint", async (req, res) => {
  try {
    const endpoint = String(req.params.endpoint)
      .replaceAll("_", "-")
      .toLowerCase();

    res.json(await footballRequest(endpoint, req.query));
  } catch (error) {
    publicError(res, error, "FOOTBALL_PROVIDER");
  }
});

for (const [route, endpoint] of [
  ["/api/countries", ENDPOINTS.countries],
  ["/api/leagues", ENDPOINTS.leagues],
  ["/api/leagues-all", ENDPOINTS.leaguesAll],
  ["/api/live", ENDPOINTS.live]
]) {
  app.get(route, async (req, res) => {
    try {
      res.json(await footballRequest(endpoint, req.query));
    } catch (error) {
      publicError(res, error, route);
    }
  });
}

app.get("/api/fixtures", async (req, res) => {
  try {
    const date = String(req.query.date || "");

    if (!/^\d{8}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: "Date must use YYYYMMDD format"
      });
    }

    res.json(await footballRequest(ENDPOINTS.fixtures, { date }));
  } catch (error) {
    publicError(res, error, "FIXTURES");
  }
});

// --------------------------------------------------
// NOTIFICATIONS: USER INBOX
// --------------------------------------------------

app.get("/api/notifications", async (req, res) => {
  const userId = safeUserId(req.query.user_id);
  const lang = safeLanguage(req.query.lang);

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "user_id required"
    });
  }

  try {
    let rows = [];
    let readIds = new Set();

    if (hasSupabase) {
      rows = await sbRequest(
        "notifications",
        "GET",
        `?select=*&active=eq.true&or=(user_id.is.null,user_id.eq.${encodeURIComponent(userId)})&order=created_at.desc&limit=100`
      );

      const reads = await sbRequest(
        "notification_reads",
        "GET",
        `?select=notification_id&user_id=eq.${encodeURIComponent(userId)}`
      );

      readIds = new Set(
        (reads || []).map(x => x.notification_id)
      );

    } else {
      rows = memoryNotifications.filter(
        x => x.active !== false && (!x.user_id || x.user_id === userId)
      );

      readIds = new Set(
        [...memoryNotificationReads]
          .filter(x => x.startsWith(`${userId}::`))
          .map(x => x.slice(userId.length + 2))
      );
    }

    res.set("Cache-Control", "no-store");

    res.json({
      success: true,
      persistent: hasSupabase,
      notifications: (rows || []).map(x => ({
        id: x.id,
        title: x.title,
        body: (x.translations && x.translations[lang]) || x.body,
        created_at: x.created_at,
        read: readIds.has(x.id)
      }))
    });

  } catch (error) {
    publicError(res, error, "NOTIFICATIONS");
  }
});

// --------------------------------------------------
// NOTIFICATION READ ONE
// --------------------------------------------------

app.post("/api/notifications/:id/read", async (req, res) => {
  const userId = safeUserId(req.body?.user_id);
  const id = String(req.params.id || "").trim();

  if (!userId || !id) {
    return res.status(400).json({
      success: false,
      message: "user_id and notification id required"
    });
  }

  try {
    if (hasSupabase) {
      await sbRequest(
        "notification_reads",
        "POST",
        "?on_conflict=user_id,notification_id",
        {
          user_id: userId,
          notification_id: id,
          read_at: isoNow()
        },
        "resolution=merge-duplicates,return=minimal"
      );
    } else {
      memoryNotificationReads.add(`${userId}::${id}`);
    }

    res.json({ success: true, persistent: hasSupabase });

  } catch (error) {
    publicError(res, error, "NOTIFICATION_READ");
  }
});

// --------------------------------------------------
// NOTIFICATION READ ALL
// --------------------------------------------------

app.post("/api/notifications/read-all", async (req, res) => {
  const userId = safeUserId(req.body?.user_id);

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "user_id required"
    });
  }

  try {
    if (hasSupabase) {
      const rows = await sbRequest(
        "notifications",
        "GET",
        `?select=id&active=eq.true&or=(user_id.is.null,user_id.eq.${encodeURIComponent(userId)})&limit=500`
      );

      const records = (rows || []).map(x => ({
        user_id: userId,
        notification_id: x.id,
        read_at: isoNow()
      }));

      if (records.length) {
        await sbRequest(
          "notification_reads",
          "POST",
          "?on_conflict=user_id,notification_id",
          records,
          "resolution=merge-duplicates,return=minimal"
        );
      }

    } else {
      memoryNotifications
        .filter(x => x.active !== false && (!x.user_id || x.user_id === userId))
        .forEach(x => memoryNotificationReads.add(`${userId}::${x.id}`));
    }

    res.json({ success: true, persistent: hasSupabase });

  } catch (error) {
    publicError(res, error, "NOTIFICATION_READ_ALL");
  }
});

// --------------------------------------------------
// ADMIN SEND NOTIFICATION
// --------------------------------------------------

app.post("/api/admin/notifications", requireAdmin, async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const body = String(req.body?.body || "").trim();
  const target = req.body?.user_id
    ? safeUserId(req.body.user_id)
    : null;

  const translations =
    req.body?.translations && typeof req.body.translations === "object"
      ? req.body.translations
      : {};

  if (!title || !body) {
    return res.status(400).json({
      success: false,
      message: "Title and body are required"
    });
  }

  if (req.body?.user_id && !target) {
    return res.status(400).json({
      success: false,
      message: "Invalid user ID"
    });
  }

  const item = {
    id: randomUUID(),
    title: title.slice(0, 160),
    body: body.slice(0, 4000),
    user_id: target,
    translations,
    created_at: isoNow(),
    active: true
  };

  try {
    if (hasSupabase) {
      await sbRequest(
        "notifications",
        "POST",
        "",
        item,
        "return=minimal"
      );
    } else {
      memoryNotifications.unshift(item);
    }

    res.status(201).json({
      success: true,
      persistent: hasSupabase,
      notification: item
    });

  } catch (error) {
    publicError(res, error, "ADMIN_NOTIFICATION_SEND");
  }
});

// --------------------------------------------------
// USER SUPPORT AUTO ACKNOWLEDGEMENT
// --------------------------------------------------

const autoAck = {
  my: "မင်္ဂလာပါ။ ဘာများကူညီပေးရမလဲဗျ။ သင့်အကူအညီတောင်းဆိုချက်ကို လက်ခံရရှိပါပြီ။ ကျွန်ုပ်တို့ဘက်မှ စာပြန်ရန် အချိန်ယူရပါက ခွင့်လွှတ်နားလည်ပေးပါရန် မေတ္တာရပ်ခံပါတယ်။ အကြောင်းအရာကို စစ်ဆေးပြီး အမြန်ဆုံး ပြန်လည်ဖြေကြားပေးပါမယ်။ ကျေးဇူးတင်ပါတယ်။",
  en: "Hello! How can we help you? We have received your support request. We apologize if our reply takes some time. Our team will review your request and respond as soon as possible. Thank you for your patience.",
  th: "สวัสดีครับ มีอะไรให้เราช่วยไหมครับ เราได้รับคำขอของคุณแล้ว ขออภัยหากตอบกลับล่าช้า ทีมงานจะตรวจสอบและตอบกลับโดยเร็วที่สุด ขอบคุณที่เข้าใจครับ",
  zh: "您好！有什么可以帮助您？我们已收到您的请求。如果回复需要一些时间，敬请谅解。我们的团队会尽快核查并回复。感谢您的耐心。",
  es: "¡Hola! ¿En qué podemos ayudarte? Hemos recibido tu solicitud. Disculpa si tardamos en responder. Nuestro equipo la revisará y responderá lo antes posible. Gracias por tu paciencia."
};

app.post("/api/support/messages", async (req, res) => {
  const userId = safeUserId(req.body?.user_id);
  const language = safeLanguage(req.body?.language);
  const message = String(req.body?.message || "").trim();
  const image = req.body?.image || null;

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "user_id required"
    });
  }

  if (!message && !image) {
    return res.status(400).json({
      success: false,
      message: "Message or image required"
    });
  }

  if (image && (
    typeof image !== "string" ||
    !image.startsWith("data:image/") ||
    image.length > 4200000
  )) {
    return res.status(413).json({
      success: false,
      message: "Image data is invalid or too large"
    });
  }

  const item = {
    id: randomUUID(),
    user_id: userId,
    name: String(req.body?.name || "User").slice(0, 100),
    email: String(req.body?.email || "").slice(0, 180),
    avatar: req.body?.avatar || null,
    message: message.slice(0, 4000),
    image,
    language,
    created_at: isoNow(),
    read: false,
    status: "new"
  };

  const ack = {
    id: randomUUID(),
    user_id: userId,
    message_id: item.id,
    sender: "admin",
    body: autoAck[language],
    translations: {},
    created_at: isoNow(),
    automatic: true
  };

  try {
    if (hasSupabase) {
      await sbRequest("support_messages", "POST", "", item, "return=minimal");
      await sbRequest("support_replies", "POST", "", ack, "return=minimal");
    } else {
      memorySupportMessages.unshift(item);
      memorySupportReplies.unshift(ack);
    }

    res.status(201).json({
      success: true,
      id: item.id,
      acknowledgement: ack.body,
      persistent: hasSupabase
    });

  } catch (error) {
    publicError(res, error, "SUPPORT_SEND");
  }
});

// --------------------------------------------------
// USER SUPPORT THREAD
// --------------------------------------------------

app.get("/api/support/thread", async (req, res) => {
  const userId = safeUserId(req.query.user_id);
  const language = safeLanguage(req.query.lang);

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "user_id required"
    });
  }

  try {
    let messages;
    let replies;

    if (hasSupabase) {
      messages = await sbRequest(
        "support_messages",
        "GET",
        `?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.asc&limit=100`
      );

      replies = await sbRequest(
        "support_replies",
        "GET",
        `?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.asc&limit=200`
      );
    } else {
      messages = memorySupportMessages.filter(x => x.user_id === userId);
      replies = memorySupportReplies.filter(x => x.user_id === userId);
    }

    replies = (replies || []).map(x => ({
      ...x,
      body: (x.translations && x.translations[language]) || x.body
    }));

    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      persistent: hasSupabase,
      messages: messages || [],
      replies: replies || []
    });

  } catch (error) {
    publicError(res, error, "SUPPORT_THREAD");
  }
});

// --------------------------------------------------
// ADMIN SUPPORT INBOX
// --------------------------------------------------

app.get("/api/admin/messages", requireAdmin, async (req, res) => {
  try {
    const messages = hasSupabase
      ? await sbRequest(
          "support_messages",
          "GET",
          "?select=*&order=created_at.desc&limit=500"
        )
      : memorySupportMessages;

    res.json({
      success: true,
      persistent: hasSupabase,
      messages: messages || []
    });

  } catch (error) {
    publicError(res, error, "ADMIN_SUPPORT_INBOX");
  }
});

// --------------------------------------------------
// ADMIN SEARCH USERS
// Note: finds users with support-message history.
// --------------------------------------------------

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();

  try {
    const rows = hasSupabase
      ? await sbRequest(
          "support_messages",
          "GET",
          "?select=user_id,name,email,avatar,created_at&order=created_at.desc&limit=1000"
        )
      : memorySupportMessages;

    const seen = new Set();
    const users = [];

    for (const row of rows || []) {
      const id = String(row.user_id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const user = {
        user_id: id,
        name: row.name || "",
        email: row.email || "",
        avatar: row.avatar || null,
        last_seen: row.created_at || null
      };

      const searchable = [
        user.user_id,
        user.name,
        user.email
      ].join(" ").toLowerCase();

      if (!q || searchable.includes(q)) users.push(user);
    }

    res.json({
      success: true,
      persistent: hasSupabase,
      users: users.slice(0, 100)
    });

  } catch (error) {
    publicError(res, error, "ADMIN_USER_SEARCH");
  }
});

// --------------------------------------------------
// ADMIN REPLY TO SUPPORT MESSAGE
// Also creates a targeted notification.
// --------------------------------------------------

app.post("/api/admin/messages/:id/reply", requireAdmin, async (req, res) => {
  const messageId = String(req.params.id || "");
  const body = String(req.body?.body || "").trim();
  const translations =
    req.body?.translations && typeof req.body.translations === "object"
      ? req.body.translations
      : {};

  if (!body) {
    return res.status(400).json({
      success: false,
      message: "Reply body required"
    });
  }

  try {
    let message;

    if (hasSupabase) {
      const found = await sbRequest(
        "support_messages",
        "GET",
        `?select=id,user_id& id=eq.${encodeURIComponent(messageId)}`.replace("& id", "&id")
      );
      message = found?.[0];
    } else {
      message = memorySupportMessages.find(x => x.id === messageId);
    }

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Support message not found"
      });
    }

    const reply = {
      id: randomUUID(),
      user_id: message.user_id,
      message_id: message.id,
      sender: "admin",
      body: body.slice(0, 4000),
      translations,
      created_at: isoNow(),
      automatic: false
    };

    const notification = {
      id: randomUUID(),
      title: "FLASH LIVE Support",
      body: body.slice(0, 4000),
      user_id: message.user_id,
      translations,
      created_at: isoNow(),
      active: true
    };

    if (hasSupabase) {
      await sbRequest("support_replies", "POST", "", reply, "return=minimal");

      await sbRequest(
        "support_messages",
        "PATCH",
        `?id=eq.${encodeURIComponent(message.id)}`,
        { status: "replied", read: true },
        "return=minimal"
      );

      await sbRequest(
        "notifications",
        "POST",
        "",
        notification,
        "return=minimal"
      );

    } else {
      memorySupportReplies.push(reply);
      memoryNotifications.unshift(notification);
    }

    res.status(201).json({
      success: true,
      persistent: hasSupabase,
      reply
    });

  } catch (error) {
    publicError(res, error, "ADMIN_SUPPORT_REPLY");
  }
});

// --------------------------------------------------
// ADMIN UPDATE SUPPORT MESSAGE STATUS
// --------------------------------------------------

app.patch("/api/admin/messages/:id", requireAdmin, async (req, res) => {
  try {
    const update = {
      read: Boolean(req.body?.read),
      status: String(req.body?.status || "read")
    };

    if (hasSupabase) {
      const rows = await sbRequest(
        "support_messages",
        "PATCH",
        `?id=eq.${encodeURIComponent(req.params.id)}`,
        update,
        "return=representation"
      );

      if (!rows?.length) {
        return res.status(404).json({
          success: false,
          message: "Message not found"
        });
      }

      return res.json({ success: true, message: rows[0] });
    }

    const item = memorySupportMessages.find(x => x.id === req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Message not found"
      });
    }

    Object.assign(item, update);
    res.json({ success: true, message: item });

  } catch (error) {
    publicError(res, error, "ADMIN_SUPPORT_UPDATE");
  }
});

// --------------------------------------------------
// FLASH LIVE STREAMS
// Existing stream API routes retained.
// Stream storage remains in memory in this version.
// --------------------------------------------------

function validateStream(input = {}) {
  const title = String(input.title || "").trim();
  const url = String(input.url || "").trim();

  if (!title || !url) return { error: "Title and URL required" };

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Invalid stream URL" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { error: "Only HTTP and HTTPS URLs are allowed" };
  }

  let type = "external";
  if (/\.m3u8($|\?)/i.test(url)) type = "m3u8";
  else if (/\.(mp4|webm|ogg)($|\?)/i.test(url)) type = "mp4";
  else if (/youtube\.com|youtu\.be/i.test(parsed.hostname)) type = "youtube";

  return { value: { title: title.slice(0, 120), url, type } };
}

app.get("/api/flash-live", (req, res) => {
  res.json({
    success: true,
    streams: memoryStreams.filter(x => x.active !== false)
  });
});

app.get("/api/admin/streams", requireAdmin, (req, res) => {
  res.json({ success: true, streams: memoryStreams });
});

app.post("/api/admin/streams", requireAdmin, (req, res) => {
  const parsed = validateStream(req.body);

  if (parsed.error) {
    return res.status(400).json({
      success: false,
      message: parsed.error
    });
  }

  const stream = {
    id: randomUUID(),
    ...parsed.value,
    createdAt: isoNow(),
    active: true
  };

  memoryStreams.unshift(stream);
  res.status(201).json({ success: true, stream });
});

app.put("/api/admin/streams/:id", requireAdmin, (req, res) => {
  const stream = memoryStreams.find(x => x.id === req.params.id);

  if (!stream) {
    return res.status(404).json({
      success: false,
      message: "Stream not found"
    });
  }

  if (typeof req.body?.active === "boolean") {
    stream.active = req.body.active;
  }

  if (req.body?.title !== undefined || req.body?.url !== undefined) {
    const parsed = validateStream({
      title: req.body.title ?? stream.title,
      url: req.body.url ?? stream.url
    });

    if (parsed.error) {
      return res.status(400).json({
        success: false,
        message: parsed.error
      });
    }

    Object.assign(stream, parsed.value);
  }

  res.json({ success: true, stream });
});

app.delete("/api/admin/streams/:id", requireAdmin, (req, res) => {
  const index = memoryStreams.findIndex(x => x.id === req.params.id);

  if (index < 0) {
    return res.status(404).json({
      success: false,
      message: "Stream not found"
    });
  }

  memoryStreams.splice(index, 1);
  res.json({ success: true });
});

// --------------------------------------------------
// 404 HANDLER
// --------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
    path: req.path
  });
});

// --------------------------------------------------
// GLOBAL ERROR HANDLER
// --------------------------------------------------

app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", error);
  if (res.headersSent) return next(error);

  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log("------------------------------------");
  console.log("FLASH LIVE SERVER STARTED");
  console.log("Port:", PORT);
  console.log("Football API keys configured:", API_KEYS.length);
  console.log("Admin key configured:", Boolean(ADMIN_KEY));
  console.log("Supabase configured:", hasSupabase);
  console.log("User URL: /app");
  console.log("Admin URL: /admin");
  console.log("------------------------------------");
});