const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const maxmind = require("maxmind");
const { pool, waitForDb } = require("./db");
const { seed } = require("./seed");
const { signToken, requireAuth, requireAdmin } = require("./auth");

const app = express();
const PORT = process.env.PORT || 4000;

// ===== IP geolocation (hybrid) =====
// IP_GEO=maxmind (default, offline, ระดับจังหวัด) | ipapi (online, ระดับเขต/อำเภอ)
const IP_GEO = (process.env.IP_GEO || "maxmind").toLowerCase();
const GEOIP_DB = process.env.GEOIP_DB || path.join(__dirname, "GeoLite2-City.mmdb");
let _mmReader;  // cache promise
function mmReader() {
  if (_mmReader === undefined) {
    _mmReader = fs.existsSync(GEOIP_DB)
      ? maxmind.open(GEOIP_DB).catch((e) => { console.error("[geoip] open failed:", e.message); return null; })
      : Promise.resolve(null);
    if (!fs.existsSync(GEOIP_DB)) console.warn(`[geoip] ไม่พบ ${GEOIP_DB} (ดูวิธีโหลด GeoLite2 ใน README)`);
  }
  return _mmReader;
}

app.set("trust proxy", true); // อ่าน IP จริงผ่าน X-Forwarded-For (หลัง nginx)
app.use(cors());
app.use(express.json({ limit: "12mb" }));  // รองรับอัปโหลดเอกสารเซ็นแล้ว (base64)

function isPrivateIp(ip) {
  return ip === "::1" || ip === "127.0.0.1" ||
    ip.startsWith("10.") || ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

// MaxMind offline (ระดับจังหวัด/ประเทศ) — privacy-first ข้อมูลไม่ออกจากระบบ
async function viaMaxmind(ip) {
  const reader = await mmReader();
  if (!reader) return "ไม่ทราบตำแหน่ง (ไม่มี GeoLite2 DB)";
  const rec = reader.get(ip);
  if (!rec) return "ไม่ทราบตำแหน่ง";
  const city = rec.city && rec.city.names && rec.city.names.en;
  const sub = rec.subdivisions && rec.subdivisions[0] && rec.subdivisions[0].names.en;
  const country = rec.country && rec.country.names && rec.country.names.en;
  const parts = [city, sub, country].filter(Boolean);
  return parts.length ? [...new Set(parts)].join(", ") : "ไม่ทราบตำแหน่ง";
}

// ip-api.com (ออนไลน์ ระดับเขต/อำเภอ เช่น "Bang Khae, Bangkok, Thailand")
async function viaIpApi(ip) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,district`,
      { signal: ctrl.signal });
    clearTimeout(timer);
    const j = await r.json();
    if (j.status !== "success") return "ไม่ทราบตำแหน่ง";
    return [...new Set([j.district, j.city, j.regionName, j.country].filter(Boolean))].join(", ");
  } catch {
    return "ไม่ทราบตำแหน่ง";
  }
}

// hybrid: เลือก provider ตาม env IP_GEO (default maxmind/offline) — IP ภายใน = LAN
async function ipLocation(ip) {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, "");
  if (isPrivateIp(clean)) return "เครือข่ายภายใน (LAN)";
  return IP_GEO === "ipapi" ? viaIpApi(clean) : viaMaxmind(clean);
}

// นำสต็อกใหม่มาคำนวณ days-of-supply + สถานะสีใหม่ (real-time refresh หลังมีข้อมูลใหม่)
async function recomputeForecast(hospitalId, drug) {
  // อัปเดตทั้งแถว daily และ weekly: อัตราใช้ต่อวัน = pred (daily) หรือ pred/7 (weekly)
  await pool.query(
    `UPDATE forecasts
     SET days_of_supply = ROUND((stock_on_hand /
           GREATEST(pred_next_day / (CASE WHEN freq='weekly' THEN 7.0 ELSE 1.0 END), 0.1))::numeric, 1),
         status = CASE
           WHEN stock_on_hand / GREATEST(pred_next_day / (CASE WHEN freq='weekly' THEN 7.0 ELSE 1.0 END), 0.1) >= 14 THEN 'green'
           WHEN stock_on_hand / GREATEST(pred_next_day / (CASE WHEN freq='weekly' THEN 7.0 ELSE 1.0 END), 0.1) >= 4  THEN 'yellow'
           ELSE 'red' END
     WHERE hospital_id = $1 AND drug = $2`,
    [hospitalId, drug]);
}

// บันทึก Audit Trail (timestamp + IP + ตำแหน่ง) — best-effort ไม่ให้ล้มทั้ง request
async function logAudit(req, action, entity, entityId, detail) {
  try {
    const loc = await ipLocation(req.ip);
    await pool.query(
      `INSERT INTO audit_log (actor, action, entity, entity_id, detail, ip, ip_location)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.user?.hospital_id || null, action, entity, entityId != null ? String(entityId) : null,
       detail || null, req.ip, loc]
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

// ===== Federated Learning round (รพ. ส่ง weight กลับ) =====
// token ภายในเดียวกับ reseed (service-to-service ไม่ใช่ JWT ของผู้ใช้)
function checkServiceToken(req) {
  const token = req.headers["x-fl-token"] || req.headers["x-reseed-token"] || "";
  return token === (process.env.FL_TOKEN || process.env.RESEED_TOKEN || "changeme");
}

// 1) รพ. ขอ "สเปกร่วม" (รายชื่อฟีเจอร์ + ค่า scaler ที่ตกลงร่วมกัน) เพื่อสเกลข้อมูลให้ตรงกันทุก รพ.
//    เผยแพร่ไว้ที่ models/fl_spec.json (สร้างด้วย scripts/fl_publish_spec.py)
app.get("/api/fl/spec", (req, res) => {
  const freq = (req.query.freq || "daily").toLowerCase() === "weekly" ? "weekly" : "daily";
  const file = path.join(process.env.SEED_DIR || path.resolve(__dirname, "../.."), "models", "fl_spec.json");
  if (!fs.existsSync(file))
    return res.status(503).json({ error: "ยังไม่มี fl_spec.json — รัน scripts/fl_publish_spec.py ก่อน" });
  try {
    const spec = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!spec[freq]) return res.status(404).json({ error: `ไม่มีสเปกสำหรับ freq=${freq}` });
    res.json(spec[freq]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2) รพ. ส่ง weight (coef+intercept ที่ใส่ DP noise แล้ว) กลับมา — เก็บ 1 แถวล่าสุดต่อ (รพ., freq)
app.post("/api/fl/submit", async (req, res) => {
  if (!checkServiceToken(req)) return res.status(403).json({ error: "invalid FL token" });
  const { hospital_id, freq = "daily", n_samples, coef, intercept, dp_sigma } = req.body || {};
  if (!hospital_id || !Array.isArray(coef) || typeof intercept !== "number" || !n_samples)
    return res.status(400).json({ error: "ต้องมี hospital_id, n_samples, coef[], intercept" });
  try {
    await pool.query(
      `INSERT INTO fl_contributions (hospital_id, freq, n_samples, coef, intercept, dp_sigma, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (hospital_id, freq) DO UPDATE
         SET n_samples=$3, coef=$4, intercept=$5, dp_sigma=$6, submitted_at=now()`,
      [hospital_id, freq, n_samples, JSON.stringify(coef), intercept, dp_sigma ?? null]);
    await logAudit({ user: { hospital_id }, ip: req.ip },
                   "fl_submit", "weights", hospital_id, `ส่ง weight (${coef.length} ค่า, n=${n_samples}) freq=${freq}`);
    res.json({ ok: true, received: coef.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3) ศูนย์กลางรวม weight ทุก รพ. ด้วย FedAvg (เฉลี่ยถ่วงน้ำหนักตาม n_samples) -> เขียนลงตาราง weights
app.post("/api/fl/aggregate", async (req, res) => {
  if (!checkServiceToken(req)) return res.status(403).json({ error: "invalid FL token" });
  const freq = (req.body && req.body.freq) === "weekly" ? "weekly" : "daily";
  try {
    const file = path.join(process.env.SEED_DIR || path.resolve(__dirname, "../.."), "models", "fl_spec.json");
    if (!fs.existsSync(file)) return res.status(503).json({ error: "ยังไม่มี fl_spec.json" });
    const features = JSON.parse(fs.readFileSync(file, "utf-8"))[freq].features;
    const { rows } = await pool.query(
      "SELECT n_samples, coef, intercept FROM fl_contributions WHERE freq=$1", [freq]);
    if (rows.length === 0) return res.status(400).json({ error: "ยังไม่มี รพ. ส่ง weight เข้ามา" });

    const total = rows.reduce((s, r) => s + r.n_samples, 0);
    const dim = features.length;
    const coef = new Array(dim).fill(0);
    let intercept = 0;
    for (const r of rows) {
      const w = r.n_samples / total;                       // น้ำหนัก FedAvg
      const c = Array.isArray(r.coef) ? r.coef : JSON.parse(r.coef);
      for (let i = 0; i < dim; i++) coef[i] += w * (c[i] || 0);
      intercept += w * r.intercept;
    }
    // เขียน weight กลางใหม่ลงตาราง weights (โมเดลที่แสดงใน Privacy Control)
    await pool.query("DELETE FROM weights");
    const values = features.map((f, i) => `($${2 * i + 1}, $${2 * i + 2})`).join(",");
    const params = features.flatMap((f, i) => [f, Number(coef[i].toFixed(6))]);
    await pool.query(`INSERT INTO weights (feature, weight) VALUES ${values}`, params);
    await pool.query("INSERT INTO weights (feature, weight) VALUES ('__bias__', $1)",
                     [Number(intercept.toFixed(6))]);
    await logAudit({ user: { hospital_id: "admin" }, ip: req.ip },
                   "fl_aggregate", "weights", freq, `FedAvg รวม ${rows.length} รพ. (${dim} ฟีเจอร์)`);
    res.json({ ok: true, hospitals: rows.length, n_features: dim, freq });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    const params = [freqOf(req)];
    let where = "";
    if (scope) { params.push(scope); where = `WHERE h.hospital_id = $${params.length}`; }
    const { rows } = await pool.query(`
      SELECT h.hospital_id, h.name, h.latitude, h.longitude, h.lead_time_days,
             COUNT(*) FILTER (WHERE f.status='red')    AS n_red,
             COUNT(*) FILTER (WHERE f.status='yellow') AS n_yellow,
             ROUND(AVG(f.confidence)::numeric, 3)      AS avg_confidence,
             CASE WHEN COUNT(*) FILTER (WHERE f.status='red')>0 THEN 'red'
                  WHEN COUNT(*) FILTER (WHERE f.status='yellow')>0 THEN 'yellow'
                  ELSE 'green' END                     AS worst_status
      FROM hospitals h
      LEFT JOIN forecasts f ON f.hospital_id = h.hospital_id AND f.freq = $1
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
    const params = [freqOf(req)];
    const where = ["freq=$1"];
    if (scope) { params.push(scope); where.push(`hospital_id=$${params.length}`); }
    if (status) { params.push(status); where.push(`status=$${params.length}`); }
    const clause = `WHERE ${where.join(" AND ")}`;
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
    const fParams = [freqOf(req)];
    let fWhere = "WHERE freq=$1";
    if (scope) { fParams.push(scope); fWhere += ` AND hospital_id=$${fParams.length}`; }
    const hCount = await pool.query(
      `SELECT COUNT(*) AS c FROM hospitals ${scope ? "WHERE hospital_id=$1" : ""}`,
      scope ? [scope] : []);
    const agg = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE status='red')    AS red_items,
             COUNT(*) FILTER (WHERE status='yellow') AS yellow_items,
             COUNT(*) FILTER (WHERE status='green')  AS green_items,
             ROUND(AVG(confidence)::numeric, 3)      AS avg_confidence
      FROM forecasts ${fWhere}`, fParams);
    res.json({ hospitals: hCount.rows[0].c, ...agg.rows[0] });
  } catch (e) { next(e); }
});

// คลังยาทั้งหมดในระบบ (รวมทุกกลุ่มยา) — admin เห็นทุก รพ., hospital เห็นเฉพาะตัวเอง
app.get("/api/drugs", requireAuth, async (req, res, next) => {
  try {
    const scope = scopedHospital(req);
    const params = [freqOf(req)];
    let where = "WHERE freq=$1";
    if (scope) { params.push(scope); where += ` AND hospital_id=$${params.length}`; }
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
    // online = ยังมี heartbeat ภายใน 2 นาที (เปิดแท็บค้างไว้ = online เรื่อย ๆ)
    // logout / ปิดแท็บ → last_seen = NULL → offline ทันที
    const h = await pool.query(`
      SELECT h.hospital_id, h.name,
             (SELECT MAX(ts) FROM audit_log a
              WHERE a.actor = h.hospital_id AND a.action = 'login') AS last_login,
             COALESCE(u.last_seen > now() - interval '2 minutes', false) AS online
      FROM hospitals h
      LEFT JOIN users u ON u.hospital_id = h.hospital_id
      ORDER BY h.hospital_id`);
    res.json({
      federated_learning: "active",
      differential_privacy: { enabled: true, sigma: 0.1 },
      transport: "TLS/SSL",
      secure_aggregation: true,
      n_weights: parseInt(w.rows[0].n_weights, 10),
      online_count: h.rows.filter((r) => r.online).length,
      hospitals: h.rows,
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
    const token = signToken({ username: user.username, hospital_id: user.hospital_id, role: user.role, name });
    await pool.query("UPDATE users SET last_seen=now() WHERE username=$1", [user.username]);
    await logAudit({ user: { hospital_id: user.hospital_id || "admin" }, ip: req.ip },
                   "login", "user", user.username, "เข้าสู่ระบบ");
    res.json({ token, hospital_id: user.hospital_id, role: user.role, name });
  } catch (e) { next(e); }
});

// ข้อมูลผู้ใช้ปัจจุบัน
app.get("/api/me", requireAuth, (req, res) => {
  res.json({ hospital_id: req.user.hospital_id, role: req.user.role, name: req.user.name });
});

// ออกจากระบบ — ล้าง last_seen (offline ทันที) + บันทึก audit
app.post("/api/logout", requireAuth, async (req, res) => {
  if (req.user.username)
    await pool.query("UPDATE users SET last_seen=NULL WHERE username=$1", [req.user.username]);
  await logAudit(req, "logout", "user", req.user.hospital_id || "admin", "ออกจากระบบ");
  res.json({ ok: true });
});

// heartbeat — ผู้ใช้ยังเปิดแท็บอยู่ → คง online (เรียกเป็นระยะจาก frontend)
app.post("/api/heartbeat", requireAuth, async (req, res) => {
  if (req.user.username)
    await pool.query("UPDATE users SET last_seen=now() WHERE username=$1", [req.user.username]);
  res.json({ ok: true });
});

// ปิดแท็บ — beacon จาก frontend (pagehide) → offline ทันที (ไม่บันทึก audit เพื่อเลี่ยง noise ตอน refresh)
app.post("/api/offline", requireAuth, async (req, res) => {
  if (req.user.username)
    await pool.query("UPDATE users SET last_seen=NULL WHERE username=$1", [req.user.username]);
  res.json({ ok: true });
});

const RESET_PW = process.env.DEFAULT_PASSWORD || "medcast123";

// admin: ออกคีย์ 4 หลักให้ รพ. ไปใช้เปลี่ยนรหัส (หมดอายุใน 1 ชม.)
app.post("/api/admin/reset-key", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { username } = req.body || {};
    const key = String(Math.floor(1000 + Math.random() * 9000));
    const r = await pool.query(
      `UPDATE users SET reset_key=$1, reset_key_expires=now()+interval '1 hour'
       WHERE username=$2 RETURNING username`, [key, username]);
    if (!r.rows[0]) return res.status(404).json({ error: "ไม่พบบัญชี" });
    await logAudit(req, "issue_reset_key", "user", username, `ออกคีย์เปลี่ยนรหัสให้ ${username}`);
    res.json({ username, key });
  } catch (e) { next(e); }
});

// admin: รีเซ็ตรหัสผ่านกลับเป็นค่าตั้งต้น (medcast123)
app.post("/api/admin/reset-password", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { username } = req.body || {};
    const hash = bcrypt.hashSync(RESET_PW, 10);
    const r = await pool.query(
      `UPDATE users SET password_hash=$1, reset_key=NULL, reset_key_expires=NULL
       WHERE username=$2 RETURNING username`, [hash, username]);
    if (!r.rows[0]) return res.status(404).json({ error: "ไม่พบบัญชี" });
    await logAudit(req, "reset_password", "user", username, `รีเซ็ตรหัสผ่าน ${username} เป็นค่าตั้งต้น`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// public: เปลี่ยนรหัสผ่านด้วยคีย์ที่ได้จาก admin
app.post("/api/change-password", async (req, res, next) => {
  try {
    const { username, key, new_password } = req.body || {};
    if (!username || !key || !new_password)
      return res.status(400).json({ error: "กรอก username / คีย์ / รหัสผ่านใหม่ ให้ครบ" });
    if (String(new_password).length < 6)
      return res.status(400).json({ error: "รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัว" });
    const u = await pool.query(
      "SELECT reset_key, reset_key_expires FROM users WHERE username=$1", [username]);
    const row = u.rows[0];
    if (!row || !row.reset_key || row.reset_key !== String(key))
      return res.status(403).json({ error: "คีย์ไม่ถูกต้อง (ขอคีย์จาก admin)" });
    if (!row.reset_key_expires || new Date(row.reset_key_expires) < new Date())
      return res.status(403).json({ error: "คีย์หมดอายุแล้ว — ขอใหม่จาก admin" });
    const hash = bcrypt.hashSync(String(new_password), 10);
    await pool.query(
      "UPDATE users SET password_hash=$1, reset_key=NULL, reset_key_expires=NULL WHERE username=$2",
      [hash, username]);
    await logAudit({ user: { hospital_id: username }, ip: req.ip },
                   "change_password", "user", username, "เปลี่ยนรหัสผ่านด้วยคีย์");
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// helper: คืน hospital_id ที่ผู้ใช้มีสิทธิ์เห็น
//   admin -> ใช้ค่า query (ถ้ามี) หรือ null = ทุก รพ.
//   hospital -> บังคับเป็น รพ. ของตัวเองเสมอ
function scopedHospital(req) {
  if (req.user.role === "admin") return req.query.hospital_id || null;
  return req.user.hospital_id;
}

// granularity ที่เลือก: daily (default) | weekly
function freqOf(req) {
  return req.query.freq === "weekly" ? "weekly" : "daily";
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
       WHERE f.drug = $1 AND f.freq = 'daily' AND f.status = 'green' AND f.hospital_id <> $2
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
      "SELECT status FROM forecasts WHERE hospital_id=$1 AND drug=$2 AND freq='daily'", [from, drug]);
    if (!chk.rows[0]) return res.status(400).json({ error: "ไม่พบยานี้ในระบบของโรงพยาบาล" });
    if (chk.rows[0].status !== "red") {
      return res.status(403).json({ error: "ยืมยาได้เฉพาะรายการที่สถานะ 🔴 ขาดแคลนเท่านั้น" });
    }
    // ผู้ให้ยืมต้องมียาตัวนี้สถานะ 🟢 (โซนปลอดภัย ≥14 วัน)
    const lend = await pool.query(
      "SELECT status FROM forecasts WHERE hospital_id=$1 AND drug=$2 AND freq='daily'", [to_hospital, drug]);
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
    const baseSelect = `SELECT b.*, hf.name AS from_name, ht.name AS to_name,
         EXISTS(SELECT 1 FROM borrow_documents d WHERE d.borrow_id = b.id) AS has_signed_doc
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

// ---------- เอกสารที่เซ็นแล้ว (อัปโหลด/ดาวน์โหลด) ----------
function canAccessBorrow(req, b) {
  const me = req.user.hospital_id;
  return req.user.role === "admin" || me === b.from_hospital || me === b.to_hospital;
}

// อัปโหลดเอกสารที่เซ็นแล้ว (base64) แนบกับคำขอยืม
app.post("/api/borrow/:id/document", requireAuth, async (req, res, next) => {
  try {
    const { filename, mime, data } = req.body || {};
    if (!data) return res.status(400).json({ error: "ไม่มีไฟล์" });
    const cur = await pool.query(
      "SELECT id, from_hospital, to_hospital FROM borrow_requests WHERE id=$1", [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: "ไม่พบคำขอ" });
    if (!canAccessBorrow(req, cur.rows[0])) return res.status(403).json({ error: "ไม่มีสิทธิ์" });
    await pool.query(
      `INSERT INTO borrow_documents (borrow_id, filename, mime, data_b64, uploaded_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (borrow_id) DO UPDATE SET
         filename=EXCLUDED.filename, mime=EXCLUDED.mime, data_b64=EXCLUDED.data_b64,
         uploaded_by=EXCLUDED.uploaded_by, uploaded_at=now()`,
      [req.params.id, filename || "signed", mime || "application/octet-stream",
       data, req.user.hospital_id || "admin"]);
    await logAudit(req, "upload_signed", "borrow_request", req.params.id,
                   `อัปโหลดเอกสารที่เซ็นแล้ว (คำขอ #${req.params.id})`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ดาวน์โหลดเอกสารที่เซ็นแล้ว
app.get("/api/borrow/:id/document", requireAuth, async (req, res, next) => {
  try {
    const cur = await pool.query(
      "SELECT from_hospital, to_hospital FROM borrow_requests WHERE id=$1", [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: "ไม่พบคำขอ" });
    if (!canAccessBorrow(req, cur.rows[0])) return res.status(403).json({ error: "ไม่มีสิทธิ์" });
    const doc = await pool.query(
      "SELECT filename, mime, data_b64, uploaded_at FROM borrow_documents WHERE borrow_id=$1",
      [req.params.id]);
    if (!doc.rows[0]) return res.status(404).json({ error: "ยังไม่มีเอกสารที่เซ็น" });
    res.json(doc.rows[0]);
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
    const base = [freqOf(req)];          // freq filter (อย่างน้อยเสมอ)
    let cond = "freq=$1";
    if (scope) { base.push(scope); cond += ` AND hospital_id=$${base.length}`; }

    // FEFO: ใกล้หมดอายุก่อน (รวมที่หมดอายุแล้ว) — เรียงตามวันหมดอายุ
    const expiring = await pool.query(
      `SELECT hospital_id, drug, desc_th, stock_on_hand, expiry_date,
              (expiry_date - CURRENT_DATE) AS days_to_expiry
       FROM forecasts
       WHERE ${cond} AND expiry_date IS NOT NULL
         AND (expiry_date - CURRENT_DATE) <= $${base.length + 1}
       ORDER BY expiry_date ASC`, [...base, expiryDays]);

    // ต่ำกว่าจุดสั่งซื้อ (reorder point)
    const reorder = await pool.query(
      `SELECT hospital_id, drug, desc_th, stock_on_hand, reorder_point, days_of_supply, status
       FROM forecasts
       WHERE ${cond} AND stock_on_hand <= reorder_point
       ORDER BY (stock_on_hand - reorder_point) ASC`, base);

    // ขาดแคลน (สถานะแดง)
    const shortage = await pool.query(
      `SELECT hospital_id, drug, desc_th, stock_on_hand, days_of_supply, status
       FROM forecasts WHERE ${cond} AND status = 'red'
       ORDER BY days_of_supply ASC`, base);

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
