
import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY;

const API_URL =
  "https://api-football-v1.p.rapidapi.com/v3";

async function footballRequest(endpoint) {
  if (!API_KEY) {
    throw new Error("RapidAPI key not configured");
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "GET",
    headers: {
      "x-rapidapi-key": API_KEY,
      "x-rapidapi-host": "api-football-v1.p.rapidapi.com"
    }
  });

  const data = await response.json();

  if (!response.ok || data.errors &&
      Object.keys(data.errors).length > 0) {
    throw new Error(
      JSON.stringify(data.errors || data)
    );
  }

  return data;
}

app.get("/", (req, res) => {
  res.json({
    app: "FLASH LIVE API",
    status: "online",
    provider: "API-Football via RapidAPI"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    provider: "RapidAPI",
    apiKeyConfigured: Boolean(API_KEY)
  });
});

app.get("/api/leagues", async (req, res) => {
  try {
    const data = await footballRequest("/leagues");
    res.json(data);
  } catch (error) {
    res.status(502).json({
      error: "Football API request failed",
      message: error.message
    });
  }
});

app.get("/api/fixtures", async (req, res) => {
  try {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") {
        params.set(key, value);
      }
    }

    const query = params.toString();
    const data = await footballRequest(
      `/fixtures${query ? `?${query}` : ""}`
    );

    res.json(data);
  } catch (error) {
    res.status(502).json({
      error: "Fixtures request failed",
      message: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`FLASH LIVE API running on port ${PORT}`);
});
