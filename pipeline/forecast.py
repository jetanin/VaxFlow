"""Demand forecasting (จาก notebook 04 §1) — SMA(ปกติ)/ES(วิกฤต) + forecast_daily ที่ webapp ใช้
ผล: forecast_model_selection.csv + demand_forecast.csv
"""
import numpy as np
import pandas as pd

from .config import FEAT, OUT

ALPHAS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.7]
CV_THR = 0.6   # §math: CV > เกณฑ์ = วิกฤต -> ES · ปกติ -> SMA


def _rmse(a, b):
    return float(np.sqrt(np.mean((np.asarray(a) - np.asarray(b)) ** 2)))


def _es(series, alpha):
    f = series.iloc[0]; out = []
    for t in range(len(series)):
        out.append(f); f = alpha * series.iloc[t] + (1 - alpha) * f
    return np.array(out)


def build():
    feat = pd.read_csv(FEAT / "demand_features.csv", parse_dates=["date"])
    rows = []
    for (hid, pid), g in feat.groupby(["hospital_id", "product_id"]):
        g = g.sort_values("date"); cut = int(len(g) * 0.8)
        train, test = g.iloc[:cut], g.iloc[cut:]
        mu = train["demand"].mean()
        cv = float(train["demand"].std() / mu) if mu > 0 else 0.0
        method = "ES" if cv > CV_THR else "SMA"
        sma_rmse = _rmse(test["demand"], test["sma_7"])
        best_a, best_r = ALPHAS[0], np.inf
        for a in ALPHAS:
            r = _rmse(test["demand"], _es(g["demand"], a)[cut:])
            if r < best_r:
                best_a, best_r = a, r
        sma_next = float(g["demand"].tail(7).mean())
        es_next = float(best_a * g["demand"].iloc[-1] + (1 - best_a) * _es(g["demand"], best_a)[-1])
        forecast_daily = round(max(0.0, es_next if method == "ES" else sma_next), 2)
        rows.append({"hospital_id": hid, "product_id": pid, "sma7_rmse": round(sma_rmse, 2),
                     "best_alpha": best_a, "es_rmse": round(best_r, 2), "cv": round(cv, 2),
                     "scenario": "crisis" if cv > CV_THR else "normal", "method": method,
                     "forecast_daily": forecast_daily,
                     "winner": "ES" if best_r < sma_rmse else "SMA"})
    fc = pd.DataFrame(rows)
    OUT.mkdir(parents=True, exist_ok=True)
    fc.to_csv(OUT / "forecast_model_selection.csv", index=False, encoding="utf-8-sig")
    fc[["hospital_id", "product_id", "method", "forecast_daily"]].to_csv(
        OUT / "demand_forecast.csv", index=False, encoding="utf-8-sig")
    print(f"[forecast] {len(fc)} series · scenario {fc.scenario.value_counts().to_dict()} "
          f"· forecast/วัน เฉลี่ย {round(fc.forecast_daily.mean(), 2)}")
    return fc
