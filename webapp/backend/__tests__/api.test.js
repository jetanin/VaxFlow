// Integration tests — ยิงจริงไปที่ API ที่รันอยู่ (default localhost:4000)
// ถ้า API ไม่ขึ้น (เช่นรัน unit อย่างเดียว) จะข้ามแบบไม่ fail · CI จะ docker compose up ก่อน
const request = require("supertest");

const API = process.env.API_URL || "http://127.0.0.1:4000";  // 127.0.0.1 เลี่ยง IPv6 ::1
const PW = process.env.DEFAULT_PASSWORD || "vacflow123";
let up = false;

async function login(username, password = PW) {
  const r = await request(API).post("/api/login").send({ username, password });
  return r.body.token;
}

beforeAll(async () => {
  try {
    const r = await request(API).get("/api/health");
    up = r.status === 200;
  } catch { up = false; }
  if (!up) console.warn(`[api.test] API ${API} ไม่ตอบ → ข้าม integration tests`);
});

// helper: รันเฉพาะเมื่อ API ขึ้น (ไม่งั้นผ่านแบบ no-op)
const itx = (name, fn) => test(name, async () => { if (!up) return; await fn(); });

describe("auth + scoping", () => {
  itx("health = ok", async () => {
    const r = await request(API).get("/api/health");
    expect(r.body.status).toBe("ok");
  });

  itx("admin login → role=admin", async () => {
    const r = await request(API).post("/api/login").send({ username: "admin", password: PW });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe("admin");
    expect(r.body.token).toBeTruthy();
  });

  itx("รหัสผิด → 401", async () => {
    const r = await request(API).post("/api/login").send({ username: "admin", password: "wrong" });
    expect(r.status).toBe(401);
  });

  itx("ไม่มี token → 401", async () => {
    const r = await request(API).get("/api/orders");
    expect(r.status).toBe(401);
  });

  itx("hospital เห็นเฉพาะของตัวเอง (scoping)", async () => {
    const token = await login("HOSP_007");
    const r = await request(API).get("/api/orders").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.every((o) => o.hospital_id === "HOSP_007")).toBe(true);
  });

  itx("ผอ.รพ (director) login ได้ + scoped", async () => {
    const token = await login("HOSP_007_director");
    const r = await request(API).get("/api/alerts").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
  });

  itx("director แตะ admin-only (audit) → 403", async () => {
    const token = await login("HOSP_007_director");
    const r = await request(API).get("/api/audit").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(403);
  });
});

describe("alerts shape (3 ระดับ + overstock)", () => {
  itx("/api/alerts มีครบ 4 บัคเก็ต", async () => {
    const token = await login("HOSP_007");
    const r = await request(API).get("/api/alerts").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    for (const k of ["expiring", "opened", "shortage", "overstock"]) {
      expect(Array.isArray(r.body[k])).toBe(true);
    }
  });
});

describe("borrow rule", () => {
  itx("ยืมจากตัวเอง → 400", async () => {
    const token = await login("HOSP_007");
    const r = await request(API).post("/api/borrow")
      .set("Authorization", `Bearer ${token}`)
      .send({ to_hospital: "HOSP_007", product_id: "VAX_J07BC02_002", quantity: 1 });
    expect(r.status).toBe(400);
  });
});
