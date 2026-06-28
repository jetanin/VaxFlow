# VacFlow — รายงานเทียบ Proposal (PDF) กับระบบปัจจุบัน + แผนแก้ไข

> อ้างอิง: VacFlow.pdf (Predictive Vaccine Shared Inventory Platform)
> สถานะ ณ วันจัดทำ: ทบทวนโค้ดทั้ง repo เทียบรายข้อกับ Proposal

## สรุปผู้บริหาร
ระบบครอบคลุม **แกนหลักของ Proposal ครบทั้ง 3 โมดูล** และจุดขาย PDPA แข็งแรง (mock-his read-only
views ไม่มี PII = ตรง §6.2 มาก) แต่มี **ช่องว่างเชิงตรรกะ 5 จุดที่ไม่ตรงสูตร/เงื่อนไขใน PDF** และมี
**"split brain"** — vaccine-engine (Python, เขียนตรงสูตร PDF) ถูกสร้างไว้แต่ webapp ไม่ได้เรียกใช้
กลับ reimplement logic เองแบบง่ายกว่า

ระดับความตรง (ประเมิน): **โครงสร้าง ~85%** · **ความถูกต้องเชิงสูตรคณิตศาสตร์ ~60%**

## ตารางเทียบรายข้อ

| Proposal | ควรเป็น | ปัจจุบัน | ช่องว่าง | ระดับ |
|---|---|---|---|---|
| §3 ขอบเขต 3–5 สาขา | 3–5 รพ. | 13 รพ. | เกิน scope (superset) | P2 |
| §3.1 2 segment ตัวแทน | mRNA + Multi-Dose (10/6ชม.) | 151 ผลิตภัณฑ์จาก อย. | segment ตัวแทนไม่ชัด | P2 |
| §3.2.1 Dynamic Shelf-Life | overwrite เมื่อมี event จริง (barcode) | engine คำนวณถูก แต่ state เป็น static ในข้อมูล | ไม่มี event-driven overwrite | P1 |
| §3.2.2 Screening | shelf ≤14 วัน **และ** อัตราใช้สาขาต่ำ | engine `screen_at_risk` มีครบ แต่ notebook/webapp ไม่เรียก — ใช้แค่ ≤14 วัน | ขาดเงื่อนไข low-consumption | **P0** |
| §3.2.2 Transportation | min Z=ΣΣc·x · demand = D(j) (+ holding `H_j·I_j`) | notebook ใช้ ≤ + REWARD maximize ไม่ตรงสูตร · engine equality ถูกแต่ไม่ถูกใช้ | objective/constraint ไม่ตรง + ไม่มี holding cost | **P0** |
| §3.2.2 Time-Window | ห้ามเส้นทางที่ lead time > อายุที่เหลือ | LP ใช้แค่ระยะทาง×rate | ไม่มี time-window constraint | **P0** |
| §3.2.3 Pooling | consolidate queue จริง | engine `consolidate_queue` ครบ แต่ nb05 ใช้ heuristic 0.75 | ไม่ได้ใช้ algorithm จริง | P1 |
| §4.2 Yellow trigger | คงคลัง > avg demand หรือ shelf ≤21 | view ใช้แค่ shelf ≤21 | ขาดเงื่อนไขคงคลังสะสม | **P0** |
| §4.2 Green/Red | I≈D / shelf≤14 | red/yellow 14/21 วัน ✓ · green เป็น default | green ไม่ได้เช็ค I≈D | P1 |
| § คณิต Normal/Crisis | SMA(ปกติ)/ES(วิกฤต) สลับตามสภาวะ | nb04 เลือก winner ต่อ series ด้วย RMSE | ไม่ detect crisis state | P1 |
| §4.1 Lead Time Coefficient | ระยะทาง + ค่าสัมประสิทธิ์เวลา | มี lead_time_days + ระยะถนนจริง แต่ LP cost ไม่รวมเวลา | lead time ไม่เข้า cost/constraint | P1 |
| §4.4 Stress/Uncertainty | ป้อน demand ผันผวนสูงทดสอบ pooling | nb05 มี wastage sim แต่ไม่มี stress test | ขาด uncertainty simulation | P1 |
| §5.2 / §6.2 PDPA | ดึงเฉพาะคลัง ไม่แตะ PII | mock-his views + vacflow_ro (ERROR 1142) | **ตรงมาก** | ✅ |
| §6.1 KPI ลด ≥30% | Baseline vs ระบบ | nb05 wastage sim | ครบ (พึ่ง heuristic pooling) | ✅~ |
| สถาปัตยกรรม | Python engine ทำ 3 โมดูล | engine ไม่ถูก webapp เรียก (server.js ไม่มี call) | split brain — /lenders ยัง greedy | **P0** |
| Branding | "VacFlow" (PDF) | "VacFlow" (repo) | ชื่อไม่ตรง | P2 |

## แผนแก้ไข จัดลำดับ

### P0 — ต้องแก้ให้ตรง Proposal (ตรรกะคณิตศาสตร์)
1. **เชื่อม vaccine-engine เข้ากับ webapp** — transshipment เรียก `solve_transport`/`screen_at_risk`
   ของ engine แทน logic ที่ reimplement (เลิก split brain)
2. **Transportation Model ให้ตรงสูตร** — เปลี่ยนจาก "≤ + REWARD" เป็น demand = D(j)
   (ใช้ `solve_transport` ที่มี evacuate-switch) + พิจารณาเพิ่ม holding cost `H_j·I_j`
3. **Screening เพิ่ม low-consumption** — source ต้อง shelf ≤14 วัน และ อัตราใช้ < เกณฑ์ (`screen_at_risk`)
4. **Time-Window constraint** — ตัดเส้นทางที่ `lead_time + transit > remaining_shelf_life`
5. **Yellow trigger** — เพิ่มเงื่อนไข "คงคลัง > ค่าเฉลี่ยดีมานด์" ใน vaccine_vial_status

### P1 — ควรเป็นตามเจตนา Proposal
6. **Pooling จริง** — nb05 ใช้ `consolidate_queue` กับ appointment_queue จริง แทน factor 0.75
7. **Crisis-state detection** — วัดความผันผวนเพื่อสลับ SMA→ES อัตโนมัติ
8. **Stress/Uncertainty test (§4.4.2)** — เพิ่ม notebook ป้อน demand ผันผวนสูง
9. **Lead time เข้า cost** — c(i,j) รวมสัมประสิทธิ์เวลา หรือเพิ่ม `DL_j ≤ 30` constraint
10. **Dynamic overwrite event-driven** — จำลอง event เปิดขวด/ละลายจาก mock-his แล้ว recompute

### P2 — Scope/branding (ต้องตัดสินใจ)
11. **3–5 vs 13 สาขา** — ลดเดโมเป็น 5 หรือคง 13 แล้วระบุว่าเป็น superset
12. **2 segment ตัวแทน** — ชู Comirnaty (mRNA) + BCG (Multi-dose) เป็น demo หลัก คง 151 เป็น master
13. **ชื่อ** — รวมเป็น VacFlow ทั้งหมดให้สม่ำเสมอ

## ข้อสังเกต
- **จุดแข็งตรง PDF**: PDPA/data-minimization (§6.2), HIS read-only connector (§5.2), 3 engine modules
  เขียนถูกตามสูตร — ปัญหาคือ "ไม่ถูกเรียกใช้" ไม่ใช่ "ไม่มี"
- **ความเสี่ยงหลัก**: transshipment ที่ผู้ใช้เห็นมาจากสูตร REWARD-maximize ซึ่งไม่ตรง Proposal —
  ควรแก้ P0 #2 ก่อน
- งานที่เพิ่มภายหลัง (road distance, retrainer GPU, orders→HOSxP, reorder, ผอ.รพ) เกินกว่า Proposal
  เป็น value-add ไม่ขัด แต่ควรระบุว่าเป็นส่วนขยาย

## สถานะการแก้ไข
- [x] P0 #1 เชื่อม engine เข้า webapp + notebook (recomputeTransshipment → /engine/match)
- [x] P0 #2 Transportation Model ตรงสูตร (ใช้ engine `solve_transport`, demand=D(j))
- [x] P0 #3 Screening low-consumption (`screen_at_risk` — supply เฉพาะสาขาบริโภค < median)
- [x] P0 #4 Time-Window constraint (ตัดเส้นทางที่ lead_time ≥ อายุที่เหลือ + drop write-off source)
- [x] P0 #5 Yellow trigger (overstock: on_hand > avg_daily×14 ใน /api/alerts + UI)
- [x] P1 #6 Pooling จริง (nb05 ใช้ `consolidate_queue` บนคิวนัดจริง — open-vial 87607→6057 ลด 93%)
- [x] P1 #7 Crisis-state detection (CV>0.6 → ES, ปกติ → SMA · เพิ่ม scenario/method ใน forecast)
- [x] P1 #8 Stress/Uncertainty test (§4.4.2 — pooling เสถียร 91–94% ทุกระดับความผันผวน)
- [x] P1 #9 Lead-time เข้า cost (c = ระยะถนน×rate + lead×coeff · Cost/Time Minimization §4.1)
- [x] P1 #10 Event-driven overwrite (POST /api/vials/:id/transition → engine /engine/expire โมดูล 1)
- [x] P2 #11 คง **13 สาขา** (ตัดสินใจ: superset ของ PDF 3–5 — ระบุใน README)
- [x] P2 #12 คง **151 ผลิตภัณฑ์** เป็น master (superset ของ 2 segment ตัวแทน — mRNA + Multi-dose ยังครบ)
- [x] P2 #13 เปลี่ยนชื่อเป็น **VacFlow** ทั้งหมด (UI/header/user/password/token/db user/network/docs)

## หมายเหตุ engine ถูกเรียกครบทั้ง 3 โมดูลแล้ว
- โมดูล 1 Dynamic Expire → `/engine/expire` (วัด transition vial)
- โมดูล 2 Matching → `/engine/match` (recomputeTransshipment) + `solve_transport`/`screen_at_risk` (notebook)
- โมดูล 3 Pooling → `consolidate_queue` (nb05 wastage + stress test)
→ เลิก split brain สำเร็จ (P0 #1)
