# VacFlow — สรุปเชิงสถาปัตยกรรม 3 มุมมอง + สิ่งที่ควรจะเป็น

> เทียบ 3 มุมมอง: **Proposal** (เจตนา) · **Code** (ที่สร้างจริง) · **Senior Dev** (มาตรฐานที่ควรเป็นเพื่อ production-ready/maintainable)
> สถานะ: หลังแก้ครบ P0 + P1 + P2 (ดู [PROPOSAL_GAP_ANALYSIS.md](PROPOSAL_GAP_ANALYSIS.md))

## กรอบการมอง
- **Proposal** = ควรมีอะไร (ข้อกำหนด)
- **Code** = สิ่งที่สร้างจริงตอนนี้
- **Senior Dev** = สิ่งที่ "ควรจะเป็น" เพื่อ maintainable / มีคุณค่าจริง

---

## 1. ตารางเทียบรายด้าน

| ด้าน | Proposal ต้องการ | Code ปัจจุบัน | Senior Dev: ควรจะเป็น |
|---|---|---|---|
| **สถาปัตยกรรม** | Python backend + RDB + 3 engine + web | Node/Express (auth/seed/serve/biz) + Python FastAPI engine + Postgres + mock-his MySQL + retrainer | โครงพอดี (polyglot, loose coupling) แต่ควรนิยาม **"source of truth ต่อ 1 การคำนวณ"** ให้ชัด — อย่าให้ logic เดียวอยู่ 3 ที่ |
| **3 โมดูลคำนวณ** | Dynamic Expire / Matching / Pooling | engine ครบ + ถูกเรียกจริง (เลิก split brain) | ✅ ดี — เหลือ **`/lenders` (ยืม) ยังเป็น greedy** ไม่ใช่ LP → รวมเส้นทาง matching เป็นหนึ่ง หรือแยกบทบาทให้ชัด (human-borrow vs auto-transship) |
| **Demand Forecast** | SMA / ES 2 สภาวะ | SMA/ES + RF/XGB/LGB/NN+Optuna+GPU | ⚠️ **ML เทรนแต่ไม่ถูกใช้ตัดสินใจ** — reorder/alert ใช้ค่าเฉลี่ย ไม่ใช่ผลโมเดล → ควรป้อน forecast เข้า reorder/threshold จริง ไม่งั้น nightly GPU = compute ทิ้ง |
| **Dynamic Expire** | overwrite ตาม event จริง | `/engine/expire` + `/vials/:id/transition` | ✅ ดี — แต่ effective_expiry คำนวณ 3 ที่ (generator/engine/view) ควร centralize สูตรเดียว |
| **ข้อมูล / Source of truth** | API real-time จาก HIS | mock-his (MySQL) → fetch → Postgres · CSV fallback · analytics จาก notebook CSV และ live recompute | analytics_transshipment มี 2 แหล่ง (CSV vs live engine) — ควรเหลือแหล่งเดียว + documented override |
| **เวลา/Determinism** | real-time | generator/notebook ตรึง `NOW=2026-06-26` · webapp ใช้ `now()` สด | ⚠️ **drift** ทำสี/threshold เพี้ยนเมื่อเวลาผ่าน → anchor ร่วม หรือ regenerate ตามวันจริง |
| **Security / PDPA** | ดึงเฉพาะคลัง ไม่แตะ PII | `vacflow_ro` + view (raw=ERROR 1142) · JWT · role · audit+IP | ✅ แข็งแรงมาก — prod ควรเพิ่ม secrets management (เลิก default `vacflow123`/token), per-user password, JWT secret บังคับตั้ง |
| **Testing** | — | engine มี pytest · mock-his RO test · **webapp/notebook ไม่มี test อัตโนมัติ** | ⚠️ **ไม่มี CI** → lint + engine pytest + backend integration test + notebook smoke + GitHub Actions |
| **Notebooks เป็น pipeline** | DS pipeline | retrainer รัน nb 03/04/05 ผ่าน nbconvert ทุกคืน | ⚠️ notebook-as-prod เปราะ (hidden state, เคยเจอ pandas pin) → สกัด logic เป็น module/script |
| **Frontend** | Dashboard + ปุ่มอนุมัติ | React+Vite, role-based, scoped | ดี — nginx cache DNS (502 ตอน rebuild) ควรใช้ resolver · ไม่มี FE test · `dist/` commit ค้าง ควร gitignore |
| **DevOps** | docker | 2 compose, mock-his ซ้ำใน webapp, port juggling | รวมเป็น compose เดียว + **profiles**, pin image, `.env` secrets, data CSV/notebook outputs ใหญ่ ควร gitignore/LFS |
| **Scope** | 3–5 รพ. / 2 segment | 13 รพ. / 151 product (superset) | OK สำหรับ demo — demand บางต่อ product (overstock แทบไม่ทริก) → demo ควรชู 2 segment + demand เข้มข้น |

---

## 2. จุดแข็ง (ทำได้ดีแล้ว)
- **PDPA by design** ระดับ DB (read-only view + ERROR 1142) ไม่ใช่แค่สัญญาในโค้ด
- **3 engine แยกเป็น service** + unit test (pytest) — testable, loose coupling
- **เลิก split brain** — engine ถูกเรียกทั้ง live + nightly
- โค้ดอ่านง่าย คอมเมนต์แน่น สม่ำเสมอ · idempotent seed + fallback (HIS→CSV) ทนทาน
- **HIS connector + event-driven overwrite** ตรงสถาปัตยกรรม Tier-2 ของ proposal

---

## 3. หนี้ทางเทคนิค / ความเสี่ยง (เรียงความสำคัญ)
1. **ML เทรนแล้วไม่ได้ใช้** — อวด RF/XGB/GPU แต่การตัดสินใจจริง (reorder/transship demand) ใช้ค่าเฉลี่ย → ควรป้อน prediction เข้า pipeline จริง
2. **ไม่มี CI/automated test ฝั่ง webapp** — รู้ว่าพังตอน manual เท่านั้น
3. **Notebook เป็น production pipeline** — เปราะ, version-sensitive
4. **Time drift** (NOW ตรึง vs now() สด) — ตัวเลขเพี้ยนตามวัน
5. **logic ซ้ำข้ามภาษา** (haversine, cost matrix, reorder) — Node/SQL/Python เสี่ยงไม่ตรงกัน
6. **secrets เป็น default** ทั้งระบบ — ไม่ prod-ready

---

## 4. สิ่งที่ควรจะเป็น (Target State)
1. **One source of truth ต่อการคำนวณ**: expiry→engine · matching→engine (รวม /lenders) · forecast→โมเดลที่เลือก ป้อนเข้า reorder/alert
2. **ปิดวงจร ML**: forecast (best model/series) → เป็น demand estimate ของ reorder + เกณฑ์ overstock แทนค่าเฉลี่ย → GPU training มีปลายทางใช้จริง
3. **Pipeline เป็น code**: สกัด nb03/04/05 เป็น `pipeline/*.py` (notebook ไว้ explore) → retrainer รัน script
4. **CI**: lint + pytest(engine) + jest(backend API) + notebook smoke + build FE บน GitHub Actions
5. **Config/secrets**: `.env` + secrets, เลิก default password/token, JWT secret บังคับตั้ง
6. **เวลา**: anchor เดียว หรือ generate ตามวันจริง ให้สี/threshold เสถียร
7. **Repo hygiene**: gitignore `dist/` + notebook outputs + data ที่ generate ได้ · compose เดียว + profiles · pin image versions
8. **Demo focus**: ชู 2 segment (Comirnaty mRNA + BCG multi-dose) + demand เข้มข้น ให้ทุก trigger เห็นชัด (คง 151 เป็น master เบื้องหลัง)

---

## 4.1 สถานะการแก้ไข (Refactor)
- [x] **P0** CI + tests (jest 14 + pytest 12 · [.github/workflows/ci.yml](../.github/workflows/ci.yml))
- [x] **P1** ปิดวงจร ML — forecast (`demand_forecast`) ขับ reorder/transship/overstock จริง
- [x] **P2** pipeline-as-code — [pipeline/](../pipeline/) (features→forecast→optimize→evaluate) · retrainer เลิก nbconvert
- [x] **P3** one-source — generator import engine `effective_expiry` · /lenders แยกบทบาทจาก auto-transship ชัด
- [x] **P4** time anchor เดียว `VACFLOW_NOW` (generator + pipeline)
- [x] **P5** secrets — `.env.example` + JWT_SECRET บังคับใน production + token interpolation
- [x] **P6** hygiene — compose profiles (`train`/`debug`) · pin adminer · frontend → 8090

## 5. บรรทัดล่างสุด
- **เทียบ Proposal**: ระบบ **ตรงครบ + เกิน** (โดยเฉพาะฉบับ v2 ที่ผ่อนปรน) — พร้อมนำเสนอ/แข่ง
- **เทียบ Senior Dev**: เป็น prototype/hackathon ที่ดีมาก แต่ห่าง production ~3 เรื่อง — **ปิดวงจร ML, CI/test, pipeline-as-code**
- **ลำดับถ้าไปต่อ**: (1) ป้อน forecast เข้า decision จริง → (2) CI + backend test → (3) สกัด pipeline เป็น script
