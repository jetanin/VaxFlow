"""Config ร่วมของ pipeline — path + time anchor เดียว (P4)

VACFLOW_NOW: anchor เวลา "ตอนนี้" ของทั้งระบบ (generators + pipeline + นับอายุขัย)
  ค่าเริ่มต้นตรึงไว้ให้ deterministic · ตั้ง env = วันจริงได้เพื่อให้สี/threshold ไม่ drift
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VAX = ROOT / "data" / "vaccine"
CLEAN = VAX / "clean"
FEAT = VAX / "features"
OUT = VAX / "outputs"
HOSPITALS = ROOT / "data" / "hospitals"

NOW_ISO = os.environ.get("VACFLOW_NOW", "2026-06-26T08:00:00+07:00")

# ให้ import vaccine-engine modules ได้ (matching_engine / pooling / dynamic_expire)
sys.path.insert(0, str(ROOT / "vaccine-engine"))


def now_ts():
    import pandas as pd
    return pd.Timestamp(NOW_ISO)
