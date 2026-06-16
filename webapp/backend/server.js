const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { pool, waitForDb } = require("./db");
const { seed } = require("./seed");
const geoip = require("geoip-lite");
const { signToken, requireAuth, requireAdmin } = require("./auth");

const app = express();
const PORT = process.env.PORT || 4000;

app.set("trust proxy", true); // อ่าน IP จริงผ่าน X-Forwarded-For (หลัง nginx)
app.use(cors());
app.use(express.json());

// แปลง IP -> ตำแหน่งโดยประมาณ (offline geoip) — IP ภายในแสดงเป็น LAN
function ipLocation(ip) {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, "");
  if (clean === "::1" || clean === "127.0.0.1" ||
      clean.startsWith("10.") || clean.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(clean)) {
    return "เครือข่ายภายใน (LAN)";
  }
  const g = geoip.lookup(clean);
  if (!g) return "ไม่ทราบตำแหน่ง";
  return [g.city, g.region, g.country].filter(Boolean).join(", ");
}

// นำสต็อกใหม่มาคำนวณ days-of-supply + สถานะสีใหม่ (real-time refresh หลังมีข้อมูลใหม่)
async function recomputeForecast(hospitalId, drug) {
  await pool.query(
    `UPDATE forecasts
     SET days_of_supply = ROUND((stock_on_hand / GREATEST(pred_next_day, 0.1))::numeric, 1),
         status = CASE
           WHEN stock_on_hand / GREATEST(pred_next_day, 0.1) >= 14 THEN 'green'
           WHEN stock_on_hand / GREATEST(pred_next_day, 0.1) >= 4  THEN 'yellow'
           ELSE 'red' END
     WHERE hospital_id = $1 AND drug = $2`,
    [hospitalId, drug]);
}

// บันทึก Audit Trail (timestamp + IP + ตำแหน่ง) — best-effort ไม่ให้ล้มทั้ง request
async function logAudit(req, action, entity, entityId, detail) {
  try {
    await pool.query(
      `INSERT INTO audit_log (actor, action, entity, entity_id, detail, ip, ip_location)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.user?.hospital_id || null, action, entity, entityId != null ? String(entityId) : null,
       detail || null, req.ip, ipLocation(req.ip)]
    );
  } catch (e) {
    console.error("[audit] failed:", e.message);
  }
}

// reseed: โหลดข้อมูลใหม่จาก CSV เข้า Postgres (เรียกโดย retrainer หลังเทรนรายวัน)
// ป้องกันด้วย token ภายใน (ไม่ใช่ JWT) เพราะเป็น service-to-service
app.post("/api/reseed", async (req, res) => {
  const token = req.headers["x-reseed-token"] || "";
  if (token !== (process.env.RESEED_TOKEN || "changeme")) {
    return res.status(403).json({ error: "invalid reseed token" });
  }
  try {
    await seed();
    console.log("[reseed] reloaded data from CSV");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
app.get("/api/hospitals", requireAuth, async (req, res, next) => {
  try {
    const scope = scopedHospital(req);
    const params = scope ? [scope] : [];
    const where = scope ? "WHERE h.hospital_id = $1" : "";
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
      ${where}
      GROUP BY h.hospital_id
      ORDER BY h.hospital_id`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// พยากรณ์ทั้งหมด (กรองด้วย ?hospital_id= / ?status= ได้)
app.get("/api/forecasts", requireAuth, async (req, res, next) => {
  try {
    const { status } = req.query;
    const scope = scopedHospital(req);  // hospital role -> บังคับ รพ.ตัวเอง
    const where = [];
    const params = [];
    if (scope) { params.push(scope); where.push(`hospital_id=$${params.length}`); }
    if (status) { params.push(status); where.push(`status=$${params.length}`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT hospital_id, drug, desc_th, last_date, pred_next_day, stock_on_hand,
              reorder_point, expiry_date, days_of_supply, status, confidence
       FROM forecasts ${clause}
       ORDER BY days_of_supply ASC NULLS FIRST`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// KPI สรุปภาพรวม
app.get("/api/summary", requireAuth, async (req, res, next) => {
  try {
    const scope = scopedHospital(req);
    const params = scope ? [scope] : [];
    const where = scope ? "WHERE hospital_id = $1" : "";
    const hospWhere = scope ? "WHERE hospital_id = $1" : "";
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM hospitals ${hospWhere}) AS hospitals,
        COUNT(*) FILTER (WHERE status='red')    AS red_items,
        COUNT(*) FILTER (WHERE status='yellow') AS yellow_items,
        COUNT(*) FILTER (WHERE status='green')  AS green_items,
        ROUND(AVG(confidence)::numeric, 3)      AS avg_confidence
      FROM forecasts ${where}`, params);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// คลังยาทั้งหมดในระบบ (รวมทุกกลุ่มยา) — admin เห็นทุก รพ., hospital เห็นเฉพาะตัวเอง
app.get("/api/drugs", requireAuth, async (req, res, next) => {
  try {
    const scope = scopedHospital(req);
    const params = scope ? [scope] : [];
    const where = scope ? "WHERE hospital_id = $1" : "";
    const { rows } = await pool.query(`
      SELECT drug,
             MAX(desc_th)                                AS desc_th,
             COUNT(DISTINCT hospital_id)                 AS hospitals,
             SUM(stock_on_hand)                          AS total_stock,
             ROUND(AVG(days_of_supply)::numeric, 1)      AS avg_days,
             COUNT(*) FILTER (WHERE status='red')        AS n_red,
             COUNT(*) FILTER (WHERE status='yellow')     AS n_yellow,
             COUNT(*) FILTER (WHERE status='green')      AS n_green
      FROM forecasts ${where}
      GROUP BY drug
      ORDER BY n_red DESC, avg_days ASC`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// ศูนย์ควบคุมความเป็นส่วนตัว: จำนวน weight ที่ส่ง + รายชื่อ รพ.
app.get("/api/privacy", requireAuth, requireAdmin, async (_req, res, next) => {
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
app.get("/api/weights", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT feature, weight FROM weights ORDER BY ABS(weight) DESC");
    res.json(rows);
  } catch (e) { next(e); }
});

// ---------- AUTH ----------
// เข้าสู่ระบบ: { username, password } -> token
app.post("/api/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "กรอก username/password" });
    const { rows } = await pool.query(
      `SELECT u.username, u.password_hash, u.hospital_id, u.role, h.name
       FROM users u LEFT JOIN hospitals h ON h.hospital_id = u.hospital_id
       WHERE u.username = $1`, [username]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "username หรือ password ไม่ถูกต้อง" });
    }
    const name = user.role === "admin" ? "ผู้ดูแลระบบ (Admin)" : user.name;
    const token = signToken({ hospital_id: user.hospital_id, role: user.role, name });
    await logAudit({ user: { hospital_id: user.hospital_id || "admin" }, ip: req.ip },
                   "login", "user", user.username, "เข้าสู่ระบบ");
    res.json({ token, hospital_id: user.hospital_id, role: user.role, name });
  } catch (e) { next(e); }
});

// ข้อมูลผู้ใช้ปัจจุบัน
app.get("/api/me", requireAuth, (req, res) => {
  res.json({ hospital_id: req.user.hospital_id, role: req.user.role, name: req.user.name });
});

// helper: คืน hospital_id ที่ผู้ใช้มีสิทธิ์เห็น
//   admin -> ใช้ค่า query (ถ้ามี) หรือ null = ทุก รพ.
//   hospital -> บังคับเป็น รพ. ของตัวเองเสมอ
function scopedHospital(req) {
  if (req.user.role === "admin") return req.query.hospital_id || null;
  return req.user.hospital_id;
}

// ---------- BORROW (ยืมยา) ----------
// รพ. ที่ให้ยืมยา drug ได้ = สถานะ 🟢 (เหลือ ≥14 วัน) — เรียงตามระยะทาง GPS ใกล้สุด (Smart Borrowing)
app.get("/api/lenders", requireAuth, async (req, res, next) => {
  try {
    const { drug } = req.query;
    const { rows } = await pool.query(
      `WITH me AS (SELECT latitude AS lat, longitude AS lon
                   FROM hospitals WHERE hospital_id = $2)
       SELECT f.hospital_id, h.name, f.status, f.days_of_supply, f.stock_on_hand,
              GREATEST(0, f.stock_on_hand - f.reorder_point) AS surplus,
              ROUND((6371 * acos(greatest(-1, least(1,
                cos(radians(me.lat)) * cos(radians(h.latitude)) *
                cos(radians(h.longitude) - radians(me.lon)) +
                sin(radians(me.lat)) * sin(radians(h.latitude))))))::numeric, 1) AS distance_km
       FROM forecasts f
       JOIN hospitals h ON h.hospital_id = f.hospital_id, me
       WHERE f.drug = $1 AND f.status = 'green' AND f.hospital_id <> $2
       ORDER BY distance_km ASC`,
      [drug, req.user.hospital_id]);
    res.json(rows);
  } catch (e) { next(e); }
});

// สร้างคำขอยืมยา — อนุญาตเฉพาะยาที่ \"สถานะแดง\" ของโรงพยาบาลผู้ขอ
app.post("/api/borrow", requireAuth, async (req, res, next) => {
  try {
    const from = req.user.hospital_id;
    const { to_hospital, drug, quantity, reason } = req.body || {};
    if (!to_hospital || !drug || !quantity) {
      return res.status(400).json({ error: "กรอก to_hospital / drug / quantity ให้ครบ" });
    }
    if (to_hospital === from) return res.status(400).json({ error: "ยืมจากโรงพยาบาลตัวเองไม่ได้" });

    const chk = await pool.query(
      "SELECT status FROM forecasts WHERE hospital_id=$1 AND drug=$2", [from, drug]);
    if (!chk.rows[0]) return res.status(400).json({ error: "ไม่พบยานี้ในระบบของโรงพยาบาล" });
    if (chk.rows[0].status !== "red") {
      return res.status(403).json({ error: "ยืมยาได้เฉพาะรายการที่สถานะ 🔴 ขาดแคลนเท่านั้น" });
    }
    // ผู้ให้ยืมต้องมียาตัวนี้สถานะ 🟢 (โซนปลอดภัย ≥14 วัน)
    const lend = await pool.query(
      "SELECT status FROM forecasts WHERE hospital_id=$1 AND drug=$2", [to_hospital, drug]);
    if (!lend.rows[0] || lend.rows[0].status !== "green") {
      return res.status(403).json({ error: "โรงพยาบาลผู้ให้ยืมต้องมียานี้สถานะ 🟢 (เหลือ ≥14 วัน)" });
    }

    const { rows } = await pool.query(
      `INSERT INTO borrow_requests (from_hospital, to_hospital, drug, quantity, reason)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [from, to_hospital, drug, parseFloat(quantity), reason || null]);
    await logAudit(req, "create_borrow", "borrow_request", rows[0].id,
                   `ขอยืม ${drug} จำนวน ${quantity} จาก ${to_hospital}`);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// รายการคำขอที่เกี่ยวข้องกับโรงพยาบาลของฉัน (ทั้งขอ + ถูกขอ)
app.get("/api/borrow", requireAuth, async (req, res, next) => {
  try {
    const me = req.user.hospital_id;
    const baseSelect = `SELECT b.*, hf.name AS from_name, ht.name AS to_name
       FROM borrow_requests b
       LEFT JOIN hospitals hf ON hf.hospital_id = b.from_hospital
       LEFT JOIN hospitals ht ON ht.hospital_id = b.to_hospital`;
    if (req.user.role === "admin") {
      // admin: เห็นคำขอทุก รพ. (oversight)
      const { rows } = await pool.query(`${baseSelect} ORDER BY b.created_at DESC`);
      res.json(rows.map((r) => ({ ...r, direction: "oversight" })));
      return;
    }
    const { rows } = await pool.query(
      `${baseSelect} WHERE b.from_hospital = $1 OR b.to_hospital = $1
       ORDER BY b.created_at DESC`, [me]);
    res.json(rows.map((r) => ({ ...r, direction: r.from_hospital === me ? "outgoing" : "incoming" })));
  } catch (e) { next(e); }
});

// ผู้ให้ยืม (to_hospital) อนุมัติ/ปฏิเสธคำขอ
app.patch("/api/borrow/:id", requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "status ต้องเป็น approved หรือ rejected" });
    }
    const cur = await pool.query("SELECT * FROM borrow_requests WHERE id=$1", [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: "ไม่พบคำขอ" });
    if (cur.rows[0].to_hospital !== req.user.hospital_id) {
      return res.status(403).json({ error: "เฉพาะโรงพยาบาลผู้ให้ยืมเท่านั้นที่ตอบคำขอได้" });
    }
    const { rows } = await pool.query(
      "UPDATE borrow_requests SET status=$1 WHERE id=$2 RETURNING *", [status, req.params.id]);
    await logAudit(req, status === "approved" ? "approve_borrow" : "reject_borrow",
                   "borrow_request", req.params.id,
                   `${status === "approved" ? "อนุมัติ" : "ปฏิเสธ"}คำขอ #${req.params.id} (${rows[0].drug})`);

    // เมื่ออนุมัติ -> โอนสต็อก แล้วนำข้อมูลใหม่มาคำนวณพยากรณ์/สถานะใหม่อัตโนมัติ
    if (status === "approved") {
      const b = rows[0];
      await pool.query(  // ผู้ให้ยืม (to_hospital) สต็อกลดลง
        "UPDATE forecasts SET stock_on_hand = GREATEST(0, stock_on_hand - $1) WHERE hospital_id=$2 AND drug=$3",
        [b.quantity, b.to_hospital, b.drug]);
      await pool.query(  // ผู้ขอยืม (from_hospital) สต็อกเพิ่มขึ้น
        "UPDATE forecasts SET stock_on_hand = stock_on_hand + $1 WHERE hospital_id=$2 AND drug=$3",
        [b.quantity, b.from_hospital, b.drug]);
      await recomputeForecast(b.to_hospital, b.drug);
      await recomputeForecast(b.from_hospital, b.drug);
      await logAudit(req, "retrain_forecast", "forecast", b.drug,
                     `อัปเดตพยากรณ์อัตโนมัติหลังโอนยา ${b.drug} ${b.quantity} หน่วย: ${b.to_hospital} → ${b.from_hospital}`);
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ---------- AUDIT TRAIL ----------
// บันทึกธุรกรรมล่าสุด (timestamp + IP) — โปร่งใส ตรวจสอบได้
app.get("/api/audit", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 500);
    const { rows } = await pool.query(
      `SELECT a.id, a.ts, a.actor, h.name AS actor_name, a.action, a.entity,
              a.entity_id, a.detail, a.ip, a.ip_location
       FROM audit_log a LEFT JOIN hospitals h ON h.hospital_id = a.actor
       ORDER BY a.ts DESC LIMIT $1`, [limit]);
    res.json(rows);
  } catch (e) { next(e); }
});

// ---------- ALERTS (Expiry/FEFO + Reorder + Shortage) ----------
app.get("/api/alerts", requireAuth, async (req, res, next) => {
  try {
    const scope = scopedHospital(req);   // admin -> null = ทุก รพ.
    const expiryDays = parseInt(req.query.expiry_days || "120", 10);
    const hf = scope ? "hospital_id = $1 AND" : "";          // hospital filter (optional)
    const hp = scope ? [scope] : [];

    // FEFO: ใกล้หมดอายุก่อน (รวมที่หมดอายุแล้ว) — เรียงตามวันหมดอายุ
    const expiring = await pool.query(
      `SELECT hospital_id, drug, desc_th, stock_on_hand, expiry_date,
              (expiry_date - CURRENT_DATE) AS days_to_expiry
       FROM forecasts
       WHERE ${hf} expiry_date IS NOT NULL
         AND (expiry_date - CURRENT_DATE) <= $${hp.length + 1}
       ORDER BY expiry_date ASC`, [...hp, expiryDays]);

    // ต่ำกว่าจุดสั่งซื้อ (reorder point)
    const reorder = await pool.query(
      `SELECT hospital_id, drug, desc_th, stock_on_hand, reorder_point, days_of_supply, status
       FROM forecasts
       WHERE ${hf} stock_on_hand <= reorder_point
       ORDER BY (stock_on_hand - reorder_point) ASC`, hp);

    // ขาดแคลน (สถานะแดง)
    const shortage = await pool.query(
      `SELECT hospital_id, drug, desc_th, stock_on_hand, days_of_supply, status
       FROM forecasts WHERE ${hf} status = 'red'
       ORDER BY days_of_supply ASC`, hp);

    res.json({
      expiring: expiring.rows,
      reorder: reorder.rows,
      shortage: shortage.rows,
    });
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
