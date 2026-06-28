"""VacFlow vaccine-engine — FastAPI microservice (Proposal: backend = Python)

วางข้าง ๆ Node/Express เดิม (loose coupling): Node ทำ auth/seed/audit/serve React
ส่วน engine นี้รับผิดชอบ logic เชิงคำนวณ 3 โมดูล (Proposal §3.2):
  1. Dynamic Expire Calculator   (implemented)
  2. Predictive Matching Engine  (implemented — Transportation Model / LP)
  3. Multi-dose Pooling System   (implemented — Queue Consolidation)
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import FastAPI
from pydantic import BaseModel, Field

from modules import dynamic_expire, matching_engine, pooling

app = FastAPI(
    title="VacFlow vaccine-engine",
    version="0.1.0",
    description="Dynamic Expire · Predictive Matching · Multi-dose Pooling",
)


@app.get("/engine/health")
def health():
    """Health check — ใช้กับ docker-compose healthcheck และ Node proxy."""
    return {"status": "ok", "service": "vaccine-engine", "version": app.version}


# ── โมดูล 1: Dynamic Expire Calculator ────────────────────────────────────
class ExpireRequest(BaseModel):
    state: str = Field(..., examples=["THAWED"], description="DEEP_FROZEN | THAWED | OPENED")
    label_expiry: datetime = Field(..., description="วันหมดอายุบนสลาก (static)")
    state_since: datetime = Field(..., description="เวลาที่เข้าสู่สถานะปัจจุบัน")
    thawed_life_days: int = 30
    open_life_hours: int = 6


class ExpireResponse(BaseModel):
    state: str
    effective_expiry: datetime
    remaining_seconds: float
    expired: bool


@app.post("/engine/expire", response_model=ExpireResponse)
def compute_expire(req: ExpireRequest):
    """คำนวณอายุขัยจริง (effective_expiry) ของขวดตามสถานะจัดเก็บ."""
    eff = dynamic_expire.effective_expiry(
        req.state, req.label_expiry, req.state_since,
        req.thawed_life_days, req.open_life_hours,
    )
    now = datetime.now(tz=req.state_since.tzinfo or timezone.utc)
    remaining = dynamic_expire.remaining_life(eff, now)
    return ExpireResponse(
        state=req.state,
        effective_expiry=eff,
        remaining_seconds=remaining.total_seconds(),
        expired=remaining.total_seconds() <= 0,
    )


# ── โมดูล 2: Predictive Matching Engine (Transportation Model) ─────────────
class MatchRequest(BaseModel):
    nodes: list[str] = Field(..., description="รหัสสาขา (index ตรงกับ supply/demand/cost)")
    supply: list[float] = Field(..., description="S(i): โดสเสี่ยงหมดอายุที่โอนออกได้ ต่อสาขา")
    demand: list[float] = Field(..., description="D(j): ดีมานด์ปลายทาง ต่อสาขา")
    cost: list[list[float]] = Field(..., description="c(i,j): ต้นทุนขนส่ง (ระยะทาง×rate)")


class MatchResponse(BaseModel):
    total_cost: float
    moves: list[dict]            # [{from, to, doses}]
    feasible: bool


@app.post("/engine/match", response_model=MatchResponse)
def match(req: MatchRequest):
    """จับคู่โอนย้ายต้นทุนต่ำสุด (min Σ c·x) สำหรับล็อตที่เข้าสถานะวิกฤต 🔴."""
    plan = matching_engine.solve_transport(req.supply, req.demand, req.cost)
    if plan is None:
        return MatchResponse(total_cost=0.0, moves=[], feasible=False)
    moves = [
        {"from": req.nodes[i], "to": req.nodes[j], "doses": round(float(plan[i][j]), 2)}
        for i in range(len(req.nodes)) for j in range(len(req.nodes))
        if plan[i][j] > 1e-6
    ]
    return MatchResponse(
        total_cost=round(matching_engine.transport_cost(plan, req.cost), 2),
        moves=sorted(moves, key=lambda m: -m["doses"]),
        feasible=True,
    )


# ── โมดูล 3: Multi-dose Pooling System (Queue Consolidation) ───────────────
class PoolRequest(BaseModel):
    daily_slots: list[int] = Field(..., description="จำนวนคิวนัดรายวัน")
    doses_per_vial: int = Field(..., description="โดสต่อขวด (Multi-Dose Multiplier)")


@app.post("/engine/pool")
def pool(req: PoolRequest):
    """รวมคิวนัดให้เต็มขวด → ลดโดสค้างขวด (Residual Wastage)."""
    return pooling.consolidate_queue(req.daily_slots, req.doses_per_vial)
