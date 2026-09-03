import { Router } from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);  // Protect all room routes — requires valid JWT

// POST /rooms — create a room (now supports direct_with for 1-on-1 chats)
router.post("/", async (req, res) => {
  const { name, isGroup, memberUsernames = [], directWith = 0 } = req.body;
  if (!name) return res.status(400).json({ error: "room name is required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const roomResult = await client.query(
      "INSERT INTO rooms (name, is_group, created_by, direct_with) VALUES ($1, $2, $3, $4) RETURNING id, name, is_group, created_at",
      [name, isGroup, req.user.id, directWith]
    );
    const room = roomResult.rows[0];

    await client.query(
      "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)",
      [room.id, req.user.id]
    );

    if (Array.isArray(memberUsernames) && memberUsernames.length > 0) {
      const usersResult = await pool.query(
        "SELECT id FROM users WHERE username = ANY($1::text[])",
        [memberUsernames]
      );
      for (const row of usersResult.rows) {
        await pool.query(
          "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [room.id, row.id]
        );
      }
    }

    await client.query("COMMIT");
    res.status(201).json({ room });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create room error:", err);
    res.status(500).json({ error: "internal server error" });
  } finally {
    client.release();
  }
});

// POST /rooms/:id/join — join an existing room
router.post("/:id/join", async (req, res) => {
  const roomId = req.params.id;
  try {
    const roomCheck = await pool.query("SELECT id FROM rooms WHERE id = $1", [req.params.id]);
    if (roomCheck.rows.length === 0) {
      return res.status(404).json({ error: "room not found" });
    }

    await pool.query(
      "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [req.params.id, req.user.id]
    );
    res.json({ joined: true });
  } catch (err) {
    console.error("Join room error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

// GET /rooms — list rooms the current user belongs to
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.name, r.is_group, r.direct_with, r.created_at
       FROM rooms r
       JOIN room_members rm ON rm.room_id = r.id
       WHERE rm.user_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json({ rooms: result.rows });
  } catch (err) {
    console.error("List rooms error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

// GET /rooms/:id/messages — history for a room (must be a member)
router.get("/:id/messages", async (req, res) => {
  const roomId = req.params.id;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  try {
    // Check membership
    const membership = await pool.query(
      "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2",
      [roomId, req.user.id]
    );
    if (membership.rows.length === 0) {
      return res.status(403).json({ error: "not a member of this room" });
    }

    const result = await pool.query(
      `SELECT
         m.id, m.content, m.emotion_tag, m.message_type,
         m.file_url, m.file_name, m.file_mime, m.file_size,
         m.created_at, m.reply_to_id,
         m.sender_id,
         r.direct_with
       FROM messages m
       JOIN rooms r ON m.room_id = r.id
       WHERE m.room_id = $1
       ORDER BY m.created_at DESC
       LIMIT $2`,
      [roomId, limit]
    );

    // Add message preview and unread count
    const messages = result.rows.map(msg => {
      const isOwn = msg.sender_id === req.user.id;
      const directWith = msg.direct_with !== null && msg.direct_with !== req.user.id;
      const isReply = msg.reply_to_id !== null;
      const isDirectMessage = directWith && isReply;

      return {
        ...msg,
        isOwn,
        isReply,
        isDirectMessage,
        preview: isDirectMessage
          ? msg.content.length > 60 ? msg.content.substring(0, 60) + "..." : msg.content
          : ""
      };
    });

    res.json({ messages });
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});
export default router;