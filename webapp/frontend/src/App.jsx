import { useEffect, useState } from "react";
import { api, auth } from "./api";
import Login from "./components/Login.jsx";
import OverviewMap from "./components/OverviewMap.jsx";
import AIIntelligence from "./components/AIIntelligence.jsx";
import PrivacyPanel from "./components/PrivacyPanel.jsx";
import Borrow from "./components/Borrow.jsx";
import Alerts from "./components/Alerts.jsx";
import AuditTrail from "./components/AuditTrail.jsx";
import Drugs from "./components/Drugs.jsx";

// hospitalOnly = แสดงเฉพาะผู้ใช้ระดับโรงพยาบาล (admin เป็นผู้ดูภาพรวม ไม่ทำรายการยืม)
const ALL_TABS = [
  { id: "map", label: "🗺️ Overview Map" },
  { id: "ai", label: "🤖 AI Intelligence" },
  { id: "drugs", label: "💊 ยาทั้งหมด" },
  { id: "alerts", label: "🔔 แจ้งเตือน", hospitalOnly: true },
  { id: "borrow", label: "🤝 ยืมยา", hospitalOnly: true },
  { id: "audit", label: "📜 Audit Trail", adminOnly: true },
  { id: "privacy", label: "🔒 Privacy Control", adminOnly: true },
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
          <h1 className="title">💊 MedCast_Secure — ศูนย์เฝ้าระวังการขาดแคลนยา</h1>
          <p className="subtitle">Federated Learning + Differential Privacy</p>
        </div>
        <div className="user-box">
          <span className="muted">{isAdmin ? "🛡️ " : "🏥 "}{me?.name || me?.hospital_id}</span>
          <span className={`badge ${isAdmin ? "red" : "green"}`}>{isAdmin ? "ADMIN" : "HOSPITAL"}</span>
          <button className="tab" onClick={() => { auth.logout(); setAuthed(false); }}>ออกจากระบบ</button>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi"><div className="label">โรงพยาบาลที่เชื่อมต่อ</div><div className="value">{summary.hospitals}</div></div>
        <div className="kpi"><div className="label">🔴 ยาขาดแคลน</div><div className="value">{summary.red_items}</div></div>
        <div className="kpi"><div className="label">🟡 ยาใกล้หมด</div><div className="value">{summary.yellow_items}</div></div>
        <div className="kpi"><div className="label">Confidence เฉลี่ย</div><div className="value">{Math.round(summary.avg_confidence * 100)}%</div></div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${activeTab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "map" && <OverviewMap hospitals={hospitals} />}
      {activeTab === "ai" && <AIIntelligence hospitals={hospitals} />}
      {activeTab === "drugs" && <Drugs />}
      {activeTab === "alerts" && <Alerts />}
      {activeTab === "borrow" && <Borrow />}
      {activeTab === "audit" && <AuditTrail />}
      {activeTab === "privacy" && <PrivacyPanel />}

      <p className="subtitle" style={{ marginTop: 16 }}>MedCast_Secure · Logistics Innovation Hackathon 2026</p>
    </div>
  );
}
