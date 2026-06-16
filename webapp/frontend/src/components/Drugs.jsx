import { useEffect, useState } from "react";
import { api, auth } from "../api";

export default function Drugs() {
  const me = auth.hospital;
  const isAdmin = me?.role === "admin";
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => { api.drugs().then(setRows).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="panel muted">⚠️ {err}</div>;

  return (
    <div className="panel">
      <h2>💊 ยาในคลังทั้งหมด {isAdmin ? "(ทุกโรงพยาบาล)" : `(${me?.name || me?.hospital_id})`}</h2>
      <p className="muted" style={{ fontSize: "0.82rem" }}>
        รวม {rows.length} กลุ่มยา · เรียงตามความเสี่ยงขาดแคลน (🔴 มากสุดก่อน)
      </p>
      <table>
        <thead>
          <tr>
            <th>กลุ่มยา</th><th>รายละเอียด</th>
            {isAdmin && <th># รพ.</th>}
            <th>คงคลังรวม</th><th>เฉลี่ยเหลือ(วัน)</th>
            <th>🟢</th><th>🟡</th><th>🔴</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.drug}>
              <td><b>{r.drug}</b></td>
              <td className="muted">{r.desc_th}</td>
              {isAdmin && <td>{r.hospitals}</td>}
              <td>{Number(r.total_stock).toLocaleString()}</td>
              <td>{r.avg_days}</td>
              <td>{r.n_green > 0 ? <span className="badge green">{r.n_green}</span> : "—"}</td>
              <td>{r.n_yellow > 0 ? <span className="badge yellow">{r.n_yellow}</span> : "—"}</td>
              <td>{r.n_red > 0 ? <span className="badge red">{r.n_red}</span> : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan="8" className="muted">ไม่มีข้อมูล</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
