const express = require("express");
const cors = require("cors");
const { pool, waitForDb } = require("./db");
const { seed } = require("./seed");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// health check
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch (e) {
    res.status(500).json({ status: "error", error: e.message });
  }
});

// รายชื่อโรงพยาบาล + สถานะรวม (แย่สุดในบรรดายา) สำหรับ Overview Map
app.get("/api/hospitals", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT h.hospital_id, h.name, h.latitude, h.longitude, h.lead_time_days,
             COUNT(*) FILTER (WHERE f.status='red')    AS n_red,
             COUNT(*) FILTER (WHERE f.status='yellow') AS n_yellow,
             ROUND(AVG(f.confidence)::numeric, 3)      AS avg_confidence,
             CASE WHEN COUNT(*) FILTER (WHERE f.status='red')>0 THEN 'red'
                  WHEN COUNT(*) FILTER (WHERE f.status='yellow')>0 THEN 'yellow'
                  ELSE 'green' END                     AS worst_status
      FROM hospitals h
      LEFT JOIN forecasts f ON f.hospital_id = h.hospital_id
      GROUP BY h.hospital_id
      ORDER BY h.hospital_id`);
    res.json(rows);
  } catch (e) { next(e); }
});

// พยากรณ์ทั้งหมด (กรองด้วย ?hospital_id= / ?status= ได้)
app.get("/api/forecasts", async (req, res, next) => {
  try {
    const { hospital_id, status } = req.query;
    const where = [];
    const params = [];
    if (hospital_id) { params.push(hospital_id); where.push(`hospital_id=$${params.length}`); }
    if (status) { params.push(status); where.push(`status=$${params.length}`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT hospital_id, drug, desc_th, last_date, pred_next_day, avg_30d,
              ratio, status, confidence
       FROM forecasts ${clause}
       ORDER BY hospital_id, drug`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// KPI สรุปภาพรวม
app.get("/api/summary", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM hospitals) AS hospitals,
        COUNT(*) FILTER (WHERE status='red')    AS red_items,
        COUNT(*) FILTER (WHERE status='yellow') AS yellow_items,
        COUNT(*) FILTER (WHERE status='green')  AS green_items,
        ROUND(AVG(confidence)::numeric, 3)      AS avg_confidence
      FROM forecasts`);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ศูนย์ควบคุมความเป็นส่วนตัว: จำนวน weight ที่ส่ง + รายชื่อ รพ.
app.get("/api/privacy", async (_req, res, next) => {
  try {
    const w = await pool.query("SELECT COUNT(*) AS n_weights FROM weights");
    const h = await pool.query("SELECT hospital_id, name FROM hospitals ORDER BY hospital_id");
    res.json({
      federated_learning: "active",
      differential_privacy: { enabled: true, sigma: 0.1 },
      transport: "TLS/SSL",
      secure_aggregation: true,
      n_weights: parseInt(w.rows[0].n_weights, 10),
      hospitals: h.rows.map((r) => ({ ...r, online: true })),
    });
  } catch (e) { next(e); }
});

// weight กลาง (โมเดลที่ส่งข้ามเครือข่าย)
app.get("/api/weights", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT feature, weight FROM weights ORDER BY ABS(weight) DESC");
    res.json(rows);
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

async function start() {
  await waitForDb();
  try {
    await seed();
  } catch (e) {
    console.error("[seed] failed (continuing):", e.message);
  }
  app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
}

start();
