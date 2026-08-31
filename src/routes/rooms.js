import { Router } from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// POST /rooms  { name, isGroup, memberUsernames: [] }
// Creates a room and adds the creator (+ optional other usernames) as members.
router.post("/", async (req, res) => {
  const { name, isGroup = false, memberUsernames = [] } = req.body;
  if (!name) return res.status(400).json({ error: "room name is required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const roomResult = await client.query(
      "INSERT INTO rooms (name, is_group, created_by) VALUES ($1, $2, $3) RETURNING id, name, is_group, created_at",
      [name, isGroup, req.user.id]
    );
    const room = roomResult.rows[0];

    await client.query(
      "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)",
      [room.id, req.user.id]
    );

    if (Array.isArray(memberUsernames) && memberUsernames.length > 0) {
      const usersResult = await client.query(
        "SELECT id FROM users WHERE username = ANY($1::text[])",
        [memberUsernames]
      );
      for (const row of usersResult.rows) {
        await client.query(
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

// POST /rooms/:id/join — join an existing (e.g. public/group) room
router.post("/:id/join", async (req, res) => {
  const roomId = req.params.id;
  try {
    const roomCheck = await pool.query("SELECT id FROM rooms WHERE id = $1", [roomId]);
    if (roomCheck.rows.length === 0) {
      return res.status(404).json({ error: "room not found" });
    }

    await pool.query(
      "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [roomId, req.user.id]
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
      `SELECT r.id, r.name, r.is_group, r.created_at
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
    const membership = await pool.query(
      "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2",
      [roomId, req.user.id]
    );
    if (membership.rows.length === 0) {
      return res.status(403).json({ error: "not a member of this room" });
    }

    const result = await pool.query(
      `SELECT
         m.id, m.content, m.emotion_tag, m.message_type, m.file_url, m.file_name, m.file_mime, m.file_size, m.created_at,
         u.id AS sender_id, u.username AS sender_username,
         r.id AS reply_id, r.content AS reply_content, r.message_type AS reply_message_type, r.file_name AS reply_file_name,
         ru.username AS reply_sender_username
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN messages r ON r.id = m.reply_to_id
       LEFT JOIN users ru ON ru.id = r.sender_id
       WHERE m.room_id = $1
       ORDER BY m.created_at DESC
       LIMIT $2`,
      [roomId, limit]
    );

    const messages = result.rows.map((row) => {
      const { reply_id, reply_content, reply_message_type, reply_file_name, reply_sender_username, ...rest } = row;
      return {
        ...rest,
        replyTo: reply_id
          ? {
              id: reply_id,
              senderUsername: reply_sender_username,
              messageType: reply_message_type,
              preview: reply_message_type === "text" ? reply_content : reply_file_name || "Attachment",
            }
          : null,
      };
    });

    res.json({ messages: messages.reverse() });
  } catch (err) {
    console.error("Message history error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

// GET /rooms/:id/members — list members of a room (must be a member)
router.get("/:id/members", async (req, res) => {
  const roomId = req.params.id;
  try {
    const membership = await pool.query(
      "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2",
      [roomId, req.user.id]
    );
    if (membership.rows.length === 0) {
      return res.status(403).json({ error: "not a member of this room" });
    }

    const result = await pool.query(
      `SELECT u.id, u.username
       FROM room_members rm
       JOIN users u ON u.id = rm.user_id
       WHERE rm.room_id = $1
       ORDER BY u.username`,
      [roomId]
    );

    res.json({ members: result.rows });
  } catch (err) {
    console.error("List members error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

export default router;
