import { Router } from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /requests — get all pending chat requests where this user is the recipient
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         cr.id,
         cr.message,
         cr.created_at,
         cr.status,
         u.username as "fromUsername",
         u.avatar_url as "fromAvatar"
       FROM chat_requests cr
       JOIN users u ON u.id = cr.from_user_id
       WHERE cr.to_user_id = $1
         AND cr.status = 'pending'
       ORDER BY cr.created_at DESC`,
      [req.user.id]
    );
    res.json({ requests: result.rows });
  } catch (err) {
    console.error("Get requests error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

// POST /requests — send a chat request to a user
// Body: { username: string, message?: string }
router.post("/", async (req, res) => {
  const { username, message = "" } = req.body;
  if (!username) return res.status(400).json({ error: "username is required" });

  try {
    // Find the target user
    const userResult = await pool.query(
      "SELECT id, username FROM users WHERE username = $1",
      [username.trim()]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const targetUser = userResult.rows[0];
    if (targetUser.id === req.user.id) {
      return res.status(400).json({ error: "You can't send a request to yourself" });
    }

    // Check if a pending request already exists in either direction
    const existing = await pool.query(
      `SELECT id FROM chat_requests
       WHERE ((from_user_id = $1 AND to_user_id = $2)
          OR (from_user_id = $2 AND to_user_id = $1))
         AND status = 'pending'`,
      [req.user.id, targetUser.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Request already pending" });
    }

    // Check if already in a direct room
    const existingRoom = await pool.query(
      `SELECT r.id FROM rooms r
       JOIN room_members rm1 ON rm1.room_id = r.id AND rm1.user_id = $1
       JOIN room_members rm2 ON rm2.room_id = r.id AND rm2.user_id = $2
       WHERE r.direct_with = $2::integer`,
      [req.user.id, targetUser.id]
    );
    if (existingRoom.rows.length > 0) {
      return res.status(409).json({ error: "Chat already exists with this user" });
    }

    // Check if blocked
    const blockCheck = await pool.query(
      "SELECT 1 FROM blocked_users WHERE (blocker_id = $1 AND blocked_id = $2)",
      [req.user.id, targetUser.id]
    );
    if (blockCheck.rows.length > 0) {
      return res.status(403).json({ error: "You have blocked this user" });
    }

    const result = await pool.query(
      `INSERT INTO chat_requests (from_user_id, to_user_id, message, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id, message, created_at, status,
                 (SELECT username FROM users WHERE id = $1) as "fromUsername"`,
      [req.user.id, targetUser.id, message]
    );
    res.status(201).json({ request: result.rows[0] });
  } catch (err) {
    console.error("Create request error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

// POST /requests/:id/action — accept or decline a request
// Body: { action: "accept" | "decline" }
router.post("/:id/action", async (req, res) => {
  const requestId = req.params.id;
  const { action } = req.body;
  if (!action || !["accept", "decline"].includes(action)) {
    return res.status(400).json({ error: "action must be 'accept' or 'decline'" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const requestResult = await client.query(
      `SELECT id, from_user_id, to_user_id, message
       FROM chat_requests
       WHERE id = $1 AND to_user_id = $2 AND status = 'pending'`,
      [requestId, req.user.id]
    );
    if (requestResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Request not found" });
    }
    const chatRequest = requestResult.rows[0];

    if (action === "accept") {
      // Create a direct room for these two users
      const roomResult = await client.query(
        `INSERT INTO rooms (name, is_group, direct_with)
         VALUES ($1, FALSE, $2)
         RETURNING id`,
        [`direct_${chatRequest.from_user_id}_${req.user.id}`, chatRequest.from_user_id]
      );
      const roomId = roomResult.rows[0].id;

      await client.query(
        "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)",
        [roomId, chatRequest.from_user_id]
      );
      await client.query(
        "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)",
        [roomId, req.user.id]
      );

      await client.query(
        "UPDATE chat_requests SET status = 'accepted' WHERE id = $1",
        [requestId]
      );

      await client.query("COMMIT");
      res.json({ accepted: true, roomId });
    } else {
      await client.query("ROLLBACK");
      await client.query("COMMIT");
      await client.query(
        "UPDATE chat_requests SET status = 'declined' WHERE id = $1",
        [requestId]
      );
      res.json({ declined: true });
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Request action error:", err);
    res.status(500).json({ error: "internal server error" });
  } finally {
    client.release();
  }
});

// DELETE /requests/:id — withdraw a pending request you sent
router.delete("/:id", async (req, res) => {
  const requestId = req.params.id;
  try {
    const result = await pool.query(
      `DELETE FROM chat_requests
       WHERE id = $1 AND from_user_id = $2 AND status = 'pending'
       RETURNING id`,
      [requestId, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Request not found or already processed" });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error("Delete request error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

export default router;