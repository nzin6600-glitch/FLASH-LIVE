import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY;

app.get("/", (req, res) => {
  res.json({
    app: "FLASH LIVE API",
    status: "online",
    provider: "API-Football"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    apiKeyConfigured: Boolean(API_KEY)
  });
});

app.get("/api/leagues", async (req, res) => {
  if (!API_KEY) {
    return res.status(503).json({
      error: "API key not configured"
    });
  }

  try {
    const response = await fetch(
      "https://v3.football.api-sports.io/leagues",
      {
        headers: {
          "x-apisports-key": API_KEY
        }
      }
    );

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(502).json({
      error: "Football provider unavailable"
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`FLASH LIVE API running on port ${PORT}`);
});
