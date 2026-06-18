import { useEffect, useState } from "react";
import { api } from "../api";
import Pagination, { usePaged } from "./Pagination.jsx";

const ACTION_TH = {
  login: "🔑 เข้าสู่ระบบ",
  logout: "🚪 ออกจากระบบ",
  create_borrow: "📤 ขอยืมยา",
  approve_borrow: "✅ อนุมัติ",
  reject_borrow: "❌ ปฏิเสธ",
  retrain_forecast: "🔄 อัปเดตพยากรณ์อัตโนมัติ",
  fl_submit: "📡 รพ. ส่ง weight (FL)",
  fl_aggregate: "🧮 รวม weight กลาง (FedAvg)",
  upload_signed: "⬆️ อัปโหลดเอกสารเซ็นแล้ว",
  issue_reset_key: "🔑 ออกคีย์เปลี่ยนรหัส",
  reset_password: "♻️ รีเซ็ตรหัสผ่าน",
  change_password: "🔐 เปลี่ยนรหัสผ่าน",
};

export default function AuditTrail() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);

  const paged = usePaged(rows, 20);
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
          {paged.slice.map((r) => (
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
      <Pagination {...paged} />
    </div>
  );
}
