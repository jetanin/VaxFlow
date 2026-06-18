// Seed Postgres จากไฟล์ CSV ที่ mount ไว้ที่ /seed
// - /seed/data/hospitals/hospital_master.csv
// - /seed/data/predictions/forecast_snapshot.csv
// - /seed/models/global_weights.csv
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { parse } = require("csv-parse/sync");
const { pool } = require("./db");

// docker: /seed (mount ../data, ../models) · local dev: repo root (webapp/backend/../..)
const SEED_DIR = process.env.SEED_DIR || path.resolve(__dirname, "../..");
const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || "medcast123";

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
    CREATE TABLE IF NOT EXISTS forecasts (
      id SERIAL PRIMARY KEY, freq TEXT NOT NULL DEFAULT 'daily', hospital_id TEXT, drug TEXT NOT NULL,
      desc_th TEXT, last_date DATE, pred_next_day DOUBLE PRECISION, stock_on_hand DOUBLE PRECISION,
      reorder_point DOUBLE PRECISION, expiry_date DATE, days_of_supply DOUBLE PRECISION,
      status TEXT, confidence DOUBLE PRECISION, UNIQUE (hospital_id, drug, freq));
    ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS freq TEXT NOT NULL DEFAULT 'daily';
    CREATE TABLE IF NOT EXISTS weights (feature TEXT PRIMARY KEY, weight DOUBLE PRECISION);
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      hospital_id TEXT, role TEXT NOT NULL DEFAULT 'hospital', created_at TIMESTAMPTZ DEFAULT now());
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'hospital';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_key TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_key_expires TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS borrow_requests (
      id SERIAL PRIMARY KEY, from_hospital TEXT, to_hospital TEXT, drug TEXT NOT NULL,
      quantity DOUBLE PRECISION NOT NULL, reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(), actor TEXT,
      action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT, ip_location TEXT);
    ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip_location TEXT;
    CREATE TABLE IF NOT EXISTS borrow_documents (
      borrow_id INTEGER PRIMARY KEY, filename TEXT, mime TEXT, data_b64 TEXT,
      uploaded_by TEXT, uploaded_at TIMESTAMPTZ DEFAULT now());
  `);
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

  const forecasts = readCsv("data/predictions/forecast_snapshot.csv");
  for (const f of forecasts) {
    await pool.query(
      `INSERT INTO forecasts
         (freq, hospital_id, drug, desc_th, last_date, pred_next_day, stock_on_hand,
          reorder_point, expiry_date, days_of_supply, status, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (hospital_id, drug, freq) DO UPDATE SET
         desc_th=EXCLUDED.desc_th, last_date=EXCLUDED.last_date,
         pred_next_day=EXCLUDED.pred_next_day, stock_on_hand=EXCLUDED.stock_on_hand,
         reorder_point=EXCLUDED.reorder_point, expiry_date=EXCLUDED.expiry_date,
         days_of_supply=EXCLUDED.days_of_supply, status=EXCLUDED.status,
         confidence=EXCLUDED.confidence`,
      [f.freq || "daily", f.hospital_id, f.drug, f.desc_th, f.last_date || null,
       parseFloat(f.pred_next_day), parseFloat(f.stock_on_hand),
       parseFloat(f.reorder_point), f.expiry_date || null,
       parseFloat(f.days_of_supply), f.status, parseFloat(f.confidence)]
    );
  }
  console.log(`[seed] forecasts: ${forecasts.length}`);

  const weights = readCsv("models/global_weights.csv");
  for (const w of weights) {
    await pool.query(
      `INSERT INTO weights (feature, weight) VALUES ($1,$2)
       ON CONFLICT (feature) DO UPDATE SET weight=EXCLUDED.weight`,
      [w.feature, parseFloat(w.weight)]
    );
  }
  console.log(`[seed] weights: ${weights.length}`);
}

module.exports = { seed };

if (require.main === module) {
  const { waitForDb } = require("./db");
  waitForDb().then(seed).then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
