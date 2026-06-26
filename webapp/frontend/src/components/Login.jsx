import { useState } from "react";
import { api, auth } from "../api";

export default function Login({ onLogin }) {
  const [mode, setMode] = useState("login"); // 'login' | 'change'
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [key, setKey] = useState("");
  const [newPw, setNewPw] = useState("");
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null); setMsg(null); setLoading(true);
    try {
      if (mode === "login") {
        const r = await api.login(username.trim(), password);
        auth.token = r.token;
        auth.hospital = { hospital_id: r.hospital_id, name: r.name, role: r.role };
        onLogin();
      } else {
        await api.changePassword(username.trim(), key.trim(), newPw);
        setMsg("✅ เปลี่ยนรหัสผ่านสำเร็จ — เข้าสู่ระบบด้วยรหัสใหม่ได้เลย");
        setMode("login"); setPassword(""); setKey(""); setNewPw("");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="panel login-card" onSubmit={submit}>
        <h1 className="title">💊 VaxFlow</h1>
        <p className="subtitle">
          {mode === "login" ? "เข้าสู่ระบบสำหรับโรงพยาบาล" : "เปลี่ยนรหัสผ่าน (ใช้คีย์จาก admin)"}
        </p>

        <label className="muted">ชื่อผู้ใช้ (รหัสโรงพยาบาล)</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="HOSP_001" autoFocus />

        {mode === "login" ? (
          <>
            <label className="muted">รหัสผ่าน</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </>
        ) : (
          <>
            <label className="muted">คีย์เปลี่ยนรหัส (4 หลัก จาก admin)</label>
            <input inputMode="numeric" maxLength={4} value={key}
                   onChange={(e) => setKey(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0000" />
            <label className="muted">รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)</label>
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="••••••••" />
          </>
        )}

        {error && <p style={{ color: "var(--red)" }}>{error}</p>}
        {msg && <p style={{ color: "var(--green)" }}>{msg}</p>}

        <button className="tab active" type="submit" disabled={loading}>
          {loading ? "กำลังดำเนินการ..." : mode === "login" ? "เข้าสู่ระบบ" : "เปลี่ยนรหัสผ่าน"}
        </button>

        <button type="button" className="tab" onClick={() => { setMode(mode === "login" ? "change" : "login"); setError(null); setMsg(null); }}>
          {mode === "login" ? "🔑 เปลี่ยนรหัสผ่าน" : "← กลับไปเข้าสู่ระบบ"}
        </button>
      </form>
    </div>
  );
}
