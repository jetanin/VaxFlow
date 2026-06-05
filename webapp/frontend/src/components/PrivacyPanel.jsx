import { useEffect, useState } from "react";
import { api } from "../api";

export default function PrivacyPanel() {
  const [p, setP] = useState(null);

  useEffect(() => { api.privacy().then(setP).catch(console.error); }, []);
  if (!p) return <div className="panel">กำลังโหลด...</div>;

  return (
    <div className="panel">
      <h2>🔒 Privacy Control Center</h2>
      <div className="kpi-row">
        <div className="kpi"><div className="label">Federated Learning</div><div className="value">✅ Active</div></div>
        <div className="kpi"><div className="label">Differential Privacy</div><div className="value">✅ σ={p.differential_privacy.sigma}</div></div>
        <div className="kpi"><div className="label">การเข้ารหัส</div><div className="value">🔒 {p.transport}</div></div>
        <div className="kpi"><div className="label">weight ที่ส่ง</div><div className="value">{p.n_weights} ค่า</div></div>
      </div>

      <p className="muted">
        <b>ข้อมูลคนไข้ดิบไม่เคยออกจากโรงพยาบาล</b> — สิ่งที่ส่งขึ้นศูนย์กลางมีแค่ weight {p.n_weights} ค่า
        (+ Differential Privacy noise) ผ่าน Secure Aggregation + {p.transport}
      </p>

      <table>
        <thead><tr><th>รหัส</th><th>โรงพยาบาล</th><th>สถานะเชื่อมต่อ</th><th>Secure Agg.</th><th>DP σ</th></tr></thead>
        <tbody>
          {p.hospitals.map((h) => (
            <tr key={h.hospital_id}>
              <td>{h.hospital_id}</td>
              <td>{h.name}</td>
              <td>{h.online ? "🟢 Online" : "⚪ Offline"}</td>
              <td>{p.secure_aggregation ? "✅" : "—"}</td>
              <td>{p.differential_privacy.sigma}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginBottom: 6 }}>กระแสข้อมูลแบบรักษาความเป็นส่วนตัว</h3>
      <div className="flow">{`raw data (อยู่ใน รพ.)
   → feature engineering → train local model
   → weight → + Differential Privacy noise
   → Secure Aggregation → ${p.transport} ──▶ ศูนย์กลาง (FedAvg)
   ◀── ส่ง weight กลางกลับ → ทุก รพ. พยากรณ์ในเครื่อง`}</div>
    </div>
  );
}
