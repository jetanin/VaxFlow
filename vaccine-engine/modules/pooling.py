"""Multi-dose Pooling System — โมดูล 3 (Proposal §3.2.3)

รวมคิวนัด (Demand Aggregation) ให้สัมพันธ์กับ "ขนาดโดสต่อขวด" (Multi-Dose Multiplier)
เพื่อแนะนำให้เปิดขวดเฉพาะวันที่มีคน ≥ โดส/ขวด → ลดโดสที่เหลือทิ้งค้างขวด (Residual Wastage)

⚠️ PDPA: ทำงานบน "จำนวนคิว (counts)" เท่านั้น — การยิง SMS/หาตัวคนไข้เกิดในระบบ รพ.
        เบอร์/ชื่อไม่ออกนอกสาขา (Proposal §5.2)
"""
from __future__ import annotations

from math import ceil


def consolidation_advice(slot_count: int, doses_per_vial: int) -> bool:
    """ควรเปิดขวดในวันนั้นหรือไม่ — มีคนนัด ≥ จำนวนโดสต่อขวด (จะไม่เหลือค้างขวด)."""
    return slot_count >= doses_per_vial


def _residual(slots_per_open, doses_per_vial: int) -> int:
    """โดสที่เหลือทิ้งรวม = (จำนวนขวดที่เปิด × โดส/ขวด) − โดสที่ใช้จริง."""
    used = sum(slots_per_open)
    vials = sum(ceil(s / doses_per_vial) for s in slots_per_open if s > 0)
    return vials * doses_per_vial - used


def consolidate_queue(daily_slots, doses_per_vial: int):
    """รวมคิวข้ามวันให้เต็มขวด แล้วเทียบ residual wastage 'ก่อน vs หลัง' pooling.

    daily_slots — list จำนวนคิวรายวัน เช่น [3, 4, 2, 8, ...]
    คืน dict:
      without_pooling — เปิดขวดทุกวันตามคิววันนั้น (เหลือค้างเยอะ)
      with_pooling    — รวมคิวให้เปิดเฉพาะวันที่สะสม ≥ โดส/ขวด
      doses_saved / reduction_pct
      open_days       — index ของวันที่แนะนำให้เปิดขวด (with pooling)
    """
    dpv = max(1, int(doses_per_vial))
    slots = [int(s) for s in daily_slots]

    # ไม่ pooling: แต่ละวันที่มีคิวต้องเปิดขวดเองทันที
    residual_without = _residual(slots, dpv)

    # pooling: สะสมคิวจนถึง ≥ dpv แล้วค่อยเปิด (ปล่อยเป็นก้อนเต็มขวด)
    open_days, batches, carry, carry_start = [], [], 0, None
    for i, s in enumerate(slots):
        if s and carry == 0:
            carry_start = i
        carry += s
        while carry >= dpv:
            batches.append(dpv)
            carry -= dpv
            open_days.append(i)
    if carry > 0:                 # เศษที่เหลือต้องเปิดอีก 1 ขวด (มี residual)
        batches.append(carry)
        open_days.append(carry_start if carry_start is not None else len(slots) - 1)
    residual_with = _residual(batches, dpv)

    saved = residual_without - residual_with
    return {
        "doses_per_vial": dpv,
        "total_appointments": sum(slots),
        "residual_without_pooling": residual_without,
        "residual_with_pooling": residual_with,
        "doses_saved": saved,
        "reduction_pct": round(100 * saved / residual_without, 1) if residual_without else 0.0,
        "open_days": sorted(set(open_days)),
    }
