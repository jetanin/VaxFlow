const { Pool } = require("pg");

// อ่าน config จาก env (docker-compose ตั้งให้)
const pool = new Pool({
  host: process.env.PGHOST || "db",
  port: parseInt(process.env.PGPORT || "5432", 10),
  user: process.env.PGUSER || "vaxflow",
  password: process.env.PGPASSWORD || "vaxflow",
  database: process.env.PGDATABASE || "vaxflow",
});

// รอจน Postgres พร้อม (container db อาจบูตช้ากว่า backend)
async function waitForDb(retries = 20, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query("SELECT 1");
      console.log("[db] connected");
      return;
    } catch (err) {
      console.log(`[db] waiting for Postgres... (${i + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("[db] could not connect to Postgres");
}

module.exports = { pool, waitForDb };
