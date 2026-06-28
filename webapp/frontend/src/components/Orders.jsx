import { useEffect, useState } from "react";
import { api, auth } from "../api";
import Pagination, { usePaged } from "./Pagination.jsx";

// 📦 คำแนะนำการสั่งซื้อ (reorder) — คำนวณใหม่จากข้อมูลสด แล้วสั่งเป็น PO command ไป HOSxP
export default function Orders() {
  const me = auth.hospital;
  const isAdmin = me?.role === "admin";
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [command, setCommand] = useState(null);   // payload คำสั่งซื้อล่าสุดที่ส่งไป HOSxP
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  function load() { api.orders().then(setRows).catch((e) => setErr(e.message)); }
  useEffect(load, []);

  async function retrain() {
    setBusy(true); setMsg(null);
    try { const r = await api.retrain(); setMsg(`✅ คำนวณใหม่แล้ว: ${r.suggestions} รายการ`); load(); }
    catch (e) { setMsg("⚠️ " + e.message); } finally { setBusy(false); }
  }

  async function dispatch(id) {
    setMsg(null); setCommand(null);
    try {
      const r = await api.dispatchOrder(id);
      setCommand(r.command);
      setMsg("✅ ส่งคำสั่งซื้อไป HOSxP แล้ว");
      load();
    } catch (e) { setMsg("⚠️ " + e.message); }
  }

  const kw = q.trim().toLowerCase();
  const filtered = rows.filter(
    (r) => kw === "" ||
      [r.hospital_name, r.hospital_id, r.product_name, r.product_id]
        .some((v) => v && String(v).toLowerCase().includes(kw))
  );
  const paged = usePaged(filtered, 20);
  const fmt = (v, d = 0) => (v == null ? "—" : Number(v).toFixed(d));

  if (err) return <div className="panel muted">⚠️ {err}</div>;

  return (
    <div className="panel">
      <h2>📦 คำแนะนำการสั่งซื้อ → HOSxP {isAdmin ? "(ทุกโรงพยาบาล)" : `(${me?.name || me?.hospital_id})`}</h2>
      <div className="filterbar">
        <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
          reorder จากคลังสด + ดีมานด์คิวนัด + lead time · สั่งเมื่อต่ำกว่า ROP · แสดง {filtered.length}/{rows.length}
        </p>
        <span style={{ flex: 1 }} />
        <input className="search" placeholder="🔍 ค้นหา (รพ. / วัคซีน)"
               value={q} onChange={(e) => setQ(e.target.value)} />
        {isAdmin && (
          <button className="tab" disabled={busy} onClick={retrain} style={{ marginLeft: 8 }}>
            {busy ? "กำลังคำนวณ..." : "🔄 เทรน/คำนวณใหม่"}
          </button>
        )}
      </div>
      {msg && <p className="muted">{msg}</p>}

      {command && (
        <pre className="panel" style={{ background: "#0b1020", color: "#9fe", overflowX: "auto", fontSize: "0.78rem" }}>
{JSON.stringify(command, null, 2)}
        </pre>
      )}

      <table>
        <thead>
          <tr>
            {isAdmin && <th>โรงพยาบาล</th>}
            <th>วัคซีน</th><th>คงเหลือ (โดส)</th><th>ดีมานด์/วัน</th>
            <th>Lead</th><th>ROP</th><th>แนะนำสั่ง</th><th>สถานะ</th><th></th>
          </tr>
        </thead>
        <tbody>
          {paged.slice.map((r) => (
            <tr key={r.id}>
              {isAdmin && <td>{r.hospital_name || r.hospital_id}</td>}
              <td>{r.product_name || r.product_id}<br />
                <span className="muted" style={{ fontSize: "0.78rem" }}>{r.product_id}</span></td>
              <td>{fmt(r.on_hand)}</td>
              <td>{fmt(r.avg_daily_demand, 1)}</td>
              <td>{r.lead_time_days} วัน</td>
              <td>{fmt(r.reorder_point)}</td>
              <td><b>{r.recommended_vials} ขวด</b><br />
                <span className="muted" style={{ fontSize: "0.78rem" }}>{r.recommended_doses} โดส</span></td>
              <td style={{ whiteSpace: "nowrap" }}>{r.status === "dispatched"
                ? <span className="badge green">✅ สั่งแล้ว</span>
                : <span className="badge yellow">⏳ รอสั่ง</span>}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {r.status !== "dispatched" && (isAdmin || me?.hospital_id === r.hospital_id) && (
                  <button className="mini ok" onClick={() => dispatch(r.id)}>📤 สั่งไป HOSxP</button>
                )}
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td colSpan={isAdmin ? 9 : 8} className="muted">
              {q ? "ไม่พบรายการ" : "ไม่มีคำแนะนำการสั่งซื้อ — คลังเพียงพอ 🎉"}</td></tr>
          )}
        </tbody>
      </table>
      <Pagination {...paged} />
    </div>
  );
}
