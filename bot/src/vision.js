// เรียก Google Cloud Vision API (REST) สำหรับ OCR สลิป/PDF ที่เป็นรูปสแกน
// ใช้ API key ธรรมดา (ง่ายสุดสำหรับ single-user, ไม่ต้องผูก service account)
// ใช้ fetch แบบ built-in ของ Node 18+ (ไม่ต้องพึ่ง node-fetch) — node-fetch v3 เป็น ESM-only
// พอ require() แบบ CJS แล้ว interop คืน module namespace object มาแทนฟังก์ชัน ทำให้ fetch(...) พัง

async function ocrImage(base64Image) {
  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64Image },
            // DOCUMENT_TEXT_DETECTION แม่นกว่า TEXT_DETECTION สำหรับข้อความหนาแน่นแบบสลิป/เอกสาร
            // languageHints บังคับให้เดาเป็นไทย/อังกฤษ กัน auto-detect หลุดไปอ่านเป็นภาษาอื่น
            // (ไม่ใส่ hint แล้วเจอปัญหาจริง: ตัวเลขไทยกลายเป็นเลขอารบิก, วันที่/ชื่อธนาคารอ่านผิดเพี้ยน)
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            imageContext: { languageHints: ['th', 'en'] },
          },
        ],
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Vision API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.responses?.[0]?.fullTextAnnotation?.text || '';
}

module.exports = { ocrImage };
