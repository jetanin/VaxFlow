# 📋 VaxFlow — Proposal (PDF) Conformance Review

> ตรวจสอบโค้ดของโปรเจกต์เทียบกับ **VaxFlow.pdf** แล้ว (1) ปรับให้ตรงตาม spec ที่ถูกต้อง
> และ (2) บันทึกจุดที่ **PDF ไม่ถูกต้อง/ขัดแย้งกันเอง** พร้อมเหตุผลที่ implementation เลือกทำต่างออกไป
> ทบทวนเมื่อ: 2026-06-27

---

## ✅ ส่วนที่ปรับให้ตรงตาม PDF (Conformed)

| Spec ใน PDF | ที่อยู่ในโค้ด | สถานะ |
|-------------|--------------|-------|
| **Dynamic Shelf-Life** : mRNA แช่แข็ง → ละลาย clock-down 30 วัน · open-vial 6 ชม. (§1, §3.1) | `vaccine-engine/modules/dynamic_expire.py`, view `vaccine_vial_status` | ✅ ตรง |
| **สัญญาณไฟ** : 🟡 อายุ ≤ 21 วัน · 🔴 อายุ ≤ 14 วัน (§4.2) | `webapp/db/init.sql` (view) + `/api/alerts` | ✅ ตรง |
| **Demand Forecasting** : Normal = SMA · Crisis = Exponential Smoothing (§Math 1) | `notebook/03,04` (`sma_7`, `es_*`, จูน α) | ✅ ตรง (+ เพิ่ม RF/XGB/LGBM/NN เป็นส่วนเสริม) |
| **Transportation Model** : `min Z = ΣΣ c(i,j)·x(i,j)` (§Math 2) | `modules/matching_engine.solve_transport`, `notebook/04` | ✅ ตรง |
| **Predictive Screening** : เสี่ยง = อายุ ≤ 14 วัน **และ** อัตราใช้ต่ำ (§3.2.2) | `modules/matching_engine.screen_at_risk` | ✅ ตรง (เพิ่มเงื่อนไข "อัตราใช้ต่ำ") |
| **Multi-dose Pooling** : รวมคิวให้ ≥ โดส/ขวด ลด residual (§3.2.3) | `modules/pooling.consolidate_queue` | ✅ ตรง |
| **Backend = Python engine** ทำ 3 โมดูล (§3.2, §4.3) | `vaccine-engine/` (FastAPI) endpoints `/engine/{expire,match,pool}` | ✅ ตรง |
| **KPI ลด wastage ≥ 30%** (§2, §4.4, §5.1) | `notebook/05` wastage simulation | ✅ ตรง |
| **PDPA / Data Minimization** : ดึงเฉพาะ Inventory Level & State (§5.2) | `appointment_queue` เก็บ counts, Tier-2 view-only (`mock-his/`) | ✅ ตรง |

**โมดูล 2 และ 3 ที่เดิมเป็น skeleton ตอนนี้ implement จริงแล้ว** (มี unit tests: `tests/test_matching.py`, `tests/test_pooling.py`).

---

## ⚠️ จุดที่ PDF ไม่ถูกต้อง / ขัดแย้งกันเอง (Report)

### 1. กล่องสูตรหน้า 5 ติดป้ายผิด (mislabeled formulas) — **สำคัญ**
หัวข้อ *"สูตรคำนวนสภาวะปกติ (Normal)"* แสดงสมการ:
```
I.   I_j / Usage Rate_j ≤ DL_j   (DL_j ≤ 30)      ← days-of-supply
II.  Σ_i X_ij + I_j ≥ D_j                          ← demand constraint ของ Transportation
III. min Z = ΣΣ (C_ij·X_ij) + Σ (H_j·I_j)          ← objective ของ Transportation
```
สมการ II, III **เป็นของ Transportation Model ไม่ใช่ "การพยากรณ์สภาวะปกติ"** และส่วน *"สูตรคำนวนสภาวะวิกฤติ (Crisis)"* กลับแสดงเพียงสมการ I (days-of-supply) ซ้ำ
→ **ขัดกับหัวข้อ "Mathematical Models"** เอง ที่ระบุถูกต้องว่า Normal = SMA, Crisis = Exponential Smoothing
**Implementation ยึดตามหัวข้อ Mathematical Models** (SMA / ES) ซึ่งสอดคล้องภายในตัวเอง

### 2. Demand constraint ของ Transportation เป็น **equality** → infeasible ในกรณีจริง — **สำคัญ**
PDF (§Math 2) ระบุ `Σ x(i,j) = D(j)` (เท่ากับพอดี) คู่กับ `Σ x(i,j) ≤ S(i)`
แต่ในงานจริง **S(i) = ของเสี่ยงหมดอายุ (น้อย)** ส่วน **D(j) = ดีมานด์รวม (มาก)** → `ΣS < ΣD`
ทำให้ระบบ **infeasible** (โอนของเสี่ยงที่มีไม่พอจะ "เท่ากับ" ดีมานด์ทุกปลายทางได้)
**Implementation แก้เป็น feasible โดยอัตโนมัติ** (`solve_transport`):
- ถ้า `ΣS ≤ ΣD` → ระบายของเสี่ยง **ออกให้หมด** `Σ_j x(i,j) = S(i)` · รับ **ไม่เกิน** ดีมานด์ `Σ_i x(i,j) ≤ D(j)`
- ถ้า `ΣS > ΣD` → ทำตาม PDF literal: ตอบดีมานด์พอดี `Σ_i x(i,j) = D(j)` · โอนออกไม่เกิน `Σ_j x(i,j) ≤ S(i)`

### 3. Objective function มี 2 เวอร์ชันไม่ตรงกัน
- §Math 2: `min Z = ΣΣ c·x` (ต้นทุนขนส่งล้วน)
- หน้า 5 สูตร III: `min Z = ΣΣ c·x + Σ H_j·I_j` (บวก holding cost `H_j·I_j`)
**Implementation ใช้แบบ §Math 2** (ต้นทุนขนส่งล้วน) เพราะเป็นเวอร์ชันที่นิยามตัวแปรครบและสอดคล้องกับเป้าหมาย "lateral transshipment"; ถ้าต้องการรวม holding cost ต้องนิยาม `H_j` เพิ่ม

### 4. Open-vial life ไม่นิ่ง (6h vs 6–24h) และไม่ครอบคลุมวัคซีนน้ำหลายโดส
- §1 เขียน "6–24 ชั่วโมง" แต่ §3.1 ตรึงไว้ที่ **6 ชั่วโมง** (เฉพาะ lyophilised/reconstituted)
- ตาม **WHO Multi-Dose Vial Policy** วัคซีนน้ำหลายโดสบางชนิด (OPV, hepB, DTP) ใช้ได้ถึง **28 วัน**
**Implementation** ใช้ค่าตาม class จริง (`vaccine_merged_with_storage.csv`): lyophilised/single-dose = 6 ชม., liquid multidose = 28 วัน — เป็นการ **ขยายให้สมจริงกว่า scope ตัวอย่างใน PDF** (PDF ศึกษาแค่ 2 segment ตัวแทน)

### 5. Scope "3–5 สาขา / 2 segment ตัวแทน" vs ข้อมูล อย. จริง 151 รายการ
PDF (§3.1) กำหนด scope ต้นแบบเป็นวัคซีน 2 กลุ่มตัวแทน (mRNA + MDV 10 โดส)
**Implementation** seed product master จาก **อย. จริง 151 รายการ** (`vaccine_merged_with_storage.csv`) — เป็น superset ของ scope; ยังคงเครือข่าย 5 สาขาตาม PDF

### 6. เกณฑ์ 🟡 Yellow มี 2 เงื่อนไข แต่ webapp ใช้แค่อายุขัย
PDF (§4.2): 🟡 = สต็อกสะสม **สูงกว่าค่าเฉลี่ยดีมานด์** *หรือ* อายุขัย ≤ 21 วัน
**webapp ปัจจุบันใช้แค่ "อายุขัย ≤ 21 วัน"** เพราะตาราง vaccine_vial ฝั่ง webapp ยังไม่เก็บดีมานด์รายผลิตภัณฑ์
→ เป็น **simplification** (ไม่ใช่ PDF error) — ส่วน days-of-supply/over-stock มีในฝั่ง notebook (forecast) แล้ว ถ้าต้องการให้ครบควรนำดีมานด์พยากรณ์มา seed เข้า webapp

### 7. ข้อผิดพลาดเล็กน้อย (typos)
- หน้าปก: **"VacFlow"** (ควรเป็น "VaxFlow")
- §4.4 ข้อ 4: **"Financialศาสตราภิวัฒน์"** — ข้อความปนเปื้อน/พิมพ์ผิด (น่าจะตั้งใจเขียน "Financial Feasibility")

---

## สรุป
โค้ด **ตรงตามแกนหลักของ Proposal ครบทั้ง 3 โมดูล + KPI + PDPA**
ส่วนที่ทำต่างจาก PDF (ข้อ 2, 3) เป็นเพราะสูตรใน PDF **infeasible/ขัดแย้งกันเอง** — ได้แก้ให้รันได้จริงและบันทึกไว้ข้างต้น
ข้อ 4, 5 เป็นการ **ขยายให้สมจริงกว่า** ตามข้อมูล อย. จริง · ข้อ 6 เป็น simplification ที่ทราบอยู่
