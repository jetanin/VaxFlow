import { useEffect, useState } from "react";
import { api, auth } from "../api";
import Pagination, { usePaged } from "./Pagination.jsx";

// อายุที่เหลือ (วัน) -> badge สี ตามเกณฑ์ remaining shelf-life
function lifeBadge(days) {
  if (days < 0) return <span className="badge red">หมดอายุแล้ว</span>;
  if (days <= 14) return <span className="badge red">{days.toFixed(1)} วัน</span>;
  if (days <= 21) return <span className="badge yellow">{days.toFixed(1)} วัน</span>;
  return <span className="badge green">{days.toFixed(1)} วัน</span>;
}

// อายุที่เหลือเป็นชั่วโมง (สำหรับขวดที่เปิดแล้ว — 6 ชม.)
function hoursLeft(days) {
  const h = days * 24;
  return h < 0 ? "หมดอายุแล้ว" : `${h.toFixed(1)} ชม.`;
}

export default function Alerts() {
  const me = auth.hospital;
  const isAdmin = me?.role === "admin";
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");

  const kw = q.trim().toLowerCase();
  const match = (r) =>
    kw === "" ||
    (r.product_id && r.product_id.toLowerCase().includes(kw)) ||
    (r.product_name && r.product_name.toLowerCase().includes(kw)) ||
    (r.hospital_id && r.hospital_id.toLowerCase().includes(kw));
  const fExp = (data?.expiring || []).filter(match);
  const fOpen = (data?.opened || []).filter(match);
  const fSho = (data?.shortage || []).filter(match);

  // เรียก hook ก่อน early-return เสมอ (ตามกฎ React)
  const pExp = usePaged(fExp, 10);
  const pOpen = usePaged(fOpen, 10);
  const pSho = usePaged(fSho, 10);

  useEffect(() => { api.alerts().then(setData).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="panel muted">⚠️ {err}</div>;
  if (!data) return <div className="panel muted">กำลังโหลด...</div>;

  return (
    <div>
      <div className="filterbar">
        <p className="muted" style={{ margin: 0 }}>
          การแจ้งเตือน{" "}
          {isAdmin ? "(ทุกโรงพยาบาล)" : `ของ 🏥 ${me?.name || me?.hospital_id}`}
        </p>
        <span style={{ flex: 1 }} />
        <input className="search" placeholder={`🔍 ค้นหาวัคซีน ${isAdmin ? "/ รหัส รพ." : ""}`}
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {/* ใกล้หมดอายุตามอายุขัยจริง (effective_expiry) */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>⏳ ใกล้หมดอายุ (ตามสถานะจัดเก็บ — Dynamic Expire)</h2>
        <table>
          <thead>
            <tr>
              {isAdmin && <th>รพ.</th>}
              <th>วัคซีน</th>
              <th>สถานะ</th>
              <th>โดสคงเหลือ</th>
              <th>หมดอายุจริง</th>
              <th>เหลือ</th>
            </tr>
          </thead>
          <tbody>
            {pExp.slice.map((r) => (
              <tr key={r.vial_id}>
                {isAdmin && <td>{r.hospital_id}</td>}
                <td>{r.product_name}</td>
                <td>{r.state}</td>
                <td>{r.doses_remaining}</td>
                <td className="muted">{new Date(r.effective_expiry).toLocaleString("th-TH")}</td>
                <td>{lifeBadge(Number(r.days_remaining))}</td>
              </tr>
            ))}
            {fExp.length === 0 && (
              <tr><td colSpan={isAdmin ? 6 : 5} className="muted">
                {q ? "ไม่พบรายการที่ค้นหา" : "ไม่มีวัคซีนใกล้หมดอายุ 🎉"}
              </td></tr>
            )}
          </tbody>
        </table>
        <Pagination {...pExp} />
      </div>

      <div className="row">
        {/* ขวดที่เปิดแล้ว (6 ชม.) — ต้องเร่งเคลียร์โดส */}
        <div className="panel">
          <h2>💉 ขวดที่เปิดแล้ว (เร่งใช้ภายใน 6 ชม.)</h2>
          <table>
            <thead>
              <tr>
                {isAdmin && <th>รพ.</th>}
                <th>วัคซีน</th>
                <th>โดสค้างขวด</th>
                <th>เหลือ</th>
              </tr>
            </thead>
            <tbody>
              {pOpen.slice.map((r) => (
                <tr key={r.vial_id}>
                  {isAdmin && <td>{r.hospital_id}</td>}
                  <td>{r.product_name}</td>
                  <td>{r.doses_remaining}</td>
                  <td><span className="badge red">{hoursLeft(Number(r.days_remaining))}</span></td>
                </tr>
              ))}
              {fOpen.length === 0 && (
                <tr><td colSpan={isAdmin ? 4 : 3} className="muted">
                  {q ? "ไม่พบรายการที่ค้นหา" : "ไม่มีขวดที่เปิดค้างไว้"}
                </td></tr>
              )}
            </tbody>
          </table>
          <Pagination {...pOpen} />
        </div>

        {/* วิกฤต (สถานะแดง) */}
        <div className="panel">
          <h2>🔴 วิกฤต (อายุ ≤ 14 วัน)</h2>
          <table>
            <thead>
              <tr>
                {isAdmin && <th>รพ.</th>}
                <th>วัคซีน</th>
                <th>โดสคงเหลือ</th>
                <th>เหลือ</th>
              </tr>
            </thead>
            <tbody>
              {pSho.slice.map((r) => (
                <tr key={r.vial_id}>
                  {isAdmin && <td>{r.hospital_id}</td>}
                  <td>{r.product_name}</td>
                  <td>{r.doses_remaining}</td>
                  <td>{lifeBadge(Number(r.days_remaining))}</td>
                </tr>
              ))}
              {fSho.length === 0 && (
                <tr><td colSpan={isAdmin ? 4 : 3} className="muted">
                  {q ? "ไม่พบรายการที่ค้นหา" : "ไม่มีวัคซีนวิกฤต"}
                </td></tr>
              )}
            </tbody>
          </table>
          <Pagination {...pSho} />
        </div>
      </div>
    </div>
  );
}
