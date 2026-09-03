import express from "express";
import { createServer } from "http";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

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

app.use("/auth", authRoutes);
app.use("/rooms", roomRoutes);
app.use("/upload", uploadRoutes);
app.use("/requests", requestRoutes);
app.use("/users", userRoutes);

const httpServer = createServer(app);
initSocket(httpServer, corsOrigins);

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
