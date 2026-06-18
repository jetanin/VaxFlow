"""FL Client — สคริปต์ที่ "แต่ละโรงพยาบาล" นำไปรันในเครื่องตัวเอง

แนวคิด Federated Learning: ข้อมูลดิบของคนไข้ **ไม่ออกจากโรงพยาบาล**
รพ. เทรนโมเดลกับข้อมูลตัวเอง -> ได้ weight -> ใส่ Differential Privacy noise -> ส่งกลับศูนย์กลาง

ขั้นตอนที่สคริปต์นี้ทำ:
  1) อ่านข้อมูลใช้ยาดิบของ รพ. (CSV ในเครื่อง — ไม่ส่งออกไปไหน)
  2) ขอ "สเปกร่วม" จากศูนย์กลาง (GET /api/fl/spec): รายชื่อฟีเจอร์ + ค่า scaler ที่ตกลงร่วมกัน
  3) สร้างฟีเจอร์ + สเกลด้วยค่ากลาง แล้วเทรน local model (SGDRegressor)
  4) ใส่ Gaussian noise (Differential Privacy) ลงบน weight ก่อนส่งออก
  5) ส่งเฉพาะ weight (coef + intercept) กลับศูนย์กลาง (POST /api/fl/submit) — ไม่มีข้อมูลคนไข้

ตัวอย่างการรัน (ที่ รพ.):
  python scripts/fl_client.py --hospital HOSP_001 \
      --server http://localhost:4000 --token medcast-reseed --freq daily

จากนั้นศูนย์กลางสั่งรวม weight ทุก รพ. ด้วย:
  curl -X POST http://localhost:4000/api/fl/aggregate \
       -H "X-FL-Token: medcast-reseed" -H "Content-Type: application/json" -d '{"freq":"daily"}'
"""
import sys
import json
import argparse
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from sklearn.linear_model import SGDRegressor

ROOT = Path(__file__).resolve().parents[1]
# ใช้ build_features ชุดเดียวกับศูนย์กลาง เพื่อให้ฟีเจอร์ตรงกันเป๊ะ
# (ในการ deploy จริง รพ. จะได้รับไฟล์ forecasting.py แนบไปด้วย)
sys.path.insert(0, str(ROOT / "dashboard"))
from forecasting import build_features  # noqa: E402

FREQ_CODE = {"daily": "D", "weekly": "W"}


def http_get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode())


def http_post_json(url: str, payload: dict, token: str) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json", "X-FL-Token": token})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def main():
    ap = argparse.ArgumentParser(description="MedCast FL client (รันที่โรงพยาบาล)")
    ap.add_argument("--hospital", required=True, help="รหัส รพ. เช่น HOSP_001")
    ap.add_argument("--data", help="ไฟล์ CSV ข้อมูลใช้ยา (ดีฟอลต์ data/hospitals/<hospital>.csv)")
    ap.add_argument("--server", default="http://localhost:4000", help="URL ศูนย์กลาง")
    ap.add_argument("--token", default="changeme", help="FL token (ตรงกับ FL_TOKEN/RESEED_TOKEN ของ backend)")
    ap.add_argument("--freq", default="daily", choices=["daily", "weekly"])
    ap.add_argument("--dp-sigma", type=float, default=None,
                    help="override ระดับ noise (ดีฟอลต์ใช้ค่าที่ศูนย์กลางกำหนดในสเปก)")
    ap.add_argument("--dry-run", action="store_true", help="คำนวณ weight แต่ไม่ส่ง (ทดสอบ)")
    args = ap.parse_args()

    data_path = Path(args.data) if args.data else ROOT / "data" / "hospitals" / f"{args.hospital}.csv"
    if not data_path.exists():
        raise SystemExit(f"ไม่พบไฟล์ข้อมูล: {data_path}")

    # 1) ข้อมูลดิบ — อยู่ในเครื่อง รพ. เท่านั้น
    usage = pd.read_csv(data_path)

    # 2) ขอสเปกร่วมจากศูนย์กลาง (ฟีเจอร์ + ค่า scaler ที่ทุก รพ. ใช้ร่วมกัน)
    spec = http_get_json(f"{args.server.rstrip('/')}/api/fl/spec?freq={args.freq}")
    features = spec["features"]
    mean = np.array(spec["scaler_mean"], dtype=float)
    scale = np.array(spec["scaler_scale"], dtype=float)
    dp_sigma = args.dp_sigma if args.dp_sigma is not None else float(spec.get("dp_sigma", 0.1))

    # 3) สร้างฟีเจอร์ + สเกลด้วยค่ากลาง -> เทรน local model
    feats = build_features(usage, freq=FREQ_CODE[args.freq])
    missing = [c for c in features if c not in feats.columns]
    for c in missing:        # รพ. นี้อาจไม่มียาบางกลุ่ม -> เติมคอลัมน์ 0 ให้มิติตรงกัน
        feats[c] = 0
    X = feats[features].to_numpy(dtype=float)
    Xs = (X - mean) / scale
    y = feats["demand"].to_numpy(dtype=float)
    model = SGDRegressor(max_iter=1000, random_state=0).fit(Xs, y)

    coef = model.coef_.astype(float).copy()
    intercept = float(model.intercept_[0])

    # 4) Differential Privacy: ใส่ Gaussian noise ก่อน weight ออกจาก รพ.
    rng = np.random.default_rng()
    if dp_sigma > 0:
        coef = coef + rng.normal(0, dp_sigma, coef.shape)
        intercept = intercept + float(rng.normal(0, dp_sigma))

    payload = {
        "hospital_id": args.hospital,
        "freq": args.freq,
        "n_samples": int(len(feats)),
        "coef": [round(float(c), 6) for c in coef],
        "intercept": round(intercept, 6),
        "dp_sigma": dp_sigma,
    }
    print(f"[fl] {args.hospital}: เทรนเสร็จ · {len(features)} weight · n={payload['n_samples']} · "
          f"DP σ={dp_sigma} (freq={args.freq})")

    if args.dry_run:
        print("[fl] --dry-run: ไม่ส่ง weight")
        return

    # 5) ส่งเฉพาะ weight กลับศูนย์กลาง (ไม่มีข้อมูลคนไข้)
    res = http_post_json(f"{args.server.rstrip('/')}/api/fl/submit", payload, args.token)
    print(f"[fl] ส่ง weight สำเร็จ -> {res}")


if __name__ == "__main__":
    main()
