-- Mock HIS เลียนแบบ HOSxP (MySQL) — Tier 2 Read-only DB Connector
-- ตารางอิงโครงสร้างจริงของ HOSxP (drugitems / opitemrece / wh_drug_balance)
-- *มีตาราง patient ที่มี PII โดยตั้งใจ* เพื่อพิสูจน์ว่า VaxFlow แตะไม่ได้
CREATE DATABASE IF NOT EXISTS mock_hosxp
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;   -- utf8mb4 กันภาษาไทยเพี้ยน
USE mock_hosxp;

-- ===== มี PII (มีไว้เพื่อพิสูจน์ว่า VaxFlow แตะไม่ได้) =====
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
  icode      VARCHAR(20) PRIMARY KEY,      -- รหัสภายใน รพ.
  name       VARCHAR(255),
  units      VARCHAR(30),
  tmt_code   VARCHAR(30),                  -- map เข้ารหัสกลาง TMT
  is_vaccine TINYINT DEFAULT 0
);

-- ===== การจ่าย/ใช้ยา (อิง opitemrece) — มี hn = PII =====
CREATE TABLE opitemrece (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  vn        VARCHAR(20),
  hn        VARCHAR(15),                   -- PII
  icode     VARCHAR(20),
  qty       DECIMAL(12,2),
  rxdate    DATETIME,
  KEY (icode), KEY (rxdate)
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
  KEY (icode)
);

-- ข้อมูลพิกัด รพ. (จริง ๆ อาจมาจาก config ไม่ใช่ HOSxP — ใส่ไว้ให้ครบ)
CREATE TABLE hospital_info (
  hospital_id VARCHAR(15) PRIMARY KEY,
  name        VARCHAR(120),
  latitude    DECIMAL(9,6),
  longitude   DECIMAL(9,6)
);
