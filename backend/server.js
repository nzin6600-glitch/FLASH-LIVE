
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const API_KEY = (process.env.API_FOOTBALL_KEY || "").trim();
const API_HOST = "free-api-live-football-data.p.rapidapi.com";
const API_URL = `https://${API_HOST}`;
const ADMIN_KEY = (process.env.ADMIN_ACCESS_KEY || "").trim();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ==========================================
// CONFIGURATION
// ==========================================

const ENDPOINTS = {
    countries: "football-get-all-countries",
    leagues: "football-popular-leagues",
    leaguesAll: "football-get-all-leagues",
    live: "football-current-live",
    fixtures: "football-get-matches-by-date"
};

const supportMessages = [];
const flashStreams = [];

// ==========================================
// ADMIN AUTHENTICATION
// ==========================================

function requireAdmin(req, res, next) {
    if (!ADMIN_KEY) {
        return res.status(503).json({
            success: false,
            message: "ADMIN_ACCESS_KEY is not configured"
        });
    }

    if ((req.get("x-admin-key") || "") !== ADMIN_KEY) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized"
        });
    }

    next();
}

// ==========================================
// FOOTBALL API REQUEST
// ==========================================

async function footballRequest(endpoint, params = {}) {
    if (!API_KEY) {
        throw new Error("API_FOOTBALL_KEY is missing");
    }

    if (!/^football-[a-z0-9-]+$/.test(endpoint)) {
        throw new Error("Invalid football endpoint");
    }

    const url = new URL(`${API_URL}/${endpoint}`);

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, String(value));
        }
    }

    const response = await fetch(url, {
        headers: {
            "x-rapidapi-key": API_KEY,
            "x-rapidapi-host": API_HOST,
            accept: "application/json"
        },
        signal: AbortSignal.timeout(20000)
    });

    const body = await response.text();

    let data;

    try {
        data = JSON.parse(body);
    } catch {
        throw new Error("Provider returned invalid JSON");
    }

    if (!response.ok || data.status === "error") {
        const error = new Error(
            data.message ||
            data.error ||
            `Provider HTTP ${response.status}`
        );

        error.status = response.status;
        throw error;
    }

    return data;
}

function handleError(res, error, name) {
    console.error(`${name} ERROR:`, error.message);

    res.status(error.status || 502).json({
        success: false,
        error: `${name} request failed`,
        message: error.message
    });
}

// ==========================================
// STREAM VALIDATION
// ==========================================

function cleanStreamInput(body = {}) {
    const title = String(body.title || "").trim();
    const url = String(body.url || "").trim();

    if (!title || !url) {
        return { error: "Title and URL required" };
    }

    if (title.length > 120 || url.length > 2048) {
        return { error: "Title or URL is too long" };
    }

    let parsed;

    try {
        parsed = new URL(url);
    } catch {
        return { error: "Invalid video URL" };
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
        return { error: "Only HTTP/HTTPS URLs allowed" };
    }

    const host = parsed.hostname.toLowerCase();
    let type = "external";

    if (
        host === "youtu.be" ||
        host === "youtube.com" ||
        host.endsWith(".youtube.com") ||
        host === "youtube-nocookie.com" ||
        host.endsWith(".youtube-nocookie.com")
    ) {
        type = "youtube";
    } else if (/\.(mp4|webm|ogg)$/i.test(parsed.pathname)) {
        type = "mp4";
    } else if (/\.m3u8$/i.test(parsed.pathname)) {
        type = "m3u8";
    }

    return {
        value: { title, url, type }
    };
}

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/", (req, res) => {
    res.json({
        app: "FLASH LIVE API",
        status: "online",
        version: "4.2.0"
    });
});

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        provider: "RapidAPI",
        host: API_HOST,
        apiKeyConfigured: Boolean(API_KEY),
        adminKeyConfigured: Boolean(ADMIN_KEY),
        version: "4.2.0"
    });
});

// ==========================================
// FLASH LIVE USER APP
// ==========================================
// User HTML location:
// Project root/index.html
//
// server.js location:
// Project root/backend/server.js
//
// Open:
// https://flash-live.onrender.com/app

app.get(["/app", "/app/"], (req, res) => {
    res.sendFile(
        path.join(__dirname, "..", "index.html"),
        error => {
            if (error && !res.headersSent) {
                console.error("USER APP ERROR:", error.message);
                res.status(404).send(
                    "User App missing. Check root index.html"
                );
            }
        }
    );
});

// ==========================================
// FOOTBALL PROVIDER
// ==========================================

app.get("/api/provider/:endpoint", async (req, res) => {
    try {
        const endpoint = String(req.params.endpoint)
            .replaceAll("_", "-")
            .toLowerCase();

        res.json(await footballRequest(endpoint, req.query));
    } catch (error) {
        handleError(res, error, "PROVIDER");
    }
});

// ==========================================
// FOOTBALL MAIN ENDPOINTS
// ==========================================

const footballRoutes = [
    ["/api/countries", ENDPOINTS.countries],
    ["/api/leagues", ENDPOINTS.leagues],
    ["/api/leagues-all", ENDPOINTS.leaguesAll],
    ["/api/live", ENDPOINTS.live]
];

for (const [route, endpoint] of footballRoutes) {
    app.get(route, async (req, res) => {
        try {
            res.json(await footballRequest(endpoint));
        } catch (error) {
            handleError(res, error, route);
        }
    });
}

// ==========================================
// FOOTBALL FIXTURES
// ==========================================

app.get("/api/fixtures", async (req, res) => {
    try {
        const date = String(req.query.date || "");

        if (!/^\d{8}$/.test(date)) {
            return res.status(400).json({
                success: false,
                error: "Invalid date",
                message: "Use YYYYMMDD format"
            });
        }

        res.json(
            await footballRequest(ENDPOINTS.fixtures, { date })
        );
    } catch (error) {
        handleError(res, error, "FIXTURES");
    }
});

// ==========================================
// USER SUPPORT MESSAGE
// ==========================================

app.post("/api/support/messages", (req, res) => {
    const { name, email, avatar, message, image } = req.body || {};

    if (!String(message || "").trim() && !image) {
        return res.status(400).json({
            success: false,
            message: "Message or image required"
        });
    }

    if (
        image &&
        (
            !String(image).startsWith("data:image/") ||
            String(image).length > 4200000
        )
    ) {
        return res.status(413).json({
            success: false,
            message: "Image must be an image under 3MB"
        });
    }

    const item = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: String(name || "Guest User").slice(0, 80),
        email: String(email || "").slice(0, 160),
        avatar:
            typeof avatar === "string" &&
            avatar.startsWith("data:image/") &&
            avatar.length <= 2800000
                ? avatar
                : null,
        message: String(message || "").slice(0, 4000),
        image: image || null,
        createdAt: new Date().toISOString(),
        read: false
    };

    supportMessages.unshift(item);

    res.status(201).json({
        success: true,
        id: item.id
    });
});

// ==========================================
// ADMIN SUPPORT INBOX
// ==========================================

app.get("/api/admin/messages", requireAdmin, (req, res) => {
    res.json({
        success: true,
        messages: supportMessages
    });
});

app.patch("/api/admin/messages/:id", requireAdmin, (req, res) => {
    const message = supportMessages.find(
        item => item.id === req.params.id
    );

    if (!message) {
        return res.status(404).json({
            success: false,
            message: "Message not found"
        });
    }

    message.read = Boolean(req.body?.read);

    res.json({
        success: true,
        message
    });
});

// ==========================================
// USER FLASH LIVE STREAM LIST
// ==========================================

app.get("/api/flash-live", (req, res) => {
    res.json({
        success: true,
        streams: flashStreams.filter(
            stream => stream.active !== false
        )
    });
});

// ==========================================
// ADMIN STREAM LIST
// ==========================================

app.get("/api/admin/streams", requireAdmin, (req, res) => {
    res.json({
        success: true,
        streams: flashStreams
    });
});

// ==========================================
// ADMIN ADD STREAM
// ==========================================

app.post("/api/admin/streams", requireAdmin, (req, res) => {
    const parsed = cleanStreamInput(req.body);

    if (parsed.error) {
        return res.status(400).json({
            success: false,
            message: parsed.error
        });
    }

    const stream = {
        id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ...parsed.value,
        createdAt: new Date().toISOString(),
        active: true
    };

    flashStreams.unshift(stream);

    res.status(201).json({
        success: true,
        stream
    });
});

// ==========================================
// ADMIN EDIT / START / STOP STREAM
// ==========================================

app.put("/api/admin/streams/:id", requireAdmin, (req, res) => {
    const stream = flashStreams.find(
        item => item.id === req.params.id
    );

    if (!stream) {
        return res.status(404).json({
            success: false,
            message: "Stream not found"
        });
    }

    if (typeof req.body?.active === "boolean") {
        stream.active = req.body.active;
    }

    if (
        req.body?.title !== undefined ||
        req.body?.url !== undefined
    ) {
        const parsed = cleanStreamInput({
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

    res.json({
        success: true,
        stream
    });
});

// ==========================================
// ADMIN DELETE STREAM
// ==========================================

app.delete("/api/admin/streams/:id", requireAdmin, (req, res) => {
    const index = flashStreams.findIndex(
        item => item.id === req.params.id
    );

    if (index < 0) {
        return res.status(404).json({
            success: false,
            message: "Stream not found"
        });
    }

    flashStreams.splice(index, 1);

    res.json({ success: true });
});

// ==========================================
// 404 NOT FOUND
// ==========================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: "API endpoint not found",
        path: req.path
    });
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `FLASH LIVE API v4.2.0 listening on ${PORT}`
    );
});
