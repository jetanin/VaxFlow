"""Unit tests — Multi-dose Pooling System (Queue Consolidation)"""
from modules import pooling


def test_consolidation_advice():
    assert pooling.consolidation_advice(10, 10)      # คิวเต็มขวดพอดี -> เปิดได้
    assert pooling.consolidation_advice(12, 10)
    assert not pooling.consolidation_advice(4, 10)   # คิวไม่พอ -> ยังไม่ควรเปิด


def test_consolidate_queue_reduces_residual():
    # 5 วัน วันละ 3 คิว, ขวดละ 10 โดส
    # ไม่ pooling: เปิด 5 ขวด ใช้ 15 -> เหลือ 35
    # pooling: รวม 15 คิว -> เปิด 2 ขวด (20 โดส) -> เหลือ 5
    r = pooling.consolidate_queue([3, 3, 3, 3, 3], doses_per_vial=10)
    assert r["total_appointments"] == 15
    assert r["residual_without_pooling"] == 35
    assert r["residual_with_pooling"] == 5
    assert r["doses_saved"] == 30
    assert r["reduction_pct"] > 30


def test_consolidate_queue_no_waste_when_aligned():
    r = pooling.consolidate_queue([10, 10], doses_per_vial=10)
    assert r["residual_without_pooling"] == 0
    assert r["residual_with_pooling"] == 0
    assert r["reduction_pct"] == 0.0
