-- MedCast_Secure — Postgres schema
-- ตารางถูกสร้างอัตโนมัติตอน container แรกเริ่ม (docker-entrypoint-initdb.d)
-- การ seed ข้อมูลจาก CSV ทำโดย backend (seed.js)

CREATE TABLE IF NOT EXISTS hospitals (
    hospital_id     TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    lead_time_days  INTEGER
);

CREATE TABLE IF NOT EXISTS forecasts (
    id              SERIAL PRIMARY KEY,
    hospital_id     TEXT REFERENCES hospitals(hospital_id),
    drug            TEXT NOT NULL,
    desc_th         TEXT,
    last_date       DATE,
    pred_next_day   DOUBLE PRECISION,
    avg_30d         DOUBLE PRECISION,
    ratio           DOUBLE PRECISION,
    status          TEXT CHECK (status IN ('green', 'yellow', 'red')),
    confidence      DOUBLE PRECISION,
    UNIQUE (hospital_id, drug)
);

CREATE TABLE IF NOT EXISTS weights (
    feature   TEXT PRIMARY KEY,
    weight    DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_forecasts_hospital ON forecasts(hospital_id);
CREATE INDEX IF NOT EXISTS idx_forecasts_status ON forecasts(status);
