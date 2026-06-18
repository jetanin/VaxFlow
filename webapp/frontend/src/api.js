// เรียก backend ผ่าน /api (dev: vite proxy, prod: nginx proxy)
const BASE = "/api";
const TOKEN_KEY = "medcast_token";

// ใช้ sessionStorage (ไม่ใช่ localStorage): token อยู่แค่ในแท็บนั้น
// → ปิดแท็บ = token หาย = ต้อง login ใหม่ · refresh ในแท็บเดิม = token ยังอยู่
export const auth = {
  get token() { return sessionStorage.getItem(TOKEN_KEY); },
  set token(v) { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); },
  get hospital() {
    const h = sessionStorage.getItem("medcast_hospital");
    return h ? JSON.parse(h) : null;
  },
  set hospital(v) {
    v ? sessionStorage.setItem("medcast_hospital", JSON.stringify(v))
      : sessionStorage.removeItem("medcast_hospital");
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

// granularity ที่ผู้ใช้เลือก (daily | weekly) — เก็บใน localStorage
export const prefs = {
  get freq() { return localStorage.getItem("medcast_freq") || "daily"; },
  set freq(v) { localStorage.setItem("medcast_freq", v); },
};
const fq = () => `freq=${prefs.freq}`;

export const api = {
  // public-ish (ขึ้นกับ freq ที่เลือก)
  summary: () => req(`/summary?${fq()}`),
  hospitals: () => req(`/hospitals?${fq()}`),
  drugs: () => req(`/drugs?${fq()}`),
  forecasts: (hospitalId, status) =>
    req(`/forecasts?${fq()}${hospitalId ? `&hospital_id=${hospitalId}` : ""}${status ? `&status=${status}` : ""}`),
  privacy: () => req("/privacy"),
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
  lenders: (drug) => req(`/lenders?drug=${encodeURIComponent(drug)}`),
  createBorrow: (payload) => req("/borrow", { method: "POST", body: JSON.stringify(payload) }),
  listBorrow: () => req("/borrow"),
  actBorrow: (id, status) =>
    req(`/borrow/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  uploadBorrowDoc: (id, payload) =>
    req(`/borrow/${id}/document`, { method: "POST", body: JSON.stringify(payload) }),
  getBorrowDoc: (id) => req(`/borrow/${id}/document`),
  // alerts + audit
  alerts: () => req(`/alerts?${fq()}`),
  audit: () => req("/audit"),
};
