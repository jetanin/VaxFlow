"""ML benchmark (จาก notebook 04 §2) — RF/XGB/LGB/NN + Optuna (GPU-aware)
   *benchmark เท่านั้น* — การตัดสินใจจริงใช้ forecast.py (ปิดวงจรแล้วใน P1)
   เปิดด้วย env VACFLOW_TRAIN=1 · เลือกโมเดล VACFLOW_MODELS, จำนวน trial VACFLOW_N_TRIALS
ผล: model_comparison.csv
"""
import os
import warnings

import numpy as np
import pandas as pd

from .config import FEAT, OUT

warnings.filterwarnings("ignore")


def _gpu_xgb(XGB):
    try:
        XGB(n_estimators=4, device="cuda", tree_method="hist", verbosity=0).fit(
            np.random.rand(16, 3), (np.arange(16) % 4).astype(float))
        return {"device": "cuda", "tree_method": "hist"}
    except Exception:
        return {"tree_method": "hist"}


def build():
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.neural_network import MLPRegressor
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import make_pipeline
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
    import optuna
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    try:
        from xgboost import XGBRegressor; HAS_XGB = True
    except Exception:
        HAS_XGB = False
    try:
        from lightgbm import LGBMRegressor; HAS_LGB = True
    except Exception:
        HAS_LGB = False

    feat = pd.read_csv(FEAT / "demand_features.csv", parse_dates=["date"])
    base = ["lag_1", "lag_7", "lag_14", "sma_7", "sma_14", "roll_std_7", "es_0.4", "dow", "is_weekend"]
    exog = [c for c in (FEAT / "exogenous_features.txt").read_text(encoding="utf-8").split()
            if c in feat.columns]
    feats = base + exog
    df = feat.sort_values("date").reset_index(drop=True)
    X = pd.concat([df[feats], pd.get_dummies(df[["hospital_id", "product_id"]]).astype(int)], axis=1)
    y = df["demand"].to_numpy()
    n = len(df); itr, iva = int(n * 0.7), int(n * 0.8)
    Xtr, ytr, Xva, yva, Xte, yte = X[:itr], y[:itr], X[itr:iva], y[itr:iva], X[iva:], y[iva:]
    sma_te = df["sma_7"].to_numpy()[iva:]
    rmse = lambda a, b: float(np.sqrt(mean_squared_error(a, b)))
    XGB_GPU = _gpu_xgb(XGBRegressor) if HAS_XGB else {}
    n_trials = int(os.environ.get("VACFLOW_N_TRIALS", 25))

    def model(name, t):
        if name == "XGBoost":
            return XGBRegressor(n_estimators=t.suggest_int("n_estimators", 100, 600),
                max_depth=t.suggest_int("max_depth", 3, 10),
                learning_rate=t.suggest_float("learning_rate", 0.01, 0.3, log=True),
                n_jobs=-1, random_state=42, verbosity=0, **XGB_GPU)
        if name == "LightGBM":
            return LGBMRegressor(n_estimators=t.suggest_int("n_estimators", 100, 600),
                num_leaves=t.suggest_int("num_leaves", 15, 128),
                learning_rate=t.suggest_float("learning_rate", 0.01, 0.3, log=True),
                n_jobs=-1, random_state=42, verbose=-1)
        if name == "RandomForest":
            return RandomForestRegressor(n_estimators=t.suggest_int("n_estimators", 100, 400),
                max_depth=t.suggest_int("max_depth", 3, 16), n_jobs=-1, random_state=42)
        h = t.suggest_categorical("hidden", ["64", "64,32", "128,64"])
        return make_pipeline(StandardScaler(), MLPRegressor(
            hidden_layer_sizes=tuple(int(x) for x in h.split(",")),
            max_iter=300, early_stopping=True, random_state=42))

    avail = (["XGBoost"] if HAS_XGB else []) + (["LightGBM"] if HAS_LGB else []) + ["RandomForest", "NeuralNet"]
    sel = [m.strip() for m in os.environ.get("VACFLOW_MODELS", "").split(",") if m.strip()]
    models = [m for m in avail if m in sel] or avail

    rows = [{"model": "SMA-7 (baseline)", "MAE": round(mean_absolute_error(yte, sma_te), 2),
             "RMSE": round(rmse(yte, sma_te), 2), "R2": round(r2_score(yte, sma_te), 3)}]
    for name in models:
        study = optuna.create_study(direction="minimize")
        study.optimize(lambda t: rmse(yva, model(name, t).fit(Xtr, ytr).predict(Xva)),
                       n_trials=n_trials, show_progress_bar=False)
        m = model(name, study.best_trial).fit(pd.concat([Xtr, Xva]), np.concatenate([ytr, yva]))
        pred = m.predict(Xte)
        rows.append({"model": name, "MAE": round(mean_absolute_error(yte, pred), 2),
                     "RMSE": round(rmse(yte, pred), 2), "R2": round(r2_score(yte, pred), 3)})
    cmp = pd.DataFrame(rows).sort_values("RMSE").reset_index(drop=True)
    cmp.to_csv(OUT / "model_comparison.csv", index=False, encoding="utf-8-sig")
    print(f"[train] model_comparison: best={cmp.iloc[0]['model']} (models={models})")
    return cmp
