// เรียก backend ผ่าน /api (dev: vite proxy, prod: nginx proxy)
const BASE = "/api";

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

export const api = {
  summary: () => get("/summary"),
  hospitals: () => get("/hospitals"),
  forecasts: (hospitalId) =>
    get(`/forecasts${hospitalId ? `?hospital_id=${hospitalId}` : ""}`),
  privacy: () => get("/privacy"),
  weights: () => get("/weights"),
};
