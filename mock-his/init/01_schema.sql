-- Mock HIS เลียนแบบ HOSxP (MySQL) — Tier 2 Read-only DB Connector
-- ตารางอิงโครงสร้างจริงของ HOSxP (drugitems / opitemrece / wh_drug_balance)
-- *มีตาราง patient ที่มี PII โดยตั้งใจ* เพื่อพิสูจน์ว่า VacFlow แตะไม่ได้
CREATE DATABASE IF NOT EXISTS mock_hosxp
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;   -- utf8mb4 กันภาษาไทยเพี้ยน
USE mock_hosxp;

-- ===== มี PII (มีไว้เพื่อพิสูจน์ว่า VacFlow แตะไม่ได้) =====
CREATE TABLE patient (
  hn       VARCHAR(15) PRIMARY KEY,
  cid      CHAR(13),
  fname    VARCHAR(60),
  lname    VARCHAR(60),
  birthday DATE,
  tel      VARCHAR(20)
);

-- ===== Drug/Vaccine master (อิง drugitems) =====
CREATE TABLE drugitems (
  icode        VARCHAR(20) PRIMARY KEY,    -- รหัสภายใน รพ.
  name         VARCHAR(255),
  units        VARCHAR(30),
  tmt_code     VARCHAR(30),                -- map เข้ารหัสกลาง TMT
  is_vaccine   TINYINT DEFAULT 0,
  manufacturer VARCHAR(120)                -- ผู้ผลิต — รองรับ lot-level recall traceability
);

-- ===== การจ่าย/ใช้ยา (อิง opitemrece) — มี hn = PII =====
CREATE TABLE opitemrece (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  vn          VARCHAR(20),
  hn          VARCHAR(15),                 -- PII
  icode       VARCHAR(20),
  hospital_id VARCHAR(15),                 -- เพิ่ม: แยก demand ราย รพ. ได้ (เดิมมองรวมประเทศ)
  qty         DECIMAL(12,2),
  rxdate      DATETIME,
  KEY (icode), KEY (rxdate), KEY (hospital_id)
);

-- ===== คลัง/สต็อก ระดับ lot (อิง wh_drug_balance) =====
CREATE TABLE wh_drug_balance (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  warehouse     VARCHAR(40),
  icode         VARCHAR(20),
  lot_no        VARCHAR(40),
  qty           DECIMAL(12,2),
  expire_date   DATE,                      -- static expiry บนสลาก
  snapshot_date DATE,
  hospital_id   VARCHAR(15) DEFAULT 'CENTRAL',  -- เพิ่ม: 'CENTRAL' = คลังกลาง (MAIN), อื่น ๆ = สต็อกหน้างานราย รพ.
  KEY (icode), KEY (hospital_id)
);

-- ข้อมูลพิกัด รพ. (จริง ๆ อาจมาจาก config ไม่ใช่ HOSxP — ใส่ไว้ให้ครบ)
CREATE TABLE hospital_info (
  hospital_id VARCHAR(15) PRIMARY KEY,
  name        VARCHAR(120),
  latitude    DECIMAL(9,6),
  longitude   DECIMAL(9,6)
);

-- ===== โดเมนวัคซีน (vial-level) ต่อโรงพยาบาล — แหล่งข้อมูลจริงที่ VacFlow มา fetch =====
-- ไม่มี PII (เป็นข้อมูลคลังระดับขวด) — เก็บ timestamp เป็น VARCHAR เพื่อคง ISO+timezone
CREATE TABLE vaccine_product (
  product_id            VARCHAR(30) PRIMARY KEY,
  name                  VARCHAR(255),
  type                  VARCHAR(20),
  storage_temp          VARCHAR(80),
  storage_min_c         INT,
  storage_max_c         INT,
  doses_per_vial        INT,
  deep_frozen_life_days INT,
  thawed_life_days      INT,
  open_life_hours       INT,
  lead_time_days        INT,               -- เพิ่ม: ระยะเวลาจัดซื้อ/จัดส่ง (วัน)
  min_stock_level       INT                -- เพิ่ม: reorder point / safety stock (โดส)
);

CREATE TABLE vaccine_vial (
  vial_id             VARCHAR(20) PRIMARY KEY,
  lot_id              VARCHAR(40),
  product_id          VARCHAR(30),
  hospital_id         VARCHAR(15),       -- ข้อมูลของแต่ละ รพ.
  state               VARCHAR(20),       -- DEEP_FROZEN | THAWED | OPENED | EXPIRED_DISCARDED | COLD_CHAIN_BREACH
  state_since         VARCHAR(40),       -- ISO+tz
  doses_remaining     INT,
  label_expiry        DATE,
  effective_expiry    VARCHAR(40),       -- ISO+tz
  discard_reason      VARCHAR(40),       -- เพิ่ม: 'EXPIRED' | 'TEMPERATURE_EXCURSION' | ... (NULL = ยังไม่ทิ้ง)
  discarded_by        VARCHAR(40),       -- เพิ่ม: ผู้บันทึกการทิ้ง / SYSTEM_AUTO
  discarded_at         VARCHAR(40),      -- เพิ่ม: ISO+tz เวลาที่ทิ้ง
  temp_excursion_flag TINYINT DEFAULT 0, -- เพิ่ม: เคยหลุด cold chain หรือไม่
  KEY (hospital_id), KEY (product_id), KEY (state)
);

-- ===== Cold-chain temperature log (event-level; ต้องแยกตารางเพราะ 1 vial มีได้หลาย reading) =====
CREATE TABLE vaccine_vial_temp_event (
  event_id        VARCHAR(20) PRIMARY KEY,
  vial_id         VARCHAR(20),
  event_timestamp VARCHAR(40),           -- ISO+tz
  temperature_c   DECIMAL(5,2),
  sensor_id       VARCHAR(40),
  location        VARCHAR(15),           -- hospital_id ของจุดวัด
  is_excursion    TINYINT DEFAULT 0,
  KEY (vial_id), KEY (event_timestamp)
);

-- ===== Vial state transition audit trail (event-level; ต้องแยกตารางเพราะ 1 vial มีได้หลาย transition) =====
CREATE TABLE vaccine_vial_state_history (
  history_id VARCHAR(20) PRIMARY KEY,
  vial_id    VARCHAR(20),
  from_state VARCHAR(20),
  to_state   VARCHAR(20),
  changed_at VARCHAR(40),                -- ISO+tz
  changed_by VARCHAR(40),
  KEY (vial_id), KEY (changed_at)
);
