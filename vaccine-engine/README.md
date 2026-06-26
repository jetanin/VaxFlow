# vaccine-engine — VaxFlow computation microservice

FastAPI service (Python) ที่วาง **ข้าง ๆ** Node/Express เดิม (ไม่เขียน backend ใหม่ทั้งหมด).
Node ยังทำ auth / seed / audit / serve React ส่วน engine นี้รับผิดชอบ logic เชิงคำนวณ 3 โมดูล
ตาม Proposal §3 ที่เหมาะกับ Python (มี scipy / pulp / pandas พร้อม):

| # | โมดูล | สถานะ | ไฟล์ |
|---|-------|-------|------|
| 1 | Dynamic Expire Calculator | ✅ implemented | `modules/dynamic_expire.py` |
| 2 | Predictive Matching Engine | 🚧 Phase 3 (skeleton) | `modules/matching_engine.py` |
| 3 | Multi-dose Pooling System | 🚧 Phase 4 (skeleton) | `modules/pooling.py` |

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
