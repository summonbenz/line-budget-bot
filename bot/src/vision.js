// เรียก Google Cloud Vision API (REST) สำหรับ OCR สลิป/PDF ที่เป็นรูปสแกน
// ใช้ API key ธรรมดา (ง่ายสุดสำหรับ single-user, ไม่ต้องผูก service account)

const fetch = require('node-fetch');

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
            features: [{ type: 'TEXT_DETECTION' }],
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
