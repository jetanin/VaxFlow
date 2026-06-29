import { useEffect, useRef, useState } from "react";
import { api } from "../api";

const TH_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
function toThai(iso) {
  if (!iso) return null;
  const dt = new Date(iso + "T00:00:00");
  if (isNaN(dt)) return null;
  return {
    d: dt.getDate(),
    m: TH_MONTHS[dt.getMonth()],
    y: dt.getFullYear() + 543,
  };
}
// รูปแบบวันที่ราชการสำหรับพิมพ์ (เดือนไทย + พ.ศ.)
function fmtThai(iso) {
  const t = toThai(iso);
  return t ? `${t.d} เดือน ${t.m} พ.ศ. ${t.y}` : "................";
}
// แปลง base64 -> Blob URL (สำหรับ preview รูป/PDF)
function b64ToUrl(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return URL.createObjectURL(
    new Blob([arr], { type: mime || "application/octet-stream" }),
  );
}
// บังคับ format: ข้อความห้ามมีตัวเลข / โทรศัพท์รับเฉพาะตัวเลข(+ - เว้นวรรค)
const onlyText = (v) => v.replace(/[0-9๐-๙]/g, "");
const onlyTel = (v) => v.replace(/[^0-9+\-\s]/g, "");

// ใบยืม - คืน ยา / เวชภัณฑ์ — แก้ไขได้ + พิมพ์ PDF + อัปโหลดเอกสารที่เซ็นแล้วกลับเข้าระบบ
export default function BorrowMemo({ request, onClose }) {
  const [f, setF] = useState({
    date: todayISO(),
    borrower: "", // ข้าพเจ้า (ผู้ยืม)
    relation: "", // เกี่ยวข้องเป็น
    patient: "", // ผู้ป่วย ชื่อ-สกุล
    patientRight: "", // สิทธิการรักษาพยาบาล
    patientTel: "",
    patientAddr: "",
    ownerOrg: request?.to_name || "", // โรงพยาบาลเจ้าของ/ผู้ให้ยืม
    reqOrg: request?.from_name || "", // โรงพยาบาลผู้ขอยืม
    deposit: "2,000",
    note: request?.reason || "",
    doctor: "", // แพทย์ผู้ให้การรักษา
    nurse: "", // พยาบาล
    borrowerSign: "", // ผู้ยืม
    lender: "", // ผู้ให้ยืม (ผู้บังคับบัญชา)
    // ── ส่วนการเงิน (กรอกได้ · เว้นเส้น "ลงชื่อ" ให้เซ็นเอง · วงเล็บชื่อกรอกได้) ──
    finRecvAmt: "", // รับเงินค่ามัดจำ จำนวนเงิน
    finReturner: "", // ข้าพเจ้า (ผู้ได้รับเงินคืน)
    finReturnAmt: "", // จำนวนเงินคืน
    finRecvName: "", // ( ) ผู้รับเงิน
    finItemRecvName: "", // ( ) ผู้รับอุปกรณ์คืน
    finDepRecvName: "", // ( ) ผู้รับเงินค่ามัดจำคืน
    finDepPayName: "", // ( ) ผู้จ่ายเงินค่ามัดจำคืน
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const blankItem = { name: "", qty: "", price: "", asset: "", note: "" };
  const [items, setItems] = useState(
    Array.from({ length: 3 }, (_, i) =>
      i === 0 && request
        ? {
            ...blankItem,
            name: request.product_id,
            qty: String(request.quantity ?? ""),
          }
        : { ...blankItem },
    ),
  );
  const setItem = (i, key, val) =>
    setItems((arr) =>
      arr.map((it, j) => (j === i ? { ...it, [key]: val } : it)),
    );
  const addItem = () => setItems((arr) => [...arr, { ...blankItem }]);
  const removeItem = (i) =>
    setItems((arr) => (arr.length > 1 ? arr.filter((_, j) => j !== i) : arr));

  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [hasDoc, setHasDoc] = useState(!!request?.has_signed_doc);
  const [preview, setPreview] = useState(null); // {url, mime, filename}
  const fileRef = useRef();

  // โหลดข้อมูลที่เคยกรอก/บันทึกไว้ของคำขอนี้ (ถ้ามี) มาเติมในฟอร์ม
  useEffect(() => {
    if (!request?.id) return;
    api.getBorrowMemo(request.id).then((m) => {
      if (m?.data?.form) setF((s) => ({ ...s, ...m.data.form }));
      if (Array.isArray(m?.data?.items) && m.data.items.length)
        setItems(m.data.items);
    }).catch(() => {});
  }, [request?.id]);

  async function onSave() {
    setSaving(true); setMsg(null);
    try {
      await api.saveBorrowMemo(request.id, { form: f, items });
      setMsg("✅ บันทึกข้อมูลลงระบบแล้ว");
    } catch (err) {
      setMsg("⚠️ " + err.message);
    } finally {
      setSaving(false);
    }
  }

  function closePreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  function onUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setMsg("⚠️ ไฟล์ใหญ่เกิน 10MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const b64 = String(reader.result).split(",")[1];
        await api.uploadBorrowDoc(request.id, {
          filename: file.name,
          mime: file.type,
          data: b64,
        });
        setMsg(`✅ อัปโหลด "${file.name}" สำเร็จ`);
        setHasDoc(true);
      } catch (err) {
        setMsg("⚠️ " + err.message);
      }
    };
    reader.readAsDataURL(file);
  }

  async function onView() {
    try {
      const d = await api.getBorrowDoc(request.id);
      const url = b64ToUrl(d.data_b64, d.mime);
      setPreview({ url, mime: d.mime || "", filename: d.filename || "signed" });
    } catch (err) {
      setMsg("⚠️ " + err.message);
    }
  }
  function downloadPreview() {
    const a = document.createElement("a");
    a.href = preview.url;
    a.download = preview.filename;
    a.click();
  }

  // ฟังก์ชัน (ไม่ใช่ component) -> input ไม่หลุดโฟกัส
  // ช่องกรอกกว้างอัตโนมัติตามจำนวนตัวอักษร (size = หน่วย ch) · min = ความกว้างขั้นต่ำ (ตัวอักษร)
  //   👉 อยากให้ช่องเริ่มต้นกว้างขึ้น เพิ่มค่า min เช่น fld("patientAddr", 60)
  const autoSize = (k, min) => Math.max(min, (f[k] ? f[k].length : 0) + 2);
  const fld = (k, min = 14) => (
    <input
      className="ln"
      size={autoSize(k, min)}
      value={f[k]}
      onChange={(e) => set(k, e.target.value)}
    />
  );
  const fldText = (k, min = 12) => (   // ห้ามมีตัวเลข
    <input
      className="ln"
      size={autoSize(k, min)}
      value={f[k]}
      onChange={(e) => set(k, onlyText(e.target.value))}
    />
  );
  const fldTel = (k, min = 11) => (   // เฉพาะตัวเลข
    <input
      className="ln"
      size={autoSize(k, min)}
      inputMode="numeric"
      placeholder="0xx-xxxxxxx"
      value={f[k]}
      onChange={(e) => set(k, onlyTel(e.target.value))}
    />
  );
  // จอ: ปฏิทิน/นาฬิกาให้เลือก (no-print) · พิมพ์: ข้อความไม่มีกรอบ (print-only)
  const dateField = (k) => (
    <>
      <input
        type="date"
        className="ln-date no-print"
        value={f[k]}
        onChange={(e) => set(k, e.target.value)}
      />
      <span className="print-only">{fmtThai(f[k])}</span>
    </>
  );
  return (
    <>
      <div className="memo-overlay">
        <div className="memo-toolbar no-print">
          <button className="tab active" onClick={onSave} disabled={saving}>
            {saving ? "กำลังบันทึก..." : "💾 บันทึกข้อมูล"}
          </button>
          <button className="tab" onClick={() => window.print()}>
            🖨️ พิมพ์ / บันทึก PDF
          </button>
          <button className="tab" onClick={() => fileRef.current.click()}>
            ⬆️ อัปโหลดเอกสารที่เซ็นแล้ว
          </button>
          {hasDoc && (
            <button className="tab" onClick={onView}>
              📎 ดูเอกสารที่เซ็น
            </button>
          )}
          <button className="tab" onClick={onClose}>
            ปิด
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,image/*"
            style={{ display: "none" }}
            onChange={onUpload}
          />
          {msg && <span className="muted">{msg}</span>}
        </div>

        <div id="memo" className="memo-paper">
          <h1 className="memo-title">ใบขออนุมัติยืม-คืนวัคซีนทางการแพทย์</h1>

          <p className="memo-center">วันที่ {dateField("date")}</p>

          <p>
            <b>เรื่อง</b>&nbsp;&nbsp;ขออนุมัติยืมวัคซีน / เวชภัณฑ์ทางการแพทย์
          </p>
          <p>
            <b>เรียน</b>&nbsp;&nbsp;รองคณบดีฝ่ายโรงพยาบาล
          </p>

          <p className="memo-indent">
            ด้วยข้าพเจ้า {fldText("borrower", 22)} เกี่ยวข้องเป็น{" "}
            {fldText("relation", 8)}
            <br />
            ของผู้ป่วย ชื่อ-สกุล {fldText("patient", 24)}
          </p>
          <p>
            สิทธิการรักษาพยาบาล {fld("patientRight", 16)} โทร{" "}
            {fldTel("patientTel")}
          </p>
          <p>ที่อยู่ {fld("patientAddr", 50)}</p>
          <p>
            มีความประสงค์ยืมวัคซีน/เวชภัณฑ์ทางการแพทย์ ของโรงพยาบาล{" "}
            {fld("ownerOrg", 18)} เพื่อใช้ในการดูแลผู้ป่วย (โรงพยาบาลผู้ขอยืม{" "}
            {fld("reqOrg", 18)})
          </p>

          <p className="memo-h" style={{ marginBottom: 4 }}>
            ๑. วัคซีน/เวชภัณฑ์ที่ขอยืม ดังรายละเอียดต่อไปนี้
          </p>
          <table className="memo-grid">
            <thead>
              <tr>
                <th style={{ width: "5%" }}>ที่</th>
                <th>รายการ</th>
                <th style={{ width: "12%" }}>จำนวน</th>
                <th style={{ width: "13%" }}>ราคา</th>
                <th style={{ width: "20%" }}>เลขครุภัณฑ์</th>
                <th style={{ width: "16%" }}>หมายเหตุ</th>
                <th className="no-print" style={{ width: "5%" }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td className="c">{i + 1}</td>
                  {["name", "qty", "price", "asset", "note"].map((key) => (
                    <td key={key}>
                      <input
                        className={`cell ${key === "qty" ? "c" : ""}`}
                        inputMode={
                          key === "qty" || key === "price" ? "numeric" : "text"
                        }
                        value={it[key]}
                        onChange={(e) =>
                          setItem(
                            i,
                            key,
                            key === "qty"
                              ? e.target.value.replace(/[^0-9]/g, "")
                              : e.target.value,
                          )
                        }
                      />
                    </td>
                  ))}
                  <td className="c no-print">
                    <button
                      className="mini no"
                      onClick={() => removeItem(i)}
                      title="ลบแถว"
                    >
                      x
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="mini ok no-print"
            style={{ marginBottom: 10 }}
            onClick={addItem}
          >
            + เพิ่มแถว
          </button>

          <p>
            ๒. มีความยินดีจ่ายเงินค่ามัดจำเหมาจ่าย เป็นจำนวนเงิน{" "}
            {fld("deposit", 8)} บาท
          </p>
          <p>
            ๓. ข้าพเจ้าจะส่งคืนวัคซีน/เวชภัณฑ์ที่ยืม ดังรายการข้างต้น
            ในสภาพเรียบร้อยให้แก่โรงพยาบาล เมื่อเสร็จสิ้นการดูแลผู้ป่วย
          </p>
          <p>
            ๔. ในกรณีวัคซีน/เวชภัณฑ์ที่ยืมเกิดชำรุดเสียหาย
            ข้าพเจ้ายินดีรับผิดชอบค่าเสียหายตามความสมควรแก่ราคา
          </p>
          <p>หมายเหตุ {fld("note")}</p>

          <div className="memo-signs3">
            <div>
              <div>ลงชื่อ ...............................</div>
              <div>( {fldText("doctor", 14)} )</div>
              <div>แพทย์ผู้ให้การรักษา</div>
            </div>
            <div>
              <div>ลงชื่อ ...............................</div>
              <div>( {fldText("nurse", 14)} )</div>
              <div>พยาบาล</div>
            </div>
            <div>
              <div>ลงชื่อ ...............................</div>
              <div>( {fldText("borrowerSign", 14)} )</div>
              <div>ผู้ยืม</div>
            </div>
          </div>

          <div style={{ marginTop: 24, textAlign: "center" }}>
            <div className="memo-h">ความเห็นผู้บังคับบัญชา</div>
            <div style={{ margin: "6px 0" }}>
              <span className="memo-chk" /> อนุมัติ
              <span className="memo-chk" /> ไม่อนุมัติ
            </div>
            <div style={{ marginTop: 14 }}>
              ลงชื่อ ...............................ผู้ให้ยืม
            </div>
            <div>( {fldText("lender", 14)} )</div>
          </div>

          {/* ── หน้า 2: สำหรับเจ้าหน้าที่การเงิน ── */}
          <div className="memo-pagebreak">
            <p className="memo-h">สำหรับเจ้าหน้าที่การเงิน</p>
            <div className="memo-signs" style={{ alignItems: "flex-start" }}>
              <div className="memo-sign">
                <div className="memo-h">การรับเงินค่ามัดจำ</div>
                <div>รับเงินค่ามัดจำเป็นจำนวนเงิน {fld("finRecvAmt", 8)} บาท</div>
                <div style={{ marginTop: 10 }}>
                  ลงชื่อ ........................... ผู้รับเงิน
                </div>
                <div>( {fldText("finRecvName", 22)} )</div>
                <div style={{ marginTop: 10 }}>
                  ลงชื่อ ........................... ผู้รับอุปกรณ์คืน
                </div>
                <div>( {fldText("finItemRecvName", 22)} )</div>
              </div>
              <div className="memo-sign">
                <div className="memo-h">การคืนเงินค่ามัดจำ</div>
                <div>ข้าพเจ้า {fldText("finReturner", 24)} ได้รับเงินค่ามัดจำคืน</div>
                <div>จำนวน {fld("finReturnAmt", 8)} บาท เป็นที่เรียบร้อย</div>
                <div style={{ marginTop: 10 }}>
                  ลงชื่อ ........................... ผู้รับเงินค่ามัดจำคืน
                </div>
                <div>( {fldText("finDepRecvName", 22)} )</div>
                <div style={{ marginTop: 10 }}>
                  ลงชื่อ ........................... ผู้จ่ายเงินค่ามัดจำคืน
                </div>
                <div>( {fldText("finDepPayName", 22)} )</div>
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: "0.85rem" }}>
              <div>
                <b>หมายเหตุ</b>
              </div>
              <div>
                ๑. หลักฐานประกอบการยืม : บัตรประชาชน/สำเนาทะเบียนบ้านของผู้ป่วย,
                ญาติ
              </div>
              <div>
                ๒. ญาตินำใบยืม : ยื่นติดต่อจ่ายเงินค่ามัดจำอุปกรณ์ที่ห้องการเงิน
                (เก็บสำเนาไว้เป็นหลักฐาน)
              </div>
              <div>๓. ญาตินำใบยืม : ยื่นติดต่อรับอุปกรณ์</div>
              <div>
                ๔. ญาตินำใบยืมพร้อมอุปกรณ์ที่ยืม :
                ยื่นติดต่อรับเงินค่ามัดจำคืนที่ห้องการเงิน ในวันเวลาราชการ
              </div>
            </div>
          </div>
        </div>
      </div>

      {preview && (
        <div className="preview-overlay no-print" onClick={closePreview}>
          <div className="preview-box" onClick={(e) => e.stopPropagation()}>
            <div className="preview-bar">
              <span className="muted">📎 {preview.filename}</span>
              <span style={{ flex: 1 }} />
              <button className="tab" onClick={downloadPreview}>
                ⬇️ ดาวน์โหลด
              </button>
              <button className="tab" onClick={closePreview}>
                ปิด
              </button>
            </div>
            {preview.mime.startsWith("image/") ? (
              <img
                src={preview.url}
                alt="เอกสารที่เซ็น"
                className="preview-content"
              />
            ) : (
              <iframe
                src={preview.url}
                title="เอกสารที่เซ็น"
                className="preview-content"
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
