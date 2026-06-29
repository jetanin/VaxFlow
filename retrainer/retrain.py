"""VacFlow retrainer job — เทรน/คำนวณใหม่ + โหลดผลเข้า webapp

1) รัน pipeline-as-code: `python -m pipeline.run`  (features → forecast → optimize → evaluate)
   *ไม่พึ่ง jupyter/nbconvert แล้ว* (เดิมเปราะ + version-sensitive) — เปิด ML benchmark ด้วย VACFLOW_TRAIN=1
2) POST /api/reseed → backend โหลด outputs ใหม่เข้า Postgres + recompute reorder/transshipment

env: BACKEND_URL · RESEED_TOKEN · VACFLOW_TRAIN · VACFLOW_MODELS · VACFLOW_N_TRIALS · VACFLOW_NOW
best-effort: ถ้า pipeline ล้ม ยัง reseed ให้ส่วนที่สำเร็จ + recompute จากข้อมูลสด
"""
import os
import subprocess
import sys

ROOT = "/work"


def run_pipeline():
    print("[retrain] ▶ python -m pipeline.run", flush=True)
    try:
        subprocess.run([sys.executable, "-m", "pipeline.run"], cwd=ROOT, check=True, env=dict(os.environ))
        print("[retrain] ✓ pipeline", flush=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"[retrain] ✗ pipeline ล้มเหลว: {e}", flush=True)
        return False


def reseed():
    import requests
    url = os.environ.get("BACKEND_URL", "http://backend:4000").rstrip("/") + "/api/reseed"
    token = os.environ.get("RESEED_TOKEN", "changeme")
    try:
        r = requests.post(url, headers={"x-reseed-token": token}, timeout=180)
        print(f"[retrain] reseed → {r.status_code} {r.text}", flush=True)
        return r.ok
    except Exception as e:  # noqa: BLE001
        print(f"[retrain] reseed ล้มเหลว: {e}", flush=True)
        return False


if __name__ == "__main__":
    ok = run_pipeline()
    seeded = reseed()
    sys.exit(0 if (ok and seeded) else 1)
