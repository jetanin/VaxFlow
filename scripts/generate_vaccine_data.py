"""สร้างข้อมูลจำลองโดเมน "วัคซีน" สำหรับ VaxFlow (เครือข่ายสาธิต 13 สาขา)

product master โหลดจาก **data/fda/vaccine_merged_with_storage.csv** (วัคซีนจริงจาก อย.
พร้อมคุณลักษณะ cold-chain) แล้วสร้างคลัง **ระดับขวด (vial-level)** ตาม state machine
DEEP_FROZEN → THAWED → OPENED (mRNA เท่านั้นที่ต้องแช่แข็งจัด)

ผลลัพธ์ (data/vaccine/):
  vaccine_product.csv    — master ผลิตภัณฑ์ (จาก อย. + cold-chain)
  vaccine_vial.csv       — คลังระดับขวด (state, state_since, doses_remaining, expiry)
  appointment_queue.csv  — คิวนัดแบบ "นับจำนวน" (ไม่มี PII) สำหรับ Multi-dose Pooling
  vaccine_branches.csv    — สาขาในเครือข่ายสาธิต + transport_rate (บาท/กม.)

ตาราง/ฟิลด์ทั้งหมดตรงกับ webapp/db/init.sql และ docs/hospital_data_schema.md
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "vaccine"
OUT.mkdir(parents=True, exist_ok=True)
MASTER = ROOT / "data" / "fda" / "vaccine_merged_with_storage.csv"

# เขตเวลาไทย — ใช้ค่าคงที่ของ "ตอนนี้" เพื่อให้ run ซ้ำแล้วได้ผลคงที่ (deterministic)
TZ = timezone(timedelta(hours=7))
NOW = datetime(2026, 6, 26, 8, 0, tzinfo=TZ)

N_BRANCHES = 13           # เครือข่ายสาธิต 13 สาขา (รพ.ตัวอย่างจริง — ตรงกับ hospital_master.csv)
SEED = 2026
rng = np.random.default_rng(SEED)

# fallback ถ้ายังไม่ได้รัน notebook 00 (ไม่มีไฟล์ master)
FALLBACK = [
    ("VAX_MRNA_01", "Comirnaty (mRNA)",      "mRNA",       6, 365, 30, 6),
    ("VAX_MDV_01",  "BCG (Multi-Dose Vial)", "MULTI_DOSE", 10, 0, 730, 6),
]

# ── 2) สาขาในเครือข่ายสาธิต (อ้างอิง hospital_id เดียวกับ generate_hospital_data.py) ──
BRANCHES = [f"HOSP_{i + 1:03d}" for i in range(N_BRANCHES)]

PROD_COLS = ["product_id", "name", "type", "doses_per_vial",
             "deep_frozen_life_days", "thawed_life_days", "open_life_hours"]


def load_products() -> pd.DataFrame:
    """product master จากไฟล์ อย. (vaccine_merged_with_storage.csv) — ถ้าไม่มีใช้ fallback."""
    if not MASTER.exists():
        print(f"[products] ไม่พบ {MASTER.name} → ใช้ fallback {len(FALLBACK)} ผลิตภัณฑ์ "
              f"(รัน notebook/00_load_data.ipynb เพื่อสร้าง master จริง)")
        return pd.DataFrame(FALLBACK, columns=PROD_COLS)
    m = pd.read_csv(MASTER, encoding="utf-8-sig")
    name = (m["trade_name_en"].fillna("").replace("", np.nan)
            .fillna(m.get("trade_name_th")).fillna(m["product_id"]).astype(str)
            .str.replace(r"\s+", " ", regex=True).str.strip().str.slice(0, 120))
    df = pd.DataFrame({
        "product_id": m["product_id"], "name": name, "type": m["vax_type"],
        "doses_per_vial": m["doses_per_vial"].astype(int),
        "deep_frozen_life_days": m["deep_frozen_life_days"].astype(int),
        "thawed_life_days": m["thawed_life_days"].astype(int),
        "open_life_hours": m["open_life_hours"].astype(int),
    }).drop_duplicates("product_id").reset_index(drop=True)
    print(f"[products] โหลด {len(df)} ผลิตภัณฑ์จาก {MASTER.name}")
    return df


def effective_expiry(state, label_expiry, state_since, thawed_days, open_hours):
    """อายุขัยจริง — สูตรเดียวกับ Dynamic Expire Calculator (vaccine-engine)."""
    if state == "DEEP_FROZEN":
        return datetime.combine(label_expiry, datetime.min.time(), tzinfo=TZ)
    if state == "THAWED":
        return min(
            datetime.combine(label_expiry, datetime.min.time(), tzinfo=TZ),
            state_since + timedelta(days=thawed_days),
        )
    return state_since + timedelta(hours=open_hours)  # OPENED


def main():
    products = load_products()
    products.to_csv(OUT / "vaccine_product.csv", index=False, encoding="utf-8-sig")
    print(f"[saved] vaccine_product.csv: {len(products)} products")

    # ── vial-level inventory ──────────────────────────────────────────────
    vials = []
    vid = 0
    for hid in BRANCHES:
        for _, p in products.iterrows():
            dpv = max(1, int(p["doses_per_vial"]))
            n_vials = int(rng.integers(1, 4))           # 1–3 ขวดต่อผลิตภัณฑ์ต่อสาขา
            # mRNA เท่านั้นที่มีสถานะแช่แข็งจัด; ตัวอื่นเก็บ 2–8°C (THAWED) ตั้งแต่ต้น
            if p["type"] == "mRNA":
                states, probs = ["DEEP_FROZEN", "THAWED", "OPENED"], [0.55, 0.30, 0.15]
            else:
                states, probs = ["THAWED", "OPENED"], [0.80, 0.20]
            for _ in range(n_vials):
                vid += 1
                state = rng.choice(states, p=probs)
                label_expiry = (NOW + timedelta(days=int(rng.integers(120, 360)))).date()

                if state == "DEEP_FROZEN":
                    state_since = NOW - timedelta(days=int(rng.integers(1, 90)))
                    doses = dpv
                elif state == "THAWED":
                    state_since = NOW - timedelta(days=int(rng.integers(0, 28)))
                    doses = dpv
                else:  # OPENED — เปิดมาแล้วไม่นาน
                    state_since = NOW - timedelta(hours=float(rng.uniform(0, 6)))
                    doses = int(rng.integers(0, dpv))

                eff = effective_expiry(state, label_expiry, state_since,
                                       int(p["thawed_life_days"]), int(p["open_life_hours"]))
                vials.append({
                    "vial_id": f"VIAL_{vid:06d}",
                    "lot_id": f"LOT_{str(p['product_id'])[-3:]}_{state_since:%Y%m}",
                    "product_id": p["product_id"],
                    "hospital_id": hid,
                    "state": state,
                    "state_since": state_since.isoformat(),
                    "doses_remaining": doses,
                    "label_expiry": label_expiry.isoformat(),
                    "effective_expiry": eff.isoformat(),
                })
    vials_df = pd.DataFrame(vials)
    vials_df.to_csv(OUT / "vaccine_vial.csv", index=False, encoding="utf-8-sig")
    print(f"[saved] vaccine_vial.csv: {len(vials_df):,} vials "
          f"({N_BRANCHES} branches x {len(products)} products)")

    # ── appointment queue (counts only — ไม่มี PII) ───────────────────────
    queue = []
    for hid in BRANCHES:
        for _, p in products.iterrows():
            for d in range(14):                          # 14 วันข้างหน้า
                queue.append({
                    "queue_date": (NOW + timedelta(days=d)).date().isoformat(),
                    "hospital_id": hid,
                    "product_id": p["product_id"],
                    "slot_count": int(rng.integers(0, 12)),
                })
    queue_df = pd.DataFrame(queue)
    queue_df.to_csv(OUT / "appointment_queue.csv", index=False, encoding="utf-8-sig")
    print(f"[saved] appointment_queue.csv: {len(queue_df):,} rows (counts, no PII)")

    # ── สาขา + transport_rate (บาท/กม.) สำหรับ Transportation Model ────────
    branches_df = pd.DataFrame({
        "hospital_id": BRANCHES,
        "transport_rate": np.round(rng.uniform(8, 25, size=N_BRANCHES), 2),
    })
    branches_df.to_csv(OUT / "vaccine_branches.csv", index=False, encoding="utf-8-sig")
    print(f"[saved] vaccine_branches.csv: {len(branches_df)} branches + transport_rate")


if __name__ == "__main__":
    main()
