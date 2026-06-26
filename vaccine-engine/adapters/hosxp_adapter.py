"""HOSxP adapter (Tier 2 — Read-only DB Connector)

อ่านจาก **view ที่ตัด PII แล้ว** ของ Mock HOSxP (MySQL) ผ่าน user `vaxflow_ro`
ที่มีสิทธิ์ SELECT เฉพาะ `vw_vaxflow_*` เท่านั้น — แตะ `patient`/`opitemrece` ดิบไม่ได้

output ของ view ออกแบบให้ตรงกับ canonical schema เดิม (`docs/hospital_data_schema.md`)
→ Mapper เหลือแค่ map `tmt_code -> product_id`
"""
import os

import pymysql


def get_conn():
    return pymysql.connect(
        host=os.environ["HIS_DB_HOST"],
        port=int(os.environ.get("HIS_DB_PORT", 3306)),
        user=os.environ["HIS_DB_USER"],
        password=os.environ["HIS_DB_PASS"],
        database=os.environ["HIS_DB_NAME"],
        cursorclass=pymysql.cursors.DictCursor,
    )


def fetch_drug_usage(since: str):
    """usage รายวันต่อรหัสยา (ไม่มี PII) — ตรงกับ schema `drug_usage`."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT usage_date, drug_code, qty_dispensed "
            "FROM vw_vaxflow_drug_usage WHERE usage_date >= %s "
            "ORDER BY usage_date, drug_code",
            (since,),
        )
        return cur.fetchall()


def fetch_inventory(snapshot_date: str | None = None):
    """สถานะคลังระดับ lot (ไม่มี PII) — ป้อน Dynamic Expire."""
    sql = ("SELECT snapshot_date, drug_code, warehouse, lot_no, stock_on_hand, expire_date "
           "FROM vw_vaxflow_inventory")
    params = ()
    if snapshot_date:
        sql += " WHERE snapshot_date = %s"
        params = (snapshot_date,)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def fetch_drug_master():
    """master ยา/วัคซีน + รหัสกลาง TMT (สำหรับ map tmt_code -> product_id)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT drug_code, name, units, tmt_code, is_vaccine "
            "FROM vw_vaxflow_drug_master"
        )
        return cur.fetchall()


if __name__ == "__main__":  # smoke test: python -m adapters.hosxp_adapter
    print("drug_master:", fetch_drug_master())
    print("inventory:", fetch_inventory()[:3])
    print("usage(7d):", fetch_drug_usage("2000-01-01")[:3])
