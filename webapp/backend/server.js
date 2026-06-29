const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const maxmind = require("maxmind");
const { pool, waitForDb } = require("./db");
const { seed, recomputeOrders, recomputeTransshipment } = require("./seed");
const { signToken, requireAuth, requireAdmin } = require("./auth");

const app = express();
const PORT = process.env.PORT || 4000;
const ENGINE_URL = process.env.ENGINE_URL || "http://vaccine-engine:8500";  // vaccine-engine (3 โมดูล)

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

// reseed: โหลดข้อมูลใหม่จาก CSV เข้า Postgres (เรียกแบบ manual หลังอัปเดตข้อมูล)
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

// รายชื่อโรงพยาบาล + สถานะรวม (แย่สุดในบรรดาขวดวัคซีน) สำหรับ Overview Map
app.get("/api/hospitals", requireAuth, async (req, res, next) => {
  try {
    const scope = scopedHospital(req);
    const params = [];
    let where = "";
    if (scope) { params.push(scope); where = `WHERE h.hospital_id = $${params.length}`; }
    const { rows } = await pool.query(`
      SELECT h.hospital_id, h.name, h.latitude, h.longitude, h.lead_time_days,
             COUNT(v.vial_id)                            AS n_vials,
             COALESCE(SUM(v.doses_remaining), 0)         AS total_doses,
             COUNT(*) FILTER (WHERE v.status='red')      AS n_red,
             COUNT(*) FILTER (WHERE v.status='yellow')   AS n_yellow,
             CASE WHEN COUNT(*) FILTER (WHERE v.status='red')>0 THEN 'red'
                  WHEN COUNT(*) FILTER (WHERE v.status='yellow')>0 THEN 'yellow'
                  ELSE 'green' END                       AS worst_status
      FROM hospitals h
      LEFT JOIN vaccine_vial_status v ON v.hospital_id = h.hospital_id
      ${where}
      GROUP BY h.hospital_id
      ORDER BY h.hospital_id`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// ขวดวัคซีนทั้งหมด (กรองด้วย ?hospital_id= / ?status= ได้) — เรียงตามอายุที่เหลือ
app.get("/api/vials", requireAuth, async (req, res, next) => {
  try {
    const { status } = req.query;
    const scope = scopedHospital(req);  // hospital role -> บังคับ รพ.ตัวเอง
    const params = [];
    const where = [];
    if (scope) { params.push(scope); where.push(`hospital_id=$${params.length}`); }
    if (status) { params.push(status); where.push(`status=$${params.length}`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT vial_id, lot_id, hospital_id, product_id, product_name, product_type,
              state, state_since, doses_remaining, doses_per_vial, label_expiry,
              effective_expiry, ROUND(days_remaining::numeric, 2) AS days_remaining,
              transportable, status
       FROM vaccine_vial_status ${clause}
       ORDER BY days_remaining ASC NULLS FIRST`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// KPI สรุปภาพรวม (นับระดับขวด)
app.get("/api/summary", requireAuth, async (req, res, next) => {
  try {
    const scope = scopedHospital(req);
    const vParams = [];
    let vWhere = "";
    if (scope) { vParams.push(scope); vWhere = `WHERE hospital_id=$${vParams.length}`; }
    const hCount = await pool.query(
      `SELECT COUNT(*) AS c FROM hospitals ${scope ? "WHERE hospital_id=$1" : ""}`,
      scope ? [scope] : []);
    const agg = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE status='red')        AS red_items,
             COUNT(*) FILTER (WHERE status='yellow')     AS yellow_items,
             COUNT(*) FILTER (WHERE status='green')      AS green_items,
             COUNT(*) FILTER (WHERE state='OPENED')      AS opened_vials,
             COALESCE(SUM(doses_remaining), 0)           AS total_doses
      FROM vaccine_vial_status ${vWhere}`, vParams);
    res.json({ hospitals: hCount.rows[0].c, ...agg.rows[0] });
  } catch (e) { next(e); }
});

// คลังวัคซีนรวมทุกผลิตภัณฑ์ — admin เห็นทุก รพ., hospital เห็นเฉพาะตัวเอง
app.get("/api/vaccines", requireAuth, async (req, res, next) => {
  try {
    const scope = scopedHospital(req);
    const params = [];
    // กรอง รพ. ใน ON clause (ไม่ใช่ WHERE) เพื่อคง "วัคซีนครบทุกตัวใน master"
    // แม้สาขานั้นจะไม่มีขวด (LEFT JOIN จาก vaccine_product → ได้ครบตาม vaccine_merged_with_storage)
    let join = "";
    if (scope) { params.push(scope); join = ` AND v.hospital_id = $${params.length}`; }
    const { rows } = await pool.query(`
      SELECT p.product_id,
             p.name                                      AS product_name,
             p.type                                      AS product_type,
             p.doses_per_vial,
             COUNT(DISTINCT v.hospital_id)               AS hospitals,
             COUNT(v.vial_id)                            AS n_vials,
             COALESCE(SUM(v.doses_remaining), 0)         AS total_doses,
             COUNT(*) FILTER (WHERE v.state='OPENED')    AS opened_vials,
             COUNT(*) FILTER (WHERE v.status='red')      AS n_red,
             COUNT(*) FILTER (WHERE v.status='yellow')   AS n_yellow,
             COUNT(*) FILTER (WHERE v.status='green')    AS n_green
      FROM vaccine_product p
      LEFT JOIN vaccine_vial_status v
        ON v.product_id = p.product_id${join}
      GROUP BY p.product_id, p.name, p.type, p.doses_per_vial
      ORDER BY n_red DESC, total_doses DESC, p.product_id`, params);
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
    const name = user.role === "admin" ? "ผู้ดูแลระบบ (Admin)"
      : user.role === "director" ? `ผอ. ${user.name}`
      : user.name;
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

const RESET_PW = process.env.DEFAULT_PASSWORD || "vacflow123";

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

// admin: รีเซ็ตรหัสผ่านกลับเป็นค่าตั้งต้น (vacflow123)
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

// ---------- BORROW (ยืมวัคซีน) ----------
// รพ. ที่ให้ยืมวัคซีนได้ = มีขวด "ขนส่งได้" (ไม่ใช่ OPENED) สถานะ 🟢 — เรียงตามระยะทางถนนจริงใกล้สุด
// บทบาทแยกชัดจาก auto-transshipment: นี่คือ "shortlist สำหรับมนุษย์เลือกยืมเอง" (เภสัชกรกดขอ)
// ส่วนการจับคู่โอนย้ายอัตโนมัติทั้งเครือข่ายใช้ engine LP (recomputeTransshipment → /engine/match)
app.get("/api/lenders", requireAuth, async (req, res, next) => {
  try {
    const { product_id } = req.query;
    const { rows } = await pool.query(
      `WITH me AS (SELECT latitude AS lat, longitude AS lon
                   FROM hospitals WHERE hospital_id = $2)
       SELECT v.hospital_id, h.name,
              COUNT(*)                  AS green_vials,
              SUM(v.doses_remaining)    AS surplus_doses,
              -- ระยะทางตามถนนจริง (OSRM) ถ้ามี · ไม่งั้น fallback haversine (เส้นตรง)
              ROUND(COALESCE(d.distance_km, 6371 * acos(greatest(-1, least(1,
                cos(radians(me.lat)) * cos(radians(h.latitude)) *
                cos(radians(h.longitude) - radians(me.lon)) +
                sin(radians(me.lat)) * sin(radians(h.latitude))))))::numeric, 1) AS distance_km
       FROM vaccine_vial_status v
       JOIN hospitals h ON h.hospital_id = v.hospital_id
       LEFT JOIN hospital_distance d ON d.from_hospital = $2 AND d.to_hospital = v.hospital_id
       CROSS JOIN me
       WHERE v.product_id = $1 AND v.status = 'green' AND v.transportable
         AND v.hospital_id <> $2
       GROUP BY v.hospital_id, h.name, h.latitude, h.longitude, me.lat, me.lon, d.distance_km
       ORDER BY distance_km ASC`,
      [product_id, req.user.hospital_id]);
    res.json(rows);
  } catch (e) { next(e); }
});

// สร้างคำขอยืมวัคซีน — ผู้ขอต้องมีขวดสถานะ 🔴 (ใกล้หมดอายุ/ขาดแคลน) ของผลิตภัณฑ์นั้น
app.post("/api/borrow", requireAuth, async (req, res, next) => {
  try {
    const from = req.user.hospital_id;
    const { to_hospital, product_id, quantity, reason } = req.body || {};
    if (!to_hospital || !product_id || !quantity) {
      return res.status(400).json({ error: "กรอก to_hospital / product_id / quantity ให้ครบ" });
    }
    if (to_hospital === from) return res.status(400).json({ error: "ยืมจากโรงพยาบาลตัวเองไม่ได้" });

    const chk = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status='red') AS n_red
       FROM vaccine_vial_status WHERE hospital_id=$1 AND product_id=$2`, [from, product_id]);
    if (parseInt(chk.rows[0].n_red, 10) === 0) {
      return res.status(403).json({ error: "ยืมได้เฉพาะวัคซีนที่โรงพยาบาลมีสถานะ 🔴 ขาดแคลน/ใกล้หมดอายุ" });
    }
    // ผู้ให้ยืมต้องมีขวด 🟢 ที่ "ขนส่งได้" (ไม่ใช่ OPENED) ของผลิตภัณฑ์นี้
    const lend = await pool.query(
      `SELECT COUNT(*) AS n FROM vaccine_vial_status
       WHERE hospital_id=$1 AND product_id=$2 AND status='green' AND transportable`,
      [to_hospital, product_id]);
    if (parseInt(lend.rows[0].n, 10) === 0) {
      return res.status(403).json({ error: "โรงพยาบาลผู้ให้ยืมต้องมีขวด 🟢 ที่ขนส่งได้ (ไม่ใช่ขวดที่เปิดแล้ว)" });
    }

    const { rows } = await pool.query(
      `INSERT INTO borrow_requests (from_hospital, to_hospital, product_id, quantity, reason)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [from, to_hospital, product_id, parseFloat(quantity), reason || null]);
    await logAudit(req, "create_borrow", "borrow_request", rows[0].id,
                   `ขอยืม ${product_id} จำนวน ${quantity} โดส จาก ${to_hospital}`);
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
                   `${status === "approved" ? "อนุมัติ" : "ปฏิเสธ"}คำขอ #${req.params.id} (${rows[0].product_id})`);
    res.json(rows[0]);
    // ข้อมูลคลัง/ดีมานด์เปลี่ยนหลังการยืม → คำนวณคำแนะนำการสั่งซื้อใหม่ (retrain) แบบ fire-and-forget
    recomputeOrders().catch((e) => console.error("[reorder] retrain failed:", e.message));
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

// ---------- ใบยืม-คืน: ข้อมูลที่กรอก (form fields) ----------
// โหลดข้อมูลที่เคยกรอกไว้ของคำขอนี้ (null ถ้ายังไม่เคยบันทึก)
app.get("/api/borrow/:id/memo", requireAuth, async (req, res, next) => {
  try {
    const cur = await pool.query(
      "SELECT from_hospital, to_hospital FROM borrow_requests WHERE id=$1", [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: "ไม่พบคำขอ" });
    if (!canAccessBorrow(req, cur.rows[0])) return res.status(403).json({ error: "ไม่มีสิทธิ์" });
    const r = await pool.query(
      "SELECT data, updated_by, updated_at FROM borrow_memo WHERE borrow_id=$1", [req.params.id]);
    res.json(r.rows[0] || null);
  } catch (e) { next(e); }
});

// บันทึกข้อมูลที่กรอกในใบยืม-คืน (upsert · เก็บ form + items เป็น JSON)
app.put("/api/borrow/:id/memo", requireAuth, async (req, res, next) => {
  try {
    const { data } = req.body || {};
    if (!data || typeof data !== "object") return res.status(400).json({ error: "ไม่มีข้อมูล" });
    const cur = await pool.query(
      "SELECT from_hospital, to_hospital FROM borrow_requests WHERE id=$1", [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: "ไม่พบคำขอ" });
    if (!canAccessBorrow(req, cur.rows[0])) return res.status(403).json({ error: "ไม่มีสิทธิ์" });
    await pool.query(
      `INSERT INTO borrow_memo (borrow_id, data, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (borrow_id) DO UPDATE SET
         data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [req.params.id, JSON.stringify(data), req.user.hospital_id || "admin"]);
    await logAudit(req, "save_memo", "borrow_request", req.params.id,
                   `บันทึกข้อมูลใบยืม-คืน (คำขอ #${req.params.id})`);
    res.json({ ok: true });
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

// ---------- ALERTS (อายุขัยวัคซีน: ใกล้หมดอายุ + ขวดที่เปิดแล้ว + ขาดแคลน) ----------
app.get("/api/alerts", requireAuth, async (req, res, next) => {
  try {
    const scope = scopedHospital(req);   // admin -> null = ทุก รพ.
    const expiryDays = parseInt(req.query.expiry_days || "21", 10);
    const params = [];
    let cond = "";
    if (scope) { params.push(scope); cond = ` AND hospital_id=$${params.length}`; }

    // ใกล้หมดอายุตามอายุขัยจริง (effective_expiry) — รวมที่หมดอายุแล้ว
    const expiring = await pool.query(
      `SELECT vial_id, hospital_id, product_id, product_name, state, doses_remaining,
              effective_expiry, ROUND(days_remaining::numeric, 2) AS days_remaining, status
       FROM vaccine_vial_status
       WHERE days_remaining <= $${params.length + 1}${cond}
       ORDER BY days_remaining ASC`, [...params, expiryDays]);

    // ขวดที่เปิดแล้ว (OPENED, 6 ชม.) — ห้ามขนส่ง ต้องเร่งเคลียร์โดส (Multi-dose Pooling)
    const opened = await pool.query(
      `SELECT vial_id, hospital_id, product_id, product_name, doses_remaining,
              effective_expiry, ROUND(days_remaining::numeric, 3) AS days_remaining
       FROM vaccine_vial_status
       WHERE state='OPENED'${cond}
       ORDER BY days_remaining ASC`, params);

    // ขาดแคลน/วิกฤต (สถานะแดง)
    const shortage = await pool.query(
      `SELECT vial_id, hospital_id, product_id, product_name, doses_remaining,
              ROUND(days_remaining::numeric, 2) AS days_remaining, status
       FROM vaccine_vial_status WHERE status='red'${cond}
       ORDER BY days_remaining ASC`, params);

    // คงคลังสะสมเกินดีมานด์ (Yellow trigger §4.2: I_t > D_avg) — เสี่ยงใช้ไม่ทันก่อนหมดอายุ
    //   on_hand (🟢/🟡 ขนส่งได้) > ดีมานด์เฉลี่ย × 14 วัน (จะใช้ไม่หมดก่อนเข้าหน้าต่างวิกฤต) → ควรเร่งโอนออก
    const ovParams = [];
    let ovCond = "";
    if (scope) { ovParams.push(scope); ovCond = ` AND s.hospital_id=$${ovParams.length}`; }
    const overstock = await pool.query(`
      WITH demand AS (   -- ดีมานด์ = forecast จากโมเดล · fallback คิวนัด
        SELECT COALESCE(f.hospital_id, q.hospital_id) AS hospital_id,
               COALESCE(f.product_id, q.product_id)   AS product_id,
               COALESCE(f.forecast_daily, q.avg_daily) AS avg_daily
        FROM (SELECT hospital_id, product_id, AVG(slot_count)::float AS avg_daily
              FROM appointment_queue GROUP BY hospital_id, product_id) q
        FULL JOIN demand_forecast f USING (hospital_id, product_id)),
      stock AS (
        SELECT hospital_id, product_id,
               COALESCE(SUM(doses_remaining) FILTER
                 (WHERE status IN ('green','yellow') AND transportable),0) AS usable
        FROM vaccine_vial_status GROUP BY hospital_id, product_id)
      SELECT s.hospital_id, s.product_id, p.name AS product_name, s.usable AS on_hand,
             ROUND(COALESCE(d.avg_daily,0)::numeric,2) AS avg_daily_demand,
             ROUND((s.usable / NULLIF(d.avg_daily,0))::numeric,0) AS days_to_consume
      FROM stock s
      LEFT JOIN demand d ON d.hospital_id=s.hospital_id AND d.product_id=s.product_id
      LEFT JOIN vaccine_product p ON p.product_id=s.product_id
      WHERE COALESCE(d.avg_daily,0) > 0 AND s.usable > d.avg_daily * 14${ovCond}
      ORDER BY days_to_consume DESC NULLS LAST LIMIT 200`, ovParams);

    res.json({
      expiring: expiring.rows,
      opened: opened.rows,
      shortage: shortage.rows,
      overstock: overstock.rows,
    });
  } catch (e) { next(e); }
});

// ---------- ANALYTICS (ผลจาก notebook: ML/Optimization) ----------
// เปรียบเทียบโมเดล + Wastage = ระดับเครือข่าย (เห็นได้ทุกคน) · Forecast/Transshipment = scope ตาม รพ.

// เปรียบเทียบโมเดลพยากรณ์ (RandomForest/XGBoost/...) เรียง RMSE
app.get("/api/analytics/models", requireAuth, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT model, mae, rmse, r2 FROM analytics_model_comparison ORDER BY rmse ASC NULLS LAST`);
    res.json(rows);
  } catch (e) { next(e); }
});

// Wastage Simulation (Without vs With VacFlow) — พิสูจน์ KPI ลดการสูญเสีย
app.get("/api/analytics/wastage", requireAuth, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT scenario, expiry_waste, openvial_waste, total_waste FROM analytics_wastage`);
    res.json(rows);
  } catch (e) { next(e); }
});

// การเลือกโมเดลพยากรณ์ต่อ (รพ.×ผลิตภัณฑ์) — hospital เห็นเฉพาะของตัวเอง
app.get("/api/analytics/forecast", requireAuth, async (req, res, next) => {
  try {
    const scope = scopedHospital(req);
    const params = [];
    let where = "";
    if (scope) { params.push(scope); where = `WHERE f.hospital_id = $${params.length}`; }
    const { rows } = await pool.query(`
      SELECT f.hospital_id, h.name AS hospital_name, f.product_id, p.name AS product_name,
             f.sma7_rmse, f.best_alpha, f.es_rmse, f.winner
      FROM analytics_forecast f
      LEFT JOIN hospitals h ON h.hospital_id = f.hospital_id
      LEFT JOIN vaccine_product p ON p.product_id = f.product_id
      ${where}
      ORDER BY GREATEST(f.sma7_rmse, f.es_rmse) DESC NULLS LAST`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// แผนโอนย้ายล็อตเสี่ยง (Transportation Model) — hospital เห็นเฉพาะที่เกี่ยวข้องกับตัวเอง
app.get("/api/analytics/transshipment", requireAuth, async (req, res, next) => {
  try {
    const scope = scopedHospital(req);
    const params = [];
    let where = "";
    if (scope) {
      params.push(scope);
      where = `WHERE t.from_hospital = $${params.length} OR t.to_hospital = $${params.length}`;
    }
    const { rows } = await pool.query(`
      SELECT t.from_hospital, hf.name AS from_name, t.to_hospital, ht.name AS to_name,
             t.doses, t.product_id, p.name AS product_name
      FROM analytics_transshipment t
      LEFT JOIN hospitals hf ON hf.hospital_id = t.from_hospital
      LEFT JOIN hospitals ht ON ht.hospital_id = t.to_hospital
      LEFT JOIN vaccine_product p ON p.product_id = t.product_id
      ${where}
      ORDER BY t.doses DESC`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// ---------- REORDER / สั่งซื้อ → HOSxP ----------
// product_id (อ้างอิง อย.) -> tmt_code กลาง สำหรับสั่งเข้า HOSxP
// (ATC ฝังใน id: VAX_J07BX03_048 -> TMT-J07BX03 — ตรงกับ drugitems.tmt_code ของ Mock HOSxP)
function tmtOf(productId) {
  const parts = String(productId).split("_");
  return parts.length >= 2 ? `TMT-${parts[1]}` : `TMT-${productId}`;
}

// retrain: คำนวณคำแนะนำการสั่งซื้อใหม่จากข้อมูลสด (เรียกเองหลังข้อมูลเปลี่ยน หรือ manual โดย admin)
app.post("/api/retrain", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const n = await recomputeOrders();
    const moves = await recomputeTransshipment();   // แผนโอนย้ายจาก vaccine-engine (LP)
    await logAudit(req, "retrain_reorder", "order_recommendation", null,
                   `คำนวณใหม่: สั่งซื้อ ${n} รายการ · แผนโอนย้าย ${moves} เส้นทาง`);
    res.json({ ok: true, suggestions: n, transshipment_moves: moves });
  } catch (e) { next(e); }
});

// คำแนะนำการสั่งซื้อ — hospital เห็นเฉพาะของตัวเอง · เรียงตามจำนวนที่แนะนำให้สั่ง
app.get("/api/orders", requireAuth, async (req, res, next) => {
  try {
    const scope = scopedHospital(req);
    const params = [];
    let where = "";
    if (scope) { params.push(scope); where = `WHERE o.hospital_id = $${params.length}`; }
    const { rows } = await pool.query(`
      SELECT o.id, o.hospital_id, h.name AS hospital_name, o.product_id, p.name AS product_name,
             p.type AS product_type, o.on_hand, o.avg_daily_demand, o.lead_time_days,
             o.reorder_point, o.recommended_vials, o.recommended_doses, o.status, o.dispatched_at
      FROM order_recommendations o
      LEFT JOIN hospitals h ON h.hospital_id = o.hospital_id
      LEFT JOIN vaccine_product p ON p.product_id = o.product_id
      ${where}
      ORDER BY o.status, o.recommended_doses DESC`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// สั่งซื้อ → HOSxP: สร้าง "คำสั่งซื้อ" (PO command) ส่งให้ระบบ HOSxP รับไปออกใบสั่งจริง
//   HIS connector เป็น read-only (PDPA) จึงไม่เขียนตรง — VacFlow ออกคำสั่ง, HOSxP ดำเนินการ
app.post("/api/orders/:id/dispatch", requireAuth, async (req, res, next) => {
  try {
    const cur = await pool.query("SELECT * FROM order_recommendations WHERE id=$1", [req.params.id]);
    const o = cur.rows[0];
    if (!o) return res.status(404).json({ error: "ไม่พบคำแนะนำการสั่งซื้อ" });
    if (req.user.role !== "admin" && req.user.hospital_id !== o.hospital_id)
      return res.status(403).json({ error: "สั่งได้เฉพาะของโรงพยาบาลตัวเอง" });
    if (o.status === "dispatched")
      return res.status(409).json({ error: "คำสั่งซื้อนี้ส่งไป HOSxP แล้ว" });

    // payload รูปแบบคำสั่งซื้อสำหรับ HOSxP (ใช้ icode = product_id, tmt_code กลาง)
    const command = {
      target: "HOSxP",
      command: "PURCHASE_ORDER",
      hospital_id: o.hospital_id,
      issued_by: req.user.hospital_id || "admin",
      issued_at: new Date().toISOString(),
      items: [{
        icode: o.product_id, tmt_code: tmtOf(o.product_id),
        vials: o.recommended_vials, doses: o.recommended_doses,
      }],
      note: `เติมสต็อกตาม reorder point (คงเหลือ ${Math.round(o.on_hand)} โดส · ROP ${Math.round(o.reorder_point)})`,
    };
    await pool.query(
      "UPDATE order_recommendations SET status='dispatched', dispatched_at=now() WHERE id=$1", [o.id]);
    await logAudit(req, "dispatch_order", "order_recommendation", o.id,
                   `ส่งคำสั่งซื้อ ${o.product_id} (${o.recommended_vials} ขวด/${o.recommended_doses} โดส) → HOSxP`);
    res.json({ ok: true, command });
  } catch (e) { next(e); }
});

// ---------- DYNAMIC EXPIRE (event-driven overwrite §3.2.1) ----------
// จำลอง event หน้างาน (ยิงบาร์โค้ดละลาย/เปิดขวด) → เปลี่ยนสถานะ + overwrite อายุขัยจริงทันที
//   เรียก vaccine-engine /engine/expire (โมดูล 1) คำนวณ effective_expiry ใหม่
const NEXT_STATE = { DEEP_FROZEN: "THAWED", THAWED: "OPENED" };
app.post("/api/vials/:id/transition", requireAuth, async (req, res, next) => {
  try {
    const cur = await pool.query(
      `SELECT v.vial_id, v.hospital_id, v.state, v.label_expiry,
              p.thawed_life_days, p.open_life_hours
       FROM vaccine_vial v JOIN vaccine_product p ON p.product_id = v.product_id
       WHERE v.vial_id = $1`, [req.params.id]);
    const v = cur.rows[0];
    if (!v) return res.status(404).json({ error: "ไม่พบขวด" });
    if (req.user.role !== "admin" && req.user.hospital_id !== v.hospital_id)
      return res.status(403).json({ error: "จัดการได้เฉพาะขวดของโรงพยาบาลตัวเอง" });
    const to = req.body?.to_state || NEXT_STATE[v.state];
    if (NEXT_STATE[v.state] !== to)
      return res.status(400).json({ error: `เปลี่ยนสถานะ ${v.state} → ${to} ไม่ได้ (state machine)` });

    const stateSince = new Date().toISOString();   // เวลาเกิด event จริง
    let eff;
    try {  // โมดูล 1 (Dynamic Expire) — overwrite วันหมดอายุจริงตาม event
      const r = await fetch(`${ENGINE_URL}/engine/expire`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: to, label_expiry: v.label_expiry, state_since: stateSince,
          thawed_life_days: v.thawed_life_days, open_life_hours: v.open_life_hours,
        }),
      });
      eff = (await r.json()).effective_expiry;
    } catch (e) {
      return res.status(502).json({ error: "vaccine-engine ไม่ตอบ: " + e.message });
    }
    await pool.query(
      "UPDATE vaccine_vial SET state=$1, state_since=$2, effective_expiry=$3 WHERE vial_id=$4",
      [to, stateSince, eff, v.vial_id]);
    await logAudit(req, "vial_transition", "vaccine_vial", v.vial_id,
                   `${v.state} → ${to} · overwrite อายุขัยตาม event (effective_expiry=${eff})`);
    const st = await pool.query(
      `SELECT state, status, ROUND(days_remaining::numeric, 2) AS days_remaining, effective_expiry
       FROM vaccine_vial_status WHERE vial_id = $1`, [v.vial_id]);
    res.json({ vial_id: v.vial_id, ...st.rows[0] });
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

// export สำหรับ unit test · start เฉพาะตอนรันตรง (node server.js) ไม่ใช่ตอน require
module.exports = { app, tmtOf, NEXT_STATE };

if (require.main === module) start();
