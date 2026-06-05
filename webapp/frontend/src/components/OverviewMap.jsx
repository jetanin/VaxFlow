import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";

const COLOR = { green: "#2ecc71", yellow: "#f1c40f", red: "#e74c3c" };
const STATUS_TH = { green: "🟢 เพียงพอ", yellow: "🟡 ใกล้หมด", red: "🔴 ขาดแคลน" };

export default function OverviewMap({ hospitals }) {
  const center = hospitals.length
    ? [
        hospitals.reduce((s, h) => s + h.latitude, 0) / hospitals.length,
        hospitals.reduce((s, h) => s + h.longitude, 0) / hospitals.length,
      ]
    : [13.7, 100.5];

  return (
    <div className="panel">
      <h2>🗺️ Overview Map — ตำแหน่งโรงพยาบาลและสถานะยา</h2>
      <MapContainer center={center} zoom={6} style={{ height: 440, width: "100%" }}>
        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {hospitals.map((h) => (
          <CircleMarker
            key={h.hospital_id}
            center={[h.latitude, h.longitude]}
            radius={12}
            pathOptions={{ color: COLOR[h.worst_status], fillColor: COLOR[h.worst_status], fillOpacity: 0.8 }}
          >
            <Tooltip>
              <b>{h.name}</b> ({h.hospital_id})<br />
              สถานะ: {STATUS_TH[h.worst_status]}<br />
              🔴 {h.n_red} · 🟡 {h.n_yellow} · Confidence {Math.round(h.avg_confidence * 100)}%
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      <table style={{ marginTop: 14 }}>
        <thead>
          <tr><th>รหัส</th><th>โรงพยาบาล</th><th>สถานะรวม</th><th>ยาขาด</th><th>ใกล้หมด</th><th>Confidence</th></tr>
        </thead>
        <tbody>
          {hospitals.map((h) => (
            <tr key={h.hospital_id}>
              <td>{h.hospital_id}</td>
              <td>{h.name}</td>
              <td><span className={`badge ${h.worst_status}`}>{STATUS_TH[h.worst_status]}</span></td>
              <td>{h.n_red}</td>
              <td>{h.n_yellow}</td>
              <td>{Math.round(h.avg_confidence * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
