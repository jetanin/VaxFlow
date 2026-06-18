# MedCast_Secure

> ระบบพยากรณ์ความต้องการยาข้ามโรงพยาบาลแบบรักษาความเป็นส่วนตัว
> **Logistics Innovation Hackathon 2026**

MedCast_Secure คือต้นแบบระบบ AI ที่ช่วยให้ศูนย์กลางการกระจายยา (เช่น คลังยาส่วนกลาง / สปสช.) สามารถ **พยากรณ์ล่วงหน้าได้ว่ายาตัวไหนกำลังจะหมดหรือขาดแคลนที่โรงพยาบาลท้องถิ่นแห่งใด ในช่วงเวลาใด** เพื่อจัดส่งยาได้ทันเวลา โดย **ข้อมูลคนไข้/คลังยาดิบไม่เคยออกจากโรงพยาบาล** — ป้องกันข้อมูลรั่วไหลและสอดคล้องกับ PDPA

---

## 🎯 ปัญหาที่แก้ (Problem)

- โรงพยาบาลท้องถิ่นมักรู้ตัวว่า "ยาขาด" ก็ต่อเมื่อยาหมดแล้ว → จัดส่งไม่ทัน
- การส่งข้อมูลคลังยา/การใช้ยาแบบดิบไปศูนย์กลาง = เสี่ยงข้อมูลคนไข้รั่วไหล + ผิด PDPA
- ต้นทุน cloud สูงถ้าต้องรวมข้อมูลดิบทั้งหมดไว้ที่เดียว

## 💡 แนวคิดหลัก (Solution)

| ด้าน                                  | วิธีการ                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **เก็บข้อมูลอัตโนมัติ**               | AI ในโรงพยาบาลดึงข้อมูลการใช้ยาเอง — _zero manual input_                                                                |
| **เรียนรู้ร่วมกันโดยไม่ส่งข้อมูลดิบ** | **Federated Learning (FedAvg)** — ส่งแค่ _weights_ ของโมเดล ไม่ใช่ข้อมูลคนไข้                                           |
| **ลดต้นทุน cloud**                    | ประมวลผลที่ปลายทาง (edge) ออกแบบให้ _scalable_                                                                          |
| **พยากรณ์แบบเรียลไทม์**               | AI พยากรณ์ว่ายาตัวไหนจะหมด/ขาดช่วงไหน + แสดง **Confidence Score**                                                       |
| **ป้องกันข้อมูลรั่วไหล**              | **Differential Privacy** (เพิ่ม noise) + **Secure Aggregation** + **TLS/SSL** — ตัวเลขที่ถูกดักจับไปไร้ความหมายทางสถิติ |

### Pipeline แบบย่อ

```
รพ.ท้องถิ่น (edge AI)                        ศูนย์กลาง (server)
─────────────────────                       ──────────────────
ข้อมูลใช้ยา (อยู่ในรพ.)
   │ zero manual input
   ▼
feature engineering → train → weights
   │ + Differential Privacy noise
   │ + Secure Aggregation
   │ ── TLS/SSL ──────────────────────────▶  FedAvg รวม weights
                                                   │
                                                   ▼
                                        Real-time forecast + Confidence
   ◀──────── ส่ง weights กลางกลับ ◀────────────────┘
   │
   ▼
ทุก รพ. พยากรณ์ในเครื่อง → สถานะสี → จัดส่งยาเชิงรุก
```

---

## 🔄 Pipeline (Notebooks)

รันตามลำดับใน [`notebook/`](notebook/)

| Notebook                    | หน้าที่                                                           | ผลลัพธ์                                         |
| --------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| `00_load_data.ipynb`        | โหลด 4 ชุดข้อมูลจาก Kaggle + แปลงเป็น CSV                         | `data/<dataset>/`                               |
| `01_data_cleaning.ipynb`    | ทำความสะอาด (รวมคอลัมน์ซ้ำ, แปลง datetime, จัดการ null)           | `data/clean/`                                   |
| `02_eda.ipynb`              | สำรวจข้อมูล (แนวโน้ม, ฤดูกาล, ความผันผวน, correlation)            | กราฟ EDA                                        |
| `03_feature_engineer.ipynb` | สร้างฟีเจอร์: time, cyclical, วันหยุด/ฤดูกาล, lag, rolling, relational/cross-drug | `data/features/daily_features.csv` (~50 ฟีเจอร์) |
| `04_model_training.ipynb`   | จูน 3 โมเดลด้วย Optuna + **FedAvg จริงจากไฟล์แยกแต่ละ รพ.** + DP  | `models/*.joblib`, `*_results.csv`              |
| `05_model_evaluation.ipynb` | ประเมิน error ต่อกลุ่มยา, confidence, สถานะสี                     | `data/predictions/`                             |

### ผลลัพธ์โมเดล (ทดสอบจริง)

- **เลือกโมเดลด้วย Optuna** (LightGBM / XGBoost / RandomForest) → ตัวที่ดีที่สุด R² ≈ **0.75** (เอาชนะ baseline lag-1 ที่ 0.54 ชัดเจน)
- **Federated Learning:** FedAvg ให้ความแม่น **ใกล้เคียง/เท่ากับ centralized (รวมข้อมูลไว้ที่เดียว)** ทั้งที่ข้อมูลดิบไม่เคยออกจากโรงพยาบาล ✅
- **Differential Privacy:** เพิ่ม noise (σ) มากขึ้น ความแม่นค่อย ๆ ลด → เห็น trade-off ความเป็นส่วนตัว vs ความแม่นชัดเจน
- **รายวัน vs รายสัปดาห์:** Confidence รายวัน ~73–75% (เพดานที่ซื่อสัตย์ของข้อมูลรายวัน) · รายสัปดาห์ ~87% (noise หักล้างกันในก้อน 7 วัน) — เลือกมุมมองได้ในแอป (ดูคำแนะนำเรื่องการยืมยาที่ [webapp/README.md](webapp/README.md))

---

## 📊 Dashboard (Streamlit)

อยู่ใน [`dashboard/`](dashboard/) — 3 พาเนลตามโจทย์

1. **🗺️ Overview Map** — แผนที่ตำแหน่ง รพ. พร้อมสถานะตาม **จำนวนวันที่ยาเหลือในคลัง (days-of-supply)**: 🟢 ≥14 วัน (ให้ยืมได้) / 🟡 4–13 วัน / 🔴 ≤3 วัน (ขาดคลัง)
2. **🤖 AI Intelligence** — กราฟพยากรณ์ความต้องการยา + ยาคงคลัง + **Confidence Score**
3. **🔒 Privacy Control Center** — สถานะ Federated Learning / Differential Privacy / TLS + กระแสข้อมูล

> **Smart Borrowing:** รพ. สถานะ 🔴 ขอยืมยาจาก รพ. 🟢 ที่อยู่**ใกล้สุดด้วย GPS** → ออกเอกสาร "บันทึกข้อความ" พิมพ์ PDF ได้ (ในเว็บแอป)

dashboard โหลด **เฉพาะ weight กลาง** (47 ค่า) ไม่แตะข้อมูลดิบของ รพ.

---

## 🌐 Web App (Full-stack: React + Node + PostgreSQL + Docker)

นอกจาก dashboard (Streamlit) สำหรับ demo เร็ว ๆ ยังมี **เว็บแอปแบบ full-stack** ใน [`webapp/`](webapp/)
สำหรับ deploy จริง — แยก frontend / backend / database ชัดเจน รันด้วย Docker Compose คำสั่งเดียว

```
┌──────────────┐   /api   ┌───────────────┐   SQL   ┌────────────┐
│ React (8080) │ ───────▶ │ Express (4000) │ ──────▶ │ PostgreSQL │
│ nginx + Vite │          │  REST API      │         │  (medcast) │
└──────────────┘          └───────────────┘         └────────────┘
                    backend seed ข้อมูลจาก CSV (data/, models/) ลง Postgres
```

| ส่วน          | เทคโนโลยี                                | หน้าที่                                            |
| ------------- | ---------------------------------------- | ------------------------------------------------- |
| **frontend**  | React + Vite + Leaflet + Recharts        | 7 แท็บ (Map / AI / ยาทั้งหมด / แจ้งเตือน / ยืมยา / Audit / Privacy) |
| **backend**   | Node.js + Express + pg + JWT + maxmind   | REST API + seed + auth + IP geolocation           |
| **database**  | PostgreSQL 16                            | hospitals / forecasts / weights / users / borrow / audit |
| **retrainer** | Python (loop) ใน Docker                  | เทรน FedAvg+DP ใหม่ทุก 24 ชม. → reseed อัตโนมัติ   |

**ฟีเจอร์หลักของเว็บแอป (ต่อยอดจาก dashboard):**

- **🔐 Login + สิทธิ์ตาม role** — `admin` เห็นทุก รพ., `hospital` เห็นเฉพาะของตัวเอง (กรองที่ backend) + เปลี่ยน/รีเซ็ตรหัสผ่านด้วยคีย์ 4 หลักจาก admin
- **🤝 Smart Borrowing + e-Document** — รพ. 🔴 ยืมยาจาก รพ. 🟢 ใกล้สุด (GPS) → ออก "ใบยืม-คืน ยา/เวชภัณฑ์" แก้ไขได้ พิมพ์ PDF (ฟอนต์ Sarabun) + อัปโหลดเอกสารที่เซ็นกลับเข้าระบบ
- **🔔 แจ้งเตือน** — ใกล้หมดอายุ (FEFO) / ต่ำกว่าจุดสั่งซื้อ (Reorder) / ขาดแคลนด่วน
- **📜 Audit Trail** — บันทึกทุกธุรกรรม timestamp + IP + **ตำแหน่ง (เขต/จังหวัด)** แก้ย้อนหลังไม่ได้
- **📅 สลับพยากรณ์ รายวัน / รายสัปดาห์** + **Pagination** (5/10/25/50/100) + ค้นหา/กรองในหน้า Map และแจ้งเตือน
- **🔒 ความปลอดภัย** — รันทั้ง **HTTP (8080)** และ **HTTPS (8443, TLS 1.2/1.3 + HSTS)** · สถานะการเชื่อมต่ออิงการ login จริง

```powershell
# 1) เตรียมข้อมูล seed (รันครั้งเดียว หลัง pipeline)
python scripts/export_forecast_snapshot.py
python scripts/export_weights.py
# 2) build + run (ต้องเปิด Docker Desktop ก่อน)
cd webapp
docker compose up --build
```

- Frontend (HTTP): http://localhost:8080 · (HTTPS): https://localhost:8443 · API: http://localhost:4000/api/health · Adminer: http://localhost:8081
- Login เริ่มต้น: `admin` / `HOSP_001…` รหัส `medcast123`

> รายละเอียด endpoint, การเลือกพยากรณ์รายวัน/รายสัปดาห์, IP geolocation และวิธี dev แบบ local (npm) ดูที่ [webapp/README.md](webapp/README.md)

---

## 🗂️ โครงสร้างโปรเจกต์

```
MedCast_Secure/
├── notebook/                   # pipeline 00–05
├── dashboard/                  # Streamlit dashboard (demo เร็ว)
│   ├── app.py                  # UI (3 พาเนล)
│   ├── forecasting.py          # โหลด weight กลาง + build features + พยากรณ์
│   └── run.py                  # ตัวเปิด (patch บั๊ก Python 3.10rc2 — ดูหมายเหตุ)
├── webapp/                     # Full-stack web app (React + Node + Postgres + Docker)
│   ├── docker-compose.yml
│   ├── db/init.sql             # schema
│   ├── backend/                # Express + pg + seeder
│   └── frontend/               # React + Vite + Leaflet + Recharts
├── scripts/
│   ├── generate_hospital_data.py    # สร้างข้อมูลจำลอง 100 รพ. ครอบคลุม 77 จังหวัด
│   ├── retrain.py                   # FedAvg+DP retrain (รายวัน/รายสัปดาห์) + reseed
│   ├── fl_publish_spec.py           # เผยแพร่สเปกร่วม (ฟีเจอร์+scaler) -> models/fl_spec.json
│   ├── fl_client.py                 # FL client: รพ. รันเอง -> เทรน+DP -> ส่ง weight กลับ
│   ├── generate_stock_snapshot.py   # สร้างคลังยาปัจจุบัน (stock/reorder/expiry)
│   ├── export_weights.py            # export weight เป็น CSV
│   └── export_forecast_snapshot.py  # export snapshot พยากรณ์ (seed web app)
├── docs/
│   └── hospital_data_schema.md     # data dictionary: รพ. ต้องเก็บอะไรบ้าง
├── data/                       # (gitignore) clean / features / hospitals / predictions
├── models/                     # โมเดล + weight + ผลลัพธ์
├── .env                        # credential Kaggle (gitignore)
└── README.MD
```

---

## 🚀 เริ่มต้นใช้งาน

### 1. ติดตั้ง dependencies

```powershell
pip install kaggle pandas python-dotenv openpyxl json5 scikit-learn lightgbm xgboost optuna joblib matplotlib seaborn streamlit plotly
```

### 2. สร้างไฟล์ `.env` (สำหรับโหลดข้อมูล Kaggle)

สร้างไฟล์ `.env` ที่ราก (root) แล้วใส่ Kaggle credential:

```env
KAGGLE_USERNAME=your_username
KAGGLE_KEY=your_api_key
```

> **วิธีหา KAGGLE_KEY:** [kaggle.com/settings](https://www.kaggle.com/settings) → **API** → **Create New Token** (ได้ไฟล์ `kaggle.json` มี `username` และ `key`)
> ⚠️ `.env` อยู่ใน `.gitignore` แล้ว — ห้าม commit

### 3. รัน pipeline

รัน notebook `00` → `05` ตามลำดับใน [`notebook/`](notebook/)

### 4. (ตัวเลือก) สร้างข้อมูล 100 โรงพยาบาล + export weight

```powershell
python scripts/generate_hospital_data.py    # -> data/hospitals/HOSP_0XX.csv (100 รพ. / 77 จังหวัด)
python scripts/generate_stock_snapshot.py   # -> data/hospitals/stock_snapshot.csv (คลัง/reorder/expiry)
python scripts/export_weights.py             # -> models/global_weights.csv ฯลฯ
```

### 5. เปิด Dashboard

```powershell
python dashboard/run.py
```

เปิดเบราว์เซอร์ที่ http://localhost:8501 (หรือ 8502)

> ⚠️ **หมายเหตุ Python:** เครื่องพัฒนาใช้ **Python 3.10.0rc2** (release candidate) ซึ่งมีบั๊กใน `typing` ทำให้ Streamlit websocket พัง จึงต้องเปิดผ่าน `python dashboard/run.py` (patch บั๊กให้)
> ถ้าใช้ Python เวอร์ชัน **stable (3.11/3.12)** สามารถใช้ `streamlit run dashboard/app.py` ได้ตรง ๆ

### 6. (ตัวเลือก) เปิด Web App แบบ full-stack ด้วย Docker

```powershell
python scripts/export_forecast_snapshot.py   # เตรียมข้อมูล seed
cd webapp && docker compose up --build        # ต้องเปิด Docker Desktop ก่อน
```

เปิดที่ http://localhost:8080 — ดูรายละเอียดที่ [webapp/README.md](webapp/README.md)

---

## ชุดข้อมูลที่ใช้ (Kaggle)

| ชุดข้อมูล                                                                                                                              | ใช้ทำอะไร                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [pharma-sales-data](https://www.kaggle.com/datasets/milanzdravkovic/pharma-sales-data)                                                 | ยอดขาย/การใช้ยาตามเวลา (ชั่วโมง/วัน/สัปดาห์/เดือน) — **ใช้ฝึกพยากรณ์** |
| [inventory-data-for-pharmacy](https://www.kaggle.com/datasets/pritipoddar/inventory-data-for-pharmacy-website-in-json-format)          | คลังยา (ชื่อยา, ผู้ผลิต, วันหมดอายุ, จำนวนคงเหลือ)                     |
| [pharmaceutical-supply-chain-optimization](https://www.kaggle.com/datasets/mohammedashraf000/pharmaceutical-supply-chain-optimization) | ข้อมูล supply chain การกระจายยา                                        |
| [pharmacy-products-dataset](https://www.kaggle.com/datasets/hossam82/pharmacy-products-dataset)                                        | รายการสินค้า/ยา                                                        |

> รายละเอียดข้อมูลที่โรงพยาบาลต้องเก็บจริง ดูที่ [docs/hospital_data_schema.md](docs/hospital_data_schema.md)

---

## 🛠️ เทคโนโลยี (Tech Stack)

- **AI / ML:** Python, pandas, scikit-learn, LightGBM, XGBoost, Optuna (hyperparameter tuning)
- **Federated Learning:** FedAvg (เฉลี่ย weight ถ่วงน้ำหนักตามจำนวนตัวอย่าง)
- **Privacy & Security:** Differential Privacy (Gaussian noise), Secure Aggregation, TLS/SSL
- **Dashboard:** Streamlit + Plotly (แผนที่ + กราฟ + privacy panel)
- **Web App:** React + Vite + Leaflet + Recharts (frontend) · Node.js + Express (backend) · PostgreSQL · Docker Compose
- **Auth & Security:** JWT (jsonwebtoken) + bcryptjs · role-based access · TLS/SSL (nginx, HTTP+HTTPS) · IP geolocation (MaxMind GeoLite2 / ip-api) สำหรับ Audit Trail
