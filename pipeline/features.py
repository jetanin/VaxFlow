"""Feature engineering (จาก notebook 03) — lag/SMA/ES + exogenous (ประชากร/ไข้หวัดใหญ่/อากาศ)
ผล: data/vaccine/features/demand_features.csv + exogenous_features.txt
"""
import numpy as np
import pandas as pd

from .config import CLEAN, FEAT

HOSP_META = pd.DataFrame([
    ("HOSP_001", "ตาก", "NORTH", "REGIONAL", 250_000),
    ("HOSP_002", "นครราชสีมา", "NORTHEAST", "COMMUNITY", 70_000),
    ("HOSP_003", "อุดรธานี", "NORTHEAST", "REGIONAL", 350_000),
    ("HOSP_004", "อุดรธานี", "NORTHEAST", "COMMUNITY", 90_000),
    ("HOSP_005", "อุดรธานี", "NORTHEAST", "COMMUNITY", 80_000),
    ("HOSP_006", "ระยอง", "EAST", "COMMUNITY", 90_000),
    ("HOSP_007", "กรุงเทพมหานคร", "BKK", "UNIVERSITY", 900_000),
    ("HOSP_008", "กรุงเทพมหานคร", "BKK", "REGIONAL", 600_000),
    ("HOSP_009", "กรุงเทพมหานคร", "BKK", "UNIVERSITY", 800_000),
    ("HOSP_010", "ปทุมธานี", "CENTRAL", "UNIVERSITY", 300_000),
    ("HOSP_011", "สมุทรปราการ", "CENTRAL", "GENERAL", 400_000),
    ("HOSP_012", "นนทบุรี", "CENTRAL", "SPECIALIZED", 60_000),
    ("HOSP_013", "ชลบุรี", "EAST", "REGIONAL", 450_000),
], columns=["hospital_id", "province", "region", "hosp_type", "catchment_pop"])

AGE_FRAC = {"NORTH": (0.052, 0.20), "NORTHEAST": (0.058, 0.18), "EAST": (0.055, 0.15),
            "CENTRAL": (0.050, 0.17), "BKK": (0.048, 0.19)}


def _add_features(g):
    g = g.copy()
    g["dow"] = g["date"].dt.weekday
    g["is_weekend"] = (g["dow"] >= 5).astype(int)
    for lag in (1, 7, 14):
        g[f"lag_{lag}"] = g["demand"].shift(lag)
    g["sma_7"] = g["demand"].shift(1).rolling(7).mean()
    g["sma_14"] = g["demand"].shift(1).rolling(14).mean()
    g["roll_std_7"] = g["demand"].shift(1).rolling(7).std()
    return g


def _exp_smoothing(s, alpha=0.4):
    f = np.zeros(len(s)); f[0] = s.iloc[0]
    for t in range(1, len(s)):
        f[t] = alpha * s.iloc[t - 1] + (1 - alpha) * f[t - 1]
    return f


def _seasonal_ili(week, region):
    main = np.exp(-((week - 34) ** 2) / (2 * 6.0 ** 2))
    minor = 0.55 * np.exp(-((week - 5) ** 2) / (2 * 4.0 ** 2))
    base = {"NORTH": 1.05, "NORTHEAST": 1.10, "EAST": 0.95, "CENTRAL": 1.00, "BKK": 0.90}[region]
    return float(40 * base * (main + minor) + 6)


def build():
    demand = pd.read_csv(CLEAN / "demand_daily.csv", parse_dates=["date"])
    demand = demand.sort_values(["hospital_id", "product_id", "date"]).reset_index(drop=True)
    feat = demand.groupby(["hospital_id", "product_id"], group_keys=False).apply(_add_features)
    feat["es_0.4"] = (feat.groupby(["hospital_id", "product_id"])["demand"]
                          .transform(lambda s: _exp_smoothing(s, 0.4)))
    feat = feat.dropna().reset_index(drop=True)

    # exogenous: metadata + ประชากร(proxy) + ไข้หวัดใหญ่(ฤดูกาล) + อากาศ
    feat = feat.merge(HOSP_META, on="hospital_id", how="left")
    pop = HOSP_META.assign(
        pop_total=lambda d: d.catchment_pop,
        frac_u5=lambda d: d.region.map(lambda r: AGE_FRAC[r][0]),
        frac_60p=lambda d: d.region.map(lambda r: AGE_FRAC[r][1]))
    pop["log_pop"] = np.log1p(pop["pop_total"])
    feat = feat.merge(pop[["hospital_id", "pop_total", "log_pop", "frac_u5", "frac_60p"]],
                      on="hospital_id", how="left")
    iso = feat["date"].dt.isocalendar()
    feat["ili_rate"] = [_seasonal_ili(int(w), r) for w, r in zip(iso["week"], feat["region"])]
    m = feat["date"].dt.month
    feat["rainy_season"] = m.between(5, 10).astype(int)
    feat["temp_c"] = m.map({1: 27, 2: 29, 3: 31, 4: 32, 5: 31, 6: 30, 7: 29, 8: 29, 9: 29, 10: 29, 11: 28, 12: 27})

    # reporting-bias guard
    SMALL = {"COMMUNITY", "SPECIALIZED"}
    feat["small_hosp"] = feat["hosp_type"].isin(SMALL).astype(int)
    feat["zero_demand_small"] = ((feat["demand"] == 0) & (feat["small_hosp"] == 1)).astype(int)
    feat["ili_reported"] = 1

    EXOG = ["log_pop", "frac_u5", "frac_60p", "ili_rate", "rainy_season", "temp_c",
            "small_hosp", "zero_demand_small", "ili_reported"]
    FEAT.mkdir(parents=True, exist_ok=True)
    feat.to_csv(FEAT / "demand_features.csv", index=False, encoding="utf-8-sig")
    (FEAT / "exogenous_features.txt").write_text("\n".join(EXOG), encoding="utf-8")
    print(f"[features] demand_features.csv: {len(feat)} rows · exogenous {len(EXOG)}")
    return feat
