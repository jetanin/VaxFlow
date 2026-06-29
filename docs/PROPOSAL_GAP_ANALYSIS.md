# VacFlow — รายงานเทียบ Proposal (PDF ฉบับใหม่ v2) กับระบบปัจจุบัน

> อ้างอิง: VacFlow.pdf **ฉบับปรับปรุง (v2)** — โครงสร้างใหม่ INPUT/PROCESS/OUTPUT,
> ใช้ชื่อ "VacFlow" ตลอด, **ตัดรายละเอียดสูตรคณิตศาสตร์เชิงลึกออก** (ไม่มี holding cost / DL_j≤30)
> สถานะ: แก้ครบ P0 + P1 + P2 แล้ว

## สรุปผู้บริหาร
หลังแก้ครบทุกระดับ ระบบ **ตรงตาม Proposal ฉบับใหม่ครบทุกข้อ และเกินในหลายจุด**:
- vaccine-engine ทั้ง 3 โมดูลถูกเรียกใช้จริงทั้ง webapp (live) + notebook/nightly → **เลิก split brain**
- Transportation Model ใช้ LP จริง (`solve_transport`) + screen low-consumption + time-window + lead cost
- Trigger 🟢🟡🔴 / SMA-ES ตามสภาวะ / Pooling จริง — ตรงเจตนา §3,§5
- PDPA: HIS read-only (`vacflow_ro` + view `vw_vacflow_*`) — ตรง §6.2/§7.2 มาก

**ฉบับใหม่ผ่อนปรนกว่าเดิม** (ตัดสูตร LP เต็ม + holding cost + DL_j≤30 ออก) → ช่องว่างเชิงสูตรที่เคยมีหายไป

## การเปลี่ยนแปลงของ Proposal (ฉบับใหม่ v2 เทียบฉบับเดิม)

| หัวข้อ | ฉบับเดิม | ฉบับใหม่ (v2) | ผลต่อระบบ |
|---|---|---|---|
| แบรนด์ | ปน VaxFlow/VacFlow | **VacFlow** ทั้งฉบับ | ✅ เปลี่ยนเป็น VacFlow ครบแล้ว |
| โครงสร้าง §3 | Product/Backend scope | **INPUT / PROCESS / OUTPUT** | เชิงเอกสาร — ครอบคลุมครบ |
| วัตถุประสงค์ | 3 ข้อ | **4 ข้อ (เพิ่ม "Shared Inventory Visibility")** | ✅ มี Overview Map + Dashboard ร่วม |
| ชื่อ 3 โมดูล | ...Module ยาว | Dynamic Shelf-Life / Predictive Screening & Optimization / Demand Pooling **Engine** | ตรง vaccine-engine |
| **สูตรคณิตศาสตร์** | สูตรเต็ม + `H_j·I_j` + `DL_j≤30` + demand `=D(j)` | **ตัดออก** เหลือบรรยาย LP เชิงคุณภาพ | **holding cost / DL_j≤30 ไม่บังคับแล้ว** |
| OUTPUT | ไม่ชัด | **Dashboard + Automated Matching Alert (ปุ่มอนุมัติ)** | ✅ มีแล้ว (ยืม/สั่งซื้อ + แผนโอนย้าย) |
| Dynamic Data | real-time exposure | **ดึง event ย้ายตู้/เปิดขวด real-time ผ่าน API** | ✅ `/api/vials/:id/transition` + HIS connector |
| Open-vial life | 6 ชม. | **6–24 ชม.** | data ใช้ 6 ชม. (อยู่ในกรอบ) |
| Trigger / SMA-ES / KPI ≥30% | เหมือนเดิม | **เหมือนเดิม** | ✅ ทำครบ |

## เทียบรายข้อ (อิงฉบับใหม่) — ครบทุกข้อ

| Proposal v2 | ปัจจุบัน | สถานะ |
|---|---|---|
| §2 วัตถุประสงค์ 1 — Shared Inventory Visibility (real-time ร่วม) | Overview Map + แท็บวิเคราะห์/แจ้งเตือนร่วมทุก รพ. | ✅ |
| §3.1 INPUT: Static(WHO) + Dynamic API(ย้ายตู้/เปิดขวด) + Simulated demand | product master(อย.) + vial state/transition + stochastic demand | ✅ |
| §3.2 Dynamic Shelf-Life Engine | `/engine/expire` overwrite อายุขัยตาม event (transition) | ✅ |
| §3.2 Predictive Screening (Red ≤14 + สาขาอุปสงค์ต่ำ) | `screen_at_risk` (≤14 วัน + บริโภค < median) | ✅ |
| §3.2 Optimization (จับคู่ต้นทาง-ปลายทาง เวลา+ต้นทุนต่ำสุด) | `solve_transport` LP + time-window + lead cost | ✅ |
| §3.2 Demand Pooling Engine | `consolidate_queue` บนคิวนัดจริง | ✅ |
| §3.3 OUTPUT: Dashboard + Automated Matching Alert (ปุ่มอนุมัติ) | แท็บแผนโอนย้าย/สั่งซื้อ + ปุ่มอนุมัติยืม/dispatch | ✅ |
| §4 Geospatial Distance Matrix (ระยะ+เวลาจริง) | OSRM ระยะถนนจริง + lead time | ✅ (เกิน: ถนนจริง) |
| §4 Forecast SMA(ปกติ)/ES(วิกฤต) | crisis detection CV>0.6 → ES, ปกติ → SMA | ✅ |
| §4 Transportation Model (LP) | engine `solve_transport` | ✅ |
| §5 Triggers 🟢/🟡(≤21 หรือ คงคลัง>avg)/🔴(≤14) | view + overstock alert | ✅ |
| §5 Automated Transshipment | recomputeTransshipment เรียก engine | ✅ |
| §5 Queue Consolidation | pooling engine | ✅ |
| §5/§7 KPI ลด ≥30% | wastage sim (pooling จริง) = **ลด ~93%** | ✅ เกินเป้า |
| §6.4/§7.2 PDPA 100% (ดึงเฉพาะคลัง ไม่แตะ PII) | `vacflow_ro` + view ตัด PII (raw = ERROR 1142) | ✅ |

## ส่วนที่ "เกิน" Proposal (value-add)
ระยะถนนจริง (OSRM) · time-window + lead-time ใน LP · ML เปรียบเทียบ (RF/XGB/LGB/NN + Optuna, GPU) ·
retrainer รายวัน 01:00 · reorder → คำสั่งซื้อ HOSxP · stress/uncertainty test · user ผอ.รพ
→ ทั้งหมดไม่ขัด Proposal เป็นส่วนเสริมเหนือข้อกำหนด

## สถานะการแก้ไข (ครบทั้งหมด)
- [x] P0 #1 เชื่อม engine เข้า webapp + notebook (recomputeTransshipment → /engine/match)
- [x] P0 #2 Transportation Model ใช้ engine `solve_transport` (demand=D(j))
- [x] P0 #3 Screening low-consumption (`screen_at_risk`)
- [x] P0 #4 Time-Window constraint (lead_time ≥ อายุที่เหลือ → ตัดเส้นทาง + drop write-off)
- [x] P0 #5 Yellow trigger overstock (on_hand > avg_daily×14)
- [x] P1 #6 Pooling จริง (open-vial 87607→6057 ลด 93%)
- [x] P1 #7 Crisis-state detection (CV>0.6 → ES)
- [x] P1 #8 Stress/Uncertainty test (pooling เสถียร 91–94%)
- [x] P1 #9 Lead-time เข้า cost (Cost/Time Min) — **หมายเหตุ: holding cost/DL_j≤30 ฉบับใหม่ตัดออก ไม่ต้องทำ**
- [x] P1 #10 Event-driven overwrite (POST /api/vials/:id/transition → /engine/expire)
- [x] P2 #11 คง 13 สาขา (superset ของ 3–5)
- [x] P2 #12 คง 151 ผลิตภัณฑ์ master (superset ของ 2 segment)
- [x] P2 #13 เปลี่ยนชื่อเป็น VacFlow ทั้งหมด

## หมายเหตุ engine ถูกเรียกครบทั้ง 3 โมดูล (เลิก split brain)
- โมดูล 1 Dynamic Expire → `/engine/expire` (vial transition)
- โมดูล 2 Matching → `/engine/match` + `solve_transport`/`screen_at_risk`
- โมดูล 3 Pooling → `consolidate_queue` (wastage + stress test)
