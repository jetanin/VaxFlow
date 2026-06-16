import { useEffect, useState } from "react";
import { api, auth } from "../api";

const STATUS_TH = { green: "🟢", yellow: "🟡", red: "🔴" };

function expiryBadge(days) {
  if (days < 0) return <span className="badge red">หมดอายุแล้ว</span>;
  if (days <= 30) return <span className="badge red">{days} วัน</span>;
  if (days <= 90) return <span className="badge yellow">{days} วัน</span>;
  return <span className="badge green">{days} วัน</span>;
}

export default function Alerts() {
  const me = auth.hospital;
  const isAdmin = me?.role === "admin";
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => { api.alerts().then(setData).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="panel muted">⚠️ {err}</div>;
  if (!data) return <div className="panel muted">กำลังโหลด...</div>;

  return (
    <div>
      <p className="muted">การแจ้งเตือน {isAdmin ? "(ทุกโรงพยาบาล)" : `ของ 🏥 ${me?.name || me?.hospital_id}`}</p>

      {/* Expiry / FEFO */}
      <div className="panel">
        <h2>⏳ ใกล้หมดอายุ (FEFO — First-Expired-First-Out)</h2>
        <table>
          <thead><tr>{isAdmin && <th>รพ.</th>}<th>ยา</th><th>รายละเอียด</th><th>คงคลัง</th><th>วันหมดอายุ</th><th>เหลือ</th></tr></thead>
          <tbody>
            {data.expiring.map((r, i) => (
              <tr key={i}>
                {isAdmin && <td>{r.hospital_id}</td>}
                <td>{r.drug}</td><td className="muted">{r.desc_th}</td>
                <td>{r.stock_on_hand?.toFixed(0)}</td><td>{r.expiry_date}</td>
                <td>{expiryBadge(r.days_to_expiry)}</td>
              </tr>
            ))}
            {data.expiring.length === 0 && <tr><td colSpan={isAdmin ? 6 : 5} className="muted">ไม่มียาใกล้หมดอายุ 🎉</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="row">
        {/* Reorder point */}
        <div className="panel">
          <h2>📦 ต่ำกว่าจุดสั่งซื้อ (Reorder Point)</h2>
          <table>
            <thead><tr>{isAdmin && <th>รพ.</th>}<th>ยา</th><th>คงคลัง</th><th>จุดสั่งซื้อ</th><th>เหลือ(วัน)</th></tr></thead>
            <tbody>
              {data.reorder.map((r, i) => (
                <tr key={i}>
                  {isAdmin && <td>{r.hospital_id}</td>}
                  <td>{STATUS_TH[r.status]} {r.drug}</td>
                  <td>{r.stock_on_hand?.toFixed(0)}</td>
                  <td>{r.reorder_point?.toFixed(0)}</td>
                  <td>{r.days_of_supply?.toFixed(0)}</td>
                </tr>
              ))}
              {data.reorder.length === 0 && <tr><td colSpan={isAdmin ? 5 : 4} className="muted">สต็อกเพียงพอทุกรายการ</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Shortage (red) */}
        <div className="panel">
          <h2>🔴 ขาดแคลนด่วน (≤3 วัน)</h2>
          <table>
            <thead><tr>{isAdmin && <th>รพ.</th>}<th>ยา</th><th>รายละเอียด</th><th>คงคลัง</th><th>เหลือ(วัน)</th></tr></thead>
            <tbody>
              {data.shortage.map((r, i) => (
                <tr key={i}>
                  {isAdmin && <td>{r.hospital_id}</td>}
                  <td>{r.drug}</td><td className="muted">{r.desc_th}</td>
                  <td>{r.stock_on_hand?.toFixed(0)}</td>
                  <td><span className="badge red">{r.days_of_supply?.toFixed(0)} วัน</span></td>
                </tr>
              ))}
              {data.shortage.length === 0 && <tr><td colSpan={isAdmin ? 5 : 4} className="muted">ไม่มียาขาดแคลน</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
