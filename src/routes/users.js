import { Router } from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /users/search?q= — search users by username prefix
router.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 1) return res.json({ users: [] });

  try {
    // Exclude blocked users and self
    const result = await pool.query(
      `SELECT u.id, u.username, u.created_at
       FROM users u
       WHERE u.username ILIKE $1
         AND u.id != $2
         AND u.id NOT IN (
           SELECT blocked_id FROM blocked_users WHERE blocker_id = $2
         )
         AND u.id NOT IN (
           SELECT blocker_id FROM blocked_users WHERE blocked_id = $2
         )
       ORDER BY u.username
       LIMIT 20`,
      [`${q}%`, req.user.id]
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error("Search users error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

// GET /users/me — get current user profile
router.get("/me", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, created_at FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("Get me error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

// GET /users/blocked — get list of blocked users
router.get("/blocked", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, bu.blocked_at
       FROM blocked_users bu
       JOIN users u ON u.id = bu.blocked_id
       WHERE bu.blocker_id = $1
       ORDER BY bu.blocked_at DESC`,
      [req.user.id]
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error("Get blocked users error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

// POST /users/block — block a user by username
// Body: { username: string }
router.post("/block", async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "username is required" });

  try {
    const userResult = await pool.query(
      "SELECT id FROM users WHERE username = $1",
      [username.trim()]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const targetId = userResult.rows[0].id;
    if (targetId === req.user.id) {
      return res.status(400).json({ error: "You can't block yourself" });
    }

    await pool.query(
      `INSERT INTO blocked_users (blocker_id, blocked_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.user.id, targetId]
    );
    res.json({ blocked: true });
  } catch (err) {
    console.error("Block user error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

// DELETE /users/block/:username — unblock a user by username
router.delete("/block/:username", async (req, res) => {
  const username = req.params.username;
  try {
    const userResult = await pool.query(
      "SELECT id FROM users WHERE username = $1",
      [username.trim()]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const targetId = userResult.rows[0].id;

    const result = await pool.query(
      `DELETE FROM blocked_users
       WHERE blocker_id = $1 AND blocked_id = $2
       RETURNING blocked_id`,
      [req.user.id, targetId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User was not blocked" });
    }
    res.json({ unblocked: true });
  } catch (err) {
    console.error("Unblock user error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

export default router;