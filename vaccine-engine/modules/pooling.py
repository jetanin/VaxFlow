"""Multi-dose Pooling System — โมดูล 3 (Proposal §3.3)  [SKELETON]

รวมคิวนัด + Dynamic Queue Pulling เพื่อไม่ให้เหลือโดสค้างขวด

ขั้นตอนที่จะ implement ใน Phase 4:
  1. Queue Consolidation — รวมคิววัคซีนชนิดเดียวกัน → แนะนำเปิดขวดวันที่มีคน ≥ โดส/ขวด
  2. Dynamic Queue Pulling — เมื่อขวดเปิด (6 ชม.) → ล็อกการโอนย้าย + เสนอเลื่อนคิวมาเคลียร์โดส

⚠️ PDPA: ทำงานบน "จำนวนคิว (counts)" เท่านั้น — การยิง SMS/หาตัวคนไข้เกิดในระบบ รพ.
        เบอร์/ชื่อไม่ออกนอกสาขา (Proposal §5.2)
"""
from __future__ import annotations


def consolidation_advice(slot_count: int, doses_per_vial: int) -> bool:  # pragma: no cover - Phase 4
    """ควรเปิดขวดในวันนั้นหรือไม่ (มีคนนัด ≥ จำนวนโดสต่อขวด). TODO: Phase 4."""
    raise NotImplementedError("Multi-dose Pooling — implement in Phase 4")
