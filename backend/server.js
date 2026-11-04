
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const API_KEY = (process.env.API_FOOTBALL_KEY || "").trim();

const API_HOST = "free-api-live-football-data.p.rapidapi.com";
const API_URL = `https://${API_HOST}`;

// =====================================
// SERVER INFORMATION
// =====================================

app.get("/", (req, res) => {
  res.json({
    app: "FLASH LIVE API",
    status: "online",
    provider: "RabbitApi",
    version: "2.0.0"
  });
});

// =====================================
// HEALTH CHECK
// =====================================

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    provider: "RapidAPI",
    host: API_HOST,
    apiKeyConfigured: Boolean(API_KEY),
    keyLength: API_KEY.length
  });
});

// =====================================
// RAPIDAPI REQUEST
// =====================================

async function footballRequest(endpoint) {
  if (!API_KEY) {
    throw new Error("API_FOOTBALL_KEY is missing");
  }

  console.log("========== API REQUEST ==========");

  console.log("Provider:", "RabbitApi");
  console.log("Host:", API_HOST);
  console.log("Endpoint:", endpoint);
  console.log("Key length:", API_KEY.length);
  console.log("Key start:", API_KEY.slice(0, 4));
  console.log("Key end:", API_KEY.slice(-4));

  const url = `${API_URL}${endpoint}`;

  let response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "x-rapidapi-key": API_KEY,
        "x-rapidapi-host": API_HOST
      },
      signal: AbortSignal.timeout(20000)
    });
  } catch (error) {
    console.error("NETWORK ERROR:", error.message);
    throw new Error("Could not connect to RapidAPI");
  }

  const text = await response.text();

  console.log("HTTP STATUS:", response.status);

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    console.error("INVALID JSON RESPONSE");
    throw new Error("Provider returned invalid JSON");
  }

  if (!response.ok || data.status === "error") {
    console.error("PROVIDER ERROR:", JSON.stringify(data));
    throw new Error(JSON.stringify(data));
  }

  console.log("API SUCCESS");

  return data;
}

// =====================================
// POPULAR LEAGUES
// =====================================

app.get("/api/leagues", async (req, res) => {
  try {
    const data = await footballRequest(
      "/football-popular-leagues"
    );

    res.json(data);

  } catch (error) {
    console.error("LEAGUES ERROR:", error.message);

    res.status(502).json({
      success: false,
      error: "Leagues request failed",
      message: error.message
    });
  }
});

// =====================================
// LIVE MATCHES
// =====================================

app.get("/api/live", async (req, res) => {
  try {
    const data = await footballRequest(
      "/football-current-live"
    );

    res.json(data);

  } catch (error) {
    console.error("LIVE ERROR:", error.message);

    res.status(502).json({
      success: false,
      error: "Live matches request failed",
      message: error.message
    });
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
      `/football-get-matches-by-date?date=${encodeURIComponent(date)}`
    );

    res.json(data);

  } catch (error) {
    console.error("FIXTURES ERROR:", error.message);

    res.status(502).json({
      success: false,
      error: "Fixtures request failed",
      message: error.message
    });
  }
});

// =====================================
// 404 HANDLER
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
  console.log("Version: 2.0.0");
  console.log("Port:", PORT);
  console.log("Provider: RabbitApi");
  console.log("Host:", API_HOST);
  console.log("API Key Configured:", Boolean(API_KEY));
  console.log("=================================");
});
