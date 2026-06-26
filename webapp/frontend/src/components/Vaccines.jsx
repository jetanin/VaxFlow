import { useEffect, useState } from "react";
import { api, auth } from "../api";

export default function Vaccines() {
  const me = auth.hospital;
  const isAdmin = me?.role === "admin";
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => { api.vaccines().then(setRows).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="panel muted">⚠️ {err}</div>;

  return (
    <div className="panel">
      <h2>💉 วัคซีนในคลังทั้งหมด {isAdmin ? "(ทุกโรงพยาบาล)" : `(${me?.name || me?.hospital_id})`}</h2>
      <p className="muted" style={{ fontSize: "0.82rem" }}>
        รวม {rows.length} ผลิตภัณฑ์ · เรียงตามความเสี่ยง (🔴 ใกล้หมดอายุมากสุดก่อน)
      </p>
      <table>
        <thead>
          <tr>
            <th>ผลิตภัณฑ์</th><th>ชนิด</th>
            {isAdmin && <th># รพ.</th>}
            <th>ขวด</th><th>โดสคงเหลือ</th><th>เปิดแล้ว</th>
            <th>🟢</th><th>🟡</th><th>🔴</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.product_id}>
              <td><b>{r.product_name}</b><br /><span className="muted" style={{ fontSize: "0.78rem" }}>{r.product_id}</span></td>
              <td>{r.product_type}</td>
              {isAdmin && <td>{r.hospitals}</td>}
              <td>{Number(r.n_vials).toLocaleString()}</td>
              <td>{Number(r.total_doses).toLocaleString()}</td>
              <td>{r.opened_vials > 0 ? <span className="badge yellow">{r.opened_vials}</span> : "—"}</td>
              <td>{r.n_green > 0 ? <span className="badge green">{r.n_green}</span> : "—"}</td>
              <td>{r.n_yellow > 0 ? <span className="badge yellow">{r.n_yellow}</span> : "—"}</td>
              <td>{r.n_red > 0 ? <span className="badge red">{r.n_red}</span> : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan="9" className="muted">ไม่มีข้อมูล</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
