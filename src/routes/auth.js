import { Router } from "express";
import bcrypt from "bcrypt";
import pool from "../config/db.js";
import { signToken } from "../utils/token.js";

const router = Router();
const SALT_ROUNDS = 12;

// POST /auth/register  { username, password }
router.post("/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }
  if (username.length < 3 || username.length > 32) {
    return res.status(400).json({ error: "username must be 3-32 characters" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }

  try {
    console.log(`[AUTH] Register attempt: username=${username}`);

    const existing = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
    if (existing.rows.length > 0) {
      console.log(`[AUTH] Username already taken: ${username}`);
      return res.status(409).json({ error: "username already taken" });
    }

    console.log(`[AUTH] Hashing password for ${username}...`);
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    console.log(`[AUTH] Inserting user ${username} into database...`);
    const result = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at",
      [username, passwordHash]
    );

    const user = result.rows[0];
    console.log(`[AUTH] User created successfully: id=${user.id}, username=${user.username}`);

    const token = signToken(user);
    res.status(201).json({ user, token });
  } catch (err) {
    console.error("[AUTH] Register error:", err.message);
    console.error("[AUTH] Stack trace:", err.stack);
    res.status(500).json({ error: "internal server error" });
  }
});

// POST /auth/login  { username, password }
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  try {
    const result = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE username = $1",
      [username]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "invalid username or password" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "invalid username or password" });
    }

    const token = signToken(user);
    res.json({ user: { id: user.id, username: user.username }, token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

export default router;
