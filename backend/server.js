
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const API_KEY = process.env.API_FOOTBALL_KEY;

const API_HOST =
  "free-api-live-football-data.p.rapidapi.com";

const API_URL = `https://${API_HOST}`;

// =====================================
// RAPIDAPI REQUEST
// =====================================

async function footballRequest(endpoint) {
  if (!API_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY is not configured"
    );
  }

  const response = await fetch(
    `${API_URL}${endpoint}`,
    {
      method: "GET",
      headers: {
        "x-rapidapi-key": API_KEY,
        "x-rapidapi-host": API_HOST
      }
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Invalid JSON response: HTTP ${response.status}`
    );
  }

  if (!response.ok || data.status === "error") {
    throw new Error(
      JSON.stringify(data)
    );
  }

  return data;
}

// =====================================
// HOME
// =====================================

app.get("/", (req, res) => {
  res.json({
    app: "FLASH LIVE API",
    status: "online",
    provider: "Free API Live Football Data",
    version: "1.0.0"
  });
});

// =====================================
// HEALTH CHECK
// =====================================

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    provider: "RapidAPI",
    apiKeyConfigured: Boolean(API_KEY)
  });
});

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
      error: "Fixtures request failed",
      message: error.message
    });
  }
});

// =====================================
// 404
// =====================================

app.use((req, res) => {
  res.status(404).json({
    error: "API endpoint not found",
    path: req.path
  });
});

// =====================================
// SERVER START
// =====================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `FLASH LIVE API running on port ${PORT}`
  );

  console.log(
    `RapidAPI Host: ${API_HOST}`
  );

  console.log(
    `API Key Configured: ${Boolean(API_KEY)}`
  );
});
