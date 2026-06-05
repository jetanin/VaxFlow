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
python scripts/export_forecast_snapshot.py   # -> data/predictions/forecast_snapshot.csv
python scripts/export_weights.py              # -> models/global_weights.csv
```

backend จะ seed จากไฟล์เหล่านี้ + `data/hospitals/hospital_master.csv` อัตโนมัติตอนเริ่ม

## รันด้วย Docker

```powershell
cd webapp
docker compose up --build
```

- **Frontend:** http://localhost:8080
- **Backend API:** http://localhost:4000/api/health
- **Postgres:** localhost:5432 (user/pass/db = `medcast`)

ปิด: `docker compose down`  ·  ล้างข้อมูล DB ด้วย: `docker compose down -v`

## REST API

| Endpoint | คืนค่า |
| --- | --- |
| `GET /api/health` | สถานะ + การเชื่อม DB |
| `GET /api/summary` | KPI (จำนวน รพ., ยาขาด/ใกล้หมด, confidence เฉลี่ย) |
| `GET /api/hospitals` | รายชื่อ รพ. + พิกัด + สถานะรวม (สำหรับแผนที่) |
| `GET /api/forecasts?hospital_id=&status=` | พยากรณ์รายยา (กรองได้) |
| `GET /api/privacy` | สถานะ FL / DP / TLS / weight |
| `GET /api/weights` | weight กลาง (เรียงตามขนาด) |

## หน้าจอ (3 พาเนล)
1. **🗺️ Overview Map** — แผนที่ Leaflet หมุด รพ. ระบายสีตามสถานะ 🟢🟡🔴
2. **🤖 AI Intelligence** — เลือก รพ. → กราฟ (Recharts) พยากรณ์ vs เฉลี่ย30วัน + ตาราง + Confidence
3. **🔒 Privacy Control** — สถานะ Federated Learning / DP / TLS + กระแสข้อมูล

## พัฒนาแบบ local (ไม่ใช้ Docker)
```powershell
# backend (ต้องมี Postgres รันอยู่ + ตั้ง env PGHOST ฯลฯ)
cd webapp/backend && npm install && npm start
# frontend (proxy /api -> localhost:4000)
cd webapp/frontend && npm install && npm run dev   # http://localhost:5173
```

## โครงสร้าง
```
webapp/
├── docker-compose.yml
├── db/init.sql              # schema (hospitals, forecasts, weights)
├── backend/                 # Express + pg + csv seeder
│   ├── server.js  db.js  seed.js  Dockerfile  package.json
└── frontend/                # React + Vite + Leaflet + Recharts
    ├── src/  Dockerfile  nginx.conf  vite.config.js  package.json
```
