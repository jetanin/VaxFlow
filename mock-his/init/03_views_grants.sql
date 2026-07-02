-- View (ตัด PII) + View-only User — บังคับ Data Minimization ที่ระดับ DB
USE mock_hosxp;

-- 1) usage รายวันต่อรหัสยา ต่อ รพ. → ตัด hn/vn ทิ้ง = ไม่มี PII
--    เพิ่ม hospital_id เพื่อรองรับ demand forecasting แยกราย รพ.
CREATE OR REPLACE
  SQL SECURITY DEFINER
  VIEW vw_vacflow_drug_usage AS
SELECT DATE(rxdate)  AS usage_date,
       hospital_id,
       icode         AS drug_code,
       SUM(qty)      AS qty_dispensed
FROM opitemrece
GROUP BY DATE(rxdate), hospital_id, icode;

-- 2) สถานะคลังระดับ lot (ไม่มี PII)
--    เพิ่ม hospital_id ('CENTRAL' = คลังกลาง, อื่น ๆ = สต็อกหน้างานราย รพ.)
--    เพิ่ม reorder_point + days_of_supply (join กับ vaccine_product/usage) เป็น KPI พร้อมใช้
CREATE OR REPLACE
  SQL SECURITY DEFINER
  VIEW vw_vacflow_inventory AS
SELECT b.snapshot_date,
       b.icode        AS drug_code,
       b.warehouse,
       b.lot_no,
       SUM(b.qty)     AS stock_on_hand,
       b.expire_date,
       b.hospital_id,
       p.min_stock_level AS reorder_point,
       ROUND(SUM(b.qty) / NULLIF(u.avg_daily_qty, 0), 1) AS days_of_supply
FROM wh_drug_balance b
LEFT JOIN vaccine_product p ON p.product_id = b.icode
LEFT JOIN (
  SELECT icode, SUM(qty) / COUNT(DISTINCT DATE(rxdate)) AS avg_daily_qty
  FROM opitemrece
  GROUP BY icode
) u ON u.icode = b.icode
GROUP BY b.snapshot_date, b.icode, b.warehouse, b.lot_no, b.expire_date, b.hospital_id,
         p.min_stock_level, u.avg_daily_qty;

-- 3) master ยา/วัคซีน + TMT + ผู้ผลิต (รองรับ recall traceability)
CREATE OR REPLACE
  SQL SECURITY DEFINER
  VIEW vw_vacflow_drug_master AS
SELECT icode AS drug_code, name, units, tmt_code, is_vaccine, manufacturer
FROM drugitems;

-- ===== สร้าง view-only user =====
CREATE USER IF NOT EXISTS 'vacflow_ro'@'%'
  IDENTIFIED BY 'CHANGE_ME_strong_pw';

-- ===== สร้าง admin user =====
CREATE USER IF NOT EXISTS 'vacflow_admin'@'%'
  IDENTIFIED BY 'CHANGE_ME_admin_pw';

GRANT ALL PRIVILEGES ON mock_hosxp.* TO 'vacflow_admin'@'%'
  WITH GRANT OPTION;

-- 4) โดเมนวัคซีน (vial-level) ต่อ รพ. — VacFlow มา fetch จาก view เหล่านี้ (ไม่มี PII)
--    เพิ่ม lead_time_days, min_stock_level (reorder point / safety stock)
CREATE OR REPLACE
  SQL SECURITY DEFINER
  VIEW vw_vacflow_vaccine_product AS
SELECT product_id, name, type, storage_temp, storage_min_c, storage_max_c,
       doses_per_vial, deep_frozen_life_days, thawed_life_days, open_life_hours,
       lead_time_days, min_stock_level
FROM vaccine_product;

-- เพิ่ม discard_reason/discarded_by/discarded_at/temp_excursion_flag → รองรับ wastage analytics
CREATE OR REPLACE
  SQL SECURITY DEFINER
  VIEW vw_vacflow_vaccine_vial AS
SELECT vial_id, lot_id, product_id, hospital_id, state, state_since,
       doses_remaining, label_expiry, effective_expiry,
       discard_reason, discarded_by, discarded_at, temp_excursion_flag
FROM vaccine_vial;

-- 5) cold-chain temperature log (ไม่มี PII — เป็น sensor reading ระดับ vial)
CREATE OR REPLACE
  SQL SECURITY DEFINER
  VIEW vw_vacflow_vial_temp_event AS
SELECT event_id, vial_id, event_timestamp, temperature_c, sensor_id, location, is_excursion
FROM vaccine_vial_temp_event;

-- 6) vial state transition audit trail (ไม่มี PII)
CREATE OR REPLACE
  SQL SECURITY DEFINER
  VIEW vw_vacflow_vial_state_history AS
SELECT history_id, vial_id, from_state, to_state, changed_at, changed_by
FROM vaccine_vial_state_history;

-- ให้สิทธิ์ SELECT เฉพาะ "view" เท่านั้น — ไม่ให้แตะตารางดิบเลย
GRANT SELECT ON mock_hosxp.vw_vacflow_drug_usage         TO 'vacflow_ro'@'%';
GRANT SELECT ON mock_hosxp.vw_vacflow_inventory          TO 'vacflow_ro'@'%';
GRANT SELECT ON mock_hosxp.vw_vacflow_drug_master        TO 'vacflow_ro'@'%';
GRANT SELECT ON mock_hosxp.vw_vacflow_vaccine_product    TO 'vacflow_ro'@'%';
GRANT SELECT ON mock_hosxp.vw_vacflow_vaccine_vial       TO 'vacflow_ro'@'%';
GRANT SELECT ON mock_hosxp.vw_vacflow_vial_temp_event    TO 'vacflow_ro'@'%';
GRANT SELECT ON mock_hosxp.vw_vacflow_vial_state_history TO 'vacflow_ro'@'%';
-- (ไม่มี GRANT ใด ๆ บน patient / opitemrece / wh_drug_balance / ตารางดิบ)

FLUSH PRIVILEGES;

-- ทำไมปลอดภัย: view เป็น SQL SECURITY DEFINER → query ด้วยสิทธิ์ root
-- ส่วน vacflow_ro มีแค่สิทธิ์ "เรียก view" จึงอ่านผลลัพธ์ที่ aggregate แล้วได้
-- แต่ไม่มีทาง SELECT ตารางดิบที่มี hn/cid ได้เลย (ERROR 1142)
