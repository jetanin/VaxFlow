import { useEffect, useState } from "react";
import { api } from "./api";
import OverviewMap from "./components/OverviewMap.jsx";
import AIIntelligence from "./components/AIIntelligence.jsx";
import PrivacyPanel from "./components/PrivacyPanel.jsx";

const TABS = [
  { id: "map", label: "🗺️ Overview Map" },
  { id: "ai", label: "🤖 AI Intelligence" },
  { id: "privacy", label: "🔒 Privacy Control" },
];

export default function App() {
  const [tab, setTab] = useState("map");
  const [summary, setSummary] = useState(null);
  const [hospitals, setHospitals] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.summary(), api.hospitals()])
      .then(([s, h]) => { setSummary(s); setHospitals(h); })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="app"><h1 className="title">⚠️ เชื่อมต่อ backend ไม่ได้</h1><p className="muted">{error}</p></div>;
  if (!summary) return <div className="app"><p className="muted">กำลังโหลด...</p></div>;

  return (
    <div className="app">
      <h1 className="title">💊 MedCast_Secure — ศูนย์เฝ้าระวังการขาดแคลนยา</h1>
      <p className="subtitle">พยากรณ์ความต้องการยาข้ามโรงพยาบาลแบบรักษาความเป็นส่วนตัว (Federated Learning + Differential Privacy)</p>

      <div className="kpi-row">
        <div className="kpi"><div className="label">โรงพยาบาลที่เชื่อมต่อ</div><div className="value">{summary.hospitals}</div></div>
        <div className="kpi"><div className="label">🔴 ยาขาดแคลน</div><div className="value">{summary.red_items}</div></div>
        <div className="kpi"><div className="label">🟡 ยาใกล้หมด</div><div className="value">{summary.yellow_items}</div></div>
        <div className="kpi"><div className="label">Confidence เฉลี่ย</div><div className="value">{Math.round(summary.avg_confidence * 100)}%</div></div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "map" && <OverviewMap hospitals={hospitals} />}
      {tab === "ai" && <AIIntelligence hospitals={hospitals} />}
      {tab === "privacy" && <PrivacyPanel />}

      <p className="subtitle" style={{ marginTop: 16 }}>MedCast_Secure · Logistics Innovation Hackathon 2026</p>
    </div>
  );
}
