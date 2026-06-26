"""Unit tests — Dynamic Expire Calculator (3 สถานะ: 1 ปี / 30 วัน / 6 ชม.)"""
from datetime import datetime, timedelta, timezone

from modules import dynamic_expire as de

TZ = timezone(timedelta(hours=7))
LABEL = datetime(2027, 1, 15, tzinfo=TZ)


def test_deep_frozen_uses_label_expiry():
    state_since = datetime(2026, 6, 1, tzinfo=TZ)
    assert de.effective_expiry("DEEP_FROZEN", LABEL, state_since) == LABEL


def test_thawed_is_state_since_plus_30_days_when_sooner():
    state_since = datetime(2026, 6, 26, 8, 0, tzinfo=TZ)
    eff = de.effective_expiry("THAWED", LABEL, state_since)
    assert eff == state_since + timedelta(days=30)


def test_thawed_capped_by_label_expiry():
    # ละลายใกล้วันหมดอายุสลาก → +30 วันเกินสลาก จึงถูก cap ด้วยสลาก
    state_since = datetime(2027, 1, 5, tzinfo=TZ)
    eff = de.effective_expiry("THAWED", LABEL, state_since)
    assert eff == LABEL


def test_opened_is_state_since_plus_6_hours():
    state_since = datetime(2026, 6, 26, 8, 0, tzinfo=TZ)
    eff = de.effective_expiry("OPENED", LABEL, state_since)
    assert eff == state_since + timedelta(hours=6)


def test_transitions_are_one_way():
    assert de.can_transition("DEEP_FROZEN", "THAWED")
    assert de.can_transition("THAWED", "OPENED")
    assert not de.can_transition("OPENED", "THAWED")
    assert not de.can_transition("DEEP_FROZEN", "OPENED")
