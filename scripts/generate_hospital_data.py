"""สร้างข้อมูลจำลอง drug_usage ของ 4 โรงพยาบาล (แยกไฟล์ละ รพ.)

ใช้ profile จากข้อมูลจริง (data/clean/salesdaily.csv) เป็นฐาน แล้วปรับ
- scale ต่างกันตามขนาด รพ.
- ตัวคูณรายกลุ่มยา (แต่ละ รพ. ใช้ยาแต่ละกลุ่มไม่เท่ากัน)
- noise รายวัน
เพื่อให้แต่ละ รพ. มี distribution ต่างกัน (เหมาะกับการสาธิต Federated Learning)

ผลลัพธ์: data/hospitals/HOSP_00X.csv  (คอลัมน์: date, drug_id, quantity_dispensed, hospital_id)
         data/hospitals/hospital_master.csv
"""
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CLEAN = ROOT / "data" / "clean"
OUT = ROOT / "data" / "hospitals"
OUT.mkdir(parents=True, exist_ok=True)

DRUG_COLS = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"]

# จังหวัด (ชื่อ, lat, lon) กระจายทั่วไทย — ใช้สร้าง 30 โรงพยาบาล
PROVINCES = [
    ("กรุงเทพมหานคร", 13.7563, 100.5018), ("เชียงใหม่", 18.7883, 98.9853),
    ("นครราชสีมา", 14.9799, 102.0978), ("หาดใหญ่ สงขลา", 7.0086, 100.4747),
    ("ขอนแก่น", 16.4419, 102.8360), ("เชียงราย", 19.9106, 99.8406),
    ("พิษณุโลก", 16.8211, 100.2659), ("นครสวรรค์", 15.7047, 100.1372),
    ("อุดรธานี", 17.4138, 102.7870), ("อุบลราชธานี", 15.2448, 104.8473),
    ("สุราษฎร์ธานี", 9.1382, 99.3215), ("ภูเก็ต", 7.8804, 98.3923),
    ("ชลบุรี", 13.3611, 100.9847), ("ระยอง", 12.6814, 101.2816),
    ("นครปฐม", 13.8199, 100.0621), ("กาญจนบุรี", 14.0227, 99.5328),
    ("ประจวบคีรีขันธ์", 11.8126, 99.7957), ("ราชบุรี", 13.5283, 99.8134),
    ("ลพบุรี", 14.7995, 100.6534), ("พระนครศรีอยุธยา", 14.3692, 100.5877),
    ("สระบุรี", 14.5289, 100.9105), ("นครศรีธรรมราช", 8.4304, 99.9631),
    ("ตรัง", 7.5563, 99.6114), ("พัทลุง", 7.6167, 100.0742),
    ("ยะลา", 6.5410, 101.2800), ("สกลนคร", 17.1545, 104.1348),
    ("ร้อยเอ็ด", 16.0538, 103.6520), ("บุรีรัมย์", 14.9930, 103.1029),
    ("ลำปาง", 18.2888, 99.4908), ("แม่ฮ่องสอน", 19.2990, 97.9659),
]


def _hospital(i, province, lat, lon):
    """กำหนดประเภท/ขนาด รพ. ตามลำดับ (รพ.ใหญ่อยู่จังหวัดต้น ๆ)."""
    rng = np.random.default_rng(1000 + i)
    if i < 4:
        prefix, scale = "รพศ.", round(rng.uniform(1.1, 1.4), 2)   # โรงพยาบาลศูนย์
    elif i < 12:
        prefix, scale = "รพท.", round(rng.uniform(0.8, 1.1), 2)   # โรงพยาบาลทั่วไป
    elif i < 22:
        prefix, scale = "รพช.", round(rng.uniform(0.5, 0.8), 2)   # โรงพยาบาลชุมชน
    else:
        prefix, scale = "รพ.สต.", round(rng.uniform(0.3, 0.5), 2) # รพ.ส่งเสริมสุขภาพตำบล
    return (f"HOSP_{i + 1:03d}", f"{prefix} {province}", scale, lat, lon, int(rng.integers(1, 5)))


# สร้าง 30 โรงพยาบาล (id, ชื่อ, ขนาด-scale, พิกัด, lead time)
HOSPITALS = [_hospital(i, p, lat, lon) for i, (p, lat, lon) in enumerate(PROVINCES)]

# ช่วงวันที่: เลื่อน profile จริงให้สิ้นสุดใกล้ปัจจุบัน (ให้รู้สึก "live")
END_DATE = pd.Timestamp("2026-06-03")


def main():
    base = pd.read_csv(CLEAN / "salesdaily.csv", parse_dates=["datum"]).sort_values("datum")
    # เลื่อนวันที่ให้แถวสุดท้าย = END_DATE
    offset = END_DATE - base["datum"].max()
    base["date"] = base["datum"] + offset

    master_rows = []
    for hid, name, scale, lat, lon, lead in HOSPITALS:
        rng = np.random.default_rng(abs(hash(hid)) % (2**32))
        # ตัวคูณรายกลุ่มยาเฉพาะ รพ. (0.5–1.5) — แต่ละ รพ. ใช้ยาต่างกัน
        drug_mult = {d: rng.uniform(0.5, 1.5) for d in DRUG_COLS}

        records = []
        for d in DRUG_COLS:
            vals = base[d].to_numpy() * scale * drug_mult[d]
            # multiplicative noise + ปัดเป็นจำนวนเต็มไม่ติดลบ
            noisy = vals * rng.normal(1.0, 0.15, size=len(vals))
            qty = np.clip(np.round(noisy), 0, None).astype(int)
            records.append(pd.DataFrame({
                "date": base["date"].dt.strftime("%Y-%m-%d"),
                "drug_id": d,
                "quantity_dispensed": qty,
                "hospital_id": hid,
            }))
        df = pd.concat(records, ignore_index=True).sort_values(["date", "drug_id"])
        path = OUT / f"{hid}.csv"
        df.to_csv(path, index=False, encoding="utf-8-sig")
        print(f"[saved] {path.name}: {len(df):,} rows "
              f"({df['date'].nunique()} days x {df['drug_id'].nunique()} drugs)")

        master_rows.append({
            "hospital_id": hid, "name": name,
            "latitude": lat, "longitude": lon, "lead_time_days": lead,
        })

    master = pd.DataFrame(master_rows)
    master.to_csv(OUT / "hospital_master.csv", index=False, encoding="utf-8-sig")
    print(f"[saved] hospital_master.csv: {len(master)} hospitals")


if __name__ == "__main__":
    main()
