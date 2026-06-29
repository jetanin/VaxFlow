const jwt = require("jsonwebtoken");

// JWT secret ต้องตั้งผ่าน env ใน production — dev มี fallback แต่เตือนดัง ๆ
const SECRET = process.env.JWT_SECRET || "vacflow-dev-secret-change-me";
if (!process.env.JWT_SECRET) {
  const msg = "[auth] JWT_SECRET ไม่ได้ตั้ง → ใช้ dev default (ห้ามใช้ใน production)";
  if (process.env.NODE_ENV === "production") throw new Error(msg);
  console.warn(msg);
}
const EXPIRES = "8h";

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

// middleware: ตรวจ Bearer token แล้วใส่ req.user
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "ต้องเข้าสู่ระบบก่อน" });
  try {
    req.user = jwt.verify(token, SECRET); // { hospital_id, name }
    next();
  } catch (e) {
    res.status(401).json({ error: "token ไม่ถูกต้องหรือหมดอายุ" });
  }
}

// middleware: เฉพาะ admin (ใช้ต่อจาก requireAuth)
function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "เฉพาะผู้ดูแลระบบ (admin) เท่านั้น" });
  }
  next();
}

module.exports = { signToken, requireAuth, requireAdmin };
