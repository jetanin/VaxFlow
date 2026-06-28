"""VaxFlow retrainer job — เทรนโมเดลใหม่ + โหลดผลเข้า webapp

1) รัน notebook pipeline (03 feature → 04 train → 05 eval) แบบ headless
   → regenerate data/vaccine/outputs/*.csv (forecast/model_comparison/transshipment/wastage)
2) POST /api/reseed → backend โหลด outputs ใหม่เข้า Postgres + recompute reorder

env: BACKEND_URL · RESEED_TOKEN · NOTEBOOKS (คอมมาคั่น) · NB_TIMEOUT (วินาที/โน้ตบุ๊ก)
ออกแบบ best-effort: ถ้าโน้ตบุ๊กใดล้ม ยัง reseed ให้ส่วนที่สำเร็จ + recompute reorder จากข้อมูลสด
"""
import os
import subprocess
import sys

ROOT = "/work"
NOTEBOOKS = os.environ.get(
    "NOTEBOOKS",
    "notebook/03_feature_engineering.ipynb,"
    "notebook/04_model_training.ipynb,"
    "notebook/05_model_evaluation.ipynb",
).split(",")
NB_TIMEOUT = os.environ.get("NB_TIMEOUT", "1800")


def run_notebooks():
    ok = True
    for nb in [n.strip() for n in NOTEBOOKS if n.strip()]:
        print(f"[retrain] ▶ executing {nb}", flush=True)
        try:
            subprocess.run(
                ["jupyter", "nbconvert", "--to", "notebook", "--execute",
                 "--output-dir", "/tmp", f"--ExecutePreprocessor.timeout={NB_TIMEOUT}", nb],
                cwd=ROOT, check=True,
            )
            print(f"[retrain] ✓ {nb}", flush=True)
        except subprocess.CalledProcessError as e:
            ok = False
            print(f"[retrain] ✗ {nb} ล้มเหลว: {e}", flush=True)
    return ok


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
    nb_ok = run_notebooks()
    seeded = reseed()
    sys.exit(0 if (nb_ok and seeded) else 1)
