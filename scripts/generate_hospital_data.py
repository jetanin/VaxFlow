"""สร้าง hospital_master.csv (เครือข่ายโรงพยาบาลตัวอย่างสำหรับ VacFlow)

ผลิตเฉพาะทะเบียนโรงพยาบาล (id, ชื่อ, พิกัด, lead time) ที่ใช้เป็นจุดยึดบนแผนที่
และเป็น foreign key ของตารางวัคซีน — ข้อมูลคลัง/ดีมานด์ระดับขวดสร้างแยกที่
scripts/generate_vaccine_data.py

เครือข่ายสาธิตใช้โรงพยาบาลจริง 13 แห่ง (ชื่อ/พิกัดจริง) เพื่อให้ตรงกับระบบ HIS
และ user สำหรับ login (username = hospital_id, ตั้งใน webapp/backend/seed.js)

ผลลัพธ์: data/hospitals/hospital_master.csv
"""
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "hospitals"
OUT.mkdir(parents=True, exist_ok=True)

# โรงพยาบาลตัวอย่าง 13 แห่ง — (id, ชื่อ, จังหวัด, lat, lon, lead_time_days)
# พิกัดอ้างอิงตำแหน่งจริงของโรงพยาบาล (ใช้ปักหมุดบนแผนที่ภาพรวม)
HOSPITALS = [
    ("HOSP_001", "โรงพยาบาลสมเด็จพระเจ้าตากสินมหาราช", "ตาก",            16.8801, 99.1252, 4),
    ("HOSP_002", "โรงพยาบาลห้วยแถลง",                   "นครราชสีมา",      15.0306, 102.5580, 3),
    ("HOSP_003", "โรงพยาบาลอุดรธานี",                   "อุดรธานี",        17.4096, 102.7902, 4),
    ("HOSP_004", "โรงพยาบาลสมเด็จพระยุพราชบ้านดุง",      "อุดรธานี",        17.6884, 103.2598, 2),
    ("HOSP_005", "โรงพยาบาลหนองหาน",                    "อุดรธานี",        17.3753, 103.0957, 2),
    ("HOSP_006", "โรงพยาบาลบ้านฉาง",                    "ระยอง",           12.7250, 101.0714, 1),
    ("HOSP_007", "โรงพยาบาลศิริราช",                    "กรุงเทพมหานคร",   13.7595, 100.4858, 1),
    ("HOSP_008", "โรงพยาบาลราชวิถี",                    "กรุงเทพมหานคร",   13.7657, 100.5316, 1),
    ("HOSP_009", "โรงพยาบาลจุฬาลงกรณ์ สภากาชาดไทย",      "กรุงเทพมหานคร",   13.7300, 100.5366, 1),
    ("HOSP_010", "โรงพยาบาลธรรมศาสตร์เฉลิมพระเกียรติ",   "ปทุมธานี",        14.0745, 100.6055, 2),
    ("HOSP_011", "โรงพยาบาลสมุทรปราการ",                "สมุทรปราการ",     13.5953, 100.5967, 2),
    ("HOSP_012", "โรงพยาบาลศรีธัญญา",                   "นนทบุรี",         13.8480, 100.5103, 2),
    ("HOSP_013", "โรงพยาบาลชลบุรี",                     "ชลบุรี",          13.3622, 100.9847, 3),
]


def main():
    master_rows = [
        {"hospital_id": hid, "name": name,
         "latitude": lat, "longitude": lon, "lead_time_days": lead}
        for hid, name, _province, lat, lon, lead in HOSPITALS
    ]
    master = pd.DataFrame(master_rows)
    master.to_csv(OUT / "hospital_master.csv", index=False, encoding="utf-8-sig")
    print(f"[saved] hospital_master.csv: {len(master)} hospitals")


if __name__ == "__main__":
    main()
