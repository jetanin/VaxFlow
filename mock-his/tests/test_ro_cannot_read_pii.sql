-- Regression guard — รันในฐานะ vacflow_ro:
--   mysql -h 127.0.0.1 -u vacflow_ro -p mock_hosxp < test_ro_cannot_read_pii.sql
USE mock_hosxp;

-- ✅ ต้องได้ผล (view ที่ตัด PII แล้ว)
SELECT * FROM vw_vacflow_drug_usage  LIMIT 3;
SELECT * FROM vw_vacflow_inventory   LIMIT 3;
SELECT * FROM vw_vacflow_drug_master LIMIT 3;

-- ❌ ต้องโดนปฏิเสธทั้งหมด (ERROR 1142 access denied) — ถ้าผ่านได้แปลว่าสิทธิ์รั่ว
SELECT * FROM patient         LIMIT 3;   -- access denied
SELECT * FROM opitemrece      LIMIT 3;   -- access denied
SELECT * FROM wh_drug_balance LIMIT 3;   -- access denied
