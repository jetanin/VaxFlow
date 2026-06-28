import { useEffect, useState } from "react";
import { api, auth } from "./api";
import Login from "./components/Login.jsx";
import OverviewMap from "./components/OverviewMap.jsx";
import Borrow from "./components/Borrow.jsx";
import Alerts from "./components/Alerts.jsx";
import AuditTrail from "./components/AuditTrail.jsx";
import Vaccines from "./components/Vaccines.jsx";
import Analytics from "./components/Analytics.jsx";

// hospitalOnly = แสดงเฉพาะผู้ใช้ระดับโรงพยาบาล (admin เป็นผู้ดูภาพรวม ไม่ทำรายการยืม)
const ALL_TABS = [
  { id: "map", label: "🗺️ Overview Map" },
  { id: "vaccines", label: "💉 วัคซีนทั้งหมด" },
  { id: "analytics", label: "📊 วิเคราะห์ (AI)" },
  { id: "alerts", label: "🔔 แจ้งเตือน", hospitalOnly: true },
  { id: "borrow", label: "🤝 ยืมวัคซีน", hospitalOnly: true },
  { id: "audit", label: "📜 Audit Trail", adminOnly: true },
];

export default function App() {
  const [authed, setAuthed] = useState(!!auth.token);
  const [tab, setTab] = useState("map");
  const [summary, setSummary] = useState(null);
  const [hospitals, setHospitals] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!authed) return;
    Promise.all([api.summary(), api.hospitals()])
      .then(([s, h]) => { setSummary(s); setHospitals(h); })
      .catch((e) => {
        if (e.status === 401) { auth.logout(); setAuthed(false); }
        else setError(e.message);
      });
  }, [authed]);

  // คง online ไว้ตราบใดที่แท็บยังเปิด: heartbeat ทันที + ทุก 45 วินาที
  // ปิดแท็บ (pagehide) → แจ้ง backend ว่า offline ทันที (token ใน sessionStorage หายเอง → ต้อง login ใหม่)
  useEffect(() => {
    if (!authed) return;
    api.heartbeat().catch(() => {});
    const hb = setInterval(() => api.heartbeat().catch(() => {}), 45000);
    const onHide = () => auth.goOffline();
    window.addEventListener("pagehide", onHide);
    return () => { clearInterval(hb); window.removeEventListener("pagehide", onHide); };
  }, [authed]);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  if (error) return <div className="app"><h1 className="title">⚠️ {error}</h1></div>;
  if (!summary) return <div className="app"><p className="muted">กำลังโหลด...</p></div>;

  const me = auth.hospital;
  const isAdmin = me?.role === "admin";
  // admin เห็นทุกแท็บ; hospital ไม่เห็นแท็บ adminOnly
  const TABS = ALL_TABS.filter((t) => isAdmin || !t.adminOnly);
  const activeTab = TABS.some((t) => t.id === tab) ? tab : "map";

  return (
    <div className="app">
      <div className="topbar">
        <div>
          <h1 className="title">💉 VaxFlow — Predictive Vaccine Shared Inventory</h1>
          <p className="subtitle">เครือข่ายแบ่งปันวัคซีน · ลด Vaccine Wastage</p>
        </div>
        <div className="user-box">
          <span className="muted">{isAdmin ? "🛡️ " : "🏥 "}{me?.name || me?.hospital_id}</span>
          <span className={`badge ${isAdmin ? "red" : "green"}`}>{isAdmin ? "ADMIN" : "HOSPITAL"}</span>
          <button className="tab" onClick={async () => {
            try { await api.logoutServer(); } catch { /* best-effort */ }
            auth.logout(); setAuthed(false);
          }}>ออกจากระบบ</button>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi"><div className="label">โรงพยาบาลที่เชื่อมต่อ</div><div className="value">{summary.hospitals}</div></div>
        <div className="kpi"><div className="label">🔴 วิกฤต (≤14 วัน)</div><div className="value">{summary.red_items}</div></div>
        <div className="kpi"><div className="label">🟡 ใกล้หมดอายุ (≤21 วัน)</div><div className="value">{summary.yellow_items}</div></div>
        <div className="kpi"><div className="label">💉 ขวดที่เปิดแล้ว</div><div className="value">{summary.opened_vials}</div></div>
        <div className="kpi"><div className="label">โดสคงคลังรวม</div><div className="value">{Number(summary.total_doses).toLocaleString()}</div></div>
      </div>

      <div className="tabbar">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${activeTab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div key={activeTab}>
        {activeTab === "map" && <OverviewMap hospitals={hospitals} />}
        {activeTab === "vaccines" && <Vaccines />}
        {activeTab === "analytics" && <Analytics />}
        {activeTab === "alerts" && <Alerts />}
        {activeTab === "borrow" && <Borrow />}
        {activeTab === "audit" && <AuditTrail />}
      </div>

      <p className="subtitle" style={{ marginTop: 16 }}>VaxFlow · Logistics Innovation Hackathon 2026</p>
    </div>
  );
}
