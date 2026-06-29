"""Transportation Model (จาก notebook 04 §3) — ใช้ engine จริง: screen_at_risk + solve_transport
   + time-window + lead-cost · ระยะถนนจริง (OSRM) · ผล: transshipment_plan.csv
"""
import numpy as np
import pandas as pd
from numpy import arccos, clip, cos, radians, sin

from modules import matching_engine as ME   # vaccine-engine (sys.path ตั้งใน config)
from .config import HOSPITALS, VAX, CLEAN, OUT, now_ts

LEAD_COST = 50   # ค่าสัมประสิทธิ์เวลา (บาท/วัน) — §4.1


def build():
    master = pd.read_csv(HOSPITALS / "hospital_master.csv")
    branches = pd.read_csv(VAX / "vaccine_branches.csv")
    vials = pd.read_csv(CLEAN / "vaccine_vial_clean.csv")
    vials["effective_expiry"] = pd.to_datetime(vials["effective_expiry"], utc=True, format="ISO8601")
    fc = pd.read_csv(OUT / "demand_forecast.csv")
    BR = list(branches["hospital_id"])
    loc = master.set_index("hospital_id").loc[BR, ["latitude", "longitude"]]
    rate = branches.set_index("hospital_id")["transport_rate"]
    lead = master.set_index("hospital_id")["lead_time_days"].reindex(BR).fillna(2)

    dmp = VAX.parent / "hospitals" / "distance_matrix.csv"
    DM = ({(r.from_hospital, r.to_hospital): r.distance_km
           for r in pd.read_csv(dmp).itertuples(index=False)} if dmp.exists() else {})

    def hav(a, b):
        la1, lo1, la2, lo2 = map(radians, [loc.loc[a, "latitude"], loc.loc[a, "longitude"],
                                           loc.loc[b, "latitude"], loc.loc[b, "longitude"]])
        return 6371 * arccos(clip(sin(la1) * sin(la2) + cos(la1) * cos(la2) * cos(lo2 - lo1), -1, 1))

    def road_km(a, b):
        return DM.get((a, b), hav(a, b))

    vials["days_remaining"] = (vials["effective_expiry"] - now_ts()).dt.total_seconds() / 86400
    risk_all = vials[(vials.hospital_id.isin(BR)) & (vials.state != "OPENED") & (vials.days_remaining <= 14)]
    rbp = risk_all.groupby("product_id")["doses_remaining"].sum()
    fc_prods = set(fc["product_id"])
    rbp = rbp[rbp.index.isin(fc_prods) & (rbp > 0)]
    if len(rbp):
        pid = rbp.idxmax()
    else:
        pid = fc.groupby("product_id")["forecast_daily"].mean().idxmax()

    # demand ปลายทาง = forecast/วัน ของ pid (ปิดวงจร ML) · usage สำหรับ screen
    demand_j = (fc[fc.product_id == pid].set_index("hospital_id")["forecast_daily"]
                .reindex(BR, fill_value=0).round())
    usage_rate = demand_j.to_dict()
    thr = float(demand_j[demand_j > 0].median()) if (demand_j > 0).any() else 1.0
    rv = (risk_all[risk_all.product_id == pid]
          [["hospital_id", "product_id", "doses_remaining", "days_remaining", "state"]].to_dict("records"))
    screened = ME.screen_at_risk(rv, usage_rate, max_days=14.0, usage_threshold=thr)
    supply = ((pd.DataFrame(screened).groupby("hospital_id")["doses_remaining"].sum()
               if screened else pd.Series(dtype=float)).reindex(BR, fill_value=0))
    if supply.sum() == 0:
        supply = (risk_all[risk_all.product_id == pid].groupby("hospital_id")["doses_remaining"]
                  .sum().reindex(BR, fill_value=0))

    n = len(BR)
    rem_src = risk_all[risk_all.product_id == pid].groupby("hospital_id")["days_remaining"].min().reindex(BR)
    BIG = 1e9

    def feasible(i, j):
        r = rem_src.iloc[i]
        return (not pd.isna(r)) and lead.iloc[j] < r

    C = np.zeros((n, n))
    for i, si in enumerate(BR):
        for j, sj in enumerate(BR):
            C[i, j] = 0 if i == j else (road_km(si, sj) * rate[sj] + lead.iloc[j] * LEAD_COST
                                        if feasible(i, j) else BIG)
    supply = supply.copy()
    for i in range(n):
        if supply.iloc[i] > 0 and not any(feasible(i, j) for j in range(n) if j != i):
            supply.iloc[i] = 0

    plan = ME.solve_transport(supply.values, demand_j.values, C, forbid_self=True)
    if plan is None:
        plan = np.zeros((n, n))
    dfp = pd.DataFrame(plan, index=BR, columns=BR).round(1)
    moved = dfp.stack().reset_index()
    moved.columns = ["from_hospital", "to_hospital", "doses"]
    moved = moved[moved["doses"] > 0.5].sort_values("doses", ascending=False)
    moved["product_id"] = pid
    OUT.mkdir(parents=True, exist_ok=True)
    moved.to_csv(OUT / "transshipment_plan.csv", index=False, encoding="utf-8-sig")
    print(f"[optimize] {pid}: {len(moved)} เส้นทาง · รวม {moved.doses.sum():.0f} โดส "
          f"· Z={ME.transport_cost(plan, C):.0f}")
    return moved
