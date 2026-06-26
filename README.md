# 💉 VaxFlow

> Predictive Vaccine Shared Inventory Platform
> **Logistics Innovation Hackathon 2026**

VaxFlow คือต้นแบบแพลตฟอร์ม **แบ่งปันคลังวัคซีนข้ามโรงพยาบาล** ที่ลด **Vaccine Wastage Rate**
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
│  UI วัคซีน   │         │ auth/seed/audit│        │ (medcast)  │
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

## 🚀 เริ่มต้นใช้งาน

### 1. สร้างข้อมูลจำลอง (เครือข่ายสาธิต 3–5 สาขา)

```powershell
python scripts/generate_hospital_data.py    # -> data/hospitals/hospital_master.csv (100 รพ. / 77 จังหวัด)
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
- Login เริ่มต้น: `admin` / `HOSP_001…` รหัส `medcast123`

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
VaxFlow/
├── notebook/
│   └── 00_load_data.ipynb          # โหลดข้อมูลวัคซีน (OpenD / FDA) + แปลงเป็น CSV
├── vaccine-engine/                 # FastAPI microservice (3 โมดูลคำนวณ)
│   ├── app.py
│   ├── modules/{dynamic_expire,matching_engine,pooling}.py
│   └── tests/
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
