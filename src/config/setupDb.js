// Applies schema.sql to the database pointed to by DATABASE_URL.
// Usage: npm run db:setup
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Check if DATABASE_URL is set
  if (!process.env.DATABASE_URL) {
    console.warn("⚠️  DATABASE_URL not set. Skipping schema setup.");
    console.warn("⚠️  Set DATABASE_URL environment variable to enable database initialization.");
    return;
  }

  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");

  // Create a dedicated pool for setup (don't reuse the main pool)
  const setupPool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log("🔧 Applying database schema...");
    await setupPool.query(sql);
    console.log("✅ Database schema applied successfully.");
  } catch (err) {
    console.error("❌ Failed to apply schema:", err.message);
    console.error("   Connection string:", process.env.DATABASE_URL?.split("@")[1] || "not set");
    // Don't exit with error — let server continue
    // This allows graceful degradation if DB is temporarily unavailable
  } finally {
    await setupPool.end();
  }
}

main();
