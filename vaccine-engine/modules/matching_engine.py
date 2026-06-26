"""Predictive Matching Engine — โมดูล 2 (Proposal §3.2.2)  [SKELETON]

ยกเครื่อง Smart Borrowing เดิม (nearest-green by GPS, greedy) ให้เป็น
Mathematical Optimization จริง (Transportation Model).

ขั้นตอนที่จะ implement ใน Phase 3:
  1. คัดกรองความเสี่ยง — เลือกล็อต remaining_life < 14 วัน + อัตราใช้สาขาต้นทางต่ำ
  2. Transportation Model — minimize Σ distance(i,j) × transport_rate
     constraint: ล็อตสถานะ OPENED → ตัดออกก่อน (ห้ามขนส่งข้ามสาขา)
  lib: scipy.optimize.linprog / PuLP / OR-Tools
"""
from __future__ import annotations


def is_transportable(state: str) -> bool:
    """ขวดที่เปิดแล้ว (OPENED) ห้ามขนส่งข้ามสาขา — ตัดออกจาก optimization ก่อน."""
    return state in ("DEEP_FROZEN", "THAWED")


def solve_transport(supply, demand, cost):  # pragma: no cover - Phase 3
    """หาแผนโอนย้ายต้นทุนต่ำสุด (Transportation Model). TODO: Phase 3."""
    raise NotImplementedError("Predictive Matching Engine — implement in Phase 3")
