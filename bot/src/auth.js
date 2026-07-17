// ตรวจ ID token ที่ LIFF web ส่งมา (Authorization: Bearer <idToken>)
// ยืนยันกับ LINE โดยตรงว่า token ยังไม่หมดอายุและออกจาก channel ของเราจริง
// แล้วเช็คว่า user ที่ login เข้ามาคือเจ้าของบอท (single-user) เท่านั้น
// ใช้ fetch แบบ built-in ของ Node 18+ (ไม่ต้องพึ่ง node-fetch) — node-fetch v3 เป็น ESM-only
// พอ require() แบบ CJS แล้ว interop คืน module namespace object มาแทนฟังก์ชัน ทำให้ fetch(...) พัง

async function verifyLiffUser(req, res, next) {
  // dev เท่านั้น: SKIP_LIFF_AUTH=1 ข้ามการตรวจ token กับ LINE (คู่กับ VITE_DEV_NO_AUTH=1 ฝั่ง liff-web)
  // เช็ค NODE_ENV กันตั้งค้างไว้แล้วหลุดขึ้น production บน VPS
  if (process.env.SKIP_LIFF_AUTH === '1' && process.env.NODE_ENV !== 'production') {
    req.lineUserId = process.env.ALLOWED_LINE_USER_ID || 'dev-user';
    return next();
  }

  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!idToken) {
      return res.status(401).json({ error: 'missing id token' });
    }

    const params = new URLSearchParams({
      id_token: idToken,
      client_id: process.env.LIFF_CHANNEL_ID,
    });

    const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    if (!verifyRes.ok) {
      return res.status(401).json({ error: 'invalid id token' });
    }

    const payload = await verifyRes.json();

    // single-user: อนุญาตแค่ line user id เดียวที่ตั้งไว้ใน .env
    if (!process.env.ALLOWED_LINE_USER_ID || payload.sub !== process.env.ALLOWED_LINE_USER_ID) {
      return res.status(403).json({ error: 'not allowed' });
    }

    req.lineUserId = payload.sub;
    next();
  } catch (err) {
    console.error('verifyLiffUser error:', err);
    res.status(500).json({ error: 'auth check failed' });
  }
}

module.exports = { verifyLiffUser };
