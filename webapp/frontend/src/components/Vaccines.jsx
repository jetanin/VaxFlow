import { useEffect, useState } from "react";
import { api, auth } from "../api";
import Pagination, { usePaged } from "./Pagination.jsx";

export default function Vaccines() {
  const me = auth.hospital;
  const isAdmin = me?.role === "admin";
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => { api.vaccines().then(setRows).catch((e) => setErr(e.message)); }, []);

  const kw = q.trim().toLowerCase();
  const filtered = rows.filter(
    (r) => kw === "" ||
      (r.product_name && r.product_name.toLowerCase().includes(kw)) ||
      (r.product_id && r.product_id.toLowerCase().includes(kw)) ||
      (r.product_type && r.product_type.toLowerCase().includes(kw))
  );
  const paged = usePaged(filtered, 25);

  if (err) return <div className="panel muted">⚠️ {err}</div>;

  return (
    <div className="panel">
      <h2>💉 วัคซีนในคลังทั้งหมด {isAdmin ? "(ทุกโรงพยาบาล)" : `(${me?.name || me?.hospital_id})`}</h2>
      <div className="filterbar">
        <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
          ครบทุกผลิตภัณฑ์ตามทะเบียน อย. · แสดง {filtered.length}/{rows.length} รายการ · เรียงตามความเสี่ยง 🔴
        </p>
        <span style={{ flex: 1 }} />
        <input className="search" placeholder="🔍 ค้นหาวัคซีน (ชื่อ / รหัส / ชนิด)"
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
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
          {paged.slice.map((r) => (
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
          {filtered.length === 0 && <tr><td colSpan="9" className="muted">{q ? "ไม่พบรายการที่ค้นหา" : "ไม่มีข้อมูล"}</td></tr>}
        </tbody>
      </table>
      <Pagination {...paged} />
    </div>
  );
}
