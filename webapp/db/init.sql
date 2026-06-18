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
    freq            TEXT NOT NULL DEFAULT 'daily',   -- 'daily' | 'weekly'
    hospital_id     TEXT REFERENCES hospitals(hospital_id),
    drug            TEXT NOT NULL,
    desc_th         TEXT,
    last_date       DATE,
    pred_next_day   DOUBLE PRECISION,   -- พยากรณ์การใช้ต่อวัน
    stock_on_hand   DOUBLE PRECISION,   -- ยาคงคลังปัจจุบัน
    reorder_point   DOUBLE PRECISION,   -- จุดสั่งซื้อซ้ำ
    expiry_date     DATE,               -- วันหมดอายุ
    days_of_supply  DOUBLE PRECISION,   -- จำนวนวันที่ยาเหลือ = stock / pred
    status          TEXT CHECK (status IN ('green', 'yellow', 'red')),
    confidence      DOUBLE PRECISION,
    UNIQUE (hospital_id, drug, freq)
);

CREATE TABLE IF NOT EXISTS weights (
    feature   TEXT PRIMARY KEY,
    weight    DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_forecasts_hospital ON forecasts(hospital_id);
CREATE INDEX IF NOT EXISTS idx_forecasts_status ON forecasts(status);

-- บัญชีผู้ใช้ (1 บัญชีต่อโรงพยาบาล)
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    hospital_id   TEXT REFERENCES hospitals(hospital_id),  -- NULL = admin (ดูได้ทุก รพ.)
    role          TEXT NOT NULL DEFAULT 'hospital'         -- 'admin' | 'hospital'
                  CHECK (role IN ('admin', 'hospital')),
    reset_key         TEXT,          -- คีย์ 4 หลักสำหรับเปลี่ยนรหัส (ออกโดย admin)
    reset_key_expires TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- คำขอยืมยาระหว่างโรงพยาบาล (รพ. สถานะแดงเป็นผู้ขอ)
CREATE TABLE IF NOT EXISTS borrow_requests (
    id            SERIAL PRIMARY KEY,
    from_hospital TEXT REFERENCES hospitals(hospital_id),  -- ผู้ขอยืม (ขาดยา)
    to_hospital   TEXT REFERENCES hospitals(hospital_id),  -- ผู้ให้ยืม
    drug          TEXT NOT NULL,
    quantity      DOUBLE PRECISION NOT NULL,
    reason        TEXT,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_borrow_from ON borrow_requests(from_hospital);
CREATE INDEX IF NOT EXISTS idx_borrow_to ON borrow_requests(to_hospital);

-- เอกสารที่เซ็นแล้ว (อัปโหลดกลับ) — 1 ไฟล์ต่อคำขอ เก็บแยกตารางไม่ให้ list ช้า
CREATE TABLE IF NOT EXISTS borrow_documents (
    borrow_id    INTEGER PRIMARY KEY REFERENCES borrow_requests(id),
    filename     TEXT,
    mime         TEXT,
    data_b64     TEXT,         -- เนื้อไฟล์ (base64)
    uploaded_by  TEXT,
    uploaded_at  TIMESTAMPTZ DEFAULT now()
);

-- Audit Trail: บันทึกทุกธุรกรรมแบบแก้ย้อนหลังไม่ได้ (timestamp + IP) ตามมาตรฐาน e-Document
CREATE TABLE IF NOT EXISTS audit_log (
    id            SERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor         TEXT,         -- hospital_id ผู้ทำรายการ
    action        TEXT NOT NULL,-- login / create_borrow / approve_borrow / reject_borrow
    entity        TEXT,         -- ประเภท (borrow_request ...)
    entity_id     TEXT,
    detail        TEXT,
    ip            TEXT,
    ip_location   TEXT          -- ตำแหน่งโดยประมาณจาก IP (geo lookup)
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
