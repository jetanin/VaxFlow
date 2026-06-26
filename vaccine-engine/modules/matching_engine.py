"""Predictive Matching Engine — โมดูล 2 (Proposal §3.2.2)

ยกเครื่อง Smart Borrowing เดิม (nearest-green by GPS, greedy) ให้เป็น
Mathematical Optimization จริง (Transportation Model / Linear Programming).

2 ขั้นตอนตาม Proposal §3.2.2:
  1. คัดกรองความเสี่ยง (screen_at_risk): อายุขัย ≤ 14 วัน + อัตราการใช้สาขาต้นทางต่ำ + ขนส่งได้
  2. จัดสรรด้วย Transportation Model (solve_transport):
       min  Z = Σ_i Σ_j c(i,j)·x(i,j)
       s.t. Σ_j x(i,j) ≤ S(i)      (supply — โอนออกไม่เกินของเสี่ยงในสาขา)
            Σ_i x(i,j) ≤/= D(j)    (demand)
            x(i,j) ≥ 0
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import linprog


def is_transportable(state: str) -> bool:
    """ขวดที่เปิดแล้ว (OPENED) ห้ามขนส่งข้ามสาขา — ตัดออกจาก optimization ก่อน."""
    return state in ("DEEP_FROZEN", "THAWED")


def screen_at_risk(vials, usage_rate, max_days: float = 14.0, usage_threshold: float = 1.0):
    """คัดกรองล็อตเสี่ยง (Proposal §3.2.2): อายุขัยเหลือ ≤ max_days วัน + สาขาใช้ช้า + ขนส่งได้.

    vials       — list ของ dict: {hospital_id, product_id, doses_remaining, days_remaining, state}
    usage_rate  — dict: hospital_id -> อัตราการใช้ต่อวัน (ดีมานด์เฉลี่ย)
    คืน list เฉพาะล็อตที่ "เสี่ยงหมดอายุ + สาขาบริโภคต่ำกว่าเกณฑ์" (จึงควรโอนออก)
    """
    out = []
    for v in vials:
        if not is_transportable(v.get("state", "")):
            continue
        if v["days_remaining"] > max_days:
            continue
        if usage_rate.get(v["hospital_id"], 0.0) >= usage_threshold:
            continue          # สาขายังใช้เร็วพอ — ไม่ต้องโอน
        out.append(v)
    return out


def solve_transport(supply, demand, cost, forbid_self: bool = True):
    """Transportation Model (LP) — min Σ c·x ภายใต้ supply/demand constraints, x ≥ 0.

    รองรับทั้ง 2 กรณีให้ feasible เสมอ:
      • Σsupply ≤ Σdemand (กรณีปกติของการระบายของเสี่ยง):
            โอนของเสี่ยง "ออกให้หมด"  Σ_j x(i,j) = S(i)  ·  รับไม่เกินดีมานด์  Σ_i x(i,j) ≤ D(j)
      • Σsupply > Σdemand:
            ตอบสนองดีมานด์ "พอดี" (ตาม Proposal)  Σ_i x(i,j) = D(j)  ·  โอนออกไม่เกินของเสี่ยง  Σ_j x(i,j) ≤ S(i)
    forbid_self=True → ห้าม x(i,i) (สาขาเดียวกัน) เมื่อ matrix เป็นจัตุรัส
    คืน plan (numpy m×n) หรือ None ถ้า LP infeasible
    """
    supply = np.asarray(supply, dtype=float)
    demand = np.asarray(demand, dtype=float)
    C = np.asarray(cost, dtype=float)
    m, n = C.shape
    c = C.flatten()

    evacuate = supply.sum() <= demand.sum()      # ระบายของเสี่ยงออกหมด
    A_ub, b_ub, A_eq, b_eq = [], [], [], []
    for i in range(m):                            # supply rows
        row = np.zeros(m * n); row[i * n:(i + 1) * n] = 1
        (A_eq if evacuate else A_ub).append(row)
        (b_eq if evacuate else b_ub).append(supply[i])
    for j in range(n):                            # demand cols
        row = np.zeros(m * n)
        for i in range(m):
            row[i * n + j] = 1
        (A_ub if evacuate else A_eq).append(row)
        (b_ub if evacuate else b_eq).append(demand[j])

    bounds = [(0, None)] * (m * n)
    if forbid_self and m == n:                    # ห้ามส่งหาตัวเอง
        for i in range(m):
            bounds[i * n + i] = (0, 0)

    res = linprog(
        c,
        A_ub=np.array(A_ub) if A_ub else None, b_ub=b_ub or None,
        A_eq=np.array(A_eq) if A_eq else None, b_eq=b_eq or None,
        bounds=bounds, method="highs",
    )
    return res.x.reshape(m, n) if res.success else None


def transport_cost(plan, cost) -> float:
    """ต้นทุนรวม Z = Σ c·x ของแผนที่ได้."""
    return float(np.sum(np.asarray(plan) * np.asarray(cost)))
