
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const API_KEY = (process.env.API_FOOTBALL_KEY || "").trim();
const API_HOST = "free-api-live-football-data.p.rapidapi.com";
const API_URL = `https://${API_HOST}`;

const ENDPOINTS = {
  countries: "football-get-all-countries",
  leagues: "football-popular-leagues",
  leaguesAll: "football-get-all-leagues",
  live: "football-current-live",
  fixtures: "football-get-matches-by-date"
};

// =====================================
// PROVIDER REQUEST
// =====================================

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

  console.log("API REQUEST:", endpoint);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-rapidapi-key": API_KEY,
      "x-rapidapi-host": API_HOST,
      "accept": "application/json"
    },
    signal: AbortSignal.timeout(20000)
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Provider returned invalid JSON");
  }

  if (!response.ok || data.status === "error") {
    const error = new Error(
      data.message || data.error || `Provider HTTP ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

// =====================================
// ERROR RESPONSE
// =====================================

function handleError(res, error, name) {
  console.error(`${name} ERROR:`, error.message);

  res.status(502).json({
    success: false,
    error: `${name} request failed`,
    message: error.message
  });
}

// =====================================
// SERVER INFORMATION
// =====================================

app.get("/", (req, res) => {
  res.json({
    app: "FLASH LIVE API",
    status: "online",
    provider: "RabbitApi",
    version: "3.0.0"
  });
});

// =====================================
// HEALTH
// =====================================

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    provider: "RapidAPI",
    host: API_HOST,
    apiKeyConfigured: Boolean(API_KEY),
    version: "3.0.0"
  });
});

// =====================================
// GENERIC PROVIDER PROXY
// Supports all verified football-* endpoints
// =====================================

app.get("/api/provider/:endpoint", async (req, res) => {
  try {
    const endpoint = String(req.params.endpoint)
      .replaceAll("_", "-")
      .toLowerCase();

    const data = await footballRequest(endpoint, req.query);

    res.json(data);
  } catch (error) {
    handleError(res, error, "PROVIDER");
  }
});

// =====================================
// COUNTRIES
// =====================================

app.get("/api/countries", async (req, res) => {
  try {
    const data = await footballRequest(ENDPOINTS.countries);
    res.json(data);
  } catch (error) {
    handleError(res, error, "COUNTRIES");
  }
});

// =====================================
// POPULAR LEAGUES
// =====================================

app.get("/api/leagues", async (req, res) => {
  try {
    const data = await footballRequest(ENDPOINTS.leagues);
    res.json(data);
  } catch (error) {
    handleError(res, error, "LEAGUES");
  }
});

// =====================================
// ALL LEAGUES
// =====================================

app.get("/api/leagues-all", async (req, res) => {
  try {
    const data = await footballRequest(ENDPOINTS.leaguesAll);
    res.json(data);
  } catch (error) {
    handleError(res, error, "ALL LEAGUES");
  }
});

// =====================================
// LIVE MATCHES
// =====================================

app.get("/api/live", async (req, res) => {
  try {
    const data = await footballRequest(ENDPOINTS.live);
    res.json(data);
  } catch (error) {
    handleError(res, error, "LIVE");
  }
});

// =====================================
// FIXTURES BY DATE
// =====================================

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

    const data = await footballRequest(
      ENDPOINTS.fixtures,
      { date }
    );

    res.json(data);
  } catch (error) {
    handleError(res, error, "FIXTURES");
  }
});

// =====================================
// 404
// =====================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "API endpoint not found",
    path: req.path
  });
});

// =====================================
// SERVER START
// =====================================

app.listen(PORT, "0.0.0.0", () => {
  console.log("=================================");
  console.log("FLASH LIVE API STARTED");
  console.log("Version: 3.0.0");
  console.log("Port:", PORT);
  console.log("Provider:", API_HOST);
  console.log("API Key Configured:", Boolean(API_KEY));
  console.log("=================================");
});
