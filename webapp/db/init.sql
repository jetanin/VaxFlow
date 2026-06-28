-- VacFlow — Postgres schema
-- ตารางถูกสร้างอัตโนมัติตอน container แรกเริ่ม (docker-entrypoint-initdb.d)
-- การ seed ข้อมูลจาก CSV ทำโดย backend (seed.js)

CREATE TABLE IF NOT EXISTS hospitals (
    hospital_id     TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    lead_time_days  INTEGER
);

-- บัญชีผู้ใช้ (1 บัญชีต่อโรงพยาบาล)
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    hospital_id   TEXT REFERENCES hospitals(hospital_id),  -- NULL = admin (ดูได้ทุก รพ.)
    role          TEXT NOT NULL DEFAULT 'hospital'         -- 'admin' | 'hospital' | 'director' (ผอ.รพ)
                  CHECK (role IN ('admin', 'hospital', 'director')),
    reset_key         TEXT,          -- คีย์ 4 หลักสำหรับเปลี่ยนรหัส (ออกโดย admin)
    reset_key_expires TIMESTAMPTZ,
    last_seen         TIMESTAMPTZ,    -- heartbeat ล่าสุด (online ถ้าใกล้ปัจจุบัน) · NULL = offline/logout
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- คำขอยืมวัคซีนระหว่างโรงพยาบาล (รพ. สถานะแดง = ใกล้หมดอายุ/ขาดแคลน เป็นผู้ขอ)
CREATE TABLE IF NOT EXISTS borrow_requests (
    id            SERIAL PRIMARY KEY,
    from_hospital TEXT REFERENCES hospitals(hospital_id),  -- ผู้ขอยืม
    to_hospital   TEXT REFERENCES hospitals(hospital_id),  -- ผู้ให้ยืม
    product_id    TEXT NOT NULL,                           -- วัคซีนที่ขอยืม (vaccine_product)
    quantity      DOUBLE PRECISION NOT NULL,               -- จำนวนโดส
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

-- ════════════════════════════════════════════════════════════════════════
-- VacFlow — โดเมนวัคซีน (สารชีววัตถุ) : เพิ่มเหนือโครง VacFlow เดิม
-- ของเดิมเก็บคลังแบบ aggregate รายวัน (ตาราง forecasts) ซึ่งติดตาม "ขวดที่เปิดแล้ว"
-- ไม่ได้ → วัคซีนต้องลงลึกถึงระดับขวด (vial) เพราะอายุหลังเปิดขวดสั้นเพียง 6 ชม.
-- ════════════════════════════════════════════════════════════════════════

-- ต้นทุนขนส่งต่อ กม. (บาท/กม.) สำหรับ Transportation Model ใน Predictive Matching
-- (lat/lon มีอยู่แล้วในตาราง hospitals) — เพิ่มแบบ idempotent ไม่กระทบ DB เดิม
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS transport_rate DOUBLE PRECISION;

-- master ของผลิตภัณฑ์วัคซีน (คุณลักษณะ cold-chain + อายุขัยแต่ละสถานะ)
CREATE TABLE IF NOT EXISTS vaccine_product (
    product_id            TEXT PRIMARY KEY,        -- เช่น VAX_MRNA_01
    name                  TEXT NOT NULL,
    type                  TEXT NOT NULL            -- mRNA | MULTI_DOSE (ตัวแทน 2 กลุ่มตาม Proposal §3.1)
                          CHECK (type IN ('mRNA', 'MULTI_DOSE')),
    doses_per_vial        INTEGER NOT NULL,        -- ใช้ใน Multi-dose Pooling
    deep_frozen_life_days INTEGER NOT NULL,        -- อายุสถานะแช่แข็งจัด (เช่น 365)
    thawed_life_days      INTEGER NOT NULL,        -- อายุหลังละลาย (เช่น 30)
    open_life_hours       INTEGER NOT NULL         -- อายุหลังเปิดขวด (เช่น 6)
);

-- คลังระดับขวด/ล็อต — หัวใจของ Dynamic Expire Calculator
CREATE TABLE IF NOT EXISTS vaccine_vial (
    vial_id          TEXT PRIMARY KEY,             -- เช่น VIAL_000123
    lot_id           TEXT,
    product_id       TEXT NOT NULL REFERENCES vaccine_product(product_id),
    hospital_id      TEXT REFERENCES hospitals(hospital_id),
    state            TEXT NOT NULL DEFAULT 'DEEP_FROZEN'
                     CHECK (state IN ('DEEP_FROZEN', 'THAWED', 'OPENED')),
    state_since      TIMESTAMPTZ NOT NULL DEFAULT now(),  -- เวลาที่เข้าสู่สถานะปัจจุบัน (thawed_at/opened_at)
    doses_remaining  INTEGER NOT NULL,             -- ป้อน Pooling
    label_expiry     DATE NOT NULL,                -- วันหมดอายุบนสลาก (static)
    effective_expiry TIMESTAMPTZ,                  -- อายุขัยจริงหลังคำนวณ overwrite (Dynamic Expire)
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vial_hospital ON vaccine_vial(hospital_id);
CREATE INDEX IF NOT EXISTS idx_vial_product ON vaccine_vial(product_id);
CREATE INDEX IF NOT EXISTS idx_vial_state ON vaccine_vial(state);

-- คิวนัดแบบรวมจำนวน (สำหรับ Multi-dose Pooling) — เก็บเป็น "จำนวนคิว" เท่านั้น
-- ไม่เก็บ PII (ชื่อ/HN/เบอร์) เพื่อคงจุดขาย PDPA 100% (Proposal §5.2)
CREATE TABLE IF NOT EXISTS appointment_queue (
    id          SERIAL PRIMARY KEY,
    queue_date  DATE NOT NULL,
    hospital_id TEXT REFERENCES hospitals(hospital_id),
    product_id  TEXT REFERENCES vaccine_product(product_id),
    slot_count  INTEGER NOT NULL DEFAULT 0,        -- จำนวนคนที่นัดไว้ในวันนั้นสำหรับวัคซีนนี้
    UNIQUE (queue_date, hospital_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_queue_hospital ON appointment_queue(hospital_id);

-- View: ขวดวัคซีน + สถานะสัญญาณไฟตาม "อายุขัยที่เหลือ" (remaining shelf-life)
--   🔴 < 14 วัน (หรือหมดอายุแล้ว) · 🟡 < 21 วัน · 🟢 ปกติ   (Proposal §6)
-- ขวดที่เปิดแล้ว (OPENED, อายุ 6 ชม.) จึงเป็น 🔴 เสมอ — และห้ามขนส่งข้ามสาขา
CREATE OR REPLACE VIEW vaccine_vial_status AS
SELECT v.vial_id, v.lot_id, v.product_id, v.hospital_id, v.state, v.state_since,
       v.doses_remaining, v.label_expiry, v.effective_expiry,
       p.name AS product_name, p.type AS product_type, p.doses_per_vial,
       EXTRACT(EPOCH FROM (v.effective_expiry - now())) / 86400.0 AS days_remaining,
       (v.state <> 'OPENED')                            AS transportable,
       CASE
         WHEN v.effective_expiry <= now() + interval '14 days' THEN 'red'
         WHEN v.effective_expiry <= now() + interval '21 days' THEN 'yellow'
         ELSE 'green' END                               AS status
FROM vaccine_vial v
JOIN vaccine_product p ON p.product_id = v.product_id;

-- ════════════════════════════════════════════════════════════════════════
-- ผลลัพธ์จาก notebook (ML/Optimization) — seed จาก data/vaccine/outputs/*.csv โดย seed.js
-- เป็นผลวิเคราะห์ "อ่านอย่างเดียว" (snapshot) แยกจากข้อมูลคลังสด
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS analytics_forecast (            -- forecast_model_selection.csv
    hospital_id TEXT, product_id TEXT,
    sma7_rmse DOUBLE PRECISION, best_alpha DOUBLE PRECISION,
    es_rmse DOUBLE PRECISION, winner TEXT
);
CREATE TABLE IF NOT EXISTS analytics_model_comparison (    -- model_comparison.csv
    model TEXT, mae DOUBLE PRECISION, rmse DOUBLE PRECISION, r2 DOUBLE PRECISION
);
CREATE TABLE IF NOT EXISTS analytics_transshipment (       -- transshipment_plan.csv
    from_hospital TEXT, to_hospital TEXT, doses DOUBLE PRECISION, product_id TEXT
);
CREATE TABLE IF NOT EXISTS analytics_wastage (             -- wastage_simulation.csv
    scenario TEXT, expiry_waste DOUBLE PRECISION,
    openvial_waste DOUBLE PRECISION, total_waste DOUBLE PRECISION
);

-- คำแนะนำการสั่งซื้อ (reorder) — คำนวณใหม่จากข้อมูลสดทุกครั้งที่ข้อมูลอัปเดต/มีการยืม
-- dispatched = ส่งเป็น "คำสั่งซื้อ" ไปยังระบบ HOSxP แล้ว (HIS connector อ่านอย่างเดียว
-- จึงสร้างเป็น PO command ให้เจ้าหน้าที่ HOSxP รับไปออกใบสั่งจริง)
CREATE TABLE IF NOT EXISTS order_recommendations (
    id                SERIAL PRIMARY KEY,
    hospital_id       TEXT REFERENCES hospitals(hospital_id),
    product_id        TEXT REFERENCES vaccine_product(product_id),
    on_hand           DOUBLE PRECISION,     -- โดสใช้ได้ (🟢/🟡 ขนส่งได้)
    avg_daily_demand  DOUBLE PRECISION,     -- ดีมานด์เฉลี่ย/วัน (จากคิวนัด)
    lead_time_days    INTEGER,
    reorder_point     DOUBLE PRECISION,     -- ROP = demand×lead×(1+safety)
    recommended_vials INTEGER,
    recommended_doses INTEGER,
    status            TEXT NOT NULL DEFAULT 'suggested'   -- suggested | dispatched
                      CHECK (status IN ('suggested', 'dispatched')),
    created_at        TIMESTAMPTZ DEFAULT now(),
    dispatched_at     TIMESTAMPTZ,
    UNIQUE (hospital_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_order_hospital ON order_recommendations(hospital_id);
