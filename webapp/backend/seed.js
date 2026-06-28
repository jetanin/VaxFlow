// Seed Postgres จากไฟล์ CSV ที่ mount ไว้ที่ /seed (VacFlow — โดเมนวัคซีน)
// - /seed/data/hospitals/hospital_master.csv
// - /seed/data/vaccine/{vaccine_product,vaccine_vial,appointment_queue,vaccine_branches}.csv
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { parse } = require("csv-parse/sync");
const { pool } = require("./db");
const { hisEnabled, waitForHis, fetchVaccineDomain } = require("./hisFetch");

// docker: /seed (mount ../data, ../models) · local dev: repo root (webapp/backend/../..)
const SEED_DIR = process.env.SEED_DIR || path.resolve(__dirname, "../..");
const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || "vacflow123";
const ENGINE_URL = process.env.ENGINE_URL || "http://vaccine-engine:8500";  // Predictive Matching Engine

function readCsv(relPath) {
  const full = path.join(SEED_DIR, relPath);
  if (!fs.existsSync(full)) {
    console.warn(`[seed] missing file: ${full}`);
    return [];
  }
  const raw = fs.readFileSync(full, "utf-8").replace(/^﻿/, ""); // strip BOM
  return parse(raw, { columns: true, skip_empty_lines: true });
}

async function ensureSchema() {
  // idempotent — เผื่อ init.sql ไม่ได้รัน
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hospitals (
      hospital_id TEXT PRIMARY KEY, name TEXT NOT NULL,
      latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, lead_time_days INTEGER);
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      hospital_id TEXT, role TEXT NOT NULL DEFAULT 'hospital', created_at TIMESTAMPTZ DEFAULT now());
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'hospital';
    -- อนุญาต role 'director' (ผอ.รพ) — แทนที่ CHECK เดิมแบบ idempotent (DB เก่ามีแค่ admin|hospital)
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','hospital','director'));
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_key TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_key_expires TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS borrow_requests (
      id SERIAL PRIMARY KEY, from_hospital TEXT, to_hospital TEXT, product_id TEXT NOT NULL,
      quantity DOUBLE PRECISION NOT NULL, reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(), actor TEXT,
      action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT, ip_location TEXT);
    ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip_location TEXT;
    CREATE TABLE IF NOT EXISTS borrow_documents (
      borrow_id INTEGER PRIMARY KEY, filename TEXT, mime TEXT, data_b64 TEXT,
      uploaded_by TEXT, uploaded_at TIMESTAMPTZ DEFAULT now());
    -- VacFlow: โดเมนวัคซีน (vial-level)
    ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS transport_rate DOUBLE PRECISION;
    CREATE TABLE IF NOT EXISTS vaccine_product (
      product_id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      doses_per_vial INTEGER NOT NULL, deep_frozen_life_days INTEGER NOT NULL,
      thawed_life_days INTEGER NOT NULL, open_life_hours INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS vaccine_vial (
      vial_id TEXT PRIMARY KEY, lot_id TEXT, product_id TEXT NOT NULL, hospital_id TEXT,
      state TEXT NOT NULL DEFAULT 'DEEP_FROZEN', state_since TIMESTAMPTZ NOT NULL DEFAULT now(),
      doses_remaining INTEGER NOT NULL, label_expiry DATE NOT NULL,
      effective_expiry TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS appointment_queue (
      id SERIAL PRIMARY KEY, queue_date DATE NOT NULL, hospital_id TEXT, product_id TEXT,
      slot_count INTEGER NOT NULL DEFAULT 0, UNIQUE (queue_date, hospital_id, product_id));
    CREATE OR REPLACE VIEW vaccine_vial_status AS
      SELECT v.vial_id, v.lot_id, v.product_id, v.hospital_id, v.state, v.state_since,
             v.doses_remaining, v.label_expiry, v.effective_expiry,
             p.name AS product_name, p.type AS product_type, p.doses_per_vial,
             EXTRACT(EPOCH FROM (v.effective_expiry - now())) / 86400.0 AS days_remaining,
             (v.state <> 'OPENED') AS transportable,
             CASE WHEN v.effective_expiry <= now() + interval '14 days' THEN 'red'
                  WHEN v.effective_expiry <= now() + interval '21 days' THEN 'yellow'
                  ELSE 'green' END AS status
      FROM vaccine_vial v JOIN vaccine_product p ON p.product_id = v.product_id;
    -- ผลลัพธ์จาก notebook (ML/Optimization) — seed จาก data/vaccine/outputs/*.csv
    CREATE TABLE IF NOT EXISTS analytics_forecast (
      hospital_id TEXT, product_id TEXT, sma7_rmse DOUBLE PRECISION,
      best_alpha DOUBLE PRECISION, es_rmse DOUBLE PRECISION, winner TEXT);
    CREATE TABLE IF NOT EXISTS analytics_model_comparison (
      model TEXT, mae DOUBLE PRECISION, rmse DOUBLE PRECISION, r2 DOUBLE PRECISION);
    CREATE TABLE IF NOT EXISTS analytics_transshipment (
      from_hospital TEXT, to_hospital TEXT, doses DOUBLE PRECISION, product_id TEXT);
    CREATE TABLE IF NOT EXISTS analytics_wastage (
      scenario TEXT, expiry_waste DOUBLE PRECISION,
      openvial_waste DOUBLE PRECISION, total_waste DOUBLE PRECISION);
    -- คำแนะนำการสั่งซื้อ (reorder) — recompute จากข้อมูลสดทุกครั้งที่อัปเดต/ยืม
    CREATE TABLE IF NOT EXISTS order_recommendations (
      id SERIAL PRIMARY KEY, hospital_id TEXT, product_id TEXT,
      on_hand DOUBLE PRECISION, avg_daily_demand DOUBLE PRECISION,
      lead_time_days INTEGER, reorder_point DOUBLE PRECISION,
      recommended_vials INTEGER, recommended_doses INTEGER,
      status TEXT NOT NULL DEFAULT 'suggested',
      created_at TIMESTAMPTZ DEFAULT now(), dispatched_at TIMESTAMPTZ,
      UNIQUE (hospital_id, product_id));
    -- ระยะทางตามถนนจริงระหว่าง รพ. (precompute จาก OSRM) — ใช้แทน haversine
    CREATE TABLE IF NOT EXISTS hospital_distance (
      from_hospital TEXT, to_hospital TEXT, distance_km DOUBLE PRECISION,
      PRIMARY KEY (from_hospital, to_hospital));
  `);
}

// reorder model: คำนวณคำแนะนำการสั่งซื้อใหม่จากข้อมูลสด (คลัง 🟢/🟡 + ดีมานด์คิวนัด + lead time)
//   ROP = avg_daily × lead × (1+safety) · สั่งเมื่อคลังต่ำกว่า ROP ให้ครอบคลุม (lead+coverage) วัน
// เก็บเฉพาะที่ต้องสั่ง · ไม่แตะรายการที่ 'dispatched' แล้ว (ON CONFLICT DO NOTHING)
const COVERAGE_DAYS = 14;
const SAFETY = 0.2;
async function recomputeOrders() {
  await pool.query("DELETE FROM order_recommendations WHERE status='suggested'");
  const r = await pool.query(`
    WITH demand AS (
      SELECT hospital_id, product_id, AVG(slot_count)::float AS avg_daily
      FROM appointment_queue GROUP BY hospital_id, product_id),
    stock AS (
      SELECT hospital_id, product_id,
             COALESCE(SUM(doses_remaining) FILTER
               (WHERE status IN ('green','yellow') AND transportable), 0) AS usable
      FROM vaccine_vial_status GROUP BY hospital_id, product_id),
    calc AS (
      SELECT h.hospital_id, p.product_id, GREATEST(p.doses_per_vial,1) AS dpv,
             COALESCE(h.lead_time_days,2) AS lead,
             COALESCE(d.avg_daily,0) AS avg_daily, COALESCE(s.usable,0) AS on_hand
      FROM hospitals h CROSS JOIN vaccine_product p
      LEFT JOIN demand d ON d.hospital_id=h.hospital_id AND d.product_id=p.product_id
      LEFT JOIN stock  s ON s.hospital_id=h.hospital_id AND s.product_id=p.product_id)
    INSERT INTO order_recommendations
      (hospital_id, product_id, on_hand, avg_daily_demand, lead_time_days,
       reorder_point, recommended_vials, recommended_doses, status)
    SELECT hospital_id, product_id, on_hand, round(avg_daily::numeric,2), lead,
           round((avg_daily*lead*(1+$1::numeric))::numeric,1),
           ceil((avg_daily*($2::numeric+lead) - on_hand)/dpv)::int,
           ceil((avg_daily*($2::numeric+lead) - on_hand)/dpv)::int * dpv,
           'suggested'
    FROM calc
    WHERE avg_daily > 0
      AND on_hand <= avg_daily*lead*(1+$1::numeric)
      AND avg_daily*($2::numeric+lead) - on_hand > 0
    ON CONFLICT (hospital_id, product_id) DO NOTHING`, [SAFETY, COVERAGE_DAYS]);
  console.log(`[reorder] recomputed: ${r.rowCount} suggestions`);
  return r.rowCount;
}

function _median(arr) {
  const a = arr.filter((x) => x > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// แผนโอนย้าย (Transportation Model) — เรียก vaccine-engine /engine/match (LP ตรงสูตร Proposal §3.2.2)
//   screen_at_risk : supply = โดสเสี่ยง 🔴 ขนส่งได้ ของสาขา "บริโภคต่ำกว่าเกณฑ์" (สาขาใช้เร็วเก็บไว้เอง)
//   solve_transport: min Z=ΣΣc·x · demand=D(j) · c=ระยะถนนจริง×rate  (แทนสูตร REWARD เดิมที่ไม่ตรง PDF)
//   เขียนผล analytics_transshipment · ถ้า engine ล่ม → คง CSV เดิม (best-effort, return -1)
async function recomputeTransshipment() {
  try {
    const prod = await pool.query(
      `SELECT product_id, SUM(doses_remaining) AS risk FROM vaccine_vial_status
       WHERE status='red' AND transportable GROUP BY product_id ORDER BY risk DESC LIMIT 1`);
    if (!prod.rows[0]) { console.log("[transship] ไม่มีของเสี่ยงที่ขนส่งได้ — ข้าม"); return 0; }
    const pid = prod.rows[0].product_id;
    const hs = (await pool.query("SELECT hospital_id FROM hospitals ORDER BY hospital_id")).rows
      .map((r) => r.hospital_id);

    const sup = await pool.query(
      `SELECT hospital_id, SUM(doses_remaining) AS s FROM vaccine_vial_status
       WHERE product_id=$1 AND status='red' AND transportable GROUP BY hospital_id`, [pid]);
    const dem = await pool.query(
      `SELECT hospital_id, AVG(slot_count) AS d FROM appointment_queue
       WHERE product_id=$1 GROUP BY hospital_id`, [pid]);
    const supMap = Object.fromEntries(sup.rows.map((r) => [r.hospital_id, Number(r.s)]));
    const demMap = Object.fromEntries(dem.rows.map((r) => [r.hospital_id, Number(r.d)]));

    // screen_at_risk: ระบายเฉพาะสาขาที่บริโภคต่ำกว่า median (ตรง §3.2.2 — สาขาใช้เร็วไม่ต้องโอนออก)
    const thr = _median(hs.map((h) => demMap[h] || 0));
    let supply = hs.map((h) => ((demMap[h] || 0) < thr ? (supMap[h] || 0) : 0));
    if (supply.reduce((a, b) => a + b, 0) === 0) supply = hs.map((h) => supMap[h] || 0); // fallback
    const demand = hs.map((h) => Math.round(demMap[h] || 0));

    // cost matrix c(i,j) = ระยะถนนจริง(กม.) × transport_rate(ปลายทาง)
    const dist = await pool.query("SELECT from_hospital, to_hospital, distance_km FROM hospital_distance");
    const dm = {};
    for (const r of dist.rows) dm[`${r.from_hospital}|${r.to_hospital}`] = Number(r.distance_km);
    const rateRows = await pool.query("SELECT hospital_id, COALESCE(transport_rate,15) AS rate FROM hospitals");
    const rate = Object.fromEntries(rateRows.rows.map((r) => [r.hospital_id, Number(r.rate)]));

    // Time-Window constraint (§3.2.2): ห้ามเส้นทางที่ "ส่งไม่ทันก่อนวัคซีนหมดอายุ"
    //   lead time ปลายทาง (วัน) >= อายุที่เหลือต่ำสุดของของเสี่ยงต้นทาง -> เส้นทางนั้นใช้ไม่ได้ (cost = BIG)
    const rem = await pool.query(
      `SELECT hospital_id, MIN(days_remaining) AS r FROM vaccine_vial_status
       WHERE product_id=$1 AND status='red' AND transportable GROUP BY hospital_id`, [pid]);
    const remMap = Object.fromEntries(rem.rows.map((r) => [r.hospital_id, Number(r.r)]));
    const leadRows = await pool.query("SELECT hospital_id, COALESCE(lead_time_days,2) AS lt FROM hospitals");
    const lead = Object.fromEntries(leadRows.rows.map((r) => [r.hospital_id, Number(r.lt)]));
    const BIG = 1e9;
    const LEAD_COST = 50;   // ค่าสัมประสิทธิ์เวลา (บาท/วัน lead time) — รวม "เวลา" เข้า objective (§4.1)
    const feasible = (a, b) => lead[b] < (remMap[a] ?? Infinity);   // ส่งถึงก่อนหมดอายุ
    // c(i,j) = ระยะถนนจริง×rate + lead_time×coefficient (Cost/Time Minimization)
    const cost = hs.map((a) => hs.map((b) =>
      a === b ? 0 : (feasible(a, b) ? (dm[`${a}|${b}`] ?? 9999) * rate[b] + lead[b] * LEAD_COST : BIG)));
    // ตัด supply ของสาขาที่ไม่มีปลายทางส่งทันเวลาเลย (ช่วยไม่ได้ -> เป็น write-off ไม่ดันเข้า LP)
    supply = hs.map((h, i) =>
      (supply[i] > 0 && hs.some((b, j) => j !== i && feasible(h, b))) ? supply[i] : 0);

    const resp = await fetch(`${ENGINE_URL}/engine/match`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes: hs, supply, demand, cost }),
    });
    const out = await resp.json();
    if (!out.feasible) { console.warn("[transship] engine: infeasible"); return 0; }
    await pool.query("DELETE FROM analytics_transshipment");
    let n = 0;
    for (const m of out.moves) {
      if (m.doses > 0.5) {
        await pool.query(
          `INSERT INTO analytics_transshipment (from_hospital, to_hospital, doses, product_id)
           VALUES ($1,$2,$3,$4)`, [m.from, m.to, m.doses, pid]);
        n++;
      }
    }
    console.log(`[transship] engine plan (${pid}): ${n} เส้นทาง · Z=${out.total_cost}`);
    return n;
  } catch (e) {
    console.error("[transship] engine recompute ข้าม (คง CSV เดิม):", e.message);
    return -1;
  }
}

// แปลงเป็นตัวเลข (คืน null ถ้าว่าง/ไม่ใช่ตัวเลข) สำหรับ seed ผลวิเคราะห์
function num(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// โหลด CSV ลงตารางแบบ replace ทั้งตาราง (ข้ามถ้าไม่มีไฟล์ → ไม่ลบของเดิม)
async function loadCsvTable(table, relPath, cols, rowMap) {
  const rows = readCsv(relPath);
  if (rows.length === 0) { console.warn(`[seed] ${table}: ข้าม(ไม่มีข้อมูล ${relPath})`); return; }
  await pool.query(`DELETE FROM ${table}`);
  const ph = cols.map((_, i) => `$${i + 1}`).join(",");
  for (const r of rows) {
    await pool.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${ph})`, rowMap(r));
  }
  console.log(`[seed] ${table}: ${rows.length}`);
}

// VacFlow: seed ผลลัพธ์จาก notebook (ML/Optimization) จาก data/vaccine/outputs/*.csv
async function seedAnalytics() {
  await loadCsvTable("analytics_forecast",
    "data/vaccine/outputs/forecast_model_selection.csv",
    ["hospital_id", "product_id", "sma7_rmse", "best_alpha", "es_rmse", "winner"],
    (r) => [r.hospital_id, r.product_id, num(r.sma7_rmse), num(r.best_alpha), num(r.es_rmse), r.winner]);
  await loadCsvTable("analytics_model_comparison",
    "data/vaccine/outputs/model_comparison.csv",
    ["model", "mae", "rmse", "r2"],
    (r) => [r.model, num(r.MAE), num(r.RMSE), num(r.R2)]);
  await loadCsvTable("analytics_transshipment",
    "data/vaccine/outputs/transshipment_plan.csv",
    ["from_hospital", "to_hospital", "doses", "product_id"],
    (r) => [r.from_hospital, r.to_hospital, num(r.doses), r.product_id]);
  await loadCsvTable("analytics_wastage",
    "data/vaccine/outputs/wastage_simulation.csv",
    ["scenario", "expiry_waste", "openvial_waste", "total_waste"],
    (r) => [r.scenario, num(r.expiry_waste), num(r.openvial_waste), num(r.total_waste)]);
}

async function seedUsers(hospitals) {
  const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
  // admin: ดูได้ทุก รพ. (hospital_id = NULL, role = admin)
  await pool.query(
    `INSERT INTO users (username, password_hash, hospital_id, role)
     VALUES ('admin', $1, NULL, 'admin') ON CONFLICT (username) DO NOTHING`, [hash]);
  // hospital users: username = hospital_id, role = hospital
  // director users (ผอ.รพ): username = <hospital_id>_director, role = director — เห็นเฉพาะ รพ.ตัวเอง
  for (const h of hospitals) {
    await pool.query(
      `INSERT INTO users (username, password_hash, hospital_id, role)
       VALUES ($1, $2, $3, 'hospital') ON CONFLICT (username) DO NOTHING`,
      [h.hospital_id, hash, h.hospital_id]
    );
    await pool.query(
      `INSERT INTO users (username, password_hash, hospital_id, role)
       VALUES ($1, $2, $3, 'director') ON CONFLICT (username) DO NOTHING`,
      [`${h.hospital_id}_director`, hash, h.hospital_id]
    );
  }
  console.log(`[seed] users: 1 admin + ${hospitals.length} hospital + ${hospitals.length} director (ผอ.รพ) (password = "${DEFAULT_PASSWORD}")`);
}

async function seed() {
  await ensureSchema();

  const hospitals = readCsv("data/hospitals/hospital_master.csv");
  for (const h of hospitals) {
    await pool.query(
      `INSERT INTO hospitals (hospital_id, name, latitude, longitude, lead_time_days)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (hospital_id) DO UPDATE SET
         name=EXCLUDED.name, latitude=EXCLUDED.latitude,
         longitude=EXCLUDED.longitude, lead_time_days=EXCLUDED.lead_time_days`,
      [h.hospital_id, h.name, parseFloat(h.latitude), parseFloat(h.longitude),
       parseInt(h.lead_time_days, 10) || null]
    );
  }
  console.log(`[seed] hospitals: ${hospitals.length}`);
  await seedUsers(hospitals);

  await seedVaccine();
  await loadCsvTable("hospital_distance", "data/hospitals/distance_matrix.csv",
    ["from_hospital", "to_hospital", "distance_km"],
    (r) => [r.from_hospital, r.to_hospital, num(r.distance_km)]);
  await seedAnalytics();
  await pruneHospitals(hospitals.map((h) => h.hospital_id));
  await seedBorrowDemo();
  await recomputeOrders();        // คำแนะนำการสั่งซื้อตั้งต้นจากข้อมูลสด
  await recomputeTransshipment(); // แผนโอนย้ายจาก engine (override CSV ด้วยผล LP ตรงสูตร)
}

// สร้างคำขอยืมตัวอย่างระหว่าง รพ. — ให้เห็นว่า "มี รพ.ที่ยืมกันได้" จริง
// เคารพกติกาเดียวกับ /api/borrow: ผู้ขอมีขวด 🔴 · ผู้ให้มีขวด 🟢 ที่ขนส่งได้ · วัคซีนเดียวกัน
// idempotent: seed เฉพาะตอนตารางว่าง (ไม่ทับคำขอจริงที่ผู้ใช้สร้าง)
async function seedBorrowDemo() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM borrow_requests");
  if (rows[0].c > 0) { console.log(`[seed] borrow_requests: ${rows[0].c} (มีอยู่แล้ว ข้าม demo)`); return; }
  // ชั้นใน: เลือกคู่ (ผู้ขอ 🔴 → ผู้ให้ 🟢) แบบสุ่ม 1 คู่ต่อผู้ขอ
  // ชั้นนอก: คิด quantity/status/created_at ด้วย random() ต่อแถว (ให้หลากหลาย + มี approved)
  const r = await pool.query(`
    INSERT INTO borrow_requests (from_hospital, to_hospital, product_id, quantity, reason, status, created_at)
    SELECT from_hospital, to_hospital, product_id,
           (5 + floor(random() * 20))::int,
           'คิวนัดเพิ่มฉับพลัน — ขอยืมชั่วคราว',
           (ARRAY['pending','pending','approved','rejected'])[1 + floor(random() * 4)],
           now() - (floor(random() * 72) || ' hours')::interval
    FROM (
      SELECT DISTINCT ON (red.hospital_id)
             red.hospital_id AS from_hospital, grn.hospital_id AS to_hospital, red.product_id
      FROM (SELECT DISTINCT hospital_id, product_id FROM vaccine_vial_status WHERE status='red') red
      JOIN (SELECT DISTINCT hospital_id, product_id FROM vaccine_vial_status
            WHERE status='green' AND transportable) grn
        ON grn.product_id = red.product_id AND grn.hospital_id <> red.hospital_id
      ORDER BY red.hospital_id, random()
    ) picks`);
  console.log(`[seed] borrow_requests: สร้างคำขอยืมตัวอย่าง ${r.rowCount} รายการ`);
}

// ลบ รพ./user/ข้อมูลที่อ้าง รพ. ซึ่ง "ไม่อยู่ใน CSV แล้ว" (เช่นเครือข่ายเดิม 100 -> 13)
// ทำให้ DB sync กับ hospital_master.csv เสมอ — reseed ด้วย UPSERT อย่างเดียวไม่ลบของเก่าให้
async function pruneHospitals(ids) {
  if (!ids.length) return;
  // ลบแถวที่อ้าง รพ.นอกชุด CSV ก่อน (กัน FK violation) แล้วค่อยลบ hospital เอง
  await pool.query(`DELETE FROM users WHERE hospital_id IS NOT NULL AND hospital_id <> ALL($1)`, [ids]);
  await pool.query(`DELETE FROM vaccine_vial WHERE hospital_id <> ALL($1)`, [ids]);
  await pool.query(`DELETE FROM appointment_queue WHERE hospital_id <> ALL($1)`, [ids]);
  await pool.query(
    `DELETE FROM borrow_requests
     WHERE (from_hospital IS NOT NULL AND from_hospital <> ALL($1))
        OR (to_hospital   IS NOT NULL AND to_hospital   <> ALL($1))`, [ids]);
  const r = await pool.query(`DELETE FROM hospitals WHERE hospital_id <> ALL($1)`, [ids]);
  if (r.rowCount) console.log(`[seed] pruned ${r.rowCount} stale hospitals (ไม่อยู่ใน CSV)`);
}

// VacFlow: seed โดเมนวัคซีน (vial-level)
//   แหล่งข้อมูล: Mock HOSxP (per-hospital) ถ้าตั้ง HIS_DB_HOST → fetch จาก view (vacflow_ro)
//   ถ้า HIS ไม่พร้อม/ไม่ได้ตั้ง → fallback อ่านจาก CSV (data/vaccine/*.csv)
async function seedVaccine() {
  let his = null;
  if (hisEnabled()) {
    if (await waitForHis()) {
      try {
        his = await fetchVaccineDomain();
        console.log(`[seed] HIS fetch: ${his.products.length} products, ${his.vials.length} vials (per-hospital)`);
      } catch (e) {
        console.warn("[seed] HIS fetch ล้มเหลว → fallback CSV:", e.message);
      }
    } else {
      console.warn("[seed] เชื่อม Mock HOSxP ไม่ได้ → fallback CSV");
    }
  }

  const products = his ? his.products : readCsv("data/vaccine/vaccine_product.csv");
  for (const p of products) {
    await pool.query(
      `INSERT INTO vaccine_product
         (product_id, name, type, doses_per_vial, deep_frozen_life_days, thawed_life_days, open_life_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (product_id) DO UPDATE SET
         name=EXCLUDED.name, type=EXCLUDED.type, doses_per_vial=EXCLUDED.doses_per_vial,
         deep_frozen_life_days=EXCLUDED.deep_frozen_life_days,
         thawed_life_days=EXCLUDED.thawed_life_days, open_life_hours=EXCLUDED.open_life_hours`,
      [p.product_id, p.name, p.type, parseInt(p.doses_per_vial, 10),
       parseInt(p.deep_frozen_life_days, 10), parseInt(p.thawed_life_days, 10),
       parseInt(p.open_life_hours, 10)]
    );
  }
  console.log(`[seed] vaccine_product: ${products.length}`);

  // transport_rate (บาท/กม.) ของสาขาในเครือข่ายสาธิต
  const branches = readCsv("data/vaccine/vaccine_branches.csv");
  for (const b of branches) {
    await pool.query(`UPDATE hospitals SET transport_rate=$2 WHERE hospital_id=$1`,
      [b.hospital_id, parseFloat(b.transport_rate)]);
  }
  console.log(`[seed] transport_rate updated: ${branches.length} branches`);

  const vials = his ? his.vials : readCsv("data/vaccine/vaccine_vial.csv");
  for (const v of vials) {
    await pool.query(
      `INSERT INTO vaccine_vial
         (vial_id, lot_id, product_id, hospital_id, state, state_since,
          doses_remaining, label_expiry, effective_expiry)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (vial_id) DO UPDATE SET
         lot_id=EXCLUDED.lot_id, product_id=EXCLUDED.product_id, hospital_id=EXCLUDED.hospital_id,
         state=EXCLUDED.state, state_since=EXCLUDED.state_since,
         doses_remaining=EXCLUDED.doses_remaining, label_expiry=EXCLUDED.label_expiry,
         effective_expiry=EXCLUDED.effective_expiry`,
      [v.vial_id, v.lot_id, v.product_id, v.hospital_id, v.state, v.state_since,
       parseInt(v.doses_remaining, 10), v.label_expiry, v.effective_expiry || null]
    );
  }
  console.log(`[seed] vaccine_vial: ${vials.length}`);

  const queue = readCsv("data/vaccine/appointment_queue.csv");
  for (const q of queue) {
    await pool.query(
      `INSERT INTO appointment_queue (queue_date, hospital_id, product_id, slot_count)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (queue_date, hospital_id, product_id) DO UPDATE SET
         slot_count=EXCLUDED.slot_count`,
      [q.queue_date, q.hospital_id, q.product_id, parseInt(q.slot_count, 10)]
    );
  }
  console.log(`[seed] appointment_queue: ${queue.length} (counts, no PII)`);
}

module.exports = { seed, recomputeOrders, recomputeTransshipment };

if (require.main === module) {
  const { waitForDb } = require("./db");
  waitForDb().then(seed).then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
