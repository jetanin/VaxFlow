// เรียก backend ผ่าน /api (dev: vite proxy, prod: nginx proxy)
const BASE = "/api";
const TOKEN_KEY = "vacflow_token";

// ใช้ sessionStorage (ไม่ใช่ localStorage): token อยู่แค่ในแท็บนั้น
// → ปิดแท็บ = token หาย = ต้อง login ใหม่ · refresh ในแท็บเดิม = token ยังอยู่
export const auth = {
  get token() { return sessionStorage.getItem(TOKEN_KEY); },
  set token(v) { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); },
  get hospital() {
    const h = sessionStorage.getItem("vacflow_hospital");
    return h ? JSON.parse(h) : null;
  },
  set hospital(v) {
    v ? sessionStorage.setItem("vacflow_hospital", JSON.stringify(v))
      : sessionStorage.removeItem("vacflow_hospital");
  },
  logout() { this.token = null; this.hospital = null; },
};

async function req(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `${path} -> ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const api = {
  summary: () => req("/summary"),
  hospitals: () => req("/hospitals"),
  vaccines: () => req("/vaccines"),
  vials: (hospitalId, status) =>
    req(`/vials?${[hospitalId ? `hospital_id=${hospitalId}` : "", status ? `status=${status}` : ""].filter(Boolean).join("&")}`),
  // auth
  login: (username, password) =>
    req("/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logoutServer: () => req("/logout", { method: "POST" }),
  heartbeat: () => req("/heartbeat", { method: "POST" }),
  // เรียกตอนปิดแท็บ (pagehide) — keepalive ให้ request ส่งจบแม้หน้ากำลังปิด
  goOffline: () => {
    if (!auth.token) return;
    try {
      fetch(`${BASE}/offline`, {
        method: "POST",
        keepalive: true,
        headers: { Authorization: `Bearer ${auth.token}` },
      });
    } catch { /* best-effort */ }
  },
  changePassword: (username, key, new_password) =>
    req("/change-password", { method: "POST", body: JSON.stringify({ username, key, new_password }) }),
  adminResetKey: (username) =>
    req("/admin/reset-key", { method: "POST", body: JSON.stringify({ username }) }),
  adminResetPassword: (username) =>
    req("/admin/reset-password", { method: "POST", body: JSON.stringify({ username }) }),
  // borrow
  lenders: (productId) => req(`/lenders?product_id=${encodeURIComponent(productId)}`),
  createBorrow: (payload) => req("/borrow", { method: "POST", body: JSON.stringify(payload) }),
  listBorrow: () => req("/borrow"),
  actBorrow: (id, status) =>
    req(`/borrow/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  uploadBorrowDoc: (id, payload) =>
    req(`/borrow/${id}/document`, { method: "POST", body: JSON.stringify(payload) }),
  getBorrowDoc: (id) => req(`/borrow/${id}/document`),
  // ข้อมูลที่กรอกในใบยืม-คืน (บันทึก/โหลดลง DB)
  getBorrowMemo: (id) => req(`/borrow/${id}/memo`),
  saveBorrowMemo: (id, data) =>
    req(`/borrow/${id}/memo`, { method: "PUT", body: JSON.stringify({ data }) }),
  // alerts + audit
  alerts: () => req("/alerts"),
  audit: () => req("/audit"),
  // analytics (ผลจาก notebook: ML/Optimization)
  analyticsModels: () => req("/analytics/models"),
  analyticsWastage: () => req("/analytics/wastage"),
  analyticsForecast: () => req("/analytics/forecast"),
  analyticsTransshipment: () => req("/analytics/transshipment"),
  // reorder / สั่งซื้อ → HOSxP
  orders: () => req("/orders"),
  dispatchOrder: (id) => req(`/orders/${id}/dispatch`, { method: "POST" }),
  retrain: () => req("/retrain", { method: "POST" }),
  // dynamic expire — จำลอง event ละลาย/เปิดขวด → overwrite อายุขัย (เปลี่ยนสถานะอัตโนมัติ)
  transitionVial: (vialId, toState) =>
    req(`/vials/${vialId}/transition`, { method: "POST", body: JSON.stringify(toState ? { to_state: toState } : {}) }),
};
