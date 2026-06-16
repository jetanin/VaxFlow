import { useEffect, useState } from "react";
import { api } from "../api";

const ACTION_TH = {
  login: "🔑 เข้าสู่ระบบ",
  create_borrow: "📤 ขอยืมยา",
  approve_borrow: "✅ อนุมัติ",
  reject_borrow: "❌ ปฏิเสธ",
  retrain_forecast: "🔄 อัปเดตพยากรณ์อัตโนมัติ",
};

export default function AuditTrail() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => { api.audit().then(setRows).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="panel muted">⚠️ {err}</div>;

  return (
    <div className="panel">
      <h2>📜 Audit Trail — บันทึกธุรกรรม (แก้ย้อนหลังไม่ได้)</h2>
      <p className="muted" style={{ fontSize: "0.82rem" }}>
        บันทึก timestamp + IP ทุกครั้งที่มีการทำธุรกรรม เพื่อความโปร่งใสและตรวจสอบได้ (e-Document compliance)
      </p>
      <table>
        <thead>
          <tr><th>เวลา</th><th>ผู้ทำรายการ</th><th>การกระทำ</th><th>รายละเอียด</th><th>IP</th><th>ตำแหน่ง</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="muted">{new Date(r.ts).toLocaleString("th-TH")}</td>
              <td>{r.actor_name || r.actor || "-"}</td>
              <td>{ACTION_TH[r.action] || r.action}</td>
              <td className="muted">{r.detail}</td>
              <td className="muted">{r.ip}</td>
              <td className="muted">📍 {r.ip_location || "-"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan="6" className="muted">ยังไม่มีบันทึก</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
