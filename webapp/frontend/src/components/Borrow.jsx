import { useEffect, useState } from "react";
import { api, auth } from "../api";
import BorrowMemo from "./BorrowMemo.jsx";
import Regulations from "./Regulations.jsx";
import Pagination, { usePaged } from "./Pagination.jsx";

const STATUS_TH = {
  pending: "⏳ รออนุมัติ",
  approved: "✅ อนุมัติแล้ว",
  rejected: "❌ ปฏิเสธ",
};

export default function Borrow() {
  const me = auth.hospital;
  const isAdmin = me?.role === "admin";
  const [redProducts, setRedProducts] = useState([]);
  const [product, setProduct] = useState("");
  const [lenders, setLenders] = useState([]);
  const [toHospital, setToHospital] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [requests, setRequests] = useState([]);
  const [msg, setMsg] = useState(null);
  const [memoFor, setMemoFor] = useState(null); // คำขอที่กำลังเปิดเอกสาร
  const [showRules, setShowRules] = useState(false);
  const pagedReq = usePaged(requests, 15);

  function refresh() {
    api
      .listBorrow()
      .then(setRequests)
      .catch((e) => setMsg(e.message));
  }

  useEffect(() => {
    if (!isAdmin) {
      // วัคซีนที่ รพ. มีขวดสถานะ 🔴 (ใกล้หมดอายุ/ขาดแคลน) → ยืมได้
      api.vaccines().then((rows) => {
        const reds = rows.filter((r) => Number(r.n_red) > 0);
        setRedProducts(reds);
        if (reds[0]) setProduct(reds[0].product_id);
      });
    }
    refresh();
  }, []);

  useEffect(() => {
    if (product)
      api.lenders(product).then((rows) => {
        setLenders(rows);
        setToHospital(rows[0]?.hospital_id || "");
      });
  }, [product]);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.createBorrow({
        to_hospital: toHospital,
        product_id: product,
        quantity: parseFloat(qty),
        reason,
      });
      setMsg("✅ ส่งคำขอยืมวัคซีนเรียบร้อย");
      setQty("");
      setReason("");
      refresh();
    } catch (err) {
      setMsg("⚠️ " + err.message);
    }
  }

  async function act(id, status) {
    try {
      await api.actBorrow(id, status);
      refresh();
    } catch (err) {
      setMsg("⚠️ " + err.message);
    }
  }

  return (
    <>
      <div
        className="panel"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <button className="tab" onClick={() => setShowRules(true)}>
          📜 ระเบียบปฏิบัติ การยืม - คืน ยา / เวชภัณฑ์
        </button>
        <span className="muted">อ่านระเบียบก่อนทำรายการยืม-คืน</span>
      </div>
      <div className="row">
        {/* ---- ฟอร์มยืมยา (เฉพาะผู้ใช้ระดับโรงพยาบาล) ---- */}
        {!isAdmin && (
          <div className="panel">
            <h2>📝 ยืมวัคซีนจากโรงพยาบาลอื่น</h2>
            {redProducts.length === 0 ? (
              <p className="muted">
                โรงพยาบาลของคุณไม่มีวัคซีนสถานะ 🔴 — ยังไม่ต้องยืม 🎉
              </p>
            ) : (
              <form onSubmit={submit}>
                <label className="muted">
                  วัคซีนที่ขาดแคลน/ใกล้หมดอายุ (🔴 เท่านั้น)
                </label>
                <select
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                >
                  {redProducts.map((d) => (
                    <option key={d.product_id} value={d.product_id}>
                      {d.product_name} ({d.product_id})
                    </option>
                  ))}
                </select>

                <label className="muted">
                  ยืมจากโรงพยาบาล 🟢 (ขวดขนส่งได้ · เรียงตามระยะทางตามถนนใกล้สุด)
                </label>
                <select
                  value={toHospital}
                  onChange={(e) => setToHospital(e.target.value)}
                >
                  {lenders.length === 0 && (
                    <option value="">— ไม่มีโรงพยาบาล 🟢 ที่ให้ยืมได้ —</option>
                  )}
                  {lenders.map((l) => (
                    <option key={l.hospital_id} value={l.hospital_id}>
                      {l.name} · {l.distance_km} กม. · {l.green_vials} ขวด
                      (เหลือ {Math.round(l.surplus_doses)} โดส)
                    </option>
                  ))}
                </select>

                <label className="muted">จำนวนโดสที่ขอยืม</label>
                <input
                  type="number"
                  min="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  required
                />

                <label className="muted">หมายเหตุ (ไม่บังคับ)</label>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="เช่น คิวนัดเพิ่มฉับพลัน"
                />

                <button
                  className="tab active"
                  type="submit"
                  disabled={!toHospital}
                >
                  ส่งคำขอยืมวัคซีน
                </button>
              </form>
            )}
            {msg && <p className="muted">{msg}</p>}
          </div>
        )}

        {/* ---- รายการคำขอ ---- */}
        <div className="panel">
          <h2>📋 คำขอยืมวัคซีน {isAdmin && "(ทุกโรงพยาบาล)"}</h2>
          <table>
            <thead>
              <tr>
                <th>ทิศทาง</th>
                <th>วัคซีน</th>
                <th>จำนวน (โดส)</th>
                <th>คู่ (ขอ → ให้)</th>
                <th>สถานะ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pagedReq.slice.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.direction === "outgoing"
                      ? "📤 ขอยืม"
                      : r.direction === "incoming"
                        ? "📥 ถูกขอ"
                        : "📋 ภาพรวม"}
                  </td>
                  <td>{r.product_id}</td>
                  <td>{r.quantity}</td>
                  <td className="muted">
                    {r.direction === "oversight"
                      ? `${r.from_name} → ${r.to_name}`
                      : r.direction === "outgoing"
                        ? r.to_name
                        : r.from_name}
                  </td>
                  <td>{STATUS_TH[r.status]}</td>
                  <td>
                    {r.direction === "incoming" && r.status === "pending" && (
                      <>
                        <button
                          className="mini ok"
                          onClick={() => act(r.id, "approved")}
                        >
                          อนุมัติ
                        </button>
                        <button
                          className="mini no"
                          onClick={() => act(r.id, "rejected")}
                        >
                          ปฏิเสธ
                        </button>
                      </>
                    )}
                    <button className="mini doc" onClick={() => setMemoFor(r)}>
                      📄 เอกสาร
                    </button>
                  </td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr>
                  <td colSpan="6" className="muted">
                    ยังไม่มีคำขอ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pagination {...pagedReq} />
        </div>

        {memoFor && (
          <BorrowMemo request={memoFor} onClose={() => setMemoFor(null)} />
        )}
      </div>
      {showRules && <Regulations onClose={() => setShowRules(false)} />}
    </>
  );
}
