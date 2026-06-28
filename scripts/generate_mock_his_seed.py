"""สร้าง mock-his/init/02_seed.sql (ข้อมูลจำลอง Mock HOSxP / MySQL)

ดึง "วัคซีนทั้งหมด" จาก data/vaccine/vaccine_product.csv (master เดียวกับ webapp — มาจาก อย.)
มาลงตาราง drugitems ของ Mock HIS แล้วผูก:
  - opitemrece      : การจ่ายวัคซีน 45 วันย้อนหลัง (มี hn = PII)
  - wh_drug_balance : คลังระดับ lot — 1 ล็อตต่อวัคซีน วน red/yellow/green ให้ VaxFlow จับ

รันซ้ำได้ผลคงที่ (deterministic) — ผลลัพธ์ overwrite ไฟล์ 02_seed.sql
"""
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS = ROOT / "data" / "vaccine" / "vaccine_product.csv"
OUT = ROOT / "mock-his" / "init" / "02_seed.sql"


def q(s: str) -> str:
    """escape single-quote สำหรับ SQL string literal."""
    return str(s).replace("'", "''")


def tmt_of(product_id: str) -> str:
    """รหัสกลาง TMT (ใช้ ATC ที่ฝังใน product_id: VAX_J07BX03_044 -> TMT-J07BX03)."""
    parts = str(product_id).split("_")
    return f"TMT-{parts[1]}" if len(parts) >= 2 else f"TMT-{product_id}"


HOSPITALS = [
    ("HOSP_001", "โรงพยาบาลสมเด็จพระเจ้าตากสินมหาราช", 16.8801, 99.1252),
    ("HOSP_002", "โรงพยาบาลห้วยแถลง", 15.0306, 102.5580),
    ("HOSP_003", "โรงพยาบาลอุดรธานี", 17.4096, 102.7902),
    ("HOSP_004", "โรงพยาบาลสมเด็จพระยุพราชบ้านดุง", 17.6884, 103.2598),
    ("HOSP_005", "โรงพยาบาลหนองหาน", 17.3753, 103.0957),
    ("HOSP_006", "โรงพยาบาลบ้านฉาง", 12.7250, 101.0714),
    ("HOSP_007", "โรงพยาบาลศิริราช", 13.7595, 100.4858),
    ("HOSP_008", "โรงพยาบาลราชวิถี", 13.7657, 100.5316),
    ("HOSP_009", "โรงพยาบาลจุฬาลงกรณ์ สภากาชาดไทย", 13.7300, 100.5366),
    ("HOSP_010", "โรงพยาบาลธรรมศาสตร์เฉลิมพระเกียรติ", 14.0745, 100.6055),
    ("HOSP_011", "โรงพยาบาลสมุทรปราการ", 13.5953, 100.5967),
    ("HOSP_012", "โรงพยาบาลศรีธัญญา", 13.8480, 100.5103),
    ("HOSP_013", "โรงพยาบาลชลบุรี", 13.3622, 100.9847),
]

PATIENTS = [
    ("HN0001", "1100000000001", "สมชาย", "ใจดี", "1980-01-15", "0810000001"),
    ("HN0002", "1100000000002", "สมหญิง", "รักษ์ดี", "1992-03-22", "0810000002"),
    ("HN0003", "1100000000003", "ปิติ", "มั่นคง", "1975-07-09", "0810000003"),
    ("HN0004", "1100000000004", "มานี", "สดใส", "1988-11-30", "0810000004"),
    ("HN0005", "1100000000005", "วีระ", "กล้าหาญ", "1969-05-12", "0810000005"),
    ("HN0006", "1100000000006", "กานดา", "ศรีสุข", "1995-09-02", "0810000006"),
    ("HN0007", "1100000000007", "ธนา", "รุ่งเรือง", "1983-02-18", "0810000007"),
    ("HN0008", "1100000000008", "ชนิดา", "พูนผล", "1990-12-25", "0810000008"),
    ("HN0009", "1100000000009", "อนุชา", "ทองดี", "1978-06-07", "0810000009"),
    ("HN0010", "1100000000010", "รัตนา", "แก้วใส", "2000-04-14", "0810000010"),
]

# วนสถานะคลังให้มีทั้งแดง/เหลือง/เขียว (วันหมดอายุนับจากวันรัน)
EXPIRE_CYCLE = [
    (10, "red"),      # <=14d
    (18, "yellow"),   # <=21d
    (90, "green"),
    (200, "green"),
]


def main():
    df = pd.read_csv(PRODUCTS, encoding="utf-8-sig").drop_duplicates("product_id")
    products = df.to_dict("records")

    lines = []
    lines.append("-- ⚠️ ไฟล์นี้ถูกสร้างโดย scripts/generate_mock_his_seed.py — อย่าแก้ด้วยมือ")
    lines.append("-- ข้อมูลจำลอง (สังเคราะห์ ไม่ใช่คนจริง) — วัคซีนทั้งหมดจาก อย. (vaccine_product.csv)")
    lines.append("-- usage ย้อนหลัง 45 วัน · คลังระดับ lot · รพ. 13 แห่ง")
    lines.append("USE mock_hosxp;")
    lines.append("")

    # ── hospital_info (13 แห่ง ตรงกับ HOSP_001..013 ของ VaxFlow + user login) ──
    lines.append("INSERT INTO hospital_info (hospital_id, name, latitude, longitude) VALUES")
    rows = [f"('{hid}','{q(name)}',{lat},{lon})" for hid, name, lat, lon in HOSPITALS]
    lines.append(",\n".join(rows) + ";")
    lines.append("")

    # ── patient (PII สังเคราะห์ — มีไว้พิสูจน์ว่า VaxFlow แตะไม่ได้) ──
    lines.append("-- ผู้ป่วยจำลอง (PII สังเคราะห์ — เลขบัตร/ชื่อไม่ใช่ของจริง)")
    lines.append("INSERT INTO patient (hn, cid, fname, lname, birthday, tel) VALUES")
    rows = [f"('{hn}','{cid}','{q(f)}','{q(l)}','{bd}','{tel}')"
            for hn, cid, f, l, bd, tel in PATIENTS]
    lines.append(",\n".join(rows) + ";")
    lines.append("")

    # ── drugitems : วัคซีนทั้งหมด + ยา non-vaccine 1 ตัว ──
    lines.append(f"-- master ยา/วัคซีน + รหัสกลาง TMT — วัคซีนทั้งหมด {len(products)} รายการจาก อย.")
    lines.append("INSERT INTO drugitems (icode, name, units, tmt_code, is_vaccine) VALUES")
    rows = [f"('{q(p['product_id'])}','{q(p['name'])}','dose','{tmt_of(p['product_id'])}',1)"
            for p in products]
    rows.append("('DRG001','Paracetamol 500mg','tablet','TMT-PARA-500',0)")
    lines.append(",\n".join(rows) + ";")
    lines.append("")

    # ── opitemrece : การจ่ายวัคซีน 45 วันย้อนหลัง (มี hn = PII) ──
    lines.append("-- การจ่ายวัคซีน 45 วันย้อนหลัง (สุ่มผู้ป่วย + จำนวน) — มี hn = PII")
    lines.append("INSERT INTO opitemrece (vn, hn, icode, qty, rxdate)")
    lines.append("WITH RECURSIVE days(n) AS (")
    lines.append("  SELECT 0 UNION ALL SELECT n + 1 FROM days WHERE n < 44)")
    lines.append("SELECT")
    lines.append("  CONCAT('VN', LPAD(FLOOR(RAND() * 1000000), 6, '0')) AS vn,")
    lines.append("  ELT(1 + FLOOR(RAND() * 10),")
    lines.append("      'HN0001','HN0002','HN0003','HN0004','HN0005',")
    lines.append("      'HN0006','HN0007','HN0008','HN0009','HN0010') AS hn,")
    lines.append("  d.icode,")
    lines.append("  FLOOR(1 + RAND() * 8) AS qty,")
    lines.append("  DATE_SUB(CURDATE(), INTERVAL days.n DAY) + INTERVAL FLOOR(RAND() * 10) HOUR AS rxdate")
    lines.append("FROM days")
    lines.append("JOIN (SELECT icode FROM drugitems WHERE is_vaccine = 1) d;")
    lines.append("")

    # ── wh_drug_balance : คลังระดับ lot — 1 ล็อตต่อวัคซีน วน red/yellow/green ──
    lines.append("-- คลังระดับ lot — 1 ล็อตต่อวัคซีน จงใจวน แดง/เหลือง/เขียว ให้ VaxFlow จับ")
    lines.append("INSERT INTO wh_drug_balance (warehouse, icode, lot_no, qty, expire_date, snapshot_date) VALUES")
    rows = []
    for i, p in enumerate(products):
        days_ahead, _tag = EXPIRE_CYCLE[i % len(EXPIRE_CYCLE)]
        qty = 40 + (i * 17) % 220                       # 40..259 แบบ deterministic
        lot = f"LOT-{tmt_of(p['product_id'])[4:]}-{i + 1:03d}"
        rows.append(f"('MAIN','{q(p['product_id'])}','{lot}',{qty}, "
                    f"DATE_ADD(CURDATE(), INTERVAL {days_ahead} DAY), CURDATE())")
    lines.append(",\n".join(rows) + ";")
    lines.append("")

    # ── โดเมนวัคซีน (vial-level) ต่อ รพ. — แหล่งข้อมูลจริงที่ VaxFlow มา fetch ──
    def emit_chunked(table, cols, value_rows, chunk=500):
        lines.append(f"-- {table}: {len(value_rows)} แถว")
        for i in range(0, len(value_rows), chunk):
            part = value_rows[i:i + chunk]
            lines.append(f"INSERT INTO {table} ({', '.join(cols)}) VALUES")
            lines.append(",\n".join(part) + ";")
        lines.append("")

    prod = pd.read_csv(ROOT / "data" / "vaccine" / "vaccine_product.csv",
                       encoding="utf-8-sig").to_dict("records")
    emit_chunked(
        "vaccine_product",
        ["product_id", "name", "type", "doses_per_vial",
         "deep_frozen_life_days", "thawed_life_days", "open_life_hours"],
        [f"('{q(p['product_id'])}','{q(p['name'])}','{q(p['type'])}',"
         f"{int(p['doses_per_vial'])},{int(p['deep_frozen_life_days'])},"
         f"{int(p['thawed_life_days'])},{int(p['open_life_hours'])})" for p in prod])

    vial = pd.read_csv(ROOT / "data" / "vaccine" / "vaccine_vial.csv",
                       encoding="utf-8-sig").to_dict("records")
    emit_chunked(
        "vaccine_vial",
        ["vial_id", "lot_id", "product_id", "hospital_id", "state", "state_since",
         "doses_remaining", "label_expiry", "effective_expiry"],
        [f"('{q(v['vial_id'])}','{q(v['lot_id'])}','{q(v['product_id'])}',"
         f"'{q(v['hospital_id'])}','{q(v['state'])}','{q(v['state_since'])}',"
         f"{int(v['doses_remaining'])},'{v['label_expiry']}','{q(v['effective_expiry'])}')"
         for v in vial])

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"[saved] {OUT.relative_to(ROOT)}: {len(df)} vaccines, "
          f"{len(prod)} products, {len(vial)} vials (per-hospital)")


if __name__ == "__main__":
    main()
