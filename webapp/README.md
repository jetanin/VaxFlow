# MedCast_Secure — Web App

Full-stack web app: **React (frontend) + Node/Express (backend) + PostgreSQL** ทั้งหมดรันด้วย **Docker Compose**

```
┌─────────────┐   /api    ┌──────────────┐   SQL   ┌────────────┐
│  React (8080)│ ───────▶ │ Express (4000)│ ──────▶ │ Postgres   │
│  nginx       │          │  REST API     │         │ (medcast)  │
└─────────────┘           └──────────────┘         └────────────┘
        ▲ seed จาก CSV (../data, ../models)
```

## ก่อนรัน — เตรียมข้อมูล seed
จากโฟลเดอร์ราก โปรเจกต์ (รัน notebook 00–05 + scripts มาก่อน):

```powershell
python scripts/generate_stock_snapshot.py     # -> data/hospitals/stock_snapshot.csv (คลังยา)
python scripts/export_forecast_snapshot.py    # -> data/predictions/forecast_snapshot.csv
python scripts/export_weights.py              # -> models/global_weights.csv
```

backend จะ seed จากไฟล์เหล่านี้ + `data/hospitals/hospital_master.csv` อัตโนมัติตอนเริ่ม

## รันด้วย Docker

```powershell
cd webapp
docker compose up --build
```

- **Frontend (HTTP):** http://localhost:8080
- **Frontend (HTTPS):** https://localhost:8443 (self-signed — กด Advanced → Proceed)
- **Backend API:** http://localhost:4000/api/health
- **Adminer (จัดการ DB):** http://localhost:8081 — System `PostgreSQL` · Server `db` · user/pass/db = `medcast`
- **Postgres:** localhost:5432 (user/pass/db = `medcast`)

> **เปิดผ่าน tunnel ฟรี (HTTP):** port 80 เสิร์ฟแอปเต็ม ไม่ redirect → ชี้ tunnel ไปที่ `8080` ได้เลย
> เช่น `ngrok http 8080` หรือ `cloudflared tunnel --url http://localhost:8080`

ปิด: `docker compose down`  ·  ล้างข้อมูล DB ด้วย: `docker compose down -v`

## 🔑 บัญชีเข้าสู่ระบบ (Login)

seed อัตโนมัติ (รหัสผ่านเดียวกันทุกบัญชี):

| Username | Role | สิทธิ์ | Password |
| --- | --- | --- | --- |
| `admin` | 🛡️ admin | เห็นพยากรณ์/คลังยา **ทุกโรงพยาบาล** | `medcast123` |
| `HOSP_001` … `HOSP_100` | 🏥 hospital | เห็นเฉพาะ **ของตัวเอง** + ยืมยาได้ | `medcast123` |

- **admin** ดูภาพรวมทุก รพ. (Map/AI/ยาทั้งหมด/Audit) แต่ไม่ทำรายการยืม-คืน
- **hospital** ข้อมูลถูกกรองที่ backend (`scopedHospital`) — เห็นได้แค่ รพ. ตัวเองเท่านั้น

> เปลี่ยนรหัสตั้งต้นด้วย env `DEFAULT_PASSWORD` · เปลี่ยน JWT secret ด้วย `JWT_SECRET`

## 📅 ควรเลือกพยากรณ์ "รายวัน" หรือ "รายสัปดาห์" สำหรับการยืมยา?

> **สรุป: ใช้ "รายวัน (Daily)" เป็นตัวตัดสินใจยืมยา** — เพราะการยืมเป็นการตัดสินใจเร่งด่วนระยะสั้น
> ส่วน "รายสัปดาห์ (Weekly)" เหมาะกับการ**วางแผนจัดซื้อ/ตั้งจุดสั่งซื้อ** มากกว่า

เหตุผล (อิงตาม logic จริงในระบบ):

| ประเด็น | 🗓️ รายวัน (Daily) | 📆 รายสัปดาห์ (Weekly) |
| --- | --- | --- |
| **ความเหมาะกับการยืม** | ✅ ใช่ — trigger สถานะ 🔴 = days-of-supply **≤ 3 วัน** เป็นสเกล "วัน" โดยตรง | ⚠️ หยาบไป — แยกไม่ออกว่าจะหมดใน 3 วันหรือ 6 วัน |
| **จับ spike คนไข้พุ่งฉับพลัน** | ✅ ตอบสนองไว เห็นภายในวันเดียว | ❌ ถูกเฉลี่ยกลบในก้อนรายสัปดาห์ → รู้ช้า |
| **ตัวเลข Confidence** | ~73–75% (เพดานที่ "ซื่อสัตย์" ของข้อมูลรายวัน) | ~87% (สูงกว่า) |
| **Confidence สูงกว่าหมายความว่าแม่นกว่าสำหรับการยืมไหม?** | — | ❌ **ไม่** — มันวัดความแม่นของ "ยอดรวมทั้งสัปดาห์" ไม่ใช่ "จะหมดใน 3 วันข้างหน้าหรือไม่" |

- **อย่าเลือกรายสัปดาห์เพราะเลข confidence สูงกว่า** — ตัวเลขนั้นมาจากการรวมก้อน 7 วันให้ noise หักล้างกัน
  ซึ่งทำให้แม่นเรื่อง "ปริมาณรวม" แต่**สูญเสียความละเอียดเรื่องจังหวะเวลา** ที่จำเป็นต่อการยืมเร่งด่วน
- **แนวทางที่ดีที่สุด:** ใช้ **รายวัน** เป็นตัวจุดสัญญาณยืม (สถานะ 🔴 / days-of-supply / FEFO) →
  แล้วคำนวณ **จำนวนที่ขอยืม** ให้พอถึงรอบเติมถัดไป โดยอ้างอิงอัตราใช้เฉลี่ยที่นิ่งกว่า (เทียบกับมุมมองรายสัปดาห์ได้)
- สลับมุมมองได้ที่ปุ่ม **รายวัน / รายสัปดาห์** มุมขวาบน (ค่าถูกกรองที่ backend ด้วย `freq`)

## 🤝 ยืมยา (Borrow)

โรงพยาบาลที่ล็อกอินแล้ว ไปแท็บ **🤝 ยืมยา**:
- ระบบให้ยืมได้ **เฉพาะยาที่สถานะ 🔴 ขาดแคลน** (เหลือ ≤3 วัน) ของโรงพยาบาลนั้น (backend บังคับ)
- ผู้ให้ยืมต้องเป็น **🟢 (เหลือ ≥14 วัน)** — ระบบเรียงตาม **ระยะทาง GPS ใกล้สุด** (Smart Borrowing)
- เลือกผู้ให้ยืม → กรอกจำนวน/เหตุผล → ส่งคำขอ
- โรงพยาบาลผู้ให้ยืมเห็นคำขอ "📥 ถูกขอ" แล้วกด **อนุมัติ/ปฏิเสธ** ได้
- ปุ่ม **📄 เอกสาร** ในแต่ละคำขอ → เปิด **"ใบยืม-คืน ยา/เวชภัณฑ์"** ตามแบบฟอร์มราชการ
  (เติมข้อมูลอัตโนมัติรวมถึง **หมายเหตุ** จากเหตุผลที่กรอกตอนยืม + แก้ไขในช่องได้ · ฟอนต์ Sarabun · วันที่=ปฏิทิน เวลา=24 ชม.)
  แล้วกด **🖨️ พิมพ์ / บันทึก PDF** (ใช้ระบบพิมพ์ของเบราว์เซอร์ → "Save as PDF")
- ปุ่ม **⬆️ อัปโหลดเอกสารที่เซ็นแล้ว** → แนบไฟล์ที่เซ็นกลับเข้าระบบ + **📎 ดูเอกสารที่เซ็น** (preview รูป/PDF)
- ปุ่ม **📜 ระเบียบปฏิบัติ** → เปิดระเบียบการยืม-คืน ก่อนทำรายการ

## 🔄 Retrain อัตโนมัติรายวัน

service **`retrainer`** (Python) ใน docker-compose จะทำงานทันทีตอนเริ่ม แล้ว**ซ้ำทุก 24 ชม.**:

```
ทุกวัน → scripts/retrain.py
   1) build features จากข้อมูลล่าสุดทุก รพ.
   2) เทรน local SGD แต่ละ รพ. + DP noise → FedAvg → weight กลางใหม่
   3) บันทึก models/fedavg_dp_demand.joblib + global_weights.csv
   4) คำนวณ forecast_snapshot.csv ใหม่ (ใช้ stock ปัจจุบัน)
   5) POST /api/reseed → backend โหลดเข้า Postgres → dashboard เห็นค่าใหม่
```

> นอกจากนี้ **ทุกครั้งที่อนุมัติคำขอยืมยา** ระบบจะโอนสต็อก + คำนวณ days-of-supply/สถานะใหม่ทันที (real-time)
> รันมือได้ด้วย `python scripts/retrain.py` · ปรับ noise ด้วย env `DP_SIGMA` · เปลี่ยน `RESEED_TOKEN` ใน production

## 📡 Federated Learning จริง — แต่ละ รพ. ส่ง weight กลับเอง

นอกจาก `retrain.py` (จำลอง FedAvg จากไฟล์ทุก รพ. ที่ศูนย์กลาง) ยังมี **FL client** ที่ออกแบบให้
**แต่ละโรงพยาบาลรันในเครื่องตัวเอง** — ข้อมูลดิบไม่ออกจาก รพ. ส่งกลับมาแค่ weight ที่ใส่ DP noise แล้ว

```powershell
# (ศูนย์กลาง) เผยแพร่ "สเปกร่วม" ครั้งเดียว — ฟีเจอร์ + ค่า scaler ที่ทุก รพ. ใช้ร่วมกัน
python scripts/fl_publish_spec.py            # -> models/fl_spec.json (backend แจกผ่าน GET /api/fl/spec)

# (ที่โรงพยาบาล) แต่ละ รพ. รันเพื่อเทรน local + ส่ง weight กลับ
python scripts/fl_client.py --hospital HOSP_001 --server http://localhost:4000 --token medcast-reseed
python scripts/fl_client.py --hospital HOSP_002 --server http://localhost:4000 --token medcast-reseed
#   ... (ทุก รพ.) ...

# (ศูนย์กลาง) รวม weight ทุก รพ. ด้วย FedAvg -> เขียน weight กลางใหม่ลงตาราง weights
curl -X POST http://localhost:4000/api/fl/aggregate -H "X-FL-Token: medcast-reseed" `
     -H "Content-Type: application/json" -d '{"freq":"daily"}'
```

ขั้นตอนใน `fl_client.py`: อ่าน CSV ในเครื่อง → ขอสเปกจากศูนย์กลาง → สร้างฟีเจอร์ + สเกลด้วยค่ากลาง →
เทรน `SGDRegressor` → **ใส่ Gaussian noise (DP) บน weight** → POST เฉพาะ `coef`/`intercept` กลับ (ไม่มีข้อมูลคนไข้)

> token: ตั้ง env `FL_TOKEN` ของ backend (ถ้าไม่ตั้งจะ fallback เป็น `RESEED_TOKEN`) · ปรับ noise ด้วย `--dp-sigma`
> เก็บ weight ล่าสุด 1 แถวต่อ (รพ., freq) ในตาราง `fl_contributions` — ตรวจสอบความโปร่งใสได้ใน Audit Trail (`fl_submit`/`fl_aggregate`)

## 🌍 IP Geolocation ใน Audit Trail (Hybrid)

ตั้งค่าด้วย env `IP_GEO` ของ backend:

| ค่า | โหมด | ความละเอียด | ความเป็นส่วนตัว |
| --- | --- | --- | --- |
| `maxmind` (default) | **offline** (ไฟล์ `.mmdb`) | เมือง/จังหวัด | ✅ ข้อมูลไม่ออกจากระบบ (เหมาะ PDPA) |
| `ipapi` | online (ip-api.com) | **เขต/อำเภอ** เช่น "Bang Khae, Bangkok" | ⚠️ ส่ง IP ออกภายนอก |

- โหมด `maxmind` ต้องวางไฟล์ `GeoLite2-City.mmdb` ที่ `webapp/geoip/` — ดู [geoip/README.md](geoip/README.md)
- IP ภายใน (LAN) แสดง "เครือข่ายภายใน (LAN)" เสมอ · ถ้าไม่มี DB → "ไม่ทราบตำแหน่ง (ไม่มี GeoLite2 DB)"

## REST API

| Endpoint | Auth | คืนค่า |
| --- | :---: | --- |
| `GET /api/health` | | สถานะ + การเชื่อม DB |
| `GET /api/summary` | ✅ | KPI (scoped ตาม role) |
| `GET /api/hospitals` | ✅ | รายชื่อ รพ. + พิกัด + สถานะรวม (scoped ตาม role) |
| `GET /api/forecasts?status=` | ✅ | พยากรณ์รายยา (hospital เห็นแค่ของตัวเอง) |
| `GET /api/drugs` | ✅ | คลังยาทั้งหมดในระบบ (รวมต่อกลุ่มยา, scoped ตาม role) |
| `GET /api/privacy` | | สถานะ FL / DP / TLS / weight |
| `GET /api/weights` | | weight กลาง |
| `POST /api/login` | | `{username,password}` → JWT token |
| `POST /api/logout` | ✅ | ออกจากระบบ → ล้าง `last_seen` (offline ทันที) + audit |
| `POST /api/heartbeat` | ✅ | คง online ระหว่างเปิดแท็บ (frontend เรียกทุก 45 วิ) |
| `POST /api/offline` | ✅ | beacon ตอนปิดแท็บ → offline ทันที |
| `GET /api/me` | ✅ | ข้อมูลผู้ใช้ปัจจุบัน |
| `GET /api/lenders?drug=` | ✅ | รพ. ที่ให้ยืมยานั้นได้ (ไม่แดง) |
| `POST /api/borrow` | ✅ | สร้างคำขอยืม (เฉพาะยาแดง) |
| `GET /api/borrow` | ✅ | คำขอที่เกี่ยวกับ รพ. ฉัน (ขอ/ถูกขอ) |
| `PATCH /api/borrow/:id` | ✅ | ผู้ให้ยืมอนุมัติ/ปฏิเสธ |
| `GET /api/alerts` | ✅ | แจ้งเตือน: ใกล้หมดอายุ (FEFO) / ต่ำกว่าจุดสั่งซื้อ / ขาดแคลน |
| `GET /api/audit` | ✅ | Audit Trail (timestamp + IP ทุกธุรกรรม) |
| `POST /api/reseed` | 🔑 token | โหลด CSV ใหม่เข้า DB (เรียกโดย retrainer หลังเทรน) |
| `GET /api/fl/spec?freq=` | | สเปกร่วมของรอบ FL (ฟีเจอร์ + ค่า scaler + dp_sigma) ให้ รพ. ดึงไปสเกลข้อมูล |
| `POST /api/fl/submit` | 🔑 token | รพ. ส่ง weight (coef+intercept ที่ใส่ DP noise) กลับ |
| `POST /api/fl/aggregate` | 🔑 token | ศูนย์กลางรวม weight ทุก รพ. ด้วย FedAvg → เขียนตาราง `weights` |

> Auth = ต้องส่ง header `Authorization: Bearer <token>`

## หน้าจอ (7 แท็บ)
1. **🗺️ Overview Map** — แผนที่ Leaflet หมุด รพ. ระบายสีตามสถานะ 🟢🟡🔴
2. **🤖 AI Intelligence** — เลือก รพ. → กราฟ days-of-supply (Recharts) + คงคลัง + Confidence
3. **💊 ยาทั้งหมด** — คลังยารวมทุกกลุ่ม (admin = ทุก รพ. / hospital = ของตัวเอง)
4. **🔔 แจ้งเตือน** — ใกล้หมดอายุ (FEFO) / ต่ำกว่าจุดสั่งซื้อ (Reorder) / ขาดแคลนด่วน *(เฉพาะ hospital)*
5. **🤝 ยืมยา** — ฟอร์ม + บันทึกข้อความ PDF (Smart Borrowing GPS) *(เฉพาะ hospital)*
6. **📜 Audit Trail** — บันทึกทุกธุรกรรม timestamp + IP (แก้ย้อนหลังไม่ได้)
7. **🔒 Privacy Control** — สถานะ Federated Learning / DP / TLS + กระแสข้อมูล + สถานะการเชื่อมต่อ (online/offline) ของแต่ละ รพ.

### 🟢 สถานะ online/offline ทำงานอย่างไร
- token เก็บใน **`sessionStorage`** → อยู่แค่ในแท็บนั้น: **ปิดแท็บ = token หาย = ต้อง login ใหม่** (refresh ในแท็บเดิม token ยังอยู่)
- เปิดแท็บค้างไว้ → frontend ส่ง **heartbeat ทุก 45 วินาที** → `users.last_seen` สดเสมอ → **คง 🟢 online** ตราบใดที่ยังไม่ออกจากระบบ
- **ปิดแท็บ** → ส่ง beacon `POST /api/offline` (pagehide) → `last_seen = NULL` → **🔴 offline ทันที** + ต้อง login ใหม่เมื่อเข้ามาอีกครั้ง
- กด **ออกจากระบบ** → `POST /api/logout` ล้าง `last_seen` (offline ทันที) + บันทึก audit
- เผื่อ beacon หลุด: ถ้าไม่มี heartbeat เกิน **2 นาที** ระบบถือว่า offline เอง

## 💻 พัฒนาแบบ local (`npm run dev`)

รัน **เฉพาะ database + Adminer** ด้วย Docker ส่วน backend/frontend รันด้วย npm (hot reload):

```powershell
cd webapp
npm install          # ติดตั้ง concurrently (root)
npm run install:all  # ติดตั้ง deps ของ backend + frontend

npm run db           # (เทอร์มินัลที่ 1) เปิด Postgres + Adminer ด้วย Docker
npm run dev          # (เทอร์มินัลที่ 2) เปิด backend (:4000) + frontend (:5173) พร้อมกัน
```

- Frontend (dev): http://localhost:5173 — Vite proxy `/api` → backend `:4000`
- Backend ใช้ `PGHOST=localhost` เชื่อม Postgres ใน Docker (port 5432) และ seed จาก `../data`, `../models` อัตโนมัติ
- Adminer: http://localhost:8081

> รันแยกทีละตัวได้ด้วย `npm run dev:backend` / `npm run dev:frontend`
> ถ้าไม่มี Docker เลย ให้ติดตั้ง PostgreSQL เองแล้วตั้ง env `PGHOST/PGUSER/PGPASSWORD/PGDATABASE`

## โครงสร้าง
```
webapp/
├── docker-compose.yml       # db + adminer + backend + frontend
├── package.json             # สคริปต์ dev (concurrently)
├── db/init.sql              # schema (hospitals, forecasts, weights, users, borrow_requests)
├── backend/                 # Express + pg + csv seeder
│   ├── server.js  db.js  seed.js  auth.js  Dockerfile  package.json
└── frontend/                # React + Vite + Leaflet + Recharts
    ├── src/  Dockerfile  nginx.conf  vite.config.js  package.json
```
