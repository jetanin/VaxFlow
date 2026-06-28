// Seed Postgres จากไฟล์ CSV ที่ mount ไว้ที่ /seed (VaxFlow — โดเมนวัคซีน)
// - /seed/data/hospitals/hospital_master.csv
// - /seed/data/vaccine/{vaccine_product,vaccine_vial,appointment_queue,vaccine_branches}.csv
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { parse } = require("csv-parse/sync");
const { pool } = require("./db");

// docker: /seed (mount ../data, ../models) · local dev: repo root (webapp/backend/../..)
const SEED_DIR = process.env.SEED_DIR || path.resolve(__dirname, "../..");
const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || "vaxflow123";

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
    -- VaxFlow: โดเมนวัคซีน (vial-level)
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
  `);
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

// VaxFlow: seed ผลลัพธ์จาก notebook (ML/Optimization) จาก data/vaccine/outputs/*.csv
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
  for (const h of hospitals) {
    await pool.query(
      `INSERT INTO users (username, password_hash, hospital_id, role)
       VALUES ($1, $2, $3, 'hospital') ON CONFLICT (username) DO NOTHING`,
      [h.hospital_id, hash, h.hospital_id]
    );
  }
  console.log(`[seed] users: 1 admin + ${hospitals.length} hospital (password = "${DEFAULT_PASSWORD}")`);
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
  await seedAnalytics();
}

// VaxFlow: seed โดเมนวัคซีน (vial-level) จาก data/vaccine/*.csv
async function seedVaccine() {
  const products = readCsv("data/vaccine/vaccine_product.csv");
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

  const vials = readCsv("data/vaccine/vaccine_vial.csv");
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

module.exports = { seed };

if (require.main === module) {
  const { waitForDb } = require("./db");
  waitForDb().then(seed).then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
