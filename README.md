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

## 💡 แนวคิดหลัก (Solution) — 3 โมดูลคำนวณ

| โมดูล | หน้าที่ |
| ----- | ------- |
| **1. Dynamic Expire Calculator** | State machine ของวัคซีน — คำนวณ `effective_expiry` ใหม่ทุกครั้งที่เปลี่ยนสถานะจัดเก็บ (overwrite วันบนสลาก) |
| **2. Predictive Matching Engine** | จับคู่โอนย้ายล็อตที่ใกล้เสื่อมไปสาขาดีมานด์สูงด้วย Transportation Model — ห้ามขนส่งขวดที่เปิดแล้ว |
| **3. Multi-dose Pooling System** | รวมคิวนัด + Dynamic Queue Pulling เพื่อเคลียร์โดสค้างขวด (ทำงานบน "จำนวนคิว" เท่านั้น — ไม่แตะ PII) |

> 🔒 **PDPA by design:** engine กลางทำงานบน **จำนวน (counts) + สถานะอายุขัย** เท่านั้น —
> ข้อมูลนัดคนไข้ (เบอร์/ชื่อ) ไม่ออกนอกระบบโรงพยาบาล การยิง SMS เกิดภายในสาขา

---

## 🏗️ สถาปัตยกรรม (Architecture)

```
┌──────────────┐  /api   ┌────────────────┐  SQL   ┌────────────┐
│ React (8080) │ ──────▶ │ Express (4000) │ ─────▶ │ PostgreSQL │
│  UI วัคซีน   │         │ auth/seed/audit│        │ (vacflow)  │
└──────────────┘         └────────────────┘        └────────────┘
                                                        │
┌────────────────────────────────────────────┐         │
│  vaccine-engine/ (FastAPI · Python · :8500)  │◀────────┘
│  ├─ 1. Dynamic Expire Calculator  (พร้อม)    │
│  ├─ 2. Predictive Matching Engine (skeleton) │
│  └─ 3. Multi-dose Pooling System  (skeleton) │
└──────────────────────────────────────────────┘
```

3 โมดูลเป็น logic เชิงคำนวณ (state machine / optimization / pooling) จึงแยกเป็น
**FastAPI microservice (`vaccine-engine/`)** วางข้าง ๆ Node เดิมที่ทำ auth / seed / audit / serve React.

| ส่วน | เทคโนโลยี | หน้าที่ |
| ---- | --------- | ------- |
| **frontend** | React + Vite + Leaflet | Map / วัคซีนทั้งหมด / แจ้งเตือน / ยืมวัคซีน / Audit |
| **backend** | Node.js + Express + pg + JWT + maxmind | REST API + seed + auth + IP geolocation |
| **vaccine-engine** | Python + FastAPI + (scipy/pulp) | 3 โมดูลคำนวณตาม Proposal §3 |
| **database** | PostgreSQL 16 | hospitals / vaccine_product / vaccine_vial / appointment_queue / users / borrow / audit |

---

## 🗃️ Data model (โดเมนวัคซีน)

- **`vaccine_product`** — master ผลิตภัณฑ์ (mRNA / MULTI_DOSE) + อายุขัยแต่ละสถานะ + โดสต่อขวด
- **`vaccine_vial`** — คลัง **ระดับขวด** : `state` (DEEP_FROZEN/THAWED/OPENED), `state_since`, `doses_remaining`, `label_expiry`, `effective_expiry`
- **`appointment_queue`** — คิวนัดแบบ **นับจำนวน** (ไม่มี PII) สำหรับ Pooling
- **view `vaccine_vial_status`** — สัญญาณไฟตามอายุที่เหลือ: 🔴 ≤14 วัน · 🟡 ≤21 วัน · 🟢 ปกติ (ขวด OPENED = 🔴 เสมอ และห้ามขนส่ง)

รายละเอียด data dictionary: [docs/hospital_data_schema.md](docs/hospital_data_schema.md)

---

## 🔄 Workflow (ภาพรวมการทำงานตั้งแต่ต้นจนจบ)

```
 ┌─────────────────── Data Science Pipeline (notebook/) ───────────────────┐
 │                                                                          │
 │  generate_hospital_data.py ─┐                                            │
 │  generate_vaccine_data.py ──┴─▶ data/vaccine/*.csv                       │
 │                                   │                                      │
 │   01 ─▶ 02 ─▶ 03 ─▶ 04 ─▶ 05      │ (clean ▸ EDA ▸ features ▸ train ▸ eval)│
 │   │     │     │     │     └─ wastage simulation → KPI ≥ 30%               │
 │   │     │     │     └─ SMA / Exponential Smoothing + Transportation Model │
 │   │     │     └─ lag / rolling (SMA) / ES features                        │
 │   │     └─ EDA: trend / seasonality / shelf-life status                   │
 │   └─ clean + สังเคราะห์ดีมานด์ (Stochastic Demand)                        │
 └──────────────────────────────────────────────────────────────────────────┘
                                   │  data/vaccine/*.csv (seed)
                                   ▼
 ┌─────────────────────────── Runtime (webapp/) ───────────────────────────┐
 │  docker compose up  →  Postgres (init.sql)  ◀── seed.js (โหลด CSV)        │
 │       React (8080) ──/api──▶ Express (4000) ──SQL──▶ Postgres            │
 │                                  └──▶ vaccine-engine (8500): 3 โมดูล      │
 │  ผู้ใช้ login → ดู Map/วัคซีน/แจ้งเตือน → ยืม-คืนวัคซีน → Audit            │
 └──────────────────────────────────────────────────────────────────────────┘
```

### A) Pipeline ใน `notebook/` (รันตามลำดับ 00 → 05)

| Notebook | หน้าที่ | ผลลัพธ์ |
| -------- | ------- | ------- |
| `00_load_data.ipynb` | โหลดข้อมูลวัคซีนจริง (OpenD / FDA) + แปลงเป็น CSV | `data/{opend,fda}/` |
| `01_data_cleaning.ipynb` | ตรวจความถูกต้องระดับขวด + สังเคราะห์ **ดีมานด์เชิงสุ่ม** (180 วัน) | `data/vaccine/clean/` |
| `02_eda_visualization.ipynb` | สำรวจแนวโน้ม / ฤดูกาล / สถานะอายุขัย | กราฟ EDA |
| `03_feature_engineering.ipynb` | lag / rolling (**SMA**) / **Exponential Smoothing** | `data/vaccine/features/` |
| `04_model_training.ipynb` | SMA/ES + **เทียบ RF · XGBoost · LightGBM · NN จูนด้วย Optuna** + **Transportation Model** (LP) | `data/vaccine/outputs/` |
| `05_model_evaluation.ipynb` | MAE/RMSE/MAPE + **wastage simulation** (KPI ≥ 30%) | `wastage_simulation.csv` |

### B) ลำดับการรันจริง (End-to-End)

```powershell
# 1) สร้างข้อมูลจำลอง
python scripts/generate_hospital_data.py
python scripts/generate_vaccine_data.py

# 2) (ตัวเลือก) รัน pipeline วิเคราะห์/พิสูจน์ KPI  — notebook 00 → 05

# 3) เปิดระบบ
cd webapp && docker compose up --build

# 4) login: admin / vacflow123  หรือ  HOSP_001 / vacflow123
```

### C) Workflow การใช้งานในแอป (per role)

- **Hospital** 🏥 : ดูคลังวัคซีนของตน → ขวด 🔴 ใกล้หมดอายุ → **ขอยืม** จากสาขา 🟢 ใกล้สุด → ออก/อัปโหลดใบยืม-คืน
- **Lender** 🤝 : รับคำขอ → **อนุมัติ/ปฏิเสธ** (ห้ามยืมขวดที่เปิดแล้ว — OPENED)
- **Admin** 🛡️ : ดูภาพรวมทุกสาขาบนแผนที่ + ตรวจ **Audit Trail** (ทุกธุรกรรม timestamp + IP)

### D) เชื่อมต่อ HIS จริงของโรงพยาบาล (Tier 2 — Read-only DB Connector)

VacFlow ต่อ HIS เดิม (เช่น **HOSxP**) แบบ **อ่านอย่างเดียว** ผ่าน user `vacflow_ro` ที่มีสิทธิ์
`SELECT` เฉพาะ **view ที่ตัด PII แล้ว** (`vw_vacflow_*`) — บังคับ Data Minimization ที่ระดับ DB
ไม่ใช่แค่สัญญาในโค้ด (ลอง `SELECT * FROM patient` จะโดน `ERROR 1142` ทันที)

```
┌──────────── โรงพยาบาล (on-prem) ────────────┐
│  HIS เดิม (HOSxP / MySQL)                     │
│   ├ patient · opitemrece (PII)   ✗ เข้าไม่ถึง │
│   └ vw_vacflow_* (aggregate)     ✓ เข้าได้    │
│              │ vacflow_ro (SELECT view เท่านั้น)│
│              ▼                                │
│   VacFlow Edge Agent (FastAPI)                │
│   adapters/hosxp_adapter.py → map TMT→product │
│   → Dynamic Expire → ส่งเฉพาะ "ยอดรวม/สถานะ"  │
└──────────────────────────────────────────────┘
```

ทดลองได้จริงในเครื่องเดียวด้วย **Mock HOSxP** (`mock-his/`):

```powershell
docker compose -f docker-compose.mock.yml up --build
# Adminer: http://localhost:8081  (login เป็น vacflow_ro แล้วลองยิง PII ดูว่าโดนบล็อก)
# พิสูจน์สิทธิ์: mysql -h 127.0.0.1 -u vacflow_ro -p mock_hosxp < mock-his/tests/test_ro_cannot_read_pii.sql
```

> รายละเอียด Tier 1/2/3 + adapter pattern ดูใน Integration Plan

> ⚠️ เปลี่ยน credential ฐานข้อมูล (medcast → vacflow) แล้ว — ถ้าเคยรันมาก่อนต้องล้าง volume เดิม:
> `cd webapp && docker compose down -v && docker compose up --build`

---

## 🚀 เริ่มต้นใช้งาน

### 1. สร้างข้อมูลจำลอง (เครือข่ายสาธิต 13 สาขา)

```powershell
python scripts/generate_hospital_data.py    # -> data/hospitals/hospital_master.csv (รพ.ตัวอย่างจริง 13 แห่ง)
python scripts/generate_vaccine_data.py      # -> data/vaccine/*.csv (vial-level + คิวนัด + transport_rate)
```

### 2. เปิด Web App ด้วย Docker

```powershell
cd webapp
docker compose up --build      # ต้องเปิด Docker Desktop ก่อน
```

- Frontend (HTTP): http://localhost:8080 · (HTTPS): https://localhost:8443
- Backend API: http://localhost:4000/api/health · Adminer: http://localhost:8081
- vaccine-engine: http://localhost:8500/docs
- Login เริ่มต้น: `admin` / `HOSP_001…` รหัส `vacflow123`

> รายละเอียด endpoint และ dev แบบ local (npm) ดูที่ [webapp/README.md](webapp/README.md)

### 3. (ตัวเลือก) รัน vaccine-engine แยก

```powershell
cd vaccine-engine
pip install -r requirements.txt
uvicorn app:app --reload --port 8500
pytest -q                       # ทดสอบ Dynamic Expire Calculator
```

---

## 🗂️ โครงสร้างโปรเจกต์

```
VacFlow/
├── notebook/
│   └── 00_load_data.ipynb          # โหลดข้อมูลวัคซีน (OpenD / FDA) + แปลงเป็น CSV
├── vaccine-engine/                 # FastAPI microservice (3 โมดูลคำนวณ)
│   ├── app.py
│   ├── modules/{dynamic_expire,matching_engine,pooling}.py
│   ├── adapters/hosxp_adapter.py   # Tier 2: อ่าน view HOSxP (read-only, ไม่มี PII)
│   └── tests/
├── mock-his/                       # Mock HOSxP (MySQL) สำหรับทดสอบ Tier 2 connector
│   ├── init/{01_schema,02_seed,03_views_grants}.sql
│   └── tests/test_ro_cannot_read_pii.sql
├── docker-compose.mock.yml         # mock-his + vacflow-edge + adminer
├── webapp/                         # Full-stack (React + Node + Postgres + Docker)
│   ├── docker-compose.yml
│   ├── db/init.sql                 # schema + vaccine_vial_status view
│   ├── backend/                    # Express + pg + seeder
│   └── frontend/                   # React + Vite + Leaflet
├── scripts/
│   ├── generate_hospital_data.py   # ทะเบียน รพ. (hospital_master.csv)
│   └── generate_vaccine_data.py    # vial-level inventory + คิวนัด
├── docs/hospital_data_schema.md
├── data/                           # (gitignore) hospitals / vaccine / opend / fda
└── README.MD
```

---

## 🛠️ เทคโนโลยี (Tech Stack)

- **Engine:** Python + FastAPI · state machine · (scipy / pulp สำหรับ Transportation Model)
- **Web App:** React + Vite + Leaflet (frontend) · Node.js + Express (backend) · PostgreSQL · Docker Compose
- **Auth & Security:** JWT + bcryptjs · role-based access · TLS/SSL (nginx, HTTP+HTTPS) · IP geolocation (MaxMind GeoLite2 / ip-api) สำหรับ Audit Trail
