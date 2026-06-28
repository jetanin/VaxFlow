import { useEffect, useState } from "react";
import { api, auth } from "../api";
import Pagination, { usePaged } from "./Pagination.jsx";

// 📊 ผลวิเคราะห์จาก notebook (ML/Optimization) ที่ seed เข้า Postgres แล้ว
//    Wastage + Model comparison = ระดับเครือข่าย · Forecast/Transshipment = scope ตาม รพ.
export default function Analytics() {
  const me = auth.hospital;
  const isAdmin = me?.role === "admin";
  const [models, setModels] = useState([]);
  const [wastage, setWastage] = useState([]);
  const [forecast, setForecast] = useState([]);
  const [moves, setMoves] = useState([]);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    Promise.all([
      api.analyticsModels(), api.analyticsWastage(),
      api.analyticsForecast(), api.analyticsTransshipment(),
    ])
      .then(([m, w, f, t]) => { setModels(m); setWastage(w); setForecast(f); setMoves(t); })
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="panel muted">⚠️ {err}</div>;

  // Wastage KPI: % ที่ลดได้ (Without -> With)
  const without = wastage.find((r) => /without/i.test(r.scenario));
  const withVf = wastage.find((r) => /with/i.test(r.scenario) && !/without/i.test(r.scenario));
  const reduction = without?.total_waste
    ? ((without.total_waste - (withVf?.total_waste ?? 0)) / without.total_waste) * 100
    : null;

  const kw = q.trim().toLowerCase();
  const fFiltered = forecast.filter(
    (r) => kw === "" ||
      [r.hospital_name, r.hospital_id, r.product_name, r.product_id, r.winner]
        .some((v) => v && String(v).toLowerCase().includes(kw))
  );
  const paged = usePaged(fFiltered, 25);
  const fmt = (v, d = 2) => (v == null ? "—" : Number(v).toFixed(d));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── Wastage Simulation ── */}
      <div className="panel">
        <h2>♻️ Wastage Simulation — Without vs With VaxFlow</h2>
        {wastage.length === 0 ? (
          <p className="muted">ยังไม่มีผล — รัน <code>notebook/05_model_evaluation.ipynb</code> แล้ว reseed</p>
        ) : (
          <>
            {reduction != null && (
              <div className="kpi-row" style={{ marginBottom: 12 }}>
                <div className="kpi"><div className="label">โดสสูญเสีย (ไม่มี VaxFlow)</div>
                  <div className="value">{Number(without.total_waste).toLocaleString()}</div></div>
                <div className="kpi"><div className="label">โดสสูญเสีย (มี VaxFlow)</div>
                  <div className="value">{Number(withVf?.total_waste ?? 0).toLocaleString()}</div></div>
                <div className="kpi"><div className="label">ลดการสูญเสีย</div>
                  <div className="value" style={{ color: reduction >= 30 ? "var(--green)" : "var(--yellow)" }}>
                    {reduction.toFixed(1)}%</div></div>
              </div>
            )}
            <table>
              <thead><tr><th>สถานการณ์</th><th>Expiry waste</th><th>Open-vial waste</th><th>รวม (โดส)</th></tr></thead>
              <tbody>
                {wastage.map((r) => (
                  <tr key={r.scenario}>
                    <td><b>{r.scenario}</b></td>
                    <td>{fmt(r.expiry_waste, 0)}</td>
                    <td>{fmt(r.openvial_waste, 0)}</td>
                    <td>{fmt(r.total_waste, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* ── Model comparison ── */}
      <div className="panel">
        <h2>🤖 เปรียบเทียบโมเดลพยากรณ์ดีมานด์</h2>
        {models.length === 0 ? (
          <p className="muted">ยังไม่มีผล — รัน <code>notebook/04_model_training.ipynb</code> แล้ว reseed</p>
        ) : (
          <table>
            <thead><tr><th>โมเดล</th><th>MAE</th><th>RMSE ↓</th><th>R²</th></tr></thead>
            <tbody>
              {models.map((r, i) => (
                <tr key={r.model}>
                  <td>{i === 0 ? "🏆 " : ""}<b>{r.model}</b></td>
                  <td>{fmt(r.mae)}</td>
                  <td>{i === 0 ? <span className="badge green">{fmt(r.rmse)}</span> : fmt(r.rmse)}</td>
                  <td>{fmt(r.r2, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Transshipment plan ── */}
      <div className="panel">
        <h2>🚚 แผนโอนย้ายล็อตเสี่ยง (Transportation Model)</h2>
        {moves.length === 0 ? (
          <p className="muted">ไม่มีแผนโอนย้าย{isAdmin ? "" : "ที่เกี่ยวข้องกับโรงพยาบาลของคุณ"} — รัน NB04 แล้ว reseed</p>
        ) : (
          <table>
            <thead><tr><th>จาก</th><th>ไป</th><th>วัคซีน</th><th>โดส</th></tr></thead>
            <tbody>
              {moves.map((r, i) => (
                <tr key={i}>
                  <td>{r.from_name || r.from_hospital}</td>
                  <td>{r.to_name || r.to_hospital}</td>
                  <td>{r.product_name || r.product_id}<br />
                    <span className="muted" style={{ fontSize: "0.78rem" }}>{r.product_id}</span></td>
                  <td><span className="badge green">{Number(r.doses).toLocaleString()}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Forecast model selection (per รพ.×product) ── */}
      <div className="panel">
        <h2>📈 การเลือกโมเดลพยากรณ์ต่อสาขา {isAdmin ? "(ทุกโรงพยาบาล)" : `(${me?.name || me?.hospital_id})`}</h2>
        <div className="filterbar">
          <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
            SMA-7 เทียบ Exponential Smoothing · แสดง {fFiltered.length}/{forecast.length} · เรียงตามความผันผวนสูงสุด
          </p>
          <span style={{ flex: 1 }} />
          <input className="search" placeholder="🔍 ค้นหา (รพ. / วัคซีน / winner)"
                 value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <table>
          <thead>
            <tr>
              {isAdmin && <th>โรงพยาบาล</th>}
              <th>วัคซีน</th><th>SMA-7 RMSE</th><th>α ที่ดีสุด</th><th>ES RMSE</th><th>ผู้ชนะ</th>
            </tr>
          </thead>
          <tbody>
            {paged.slice.map((r, i) => (
              <tr key={i}>
                {isAdmin && <td>{r.hospital_name || r.hospital_id}</td>}
                <td>{r.product_name || r.product_id}<br />
                  <span className="muted" style={{ fontSize: "0.78rem" }}>{r.product_id}</span></td>
                <td>{fmt(r.sma7_rmse)}</td>
                <td>{fmt(r.best_alpha, 1)}</td>
                <td>{fmt(r.es_rmse)}</td>
                <td><span className={`badge ${r.winner === "ES" ? "yellow" : "green"}`}>{r.winner}</span></td>
              </tr>
            ))}
            {fFiltered.length === 0 && (
              <tr><td colSpan={isAdmin ? 6 : 5} className="muted">
                {q ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีผล — รัน NB04 แล้ว reseed"}</td></tr>
            )}
          </tbody>
        </table>
        <Pagination {...paged} />
      </div>
    </div>
  );
}
