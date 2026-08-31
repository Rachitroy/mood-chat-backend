import { Router } from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = crypto.randomBytes(8).toString("hex");
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

const router = Router();
router.use(requireAuth);

// POST /upload/:roomId  (multipart/form-data, field name "file")
// Must be a member of the room. Returns metadata the client then sends
// over the socket as a file message.
router.post("/:roomId", upload.single("file"), async (req, res) => {
  const roomId = req.params.roomId;

  if (!req.file) {
    return res.status(400).json({ error: "no file provided" });
  }

  try {
    const membership = await pool.query(
      "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2",
      [roomId, req.user.id]
    );
    if (membership.rows.length === 0) {
      return res.status(403).json({ error: "not a member of this room" });
    }

    res.status(201).json({
      url: `/uploads/${req.file.filename}`,
      fileName: req.file.originalname,
      fileMime: req.file.mimetype,
      fileSize: req.file.size,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

export default router;
