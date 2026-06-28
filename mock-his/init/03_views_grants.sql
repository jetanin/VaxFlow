-- View (ตัด PII) + View-only User — บังคับ Data Minimization ที่ระดับ DB
USE mock_hosxp;

-- 1) usage รายวันต่อรหัสยา → ตัด hn/vn ทิ้ง = ไม่มี PII
CREATE OR REPLACE
  SQL SECURITY DEFINER
  VIEW vw_vacflow_drug_usage AS
SELECT DATE(rxdate)  AS usage_date,
       icode         AS drug_code,
       SUM(qty)      AS qty_dispensed
FROM opitemrece
GROUP BY DATE(rxdate), icode;

-- 2) สถานะคลังระดับ lot (ไม่มี PII)
CREATE OR REPLACE
  SQL SECURITY DEFINER
  VIEW vw_vacflow_inventory AS
SELECT snapshot_date,
       icode        AS drug_code,
       warehouse,
       lot_no,
       SUM(qty)     AS stock_on_hand,
       expire_date
FROM wh_drug_balance
GROUP BY snapshot_date, icode, warehouse, lot_no, expire_date;

-- 3) master ยา/วัคซีน + TMT
CREATE OR REPLACE
  SQL SECURITY DEFINER
  VIEW vw_vacflow_drug_master AS
SELECT icode AS drug_code, name, units, tmt_code, is_vaccine
FROM drugitems;

-- ===== สร้าง view-only user =====
CREATE USER IF NOT EXISTS 'vacflow_ro'@'%'
  IDENTIFIED BY 'CHANGE_ME_strong_pw';

-- 4) โดเมนวัคซีน (vial-level) ต่อ รพ. — VacFlow มา fetch จาก view เหล่านี้ (ไม่มี PII)
CREATE OR REPLACE
  SQL SECURITY DEFINER
  VIEW vw_vacflow_vaccine_product AS
SELECT product_id, name, type, doses_per_vial,
       deep_frozen_life_days, thawed_life_days, open_life_hours
FROM vaccine_product;

CREATE OR REPLACE
  SQL SECURITY DEFINER
  VIEW vw_vacflow_vaccine_vial AS
SELECT vial_id, lot_id, product_id, hospital_id, state, state_since,
       doses_remaining, label_expiry, effective_expiry
FROM vaccine_vial;

-- ให้สิทธิ์ SELECT เฉพาะ "view" เท่านั้น — ไม่ให้แตะตารางดิบเลย
GRANT SELECT ON mock_hosxp.vw_vacflow_drug_usage      TO 'vacflow_ro'@'%';
GRANT SELECT ON mock_hosxp.vw_vacflow_inventory       TO 'vacflow_ro'@'%';
GRANT SELECT ON mock_hosxp.vw_vacflow_drug_master     TO 'vacflow_ro'@'%';
GRANT SELECT ON mock_hosxp.vw_vacflow_vaccine_product TO 'vacflow_ro'@'%';
GRANT SELECT ON mock_hosxp.vw_vacflow_vaccine_vial    TO 'vacflow_ro'@'%';
-- (ไม่มี GRANT ใด ๆ บน patient / opitemrece / wh_drug_balance / ตารางดิบ)

FLUSH PRIVILEGES;

-- ทำไมปลอดภัย: view เป็น SQL SECURITY DEFINER → query ด้วยสิทธิ์ root
-- ส่วน vacflow_ro มีแค่สิทธิ์ "เรียก view" จึงอ่านผลลัพธ์ที่ aggregate แล้วได้
-- แต่ไม่มีทาง SELECT ตารางดิบที่มี hn/cid ได้เลย (ERROR 1142)
