"""สร้าง distance_matrix.csv — ระยะทาง "ตามถนนจริง" ระหว่างโรงพยาบาล (13 แห่ง)

ใช้ OSRM Table service (public) คำนวณระยะทางขับรถจริงทุกคู่ในครั้งเดียว
ถ้าต่อ OSRM ไม่ได้ → fallback เป็น haversine × 1.3 (circuity factor โดยประมาณ)

ผลลัพธ์: data/hospitals/distance_matrix.csv (from_hospital, to_hospital, distance_km)
"""
import json
import urllib.request
from math import acos, cos, radians, sin
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "data" / "hospitals" / "hospital_master.csv"
OUT = ROOT / "data" / "hospitals" / "distance_matrix.csv"
OSRM = "https://router.project-osrm.org/table/v1/driving/"
CIRCUITY = 1.3   # เส้นตรง -> ถนนจริงโดยประมาณ (เผื่ออ้อม) เมื่อ OSRM ใช้ไม่ได้


def haversine_km(a, b):
    la1, lo1, la2, lo2 = map(radians, [a[0], a[1], b[0], b[1]])
    return 6371 * acos(min(1, max(-1,
        sin(la1) * sin(la2) + cos(la1) * cos(la2) * cos(lo2 - lo1))))


def osrm_matrix(coords):
    """คืน distance matrix (กม.) จาก OSRM — None ถ้าใช้ไม่ได้. coords = [(lat,lon),...]"""
    pts = ";".join(f"{lon},{lat}" for lat, lon in coords)   # OSRM = lon,lat
    url = f"{OSRM}{pts}?annotations=distance"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            d = json.load(r)
        if d.get("code") != "Ok":
            print("[osrm] code:", d.get("code"), "-> fallback")
            return None
        # meters -> km
        return [[(v / 1000.0 if v is not None else None) for v in row] for row in d["distances"]]
    except Exception as e:  # noqa: BLE001
        print("[osrm] ใช้ไม่ได้:", e, "-> fallback haversine x", CIRCUITY)
        return None


def main():
    hs = pd.read_csv(MASTER, encoding="utf-8-sig")
    ids = hs["hospital_id"].tolist()
    coords = list(zip(hs["latitude"], hs["longitude"]))

    mat = osrm_matrix(coords)
    source = "OSRM (ถนนจริง)"
    if mat is None:
        mat = [[haversine_km(a, b) * CIRCUITY for b in coords] for a in coords]
        source = f"haversine x {CIRCUITY}"

    rows = []
    for i, fr in enumerate(ids):
        for j, to in enumerate(ids):
            if i == j:
                continue
            km = mat[i][j]
            if km is None:   # OSRM หาเส้นทางคู่นี้ไม่ได้ -> เติม haversine
                km = haversine_km(coords[i], coords[j]) * CIRCUITY
            rows.append({"from_hospital": fr, "to_hospital": to, "distance_km": round(km, 1)})

    pd.DataFrame(rows).to_csv(OUT, index=False, encoding="utf-8-sig")
    print(f"[saved] distance_matrix.csv: {len(rows)} คู่ · แหล่ง: {source}")


if __name__ == "__main__":
    main()
