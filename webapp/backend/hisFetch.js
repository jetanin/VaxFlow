// Fetch โดเมนวัคซีน (per-hospital) จาก Mock HOSxP (MySQL) ผ่าน view ที่ตัด PII แล้ว
// VacFlow เชื่อมด้วย user read-only (vacflow_ro) — อ่านได้เฉพาะ vw_vacflow_* เท่านั้น
// ถ้าไม่ตั้ง HIS_DB_HOST → ปิดการ fetch (seed จะ fallback ไป CSV)
const mysql = require("mysql2/promise");

const CFG = {
  host: process.env.HIS_DB_HOST,
  port: parseInt(process.env.HIS_DB_PORT || "3306", 10),
  user: process.env.HIS_DB_USER || "vacflow_ro",
  password: process.env.HIS_DB_PASS || "",
  database: process.env.HIS_DB_NAME || "mock_hosxp",
  connectTimeout: 5000,
};

function hisEnabled() {
  return !!CFG.host;
}

// รอจน HIS พร้อม (mock-his อาจ init นานช่วงบูตครั้งแรก)
async function waitForHis(retries = 30, delayMs = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const c = await mysql.createConnection(CFG);
      await c.query("SELECT 1");
      await c.end();
      return true;
    } catch (e) {
      console.log(`[his] waiting for Mock HOSxP... (${i + 1}/${retries}) ${e.code || e.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

// ดึง product master + vial (per-hospital) จาก view (ไม่มี PII)
async function fetchVaccineDomain() {
  const conn = await mysql.createConnection(CFG);
  try {
    const [products] = await conn.query(
          `SELECT product_id, name, type, storage_temp, storage_min_c, storage_max_c,
            doses_per_vial, deep_frozen_life_days, thawed_life_days, open_life_hours
       FROM vw_vacflow_vaccine_product`);
    const [vials] = await conn.query(
      `SELECT vial_id, lot_id, product_id, hospital_id, state, state_since,
              doses_remaining, label_expiry, effective_expiry
       FROM vw_vacflow_vaccine_vial`);
    return { products, vials };
  } finally {
    await conn.end();
  }
}

module.exports = { hisEnabled, waitForHis, fetchVaccineDomain };
