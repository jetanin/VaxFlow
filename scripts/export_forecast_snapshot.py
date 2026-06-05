"""สร้าง snapshot การพยากรณ์ล่าสุด (ทุก รพ. × ทุกกลุ่มยา) สำหรับ web app seed ลง Postgres

ผลลัพธ์: data/predictions/forecast_snapshot.csv
คอลัมน์: hospital_id, drug, desc_th, last_date, pred_next_day, avg_30d, ratio, status, confidence
"""
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard"))
from forecasting import forecast_all, load_atc_names  # noqa: E402

OUT = ROOT / "data" / "predictions"
OUT.mkdir(parents=True, exist_ok=True)


def main():
    forecast_df, _ = forecast_all()
    atc = load_atc_names()
    forecast_df["desc_th"] = forecast_df["drug"].map(atc).fillna("")
    cols = ["hospital_id", "drug", "desc_th", "last_date",
            "pred_next_day", "avg_30d", "ratio", "status", "confidence"]
    forecast_df[cols].to_csv(OUT / "forecast_snapshot.csv", index=False, encoding="utf-8-sig")
    print(f"[saved] forecast_snapshot.csv: {len(forecast_df)} rows")


if __name__ == "__main__":
    main()
