import { useRef, useState } from "react";
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
    time: new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    reqOrg: request?.from_name || "",
    note: request?.reason || "",
    borrower: "",
    borrowerTel: "",
    lendOrg: request?.to_name || "",
    lender: "",
    lenderTel: "",
    returnDate: "",
    returnTime: "",
    returner: "",
    returnerTel: "",
    receiver: "",
    receiverTel: "",
    officer: "",
    officerPos: "",
    officerDate: "",
    approver: "",
    approverPos: "",
    approverDate: "",
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const [items, setItems] = useState(
    Array.from({ length: 1 }, (_, i) =>
      i === 0 && request
        ? { name: request.product_id, qty: String(request.quantity ?? "") }
        : { name: "", qty: "" },
    ),
  );
  const setItem = (i, key, val) =>
    setItems((arr) =>
      arr.map((it, j) => (j === i ? { ...it, [key]: val } : it)),
    );
  const addItem = () => setItems((arr) => [...arr, { name: "", qty: "" }]);
  const removeItem = (i) =>
    setItems((arr) => (arr.length > 1 ? arr.filter((_, j) => j !== i) : arr));

  const [msg, setMsg] = useState(null);
  const [hasDoc, setHasDoc] = useState(!!request?.has_signed_doc);
  const [preview, setPreview] = useState(null); // {url, mime, filename}
  const fileRef = useRef();

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
  const fld = (k, w = "w-grow") => (
    <input
      className={`ln ${w}`}
      value={f[k]}
      onChange={(e) => set(k, e.target.value)}
    />
  );
  const fldText = (
    k,
    w = "w8", // ห้ามมีตัวเลข
  ) => (
    <input
      className={`ln ${w}`}
      value={f[k]}
      onChange={(e) => set(k, onlyText(e.target.value))}
    />
  );
  const fldTel = (
    k,
    w = "w8", // เฉพาะตัวเลข
  ) => (
    <input
      className={`ln ${w}`}
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
  const timeField = (k) => (
    <>
      <input
        type="time"
        className="ln-date no-print"
        value={f[k]}
        onChange={(e) => set(k, e.target.value)}
      />
      <span className="print-only">{f[k] ? `${f[k]} น.` : "........ น."}</span>
    </>
  );

  return (
    <>
      <div className="memo-overlay">
        <div className="memo-toolbar no-print">
          <button className="tab active" onClick={() => window.print()}>
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
          <h1 className="memo-title">ใบยืม - คืน ยา / เวชภัณฑ์</h1>

          <p className="memo-center">
            วันที่ {fmtThai(f.date)} เวลา {f.time} น.
          </p>

          <p>
            <b>เรื่อง</b>&nbsp;&nbsp;ขอยืมยา / เวชภัณฑ์
          </p>
          <p>หน่วยงานที่ขอยืมยา {fld("reqOrg")}</p>
          <p>
            ชื่อผู้ยืมยา {fldText("borrower")} โทรศัพท์ {fldTel("borrowerTel")}
          </p>
          <p>หน่วยงานที่ให้ยืม {fld("lendOrg")}</p>

          <p className="memo-h" style={{ marginBottom: 4 }}>
            รายการที่ขอยืม
          </p>
          <ol className="memo-list">
            {items.map((it, i) => (
              <li key={i}>
                <input
                  className="ln w-item"
                  value={it.name}
                  onChange={(e) => setItem(i, "name", e.target.value)}
                />
                จำนวน{" "}
                <input
                  className="ln w3"
                  inputMode="numeric"
                  value={it.qty}
                  onChange={(e) =>
                    setItem(i, "qty", e.target.value.replace(/[^0-9]/g, ""))
                  }
                />
                <button
                  className="mini no no-print"
                  style={{ marginLeft: 6 }}
                  onClick={() => removeItem(i)}
                  title="ลบรายการ"
                >
                  x
                </button>
              </li>
            ))}
          </ol>
          <p>หมายเหตุ {fld("note")}</p>
          <button
            className="mini ok no-print"
            style={{ marginBottom: 12 }}
            onClick={addItem}
          >
            + เพิ่มรายการ
          </button>

          <p>
            ชื่อผู้ให้ยืมยา {fldText("lender")} โทรศัพท์ {fldTel("lenderTel")}
          </p>
          <p>
            วันที่คืน {dateField("returnDate")} เวลา {timeField("returnTime")}
          </p>
          <p>
            ชื่อผู้คืน {fldText("returner")} โทรศัพท์ {fldTel("returnerTel")}
          </p>
          <p>
            ชื่อผู้รับคืน {fldText("receiver")} โทรศัพท์ {fldTel("receiverTel")}
          </p>

          <div className="memo-signs">
            <div className="memo-sign">
              <div className="memo-h">เจ้าหน้าที่ผู้รับผิดชอบ</div>
              <div>
                ลงชื่อ ...................................................
              </div>
              <div>( {fldText("officer")} )</div>
              <div>ตำแหน่ง {fldText("officerPos")}</div>
              <div>วันที่ {dateField("officerDate")}</div>
            </div>
            <div className="memo-sign">
              <div className="memo-h">ผู้อนุมัติ</div>
              <div>
                ลงชื่อ ...................................................
              </div>
              <div>( {fldText("approver")} )</div>
              <div>ตำแหน่ง {fldText("approverPos")}</div>
              <div>วันที่ {dateField("approverDate")}</div>
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
