import express from "express";
import { createServer } from "http";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();
import { Pool } from "pg";

import authRoutes from "./routes/auth.js";
import roomRoutes from "./routes/rooms.js";
import uploadRoutes from "./routes/upload.js";
import requestRoutes from "./routes/requests.js";
import userRoutes from "./routes/users.js";
import { initSocket } from "./sockets/chat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const PORT = process.env.PORT || 4000;
const corsOrigins = (process.env.CLIENT_ORIGIN || "*").split(",").map((s) => s.trim());

const app = express();
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/health", (req, res) => res.json({ ok: true }));

// Initialize database schema if needed
async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set - skipping database initialization");
    return;
  }

  const schemaPath = path.join(__dirname, "config", "schema.sql");
  let schema;
  try {
    schema = fs.readFileSync(schemaPath, "utf8");
  } catch (err) {
    console.error("Could not read schema file:", err.message);
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Parse and execute schema
    const statements = schema.split(";").filter(s => s.trim().length > 0);
    for (const stmt of statements) {
      if (stmt.trim()) {
        try {
          await pool.query(stmt.trim());
        } catch (e) {
          // Ignore "already exists" errors
          if (!e.message.includes("already exists") && !e.message.includes("duplicate key")) {
            console.warn("Schema statement warning:", e.message);
          }
        }
      }
    }
    console.log("Database schema initialized successfully");
  } catch (err) {
    console.error("Database schema initialization error:", err.message);
  } finally {
    await pool.end();
  }
}

app.use("/auth", authRoutes);
app.use("/rooms", roomRoutes);
app.use("/upload", uploadRoutes);
app.use("/requests", requestRoutes);
app.use("/users", userRoutes);

const httpServer = createServer(app);
initSocket(httpServer, corsOrigins);

// Start server and initialize DB
httpServer.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  await initDatabase();
});
