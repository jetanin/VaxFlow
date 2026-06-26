"""สร้างข้อมูลจำลองโดเมน "วัคซีน" สำหรับ VaxFlow (เครือข่ายสาธิต 3–5 สาขา)

ของเดิม (generate_hospital_data.py) สร้างคลังแบบ aggregate รายวัน ซึ่งติดตาม
"ขวดที่เปิดแล้ว" ไม่ได้ → วัคซีนต้องลงลึกถึง **ระดับขวด (vial-level)** เพราะอายุ
หลังเปิดขวดสั้นเพียง 6 ชม. (state machine: DEEP_FROZEN → THAWED → OPENED)

ผลลัพธ์ (data/vaccine/):
  vaccine_product.csv    — master ผลิตภัณฑ์ (mRNA / MULTI_DOSE)
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

# เขตเวลาไทย — ใช้ค่าคงที่ของ "ตอนนี้" เพื่อให้ run ซ้ำแล้วได้ผลคงที่ (deterministic)
TZ = timezone(timedelta(hours=7))
NOW = datetime(2026, 6, 26, 8, 0, tzinfo=TZ)

N_BRANCHES = 5            # เครือข่ายสาธิต 3–5 สาขา (ตาม Proposal §1 ข้อ 7)
SEED = 2026
rng = np.random.default_rng(SEED)

# ── 1) master ผลิตภัณฑ์วัคซีน : ตัวแทน 2 กลุ่มตาม Proposal §3.1 ────────────────
# (product_id, name, type, doses_per_vial, deep_frozen_life_days, thawed_life_days, open_life_hours)
PRODUCTS = [
    ("VAX_MRNA_01", "Comirnaty (mRNA)",       "mRNA",       6, 365, 30, 6),
    ("VAX_MDV_01",  "BCG (Multi-Dose Vial)",  "MULTI_DOSE", 10, 365, 30, 6),
]

# ── 2) สาขาในเครือข่ายสาธิต (อ้างอิง hospital_id เดียวกับ generate_hospital_data.py) ──
BRANCHES = [f"HOSP_{i + 1:03d}" for i in range(N_BRANCHES)]
STATES = ["DEEP_FROZEN", "THAWED", "OPENED"]


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
    products = pd.DataFrame(
        PRODUCTS,
        columns=["product_id", "name", "type", "doses_per_vial",
                 "deep_frozen_life_days", "thawed_life_days", "open_life_hours"],
    )
    products.to_csv(OUT / "vaccine_product.csv", index=False, encoding="utf-8-sig")
    print(f"[saved] vaccine_product.csv: {len(products)} products")

    # ── vial-level inventory ──────────────────────────────────────────────
    vials = []
    vid = 0
    for hid in BRANCHES:
        for _, p in products.iterrows():
            n_vials = int(rng.integers(8, 16))          # 8–15 ขวดต่อผลิตภัณฑ์ต่อสาขา
            for _ in range(n_vials):
                vid += 1
                state = rng.choice(STATES, p=[0.6, 0.3, 0.1])
                label_expiry = (NOW + timedelta(days=int(rng.integers(120, 360)))).date()

                if state == "DEEP_FROZEN":
                    state_since = NOW - timedelta(days=int(rng.integers(1, 90)))
                    doses = int(p["doses_per_vial"])
                elif state == "THAWED":
                    state_since = NOW - timedelta(days=int(rng.integers(0, 28)))
                    doses = int(p["doses_per_vial"])
                else:  # OPENED — เปิดมาแล้ว 0–6 ชม.
                    state_since = NOW - timedelta(hours=float(rng.uniform(0, 6)))
                    doses = int(rng.integers(0, p["doses_per_vial"]))

                eff = effective_expiry(state, label_expiry, state_since,
                                       int(p["thawed_life_days"]), int(p["open_life_hours"]))
                vials.append({
                    "vial_id": f"VIAL_{vid:06d}",
                    "lot_id": f"LOT_{p['product_id'][-2:]}_{state_since:%Y%m}",
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
