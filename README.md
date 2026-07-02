# 💉 VacFlow

> Predictive Vaccine Shared Inventory Platform
> **Logistics Innovation Hackathon 2026**

VacFlow คือต้นแบบแพลตฟอร์ม **แบ่งปันคลังวัคซีนข้ามโรงพยาบาล** ที่ลด **Vaccine Wastage Rate**
ในเครือข่ายจำลอง โดยจัดการวัคซีน (สารชีววัตถุ) ตาม **อายุขัยจริงที่ขึ้นกับสถานะจัดเก็บ**
(แช่แข็งจัด → ละลาย → เปิดขวด) ไม่ใช่แค่วันหมดอายุบนสลาก — และโอนย้ายล็อตที่กำลังจะเสื่อม
ไปยังสาขาที่ยังใช้ทัน ก่อนของจะหมดอายุทิ้ง

---

## 🎯 ปัญหาที่แก้ (Problem)

- วัคซีนมีอายุขัยสั้นและไวต่ออุณหภูมิ — เมื่อ "ละลาย" หรือ "เปิดขวด" นาฬิกานับถอยหลังเริ่มทันที (30 วัน / 6 ชม.)
- คลังแบบ aggregate รายวันติดตาม "ขวดที่เปิดแล้ว" ไม่ได้ → เกิดของหมดอายุทิ้งจำนวนมาก
- แต่ละสาขาบริหารคลังแยกกัน ทำให้ล็อตที่เหลือที่หนึ่งหมดอายุ ขณะอีกที่ขาด

## 💡 แนวคิดหลัก (Solution) — 3 โมดูลคำนวณ (เรียกใช้จริงทั้ง webapp + pipeline)

| โมดูล                             | หน้าที่                                                                                       | จุดเรียกใช้                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **1. Dynamic Expire Calculator**  | คำนวณ `effective_expiry` ใหม่ทุกครั้งที่เปลี่ยนสถานะ (overwrite วันบนสลาก)                    | `/engine/expire` · `POST /api/vials/:id/transition` |
| **2. Predictive Matching Engine** | คัดกรองล็อตเสี่ยง (≤14 วัน + บริโภคต่ำ) → Transportation Model (LP) + time-window + lead cost | `/engine/match` · `recomputeTransshipment`          |
| **3. Multi-dose Pooling System**  | รวมคิวนัดให้เต็มขวด ลดโดสค้างขวด (ทำงานบน "จำนวนคิว" ไม่แตะ PII)                              | `consolidate_queue` (pipeline/evaluate)             |

> 🔒 **PDPA by design:** เชื่อม HIS แบบ read-only ผ่าน view ที่ตัด PII (`vw_vacflow_*`) — แตะ `patient` ดิบไม่ได้ (ERROR 1142)

---

## 🏗️ สถาปัตยกรรม (Architecture)

```
┌──────────────┐  /api   ┌────────────────┐  SQL   ┌────────────┐
│ React (8090) │ ──────▶ │ Express (4000) │ ─────▶ │ PostgreSQL │
│  UI วัคซีน   │         │ auth/seed/audit│        │ (vacflow)  │
└──────────────┘         └───────┬────────┘        └────────────┘
                                 │ HTTP                  ▲
                  ┌──────────────┴───────────────┐       │ fetch (read-only view)
                  ▼                              ▼       │
   ┌──────────────────────────┐     ┌────────────────────────────┐
   │ vaccine-engine (8500)     │     │ Mock HOSxP (MySQL)          │
   │ 1 Dynamic Expire ✓        │     │ vw_vacflow_* (per-hospital) │
   │ 2 Matching (LP) ✓         │     │ vacflow_ro (SELECT view)    │
   │ 3 Pooling ✓               │     └────────────────────────────┘
   └──────────────────────────┘
   ┌──────────────────────────┐
   │ retrainer (01:00 ทุกวัน)  │ → python -m pipeline.run → POST /api/reseed
   └──────────────────────────┘
```

| ส่วน               | เทคโนโลยี                              | หน้าที่                                                                     |
| ------------------ | -------------------------------------- | --------------------------------------------------------------------------- |
| **frontend**       | React + Vite + Leaflet                 | Map · วัคซีน · วิเคราะห์(AI) · สั่งซื้อ→HOSxP · แจ้งเตือน · ยืม-คืน · Audit |
| **backend**        | Node.js + Express + pg + JWT + maxmind | REST API + seed (fetch จาก HIS) + auth + IP geolocation                     |
| **vaccine-engine** | Python + FastAPI + scipy               | 3 โมดูลคำนวณ (Proposal §3) — เรียกจริงจาก backend + pipeline                |
| **pipeline**       | Python (pipeline/)                     | features → forecast → optimize → evaluate (แทน notebook ใน prod)            |
| **retrainer**      | Python + cron loop (GPU)               | เทรน/คำนวณใหม่ทุก 01:00 แล้ว reseed                                         |
| **database**       | PostgreSQL 16 + Mock HOSxP (MySQL 8)   | คลัง/ผู้ใช้/ยืม/analytics + HIS connector                                   |

---

## 🧠 Demand Forecasting + การตัดสินใจ (ปิดวงจร ML)

- **พยากรณ์ที่ใช้จริง:** SMA (สภาวะปกติ) / Exponential Smoothing (สภาวะวิกฤต) — เลือกตามความผันผวน `CV=std/mean`
  → `forecast_daily` ต่อ (รพ.×วัคซีน) เขียนลงตาราง `demand_forecast`
  → **ขับ** การสั่งซื้อ (reorder) · แผนโอนย้าย (demand ปลายทาง) · เกณฑ์ overstock alert
- **ML benchmark:** RandomForest · XGBoost · LightGBM · Neural Network จูนด้วย **Optuna** (GPU/CUDA)
  → `model_comparison.csv` (เทียบกับ baseline SMA-7) แสดงในแท็บ 📊 วิเคราะห์ (AI)

---

## 🗃️ Data model (Postgres)

- **`vaccine_product`** — master ผลิตภัณฑ์ (mRNA / MULTI_DOSE) + อายุขัยแต่ละสถานะ + โดสต่อขวด (151 รายการจาก อย.)
- **`vaccine_vial`** — คลัง **ระดับขวด**: `state`, `state_since`, `doses_remaining`, `label_expiry`, `effective_expiry`
- **view `vaccine_vial_status`** — สัญญาณไฟ: 🔴 ≤14 วัน · 🟡 ≤21 วัน · 🟢 ปกติ (OPENED = 🔴 เสมอ, ห้ามขนส่ง)
- **`appointment_queue`** — คิวนัดแบบนับจำนวน (ไม่มี PII) สำหรับ Pooling
- **`hospital_distance`** — ระยะทาง **ตามถนนจริง** (OSRM) ระหว่าง รพ.
- **`demand_forecast`** — ผลพยากรณ์ที่ขับการตัดสินใจ
- **`order_recommendations`** — คำแนะนำสั่งซื้อ (reorder) → ออกเป็น PO command ไป HOSxP
- **`borrow_requests` / `borrow_documents` / `borrow_memo`** — คำขอยืม + ไฟล์เซ็น + ข้อมูลใบยืมที่กรอก
- **`analytics_*`** — ผลจาก pipeline (forecast / model_comparison / transshipment / wastage)

รายละเอียด: [docs/hospital_data_schema.md](docs/hospital_data_schema.md) · [docs/PROPOSAL_GAP_ANALYSIS.md](docs/PROPOSAL_GAP_ANALYSIS.md) · [docs/ARCHITECTURE_REVIEW.md](docs/ARCHITECTURE_REVIEW.md)

---

## 🚀 เริ่มต้นใช้งาน

### Fast init (Windows)

```powershell
.\init-system.ps1
```

สคริปต์นี้จะ stop stack เดิม, generate ข้อมูล, แล้ว start ทั้ง webapp stack และ mock-HIS stack ให้ครบ
ในครั้งเดียว

### 1. สร้างข้อมูลจำลอง (เครือข่ายสาธิต 13 สาขา · 151 วัคซีน)

```powershell
python scripts/generate_hospital_data.py     # -> hospital_master.csv (รพ.จริง 13 แห่ง)
python scripts/generate_vaccine_data.py       # -> vaccine_*.csv (vial-level + คิวนัด + transport_rate)
python scripts/generate_mock_his_seed.py      # -> mock-his seed (per-hospital, สำหรับ HIS connector)
python scripts/compute_road_distance.py       # -> distance_matrix.csv (OSRM ถนนจริง · fallback haversine)
```

### 2. เปิด Web App ด้วย Docker

```powershell
cd webapp
docker compose up -d --build              # core: db + mock-his + vaccine-engine + backend + frontend
docker compose --profile train up -d      # + retrainer (เทรนรายวัน 01:00, ต้องมี NVIDIA GPU ถ้าจะใช้ CUDA)
docker compose --profile debug up -d       # + adminer (จัดการ DB)
```

- Frontend: **http://localhost:8090** · (HTTPS) https://localhost:8443
- Backend API: http://localhost:4000/api/health · vaccine-engine: http://localhost:8500/docs
- Adminer (profile debug): http://localhost:8081

### 3. บัญชีผู้ใช้ (seed อัตโนมัติ · รหัส `vacflow123`)

| Username                | บทบาท               | สิทธิ์                                   |
| ----------------------- | ------------------- | ---------------------------------------- |
| `admin`                 | 🛡️ admin            | เห็นทุกโรงพยาบาล + Audit Trail + retrain |
| `HOSP_001` … `HOSP_013` | 🏥 hospital         | เห็น/จัดการเฉพาะ รพ.ตัวเอง               |
| `HOSP_001_director` …   | 🧑‍⚕️ ผอ.รพ (director) | เหมือน hospital (ขอบเขต รพ.ตัวเอง)       |

> ⚙️ secrets ตั้งใน `.env` (ดู [.env.example](.env.example)) — `JWT_SECRET` บังคับใน production · `VACFLOW_NOW` = time anchor

### 4. บัญชีฐานข้อมูล (DB Users)

| Database | User | สิทธิ์ | Password |
| --- | --- | --- | --- |
| PostgreSQL (`webapp/db`) | `vacflow` | app user สำหรับ backend + Adminer | `vacflow` |
| MySQL (`mock-his`) | `root` | full access สำหรับ init / debug ภายใน container | `rootpw` |
| MySQL (`mock-his`) | `vacflow_ro` | read-only ผ่าน view `vw_vacflow_*` | `CHANGE_ME_strong_pw` |
| MySQL (`mock-his`) | `vacflow_admin` | admin ของ mock-his · full access บน `mock_hosxp.*` | `CHANGE_ME_admin_pw` |

> ใช้ `db` เป็น host เฉพาะตอนต่อ PostgreSQL ของ webapp ใน `webapp/docker-compose.yml`
> และใช้ `mock-his` เป็น host ตอนต่อ MySQL ของ mock-his ใน `docker-compose.mock.yml`

---

## 🔄 Pipeline (pipeline-as-code) + Notebooks

**Production path** ไม่พึ่ง jupyter อีกต่อไป — retrainer รัน `python -m pipeline.run`:

```
features → forecast → optimize → evaluate   (+ train ถ้า VACFLOW_TRAIN=1)
```

| pipeline module                              | หน้าที่                                               | output                                                 |
| -------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| [pipeline/features.py](pipeline/features.py) | lag/SMA/ES + exogenous (ประชากร/ไข้หวัดใหญ่/อากาศ)    | `features/demand_features.csv`                         |
| [pipeline/forecast.py](pipeline/forecast.py) | SMA/ES + scenario(CV) + `forecast_daily`              | `forecast_model_selection.csv` · `demand_forecast.csv` |
| [pipeline/optimize.py](pipeline/optimize.py) | Transportation Model (engine LP + time-window + lead) | `transshipment_plan.csv`                               |
| [pipeline/evaluate.py](pipeline/evaluate.py) | wastage simulation + stress test (pooling จริง)       | `wastage_simulation.csv` · `stress_test.csv`           |
| [pipeline/train.py](pipeline/train.py)       | ML benchmark RF/XGB/LGB/NN + Optuna (GPU)             | `model_comparison.csv`                                 |

> `notebook/00–05` เก็บไว้สำหรับ **explore/นำเสนอ** (ลอจิกหลักย้ายมาอยู่ที่ pipeline/ + vaccine-engine แล้ว)

---

## 🔌 เชื่อมต่อ HIS จริง (Tier 2 — Read-only DB Connector)

VacFlow ต่อ HIS เดิม (เช่น **HOSxP**) แบบ **อ่านอย่างเดียว** ผ่าน user `vacflow_ro` ที่ SELECT ได้เฉพาะ
**view ที่ตัด PII** (`vw_vacflow_*`) — บังคับ Data Minimization ที่ระดับ DB (ลอง `SELECT * FROM patient` → `ERROR 1142`)
backend จะ **fetch per-hospital vials จาก HIS** มาลง Postgres (ถ้า HIS ไม่พร้อม → fallback อ่าน CSV)

ทดลองด้วย Mock HOSxP:

```powershell
docker compose -f docker-compose.mock.yml up --build
# พิสูจน์สิทธิ์: docker exec -i vacflow-mock-his mysql -uvacflow_ro -pCHANGE_ME_strong_pw mock_hosxp < mock-his/tests/test_ro_cannot_read_pii.sql
```

- บัญชี admin ของ mock-his: `vacflow_admin` / `CHANGE_ME_admin_pw`
- ใน Adminer ของ mock-his ให้ใช้ Server `mock-his` ไม่ใช่ `db`

---

## ✅ Test & CI

```powershell
cd webapp/backend && npm install && npm test     # jest: unit + integration (14)
cd vaccine-engine && pytest tests -q              # engine: 12
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)): ruff + engine pytest + backend jest + frontend build + integration (compose up → ยิง API จริง)

---

## 🗂️ โครงสร้างโปรเจกต์

```
VacFlow/
├── notebook/00–05.ipynb            # explore/นำเสนอ (ลอจิกหลักอยู่ที่ pipeline/)
├── pipeline/                       # pipeline-as-code (features/forecast/optimize/evaluate/train/run)
├── vaccine-engine/                 # FastAPI — 3 โมดูลคำนวณ + adapters/hosxp_adapter.py + tests
├── retrainer/                      # เทรนรายวัน 01:00 → pipeline.run → reseed
├── mock-his/                       # Mock HOSxP (MySQL) + test_ro_cannot_read_pii.sql
├── webapp/
│   ├── docker-compose.yml          # db + mock-his + vaccine-engine + backend + frontend (+profiles: train/debug)
│   ├── backend/  (server.js · seed.js · hisFetch.js · auth.js · __tests__/)
│   └── frontend/ (React + Vite + Leaflet)
├── scripts/                        # generate_hospital_data / generate_vaccine_data / generate_mock_his_seed / compute_road_distance
├── docs/                           # hospital_data_schema · PROPOSAL_GAP_ANALYSIS · ARCHITECTURE_REVIEW
├── .github/workflows/ci.yml
├── .env.example
└── data/                           # (gitignore) hospitals / vaccine / fda / opend
```

---

## 🛠️ Tech Stack

- **Engine/Pipeline:** Python · FastAPI · scipy (LP) · scikit-learn / XGBoost / LightGBM / Optuna (GPU)
- **Web App:** React + Vite + Leaflet · Node.js + Express · PostgreSQL · Mock HOSxP (MySQL) · Docker Compose
- **Security:** JWT + bcryptjs · role-based (admin/hospital/director) · TLS (nginx) · IP geolocation · PDPA read-only view
- **Geospatial:** OSRM (ระยะทางถนนจริง) · fallback haversine
- **Quality:** jest + supertest · pytest · GitHub Actions CI
