import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const SECRET = process.env.JWT_SECRET;

// Validate that JWT_SECRET is set
if (!SECRET) {
  console.error("❌ FATAL: JWT_SECRET environment variable is not set!");
  console.error("   Authentication will fail. Set JWT_SECRET before starting the server.");
  process.exit(1);
}

export function signToken(user) {
  try {
    return jwt.sign({ id: user.id, username: user.username }, SECRET, {
      expiresIn: "7d",
    });
  } catch (err) {
    console.error("Error signing token:", err.message);
    throw err;
  }
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (err) {
    console.error("Error verifying token:", err.message);
    throw err;
  }
}
