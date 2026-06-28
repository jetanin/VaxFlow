# vaccine-engine — VacFlow computation microservice

FastAPI service (Python) ที่วาง **ข้าง ๆ** Node/Express เดิม (ไม่เขียน backend ใหม่ทั้งหมด).
Node ยังทำ auth / seed / audit / serve React ส่วน engine นี้รับผิดชอบ logic เชิงคำนวณ 3 โมดูล
ตาม Proposal §3 ที่เหมาะกับ Python (มี scipy / pulp / pandas พร้อม):

| # | โมดูล | สถานะ | ไฟล์ | endpoint |
|---|-------|-------|------|----------|
| 1 | Dynamic Expire Calculator | ✅ implemented | `modules/dynamic_expire.py` | `POST /engine/expire` |
| 2 | Predictive Matching Engine (Transportation Model / LP) | ✅ implemented | `modules/matching_engine.py` | `POST /engine/match` |
| 3 | Multi-dose Pooling System (Queue Consolidation) | ✅ implemented | `modules/pooling.py` | `POST /engine/pool` |

> ตรงตาม Proposal §3.2 — ดูบันทึกข้อคลาดเคลื่อนของ Proposal ที่ [docs/VACFLOW_PDF_REVIEW.md](../docs/VACFLOW_PDF_REVIEW.md)

## รัน

```bash
# local
pip install -r requirements.txt
uvicorn app:app --reload --port 8500

# docker (รวมในเครือข่ายเดียวกับ webapp)
docker compose up vaccine-engine
```

- Health: `GET /engine/health`
- API docs: `http://localhost:8500/docs`
- Dynamic Expire: `POST /engine/expire`

## ทดสอบ

```bash
cd vaccine-engine && pytest -q
```
