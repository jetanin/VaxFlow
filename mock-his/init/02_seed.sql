-- ข้อมูลจำลอง (สังเคราะห์ ไม่ใช่คนจริง) — ผูกแนวคิดเดียวกับ generate_vaccine_data.py
-- usage ย้อนหลัง 45 วัน · คลังระดับ lot · รพ. 5 แห่ง
USE mock_hosxp;

-- ทะเบียนโรงพยาบาล (5 สาขา ตรงกับ HOSP_001..005 ของ VaxFlow)
INSERT INTO hospital_info (hospital_id, name, latitude, longitude) VALUES
('HOSP_001','รพศ. กรุงเทพมหานคร', 13.7563, 100.5018),
('HOSP_002','รพศ. สมุทรปราการ',   13.5991, 100.5998),
('HOSP_003','รพท. นนทบุรี',        13.8591, 100.5217),
('HOSP_004','รพช. ปทุมธานี',       14.0208, 100.5250),
('HOSP_005','รพ.สต. อยุธยา',       14.3692, 100.5877);

-- ผู้ป่วยจำลอง (PII สังเคราะห์ — เลขบัตร/ชื่อไม่ใช่ของจริง)
INSERT INTO patient (hn, cid, fname, lname, birthday, tel) VALUES
('HN0001','1100000000001','สมชาย','ใจดี','1980-01-15','0810000001'),
('HN0002','1100000000002','สมหญิง','รักษ์ดี','1992-03-22','0810000002'),
('HN0003','1100000000003','ปิติ','มั่นคง','1975-07-09','0810000003'),
('HN0004','1100000000004','มานี','สดใส','1988-11-30','0810000004'),
('HN0005','1100000000005','วีระ','กล้าหาญ','1969-05-12','0810000005'),
('HN0006','1100000000006','กานดา','ศรีสุข','1995-09-02','0810000006'),
('HN0007','1100000000007','ธนา','รุ่งเรือง','1983-02-18','0810000007'),
('HN0008','1100000000008','ชนิดา','พูนผล','1990-12-25','0810000008'),
('HN0009','1100000000009','อนุชา','ทองดี','1978-06-07','0810000009'),
('HN0010','1100000000010','รัตนา','แก้วใส','2000-04-14','0810000010');

-- master ยา/วัคซีน + รหัสกลาง TMT (icode = รหัสภายใน รพ.)
INSERT INTO drugitems (icode, name, units, tmt_code, is_vaccine) VALUES
('VAX001','Comirnaty (mRNA)','dose','TMT-MRNA-01',1),
('VAX002','BCG (Multi-Dose Vial)','dose','TMT-MDV-01',1),
('DRG001','Paracetamol 500mg','tablet','TMT-PARA-500',0);

-- การจ่ายวัคซีน 45 วันย้อนหลัง (สุ่มผู้ป่วย + จำนวน) — มี hn = PII
INSERT INTO opitemrece (vn, hn, icode, qty, rxdate)
WITH RECURSIVE days(n) AS (
  SELECT 0 UNION ALL SELECT n + 1 FROM days WHERE n < 44
),
seq(s) AS (
  SELECT 1 UNION ALL SELECT s + 1 FROM seq WHERE s < 6
)
SELECT
  CONCAT('VN', LPAD(FLOOR(RAND() * 1000000), 6, '0')) AS vn,
  ELT(1 + FLOOR(RAND() * 10),
      'HN0001','HN0002','HN0003','HN0004','HN0005',
      'HN0006','HN0007','HN0008','HN0009','HN0010') AS hn,
  d.icode,
  FLOOR(1 + RAND() * 8) AS qty,
  DATE_SUB(CURDATE(), INTERVAL days.n DAY) + INTERVAL FLOOR(RAND() * 10) HOUR AS rxdate
FROM days
JOIN (SELECT icode FROM drugitems WHERE is_vaccine = 1) d
JOIN seq;

-- คลังระดับ lot — จงใจมีล็อตใกล้หมดอายุ (สถานะแดง/เหลือง) ให้ VaxFlow จับ
INSERT INTO wh_drug_balance (warehouse, icode, lot_no, qty, expire_date, snapshot_date) VALUES
('MAIN','VAX001','LOT-MRNA-A',  60, DATE_ADD(CURDATE(), INTERVAL 10 DAY),  CURDATE()),  -- red  (<=14d)
('MAIN','VAX001','LOT-MRNA-B', 120, DATE_ADD(CURDATE(), INTERVAL 18 DAY),  CURDATE()),  -- yellow (<=21d)
('MAIN','VAX001','LOT-MRNA-C', 200, DATE_ADD(CURDATE(), INTERVAL 200 DAY), CURDATE()),  -- green
('MAIN','VAX002','LOT-MDV-A',   50, DATE_ADD(CURDATE(), INTERVAL 12 DAY),  CURDATE()),  -- red
('MAIN','VAX002','LOT-MDV-B',  150, DATE_ADD(CURDATE(), INTERVAL 90 DAY),  CURDATE());  -- green
