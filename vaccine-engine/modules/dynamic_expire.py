"""Dynamic Expire Calculator — โมดูล 1 (Proposal §3.2.1)

State machine ของวัคซีน: อายุขัยจริงขึ้นกับ "สถานะจัดเก็บ" ไม่ใช่แค่วันบนสลาก

    DEEP_FROZEN (≈1 ปี) ──ละลาย──► THAWED (30 วัน) ──เจาะขวด──► OPENED (6 ชม.)

ทุกครั้งที่เปลี่ยนสถานะ → คำนวณ effective_expiry ใหม่และ overwrite ทับค่า static
"""
from __future__ import annotations

from datetime import datetime, timedelta

VialState = str  # "DEEP_FROZEN" | "THAWED" | "OPENED"

VALID_STATES = ("DEEP_FROZEN", "THAWED", "OPENED")

# การเปลี่ยนสถานะที่อนุญาต (เดินหน้าทางเดียว — ขวดที่เปิดแล้วย้อนกลับไปแช่แข็งไม่ได้)
ALLOWED_TRANSITIONS = {
    "DEEP_FROZEN": {"THAWED"},
    "THAWED": {"OPENED"},
    "OPENED": set(),
}


def effective_expiry(
    state: VialState,
    label_expiry: datetime,
    state_since: datetime,
    thawed_life_days: int = 30,
    open_life_hours: int = 6,
) -> datetime:
    """อายุขัยจริงของขวด ตามสถานะปัจจุบัน

    - DEEP_FROZEN → ใช้วันหมดอายุบนสลาก (static)
    - THAWED      → min(สลาก, ละลายเมื่อ + 30 วัน)
    - OPENED      → เปิดเมื่อ + 6 ชม. (สั้นที่สุด — ห้ามขนส่งข้ามสาขา)
    """
    if state == "DEEP_FROZEN":
        return label_expiry
    if state == "THAWED":
        return min(label_expiry, state_since + timedelta(days=thawed_life_days))
    if state == "OPENED":
        return state_since + timedelta(hours=open_life_hours)
    raise ValueError(f"unknown state: {state!r}")


def remaining_life(effective: datetime, now: datetime) -> timedelta:
    """เวลาที่เหลือก่อนเสื่อม (ป้อนเกณฑ์สัญญาณไฟ 🟡<21วัน / 🔴<14วัน)."""
    return effective - now


def can_transition(current: VialState, target: VialState) -> bool:
    """ตรวจว่าเปลี่ยนจาก current → target ได้ตาม state machine หรือไม่."""
    if current not in VALID_STATES or target not in VALID_STATES:
        return False
    return target in ALLOWED_TRANSITIONS[current]
