// ส่งรูป statement (ทุกหน้า) ให้ Google Gemini อ่าน+ถอดรายการธุรกรรมทั้งหมดเป็น JSON array
// ต่อยอดจาก slipExtract.js (สลิปใบเดียว) — อันนี้เป็น statement หลายรายการ/หลายหน้า
// ส่งทุกหน้าไปใน request เดียว (parts หลาย inline_data) เพื่อให้ Gemini เห็นบริบทข้ามหน้า
// (เช่นหัวตารางอยู่หน้าแรก แต่รายการต่อไปหน้าถัดไป) แล้วบังคับ responseSchema ให้ตอบตามรูปแบบ

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_VISION_API_KEY;
}

// responseSchema (subset ของ OpenAPI) — type ตัวพิมพ์ใหญ่ บังคับให้ตอบเป็น array รายการธุรกรรม
const STATEMENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_statement: { type: 'BOOLEAN' }, // false ถ้ารูปไม่ใช่ statement/รายการเดินบัญชี
    transactions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING' }, // วันที่ทำรายการ YYYY-MM-DD (ค.ศ.)
          description: { type: 'STRING' }, // รายละเอียด/ชื่อร้าน
          amount: { type: 'NUMBER' }, // ยอดของรายการ เป็นบวกเสมอ (ทิศทางดูจาก direction)
          direction: { type: 'STRING', enum: ['expense', 'income'] }, // จ่ายออก/รับเข้า
        },
        required: ['date', 'description', 'amount', 'direction'],
      },
    },
  },
  required: ['is_statement', 'transactions'],
};

function prompt(bankHint) {
  return `นี่คือภาพ statement (รายการเดินบัญชี/ใบแจ้งยอดบัตรเครดิต) จากธนาคารไทย${
    bankHint ? ` — ${bankHint}` : ''
  } อาจมีหลายหน้า ช่วยอ่านทุกหน้าแล้วสกัด "ทุกรายการธุรกรรม" ตาม schema

กติกา:
- ดึงทุกแถวรายการธุรกรรมในตาราง เรียงตามที่ปรากฏบน statement ทุกหน้า อย่าตกหล่น
- date: วันที่ทำรายการ แปลงเป็น YYYY-MM-DD ปฏิทินสากล (ค.ศ.) — ถ้าเป็น พ.ศ. (ปี >= 2500 หรือ 2 หลักแบบ 68/69) ให้ลบด้วย 543 (เช่น "17/07/69" หรือ "17 ก.ค. 2569" = 2026-07-17) ถ้ามีทั้งวันที่ทำรายการและวันที่บันทึก ให้ใช้วันที่ทำรายการ
- description: รายละเอียด/ชื่อร้านของแถวนั้น รวมเป็นบรรทัดเดียว คงตัวสะกดภาษาไทยให้ถูก
- amount: ยอดเงินของรายการนั้น เป็นตัวเลขบวกเสมอ (ห้ามติดลบ ห้ามใส่คอมมา)
- direction: "expense" สำหรับรายการจ่าย/ถอน/ซื้อ/เดบิต, "income" สำหรับรายการรับเข้า/ฝาก/เครดิต/คืนเงิน/ชำระยอด
- ข้ามแถวที่ไม่ใช่ธุรกรรมจริง เช่น ยอดยกมา/ยอดยกไป (balance b/f, c/f), ยอดรวม (total), ดอกเบี้ยสรุป, หัวตาราง, ยอดคงเหลือ
- is_statement: false ถ้าภาพไม่ใช่ statement/รายการเดินบัญชี (แล้วให้ transactions เป็น array ว่าง)`;
}

function mediaType(buffer) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  return 'image/jpeg'; // pdftoppm ออกมาเป็น jpeg
}

// รับ date string จาก Gemini แล้วคืน YYYY-MM-DD ที่ถูกต้อง หรือ null — เผื่อโมเดลเผลอตอบเป็น พ.ศ.
function normalizeDate(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const year = Number(raw.slice(0, 4));
  return year >= 2500 ? `${year - 543}${raw.slice(4)}` : raw;
}

// images: array ของ Buffer รูปแต่ละหน้า (จาก pdf.js) — คืน array ของ
// { date, description, amount, direction } (ยังไม่ใส่เครื่องหมาย signed) หรือ [] ถ้าไม่ใช่ statement
async function extractStatement(images, bankHint) {
  const key = apiKey();
  if (!key) throw new Error('ไม่ได้ตั้ง GEMINI_API_KEY (หรือ GOOGLE_VISION_API_KEY) ใน .env');
  if (!images || images.length === 0) return [];

  const parts = images.map((buf) => ({
    inline_data: { mime_type: mediaType(buf), data: buf.toString('base64') },
  }));
  parts.push({ text: prompt(bankHint) });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: STATEMENT_SCHEMA,
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return [];

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.error('statementExtract JSON parse error:', err, text);
    return [];
  }

  if (!data.is_statement || !Array.isArray(data.transactions)) return [];

  return data.transactions
    .map((t) => ({
      date: normalizeDate(t.date),
      description: (t.description || '').trim() || 'รายการ',
      amount: Number(t.amount),
      direction: t.direction === 'income' ? 'income' : 'expense',
    }))
    .filter((t) => Number.isFinite(t.amount) && t.amount > 0); // กันแถวที่ไม่มียอดจริง
}

module.exports = { extractStatement };
