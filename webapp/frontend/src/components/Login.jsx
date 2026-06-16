import { useState } from "react";
import { api, auth } from "../api";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api.login(username.trim(), password);
      auth.token = r.token;
      auth.hospital = { hospital_id: r.hospital_id, name: r.name, role: r.role };
      onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="panel login-card" onSubmit={submit}>
        <h1 className="title">💊 MedCast_Secure</h1>
        <p className="subtitle">เข้าสู่ระบบสำหรับโรงพยาบาล</p>

        <label className="muted">ชื่อผู้ใช้ (รหัสโรงพยาบาล)</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)}
               placeholder="HOSP_001" autoFocus />

        <label className="muted">รหัสผ่าน</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
               placeholder="••••••••" />

        {error && <p style={{ color: "var(--red)" }}>{error}</p>}
        <button className="tab active" type="submit" disabled={loading}>
          {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
        </button>
        <p className="muted" style={{ fontSize: "0.8rem" }}>
          🏥 รพ.: <b>HOSP_001…HOSP_004</b> (เห็นเฉพาะของตัวเอง)<br />
          🛡️ admin: <b>admin</b> (เห็นทุก รพ.) · รหัสผ่าน <b>medcast123</b>
        </p>
      </form>
    </div>
  );
}
