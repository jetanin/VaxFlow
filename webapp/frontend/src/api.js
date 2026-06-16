// เรียก backend ผ่าน /api (dev: vite proxy, prod: nginx proxy)
const BASE = "/api";
const TOKEN_KEY = "medcast_token";

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  set token(v) { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); },
  get hospital() {
    const h = localStorage.getItem("medcast_hospital");
    return h ? JSON.parse(h) : null;
  },
  set hospital(v) {
    v ? localStorage.setItem("medcast_hospital", JSON.stringify(v))
      : localStorage.removeItem("medcast_hospital");
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
  // public-ish
  summary: () => req("/summary"),
  hospitals: () => req("/hospitals"),
  drugs: () => req("/drugs"),
  forecasts: (hospitalId, status) =>
    req(`/forecasts?${hospitalId ? `hospital_id=${hospitalId}&` : ""}${status ? `status=${status}` : ""}`),
  privacy: () => req("/privacy"),
  // auth
  login: (username, password) =>
    req("/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  // borrow
  lenders: (drug) => req(`/lenders?drug=${encodeURIComponent(drug)}`),
  createBorrow: (payload) => req("/borrow", { method: "POST", body: JSON.stringify(payload) }),
  listBorrow: () => req("/borrow"),
  actBorrow: (id, status) =>
    req(`/borrow/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  // alerts + audit
  alerts: () => req("/alerts"),
  audit: () => req("/audit"),
};
