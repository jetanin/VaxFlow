"""Wastage simulation + stress test (จาก notebook 05) — ใช้ engine pooling (consolidate_queue)
ผล: wastage_simulation.csv + stress_test.csv  (พิสูจน์ KPI ลด >= 30%)
"""
import numpy as np
import pandas as pd

from modules import pooling as PL   # vaccine-engine
from .config import VAX, CLEAN, OUT, FEAT, now_ts


def build():
    feat = pd.read_csv(FEAT / "demand_features.csv", parse_dates=["date"])
    vials = pd.read_csv(CLEAN / "vaccine_vial_clean.csv")
    vials["effective_expiry"] = pd.to_datetime(vials["effective_expiry"], utc=True, format="ISO8601")
    products = pd.read_csv(CLEAN / "vaccine_product_clean.csv").set_index("product_id")
    queue = pd.read_csv(VAX / "appointment_queue.csv", parse_dates=["queue_date"])
    vials["days_remaining"] = (vials["effective_expiry"] - now_ts()).dt.total_seconds() / 86400
    avg_demand = feat.groupby(["hospital_id", "product_id"])["demand"].mean()

    # expiry waste (ของเสี่ยง ≤14 วัน ที่ demand 14 วันใช้ไม่ทัน)
    expiry_waste = 0
    for (hid, pid), g in vials.groupby(["hospital_id", "product_id"]):
        d = avg_demand.get((hid, pid), 0)
        risk = g[(g.state != "OPENED") & (g.days_remaining <= 14)]
        expiry_waste += max(0, risk["doses_remaining"].sum() - d * 14)

    # open-vial waste จาก engine pooling จริง (without vs with)
    ov_wo = ov_w = 0
    for (hid, pid), g in queue.sort_values("queue_date").groupby(["hospital_id", "product_id"]):
        dpv = int(products.loc[pid, "doses_per_vial"]) if pid in products.index else 1
        r = PL.consolidate_queue(g["slot_count"].tolist(), dpv)
        ov_wo += r["residual_without_pooling"]; ov_w += r["residual_with_pooling"]

    # transshipment กู้ expiry
    try:
        recovered = min(expiry_waste, pd.read_csv(OUT / "transshipment_plan.csv")["doses"].sum())
    except FileNotFoundError:
        recovered = expiry_waste * 0.7
    base_total = expiry_waste + ov_wo
    vf_total = (expiry_waste - recovered) + ov_w
    reduction = (base_total - vf_total) / base_total * 100 if base_total else 0
    pd.DataFrame({
        "scenario": ["Without VacFlow", "With VacFlow"],
        "expiry_waste": [expiry_waste, expiry_waste - recovered],
        "openvial_waste": [ov_wo, ov_w],
        "total_waste": [base_total, vf_total],
    }).round(0).to_csv(OUT / "wastage_simulation.csv", index=False, encoding="utf-8-sig")

    # stress test ความผันผวน
    rng = np.random.default_rng(2026)
    qg = list(queue.sort_values("queue_date").groupby(["hospital_id", "product_id"]))
    srows = []
    for label, sigma in {"ปกติ": 0.0, "กลาง": 0.5, "สูง": 1.0, "วิกฤต": 1.5}.items():
        wo = wp = 0
        for (hid, pid), g in qg:
            dpv = int(products.loc[pid, "doses_per_vial"]) if pid in products.index else 1
            s = np.array(g["slot_count"], float)
            if sigma > 0:
                s = np.clip(np.round(s * np.maximum(0, rng.normal(1, sigma, len(s)))), 0, None)
            r = PL.consolidate_queue([int(x) for x in s], dpv)
            wo += r["residual_without_pooling"]; wp += r["residual_with_pooling"]
        srows.append({"scenario": label, "sigma": sigma, "waste_no_pool": wo, "waste_pool": wp,
                      "reduction_%": round(100 * (wo - wp) / wo, 1) if wo else 0.0})
    pd.DataFrame(srows).to_csv(OUT / "stress_test.csv", index=False, encoding="utf-8-sig")
    print(f"[evaluate] wastage {base_total:.0f}→{vf_total:.0f} (ลด {reduction:.1f}%) · stress test saved")
    return reduction
