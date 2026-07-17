// ส่งรูปสลิปให้ Google Gemini อ่าน+สกัดข้อมูลเป็น JSON ในขั้นตอนเดียว (แทน OCR + regex parser)
// จัดการได้ทุกฟอร์แมตธนาคาร: ชื่อร้านตัดหลายบรรทัด, ข้อความตกแต่ง (Sanrio/Disney),
// THB vs บาท, ไทย/อังกฤษปนกัน — ไม่ต้องไล่เขียน special-case ต่อธนาคารทีละเจ้า
//
// ใช้ Gemini REST (fetch ในตัว Node 18+ ไม่ต้องเพิ่ม SDK) — อยู่ในระบบ Google เดียวกับ Vision API
// ตั้ง GEMINI_API_KEY ใน .env — ใช้ key จาก Google AI Studio (aistudio.google.com/apikey)
// ในโปรเจกต์ที่ไม่มี billing เพื่อเข้า free tier (gemini-2.5-flash ตัวเดิมโดนบล็อกสำหรับ user ใหม่)
// เปลี่ยนรุ่นได้ด้วย GEMINI_MODEL — ค่าเริ่มต้น gemini-flash-lite-latest (ชี้ไปรุ่น flash-lite
// ล่าสุดเสมอ กันปัญหา model ถูก deprecate) เร็ว + rate limit free tier สูง
// เทสต์แล้วอ่าน payee/amount ไทยแม่นครบทุกใบ (เลข ref ยาวๆ อาจหลุด ~1 หลักเป็นบางครั้ง
// เหมือนกันทั้ง flash และ flash-lite — กระทบแค่การ dedup ไม่กระทบยอดที่บันทึก)

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_VISION_API_KEY;
}

// responseSchema ของ Gemini (subset ของ OpenAPI) — type เป็นตัวพิมพ์ใหญ่ บังคับให้ตอบ JSON ตามนี้
const SLIP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_slip: { type: 'BOOLEAN' }, // false ถ้ารูปไม่ใช่สลิปธุรกรรม
    payee: { type: 'STRING' }, // ชื่อผู้รับเงิน/ร้านค้า (รวมชื่อที่ตัดหลายบรรทัด) "" ถ้าไม่มี
    amount: { type: 'NUMBER' }, // ยอดที่จ่าย/โอนจริง (ไม่ใช่ค่าธรรมเนียม) เป็นบวกเสมอ
    ref: { type: 'STRING' }, // เลขอ้างอิงธุรกรรม "" ถ้าไม่มี
    direction: { type: 'STRING', enum: ['expense', 'income'] }, // จ่ายออก / รับเข้า
    date: { type: 'STRING' }, // วันที่ทำรายการ รูปแบบ YYYY-MM-DD (ค.ศ.) "" ถ้าไม่มี
  },
  required: ['is_slip', 'payee', 'amount', 'ref', 'direction', 'date'],
};

const PROMPT = `นี่คือรูปสลิปธุรกรรมจากแอปธนาคารไทย (โอนเงิน/จ่ายบิล/ชำระเงิน) ช่วยอ่านแล้วสกัดข้อมูลตาม schema

กติกา:
- payee: ชื่อผู้รับเงินหรือร้านค้าปลายทาง (ไม่ใช่ผู้โอน) ถ้าชื่อถูกตัดเป็นหลายบรรทัดให้รวมเป็นบรรทัดเดียวคั่นด้วยช่องว่าง คงตัวสะกดภาษาไทยให้ถูกต้อง อย่าเอาข้อความตกแต่ง/ลายน้ำ/โลโก้แบรนด์ (เช่น My Melody, Sanrio, Disney, ชื่อธนาคาร) มาเป็นชื่อ
- amount: ยอดเงินที่จ่าย/โอนจริง เป็นตัวเลขบวก ห้ามเอายอด "ค่าธรรมเนียม" มา
- ref: เลขอ้างอิงธุรกรรม (รหัสอ้างอิง/เลขที่รายการ/หมายเลขอ้างอิง) ถ้ามีหลายตัวเอาตัวหลัก ถ้าไม่มีให้ ""
- direction: "expense" ถ้าเป็นการจ่าย/โอนเงินออก (ปกติของสลิปพวกนี้), "income" ถ้าเป็นการรับเงินเข้า
- date: วันที่ที่ทำรายการบนสลิป แปลงเป็นรูปแบบ YYYY-MM-DD ปฏิทินสากล (ค.ศ.) — สลิปไทยมักเป็น พ.ศ. ให้ลบปีด้วย 543 (เช่น "17 ก.ค. 69" หรือ "17 ก.ค. 2569" = 2026-07-17) ถ้าหาไม่เจอให้ ""
- is_slip: false ถ้ารูปไม่ใช่สลิปธุรกรรมการเงิน`;

function mediaType(buffer) {
  // ตรวจชนิดรูปจาก magic bytes (LINE ส่งมาเป็น jpeg เป็นส่วนใหญ่ แต่รองรับ png/gif/webp ด้วย)
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
  return 'image/jpeg';
}

// buffer: รูปดิบจาก LINE — คืน { payee, amount, ref, direction } หรือ null ถ้าไม่ใช่สลิป/หายอดไม่ได้
async function extractSlip(buffer) {
  const key = apiKey();
  if (!key) throw new Error('ไม่ได้ตั้ง GEMINI_API_KEY (หรือ GOOGLE_VISION_API_KEY) ใน .env');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: mediaType(buffer), data: buffer.toString('base64') } },
              { text: PROMPT },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: SLIP_SCHEMA,
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.error('slipExtract JSON parse error:', err, text);
    return null;
  }

  if (!data.is_slip || typeof data.amount !== 'number' || data.amount <= 0) return null;

  // รับ date เฉพาะที่เป็น YYYY-MM-DD จริง — เผื่อโมเดลเผลอตอบเป็น พ.ศ. (ปี >= 2500) ก็แปลงเป็น ค.ศ. ให้
  let date = null;
  if (typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    const year = Number(data.date.slice(0, 4));
    date = year >= 2500 ? `${year - 543}${data.date.slice(4)}` : data.date;
  }

  return {
    payee: data.payee?.trim() || 'สลิปโอนเงิน',
    amount: data.amount,
    ref: data.ref?.trim() || null,
    direction: data.direction === 'income' ? 'income' : 'expense',
    date,
  };
}

module.exports = { extractSlip };
