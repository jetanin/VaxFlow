"""VaxFlow vaccine-engine — FastAPI microservice (Proposal: backend = Python)

วางข้าง ๆ Node/Express เดิม (loose coupling): Node ทำ auth/seed/audit/serve React
ส่วน engine นี้รับผิดชอบ logic เชิงคำนวณ 3 โมดูล:
  1. Dynamic Expire Calculator   (implemented)
  2. Predictive Matching Engine  (Phase 3 — skeleton)
  3. Multi-dose Pooling System   (Phase 4 — skeleton)
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import FastAPI
from pydantic import BaseModel, Field

from modules import dynamic_expire

app = FastAPI(
    title="VaxFlow vaccine-engine",
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
