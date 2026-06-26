"""Unit tests — Predictive Matching Engine (Transportation Model)"""
import numpy as np

from modules import matching_engine as me


def test_opened_not_transportable():
    assert not me.is_transportable("OPENED")
    assert me.is_transportable("THAWED") and me.is_transportable("DEEP_FROZEN")


def test_screen_at_risk_filters_by_life_usage_and_state():
    vials = [
        {"hospital_id": "A", "product_id": "P", "doses_remaining": 5, "days_remaining": 8, "state": "THAWED"},   # at risk
        {"hospital_id": "B", "product_id": "P", "doses_remaining": 5, "days_remaining": 8, "state": "OPENED"},   # opened -> skip
        {"hospital_id": "C", "product_id": "P", "doses_remaining": 5, "days_remaining": 40, "state": "THAWED"},  # life ok -> skip
        {"hospital_id": "D", "product_id": "P", "doses_remaining": 5, "days_remaining": 8, "state": "THAWED"},   # high usage -> skip
    ]
    usage = {"A": 0.2, "B": 0.2, "C": 0.2, "D": 9.0}
    risk = me.screen_at_risk(vials, usage, max_days=14, usage_threshold=1.0)
    assert [v["hospital_id"] for v in risk] == ["A"]


def test_solve_transport_evacuates_supply_to_cheapest_demand():
    # supply(48) < demand(102) -> ระบายของเสี่ยงออกหมด, รับไม่เกินดีมานด์
    supply = [10, 0, 30, 8, 0]
    demand = [17, 16, 32, 20, 17]
    cost = np.ones((5, 5)) + np.eye(5) * 100   # diagonal แพง (กันส่งหาตัวเอง)
    plan = me.solve_transport(supply, demand, cost)
    assert plan is not None
    assert np.isclose(plan.sum(), sum(supply))            # โอนของเสี่ยงออกครบ
    assert np.allclose(np.diag(plan), 0)                  # ไม่ส่งหาตัวเอง
    # รับไม่เกินดีมานด์รายปลายทาง
    assert (plan.sum(axis=0) <= np.array(demand) + 1e-6).all()


def test_solve_transport_meets_demand_when_supply_excess():
    # supply(100) > demand(30) -> ตอบสนองดีมานด์พอดี (ตาม Proposal literal)
    supply = [60, 40]
    demand = [20, 10]
    cost = [[1, 2], [2, 1]]
    plan = me.solve_transport(supply, demand, cost, forbid_self=False)
    assert plan is not None
    assert np.allclose(plan.sum(axis=0), demand)          # demand พอดี
    assert (plan.sum(axis=1) <= np.array(supply) + 1e-6).all()
