"""เผยแพร่ "สเปกร่วม" ของรอบ Federated Learning -> models/fl_spec.json

ในการทำ FedAvg ให้ weight ของแต่ละ รพ. นำมาเฉลี่ยกันได้ ทุก รพ. ต้อง
**สเกลฟีเจอร์ด้วยค่าเดียวกัน** (StandardScaler ตัวเดียวกัน) และใช้รายชื่อฟีเจอร์ชุดเดียวกัน

สคริปต์นี้ดึง scaler + รายชื่อฟีเจอร์ที่ตกลงร่วมแล้วจากโมเดลกลางที่เคยเทรนไว้
(models/fedavg_dp_demand*.joblib) มาเขียนเป็น JSON ให้ backend แจกจ่ายผ่าน GET /api/fl/spec

รัน:  python scripts/fl_publish_spec.py
"""
import os
import sys
import json
from pathlib import Path

import joblib

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"
DP_SIGMA = float(os.getenv("DP_SIGMA", "0.1"))


def spec_for(freq: str) -> dict:
    suf = "" if freq == "D" else f"_{freq}"
    bundle = joblib.load(MODELS / f"fedavg_dp_demand{suf}.joblib")
    scaler = bundle["scaler"]
    return {
        "freq": freq,
        "features": list(bundle["features"]),
        "scaler_mean": [round(float(x), 8) for x in scaler.mean_],
        "scaler_scale": [round(float(x), 8) for x in scaler.scale_],
        "dp_sigma": DP_SIGMA,
    }


def main():
    spec = {"daily": spec_for("D"), "weekly": spec_for("W")}
    out = MODELS / "fl_spec.json"
    out.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    n = len(spec["daily"]["features"])
    print(f"[fl] เขียน {out} แล้ว · {n} ฟีเจอร์ · dp_sigma={DP_SIGMA}")
    print("    backend จะแจกจ่ายผ่าน GET /api/fl/spec?freq=daily|weekly")


if __name__ == "__main__":
    main()
