// ถอดรหัส QR Code จากรูปสลิป แล้ว parse ตามมาตรฐาน Thai QR Payment ของ ธปท.
// อ้างอิง: https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2562/ThaiPDF/25620084.pdf
// ("มาตรฐาน QR Code สำหรับการชำระเงิน" ของไทย ซึ่งอิงโครงสร้าง TLV ของ EMVCo Merchant
// Presented QR) — jimp/jsqr เป็น pure-JS ทั้งคู่ ไม่ต้อง compile native เข้ากับ VPS 1GB

const { Jimp } = require('jimp');
const jsQR = require('jsqr');
const crypto = require('crypto');

// AID ของแต่ละรูปแบบ merchant account info template ตามมาตรฐาน Thai QR
const AID_PROMPTPAY = 'A000000677010111';
const AID_BILL_PAYMENT = 'A000000677010112';
// tag ที่มักใช้เก็บ merchant account info (29-51 ตามสเปก EMVCo) — วนหา AID ที่รู้จักแทนที่จะ
// เจาะจงเลข tag เดียว เพราะแต่ละธนาคาร/ผู้ให้บริการเลือก tag ไม่ตรงกันเสมอไป
const MERCHANT_INFO_TAGS = ['26', '27', '28', '29', '30', '31', '49', '50', '51'];

async function decodeQrFromImage(buffer) {
  const image = await Jimp.read(buffer);
  const { data, width, height } = image.bitmap;
  const result = jsQR(new Uint8ClampedArray(data), width, height);
  return result ? result.data : null;
}

// TLV ธรรมดาตามสเปก EMVCo: 2 หลัก tag + 2 หลัก length (นับเป็นจำนวนตัวอักษร) + value
function parseTLV(str) {
  const fields = {};
  let i = 0;
  while (i + 4 <= str.length) {
    const id = str.slice(i, i + 2);
    const len = parseInt(str.slice(i + 2, i + 4), 10);
    if (Number.isNaN(len)) break;
    fields[id] = str.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return fields;
}

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — คำนวณจาก payload ทั้งหมดยกเว้น
// ค่า CRC 4 ตัวท้ายสุด (tag 63 length 04) ตามที่สเปกกำหนด ใช้เช็คว่าถอด QR มาไม่ผิดเพี้ยน
function crc16ccitt(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// payload: string ดิบที่ได้จาก QR (ไม่ใช่ base64/รูป) — คืน null ถ้าไม่ใช่โครงสร้าง Thai QR ที่รู้จัก
function parseThaiQr(payload) {
  if (!payload || payload.length < 8) return null;

  const fields = parseTLV(payload);
  const crcValue = fields['63'];
  const valid = Boolean(crcValue) && crc16ccitt(payload.slice(0, -4)) === crcValue;

  let merchantInfo = null;
  let isPromptPay = false;
  let isBillPayment = false;
  for (const tag of MERCHANT_INFO_TAGS) {
    if (!fields[tag]) continue;
    const sub = parseTLV(fields[tag]);
    if (sub['00'] === AID_PROMPTPAY) {
      isPromptPay = true;
      merchantInfo = {
        aid: sub['00'],
        promptPayMobile: sub['01'] || null,
        promptPayTaxId: sub['02'] || null,
        promptPayEWallet: sub['03'] || null,
      };
      break;
    }
    if (sub['00'] === AID_BILL_PAYMENT) {
      isBillPayment = true;
      merchantInfo = {
        aid: sub['00'],
        billerId: sub['01'] || null,
        ref1: sub['02'] || null,
        ref2: sub['03'] || null,
      };
      break;
    }
  }

  // tag 62: Additional Data Field Template — 01 Bill Number, 05 Reference Label เป็นต้น
  const additional = fields['62'] ? parseTLV(fields['62']) : {};
  const amount = fields['54'] !== undefined ? parseFloat(fields['54']) : null;

  return {
    raw: payload,
    valid,
    pointOfInitiationMethod: fields['01'] || null, // '11' = static, '12' = dynamic (มียอดเงินตายตัว)
    isPromptPay,
    isBillPayment,
    merchantInfo,
    merchantCategoryCode: fields['52'] || null,
    currency: fields['53'] || null, // ISO 4217 numeric, '764' = THB
    amount: amount !== null && !Number.isNaN(amount) ? amount : null,
    countryCode: fields['58'] || null,
    merchantName: fields['59'] || null,
    merchantCity: fields['60'] || null,
    billNumber: additional['01'] || null,
    referenceLabel: additional['05'] || null,
    // dedupe key กันบันทึกซ้ำเมื่อผู้ใช้ส่งรูปสลิปเดิมซ้ำ — ใช้ hash ของ payload ทั้งก้อน
    // เพราะ QR แบบ dynamic (มียอดเงิน) จะฝัง ref/เวลาที่ต่างกันในแต่ละธุรกรรมอยู่แล้ว
    // ทำให้ payload ไม่ซ้ำกันข้ามธุรกรรมจริง แม้ตัด field ย่อยที่ธนาคารแต่ละเจ้าใช้ไม่ตรงกัน
    ref: crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24),
  };
}

module.exports = { decodeQrFromImage, parseThaiQr };
