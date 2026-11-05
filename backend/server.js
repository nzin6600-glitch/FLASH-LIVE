// Add at the top with the existing imports
import path from "node:path";
import { fileURLToPath } from "node:url";

// Add below const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// ==========================================
// FLASH LIVE USER APP - HTTPS ROUTE
// ==========================================

// Put User HTML at: public/index.html
// Open: https://flash-live.onrender.com/app

app.get(["/app", "/app/"], (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html"),
        (error) => {
            if (error && !res.headersSent) {
                console.error("USER APP FILE ERROR:", error.message);

                res.status(404).send(
                    "FLASH LIVE User App not found. Add public/index.html to the repository."
                );
            }
        }
    );
});