import { useEffect, useState } from "react";
import { api } from "../api";
import Pagination, { usePaged } from "./Pagination.jsx";

export default function PrivacyPanel() {
  const [p, setP] = useState(null);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [q, setQ] = useState("");
  const [showTls, setShowTls] = useState(false);
  const [keys, setKeys] = useState({});   // hospital_id -> คีย์ 4 หลัก
  const [pwMsg, setPwMsg] = useState(null);

  async function issueKey(u) {
    try { const r = await api.adminResetKey(u); setKeys((k) => ({ ...k, [u]: r.key })); setPwMsg(null); }
    catch (e) { setPwMsg("⚠️ " + e.message); }
  }
  async function resetPw(u) {
    if (!window.confirm(`รีเซ็ตรหัสผ่าน ${u} เป็น medcast123 ?`)) return;
    try { await api.adminResetPassword(u); setPwMsg(`♻️ รีเซ็ต ${u} เป็น medcast123 แล้ว`); }
    catch (e) { setPwMsg("⚠️ " + e.message); }
  }

  const kw = q.trim().toLowerCase();
  // เรียง: online ก่อน แล้วตาม login ล่าสุด
  const list = (p?.hospitals || [])
    .filter((h) => !onlineOnly || h.online)
    .filter((h) => kw === "" ||
      h.name.toLowerCase().includes(kw) || h.hospital_id.toLowerCase().includes(kw))
    .sort((a, b) =>
      (b.online ? 1 : 0) - (a.online ? 1 : 0) ||
      new Date(b.last_login || 0) - new Date(a.last_login || 0));
  const paged = usePaged(list, 15);

  useEffect(() => { api.privacy().then(setP).catch(console.error); }, []);
  if (!p) return <div className="panel">กำลังโหลด...</div>;

  const fmt = (ts) => (ts ? new Date(ts).toLocaleString("th-TH") : "— ยังไม่เคยเข้าระบบ");

  return (
    <div className="panel">
      <h2>🔒 Privacy Control Center</h2>
      <div className="kpi-row">
        <div className="kpi"><div className="label">Federated Learning</div><div className="value">✅ Active</div></div>
        <div className="kpi"><div className="label">Differential Privacy</div><div className="value">✅ σ={p.differential_privacy.sigma}</div></div>
        <div className="kpi" style={{ cursor: "pointer" }} onClick={() => setShowTls((v) => !v)}>
          <div className="label">การเข้ารหัส (คลิกดูวิธี)</div><div className="value">🔒 {p.transport}</div></div>
        <div className="kpi"><div className="label">รพ. ออนไลน์</div><div className="value">🟢 {p.online_count}/{p.hospitals.length}</div></div>
      </div>

      {showTls && (
        <div className="tls-box">
          <b>🔐 การเข้ารหัสการรับส่งข้อมูลด้วย TLS/SSL</b>
          <ol>
            <li>ทุกการเชื่อมต่อ รพ. ↔ ศูนย์กลาง วิ่งผ่าน <b>HTTPS (TLS 1.2/1.3)</b> — เข้ารหัสระดับ transport ตลอดเส้นทาง</li>
            <li><b>Nginx (reverse proxy)</b> ทำ TLS termination ด้วยใบรับรอง (certificate) จาก Let's Encrypt หรือ CA ขององค์กร</li>
            <li>บังคับ HTTPS: redirect 80 → 443 + เปิด <b>HSTS</b>, ปิด protocol/cipher เก่า (SSLv3/TLS1.0)</li>
            <li><b>weight + payload</b> ที่ส่ง (เช่น <code>POST /api/...</code>) ถูกเข้ารหัส — ดักจับระหว่างทางก็ถอดอ่านไม่ได้</li>
            <li>ต่ออายุใบรับรองอัตโนมัติด้วย <b>certbot</b> + รวมกับ Differential Privacy → ปลอดภัย 2 ชั้น</li>
          </ol>
          <span className="muted">หมายเหตุ: prototype สาธิตรันบน HTTP (dev) — production เปิด TLS ที่ Nginx ตามขั้นตอนข้างต้น</span>
        </div>
      )}

      <p className="muted">
        <b>ข้อมูลคนไข้ดิบไม่เคยออกจากโรงพยาบาล</b> — สิ่งที่ส่งขึ้นศูนย์กลางมีแค่ weight {p.n_weights} ค่า
        (+ Differential Privacy noise) ผ่าน Secure Aggregation + {p.transport}
      </p>

      <div className="filterbar">
        <b>สถานะการเชื่อมต่อ</b>
        <span className="muted">(🟢 online = เข้าระบบภายใน 30 นาที)</span>
        <input className="search" placeholder="🔍 ค้นหาโรงพยาบาล (ชื่อ / รหัส)"
               value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="muted" style={{ whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked)} /> เฉพาะออนไลน์
        </label>
      </div>

      {pwMsg && <p className="muted">{pwMsg}</p>}
      <table>
        <thead><tr><th>รหัส</th><th>โรงพยาบาล</th><th>สถานะเชื่อมต่อ</th><th>เข้าระบบล่าสุด</th><th>จัดการรหัสผ่าน</th></tr></thead>
        <tbody>
          {paged.slice.map((h) => (
            <tr key={h.hospital_id}>
              <td>{h.hospital_id}</td>
              <td>{h.name}</td>
              <td>{h.online ? "🟢 Online" : "⚪ Offline"}</td>
              <td className="muted">{fmt(h.last_login)}</td>
              <td>
                <button className="mini doc" onClick={() => issueKey(h.hospital_id)}>🔑 ขอคีย์</button>
                <button className="mini no" style={{ marginLeft: 4 }} onClick={() => resetPw(h.hospital_id)}>♻️ รีเซ็ต</button>
                {keys[h.hospital_id] && (
                  <b style={{ marginLeft: 8 }}>คีย์: {keys[h.hospital_id]}</b>
                )}
              </td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan="5" className="muted">ไม่พบโรงพยาบาลที่ตรงเงื่อนไข</td></tr>}
        </tbody>
      </table>
      <Pagination {...paged} />

      <h3 style={{ marginBottom: 6 }}>กระแสข้อมูลแบบรักษาความเป็นส่วนตัว</h3>
      <div className="flow">{`raw data (อยู่ใน รพ.)
   → feature engineering → train local model
   → weight → + Differential Privacy noise
   → Secure Aggregation → ${p.transport} ──▶ ศูนย์กลาง (FedAvg)
   ◀── ส่ง weight กลางกลับ → ทุก รพ. พยากรณ์ในเครื่อง`}</div>
    </div>
  );
}
