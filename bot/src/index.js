require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const line = require('@line/bot-sdk');
const db = require('./db');
const actual = require('./actualClient');
const { parseExpenseText } = require('./handlers/text');
const { guessCategory } = require('./handlers/category');
const { decodeQrFromImage, parseThaiQr } = require('./qr');
const { extractSlip } = require('./slipExtract');
const { renderPdfToImages } = require('./pdf');
const { extractStatement } = require('./statementExtract');
const { extractPayee } = require('./payee');

// ธนาคารให้เลือกตอนนำเข้า statement PDF — key ใช้จับคู่รหัสผ่านใน PDF_PASSWORDS และเป็น hint ให้ AI
const BANKS = [
  { key: 'kbank', label: 'กสิกรไทย (KBank)', color: '#138B4B' },
 // { key: 'scb', label: 'ไทยพาณิชย์ (SCB)', color: '#4E2E7F' },
 // { key: 'bbl', label: 'กรุงเทพ (BBL)', color: '#1E3A8A' },
 // { key: 'ktb', label: 'กรุงไทย (KTB)', color: '#00A4E4' },
  { key: 'ttb', label: 'ทีทีบี (ttb)', color: '#002D63' }, // หรือใช้สีส้มคู่บุญ #F36F21
  { key: 'bay', label: 'กรุงศรี (BAY)', color: '#FCC419' },
  { key: 'uob', label: 'ยูโอบี (UOB)', color: '#0B3674' },
 // { key: 'kkp', label: 'เกียรตินาคินภัทร (KKP)', color: '#252B46' },
 // { key: 'gsb', label: 'ออมสิน (GSB)', color: '#EC008C' },
  { key: 'other', label: 'อื่นๆ / ไม่ระบุ', color: '#6B7280' },
];

// รหัสผ่าน PDF ต่อธนาคาร ตั้งใน .env เป็น JSON เช่น PDF_PASSWORDS={"kbank":"1234","scb":"..."}
// key ต้องตรงกับ BANKS[].key — ธนาคารที่ไม่มีในนี้ถือว่า PDF ไม่ติดรหัส
let PDF_PASSWORDS = {};
try {
  PDF_PASSWORDS = JSON.parse(process.env.PDF_PASSWORDS || '{}');
} catch (err) {
  console.error('PDF_PASSWORDS ไม่ใช่ JSON ที่ถูกต้อง — จะถือว่าไม่มีรหัสผ่าน:', err.message);
}

// โฟลเดอร์เก็บ PDF ต้นฉบับระหว่างรอผู้ใช้เลือกธนาคาร/บัญชี (ลบทิ้งเมื่อยืนยัน/ยกเลิก/หมดอายุ)
const IMPORT_DIR = path.join(__dirname, '..', 'data', 'imports');
fs.mkdirSync(IMPORT_DIR, { recursive: true });

// ภาพจิยุมุมหัวการ์ด "นำเข้าสำเร็จ" ให้เข้าชุดกับการ์ดจดรายการเดี่ยว — ตั้ง URL รูป (https) ใน .env
// ถ้าไม่ตั้งไว้ก็ยังทำงานได้ แค่ไม่มีรูป (ต้องเป็น URL สาธารณะ https เท่านั้นตามข้อกำหนด Flex image)
const CHIYU_HERO_URL = process.env.CHIYU_HERO_URL || null;

const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});
const blobClient = new line.messagingApi.MessagingApiBlobClient({
  channelAccessToken: config.channelAccessToken,
});

const app = express();

app.get('/health', (req, res) => res.send('ok'));

// API สำหรับ LIFF dashboard (liff-web/) — auth ผ่าน verifyLiffUser ในตัว router เอง
app.use('/api', require('./routes/api'));

// line.middleware ต้องอ่าน raw body เอง ห้ามใส่ express.json() ก่อนหน้า route นี้
app.post('/webhook', line.middleware(config), async (req, res) => {
  res.status(200).end(); // ตอบ Line ทันทีกัน timeout แล้วค่อยประมวลผลต่อ async
  for (const event of req.body.events) {
    handleEvent(event).catch((err) => console.error('handleEvent error:', err));
  }
});

async function handleEvent(event) {
  const userId = event.source.userId;
  console.log('line_user_id:', userId); // เอาไปใส่ ALLOWED_LINE_USER_ID ใน .env ตอน setup LIFF
  db.prepare(
    `INSERT INTO users (line_user_id) VALUES (?) ON CONFLICT(line_user_id) DO NOTHING`
  ).run(userId);

  if (event.type === 'postback') {
    await showLoading(userId);
    return handlePostback(event);
  }

  if (event.type !== 'message') return;

  // แสดง loading animation ระหว่างรอประมวลผล (โดยเฉพาะรูปที่ต้องเรียก Gemini + Actual API)
  await showLoading(userId);

  if (event.message.type === 'text') {
    return handleText(event);
  }
  if (event.message.type === 'image') {
    return handleImage(event);
  }
  if (event.message.type === 'file') {
    return handleFile(event);
  }
}

// แสดง loading animation ในแชท 1-1 (LINE loading indicator API) — auto หายเมื่อบอทตอบ หรือครบเวลา
// ใช้ได้เฉพาะแชทตัวต่อตัว (source.type === 'user') และห้ามให้ error ตรงนี้ทำให้ flow หลักล้ม
async function showLoading(userId, loadingSeconds = 10) {
  if (!userId) return;
  try {
    await client.showLoadingAnimation({ chatId: userId, loadingSeconds });
  } catch (err) {
    console.error('showLoadingAnimation error:', err);
  }
}

async function handleText(event) {
  const text = event.message.text.trim();
  if (text === 'สวัสดี' || text === 'hello') {
    return reply(event.replyToken, 'สวัสดีค่ะ จิยุพร้อมให้บริการค่า');
  }

  const parsed = parseExpenseText(text);
  if (!parsed) {
    return reply(
      event.replyToken,
      'พิมพ์แบบ "รายการ จำนวน" เช่น "ข้าว 60" หรือ "เงินเดือน +30000"'
    );
  }

  return offerAccountChoice(event, { label: parsed.label, amount: parsed.amount });
}

// เสนอบัญชีให้เลือกเป็น Flex Message (สวย + รองรับชื่อยาว) แล้วผูก postback บันทึกธุรกรรมเมื่อกด
// ใช้ร่วมกันทั้งข้อความพิมพ์เองและสลิป — payload เต็ม (amount/label/category/ref/source/date)
// เก็บใน pending_tx ที่ DB แล้วใส่แค่ token สั้นๆ ใน postback (กันชน limit 300 ตัวอักษร)
async function offerAccountChoice(event, { label, amount, ref, source, date }) {
  const accounts = (await actual.getAccounts()).filter((a) => !a.closed);
  if (accounts.length === 0) {
    return reply(event.replyToken, 'ยังไม่มีบัญชีใน Actual Budget ให้เลือก');
  }

  const isIncome = amount > 0;
  const categories = await actual.getCategories();
  const category = guessCategory(label, categories, isIncome);
  console.log(
    'category guess:',
    JSON.stringify({ label, isIncome, guessed: category?.name || null })
  );

  // เก็บรายการค้างไว้ที่ DB คืนแค่ token — postback แต่ละปุ่มเลยเหลือแค่ token + accountId
  const token = crypto.randomBytes(9).toString('hex');
  db.prepare(`INSERT INTO pending_tx (token, payload) VALUES (?, ?)`).run(
    token,
    JSON.stringify({
      amount,
      label,
      categoryId: category?.id,
      categoryName: category?.name,
      ref,
      source,
      date,
    })
  );
  // เก็บกวาดรายการค้างเก่าเกิน 1 วัน (ผู้ใช้กดค้างแล้วเลิก) กัน DB บวม
  db.prepare(`DELETE FROM pending_tx WHERE created_at < datetime('now', '-1 day')`).run();

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'flex',
        altText: `${label} ${amount} บาท — เลือกบัญชี`,
        contents: buildAccountPickerBubble({ label, amount, category, date, accounts, token }),
      },
    ],
  });
}

// Flex bubble: หัวแสดงรายการ (ชื่อ/ยอด/หมวดหมู่/วันที่) แล้วต่อด้วยรายการบัญชีให้กดเลือก
// แต่ละบัญชีเป็น box ที่กดได้ (มี action ที่ box) เพื่อให้แสดงชื่อยาวๆ ได้ ไม่ติด label limit ของปุ่ม
function buildAccountPickerBubble({ label, amount, category, date, accounts, token }) {
  const isIncome = amount > 0;
  const amountText = `${isIncome ? '+' : '-'}${Math.abs(amount).toLocaleString('en-US')} บาท`;

  const detailRows = [];
  if (category) detailRows.push(infoRow('หมวดหมู่', category.name));
  if (date) detailRows.push(infoRow('วันที่', date));

  const accountRows = accounts.slice(0, 20).map((a) => ({
    type: 'box',
    layout: 'horizontal',
    paddingAll: 'md',
    cornerRadius: 'md',
    backgroundColor: '#F3F6F9',
    margin: 'sm',
    action: {
      type: 'postback',
      data: `action=add_tx&token=${token}&accountId=${encodeURIComponent(a.id)}`,
      displayText: `เลือกบัญชี: ${a.name}`,
    },
    contents: [
      { type: 'text', text: a.name, wrap: true, weight: 'bold', color: '#1F6FEB', size: 'sm' },
    ],
  }));

  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: label, weight: 'bold', size: 'lg', wrap: true },
        { type: 'text', text: amountText, size: 'xxl', weight: 'bold', color: isIncome ? '#17803D' : '#D93025' },
        ...(detailRows.length ? [{ type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md', contents: detailRows }] : []),
        { type: 'separator', margin: 'lg' },
        { type: 'text', text: 'เลือกบัญชีที่จะบันทึก', size: 'sm', color: '#8A8A8A', margin: 'md' },
        ...accountRows,
      ],
    },
  };
}

function infoRow(label, value) {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: '#8A8A8A', size: 'sm', flex: 2 },
      { type: 'text', text: value, color: '#333333', size: 'sm', flex: 5, wrap: true },
    ],
  };
}

async function handlePostback(event) {
  const data = new URLSearchParams(event.postback.data);
  switch (data.get('action')) {
    case 'add_tx':
      return handleAddTx(event, data);
    case 'imp_bank':
      return handleImportBank(event, data);
    case 'imp_review':
      return handleImportReview(event, data);
    case 'imp_account':
      return handleImportAccount(event, data);
    case 'imp_cancel':
      return handleImportCancel(event, data);
    default:
      return;
  }
}

async function handleAddTx(event, data) {
  const token = data.get('token');
  const accountId = data.get('accountId');

  const row = token && db.prepare(`SELECT payload FROM pending_tx WHERE token = ?`).get(token);
  if (!row) {
    return reply(event.replyToken, 'รายการนี้หมดอายุหรือถูกบันทึกไปแล้ว ลองส่งใหม่อีกครั้งค่ะ');
  }
  const { amount, label, categoryId, categoryName, ref, source, date } = JSON.parse(row.payload);

  if (ref && db.prepare(`SELECT 1 FROM transaction_refs WHERE ref = ?`).get(ref)) {
    db.prepare(`DELETE FROM pending_tx WHERE token = ?`).run(token);
    return reply(event.replyToken, 'รายการนี้บันทึกไปแล้ว ข้ามให้ไม่ซ้ำนะคะ');
  }

  try {
    await actual.addTransaction({ accountId, amount, payee: label, category: categoryId, date });
  } catch (err) {
    console.error('handlePostback addTransaction error:', err);
    return reply(event.replyToken, 'บันทึกรายการไม่สำเร็จ ลองใหม่อีกครั้งค่ะ');
  }

  if (ref) {
    db.prepare(
      `INSERT INTO transaction_refs (ref, source, amount) VALUES (?, ?, ?) ON CONFLICT(ref) DO NOTHING`
    ).run(ref, source || 'manual', amount);
  }
  db.prepare(`DELETE FROM pending_tx WHERE token = ?`).run(token); // ใช้ครั้งเดียว กดซ้ำจะไม่บันทึกซ้ำ

  const accountName =
    (await actual.getAccounts()).find((a) => a.id === accountId)?.name || accountId;
  const lines = [
    'บันทึกแล้ว:',
    `${label} ${amount} บาท`,
    ...(categoryName ? [`หมวดหมู่: ${categoryName}`] : []),
    `บัญชี: ${accountName}`,
    ...(date ? [`วันที่: ${date}`] : []),
  ];
  return reply(event.replyToken, lines.join('\n'));
}

// รูปที่ส่งเข้ามาอาจมี QR Code (ค่าเริ่มต้นคือมี — QR แบบ Thai QR Payment ที่ผูกยอดเงินตายตัว)
// หรือไม่มีก็ได้ ลอง decode+parse QR ก่อนเพราะแม่น + ฟรี + ไม่ต้องเรียก API
// ถ้าไม่เจอ QR ที่ใช้ได้ (เช่น สลิปหลังจ่ายเงินที่ฝัง QR ตรวจสอบสลิปของธนาคารเอง) ค่อยส่งรูปให้ Claude อ่าน
async function handleImage(event) {
  const stream = await blobClient.getMessageContent(event.message.id);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);

  const qrPayload = await decodeQrFromImage(buffer).catch((err) => {
    console.error('decodeQrFromImage error:', err);
    return null;
  });

  if (qrPayload) {
    const qr = parseThaiQr(qrPayload);
    console.log('qr parsed:', JSON.stringify({ ...qr, raw: undefined }));

    // เชื่อยอดเงินจาก QR เฉพาะตอน CRC ถูกต้อง (กัน decode ผิดเพี้ยนจากภาพเบลอ/แสงสะท้อน)
    // และต้องมี tag 54 (Transaction Amount) — ถ้าเป็น QR แบบ static (รับเงินทั่วไป ไม่ผูกยอด)
    // จะไม่มี field นี้ ให้ไป fallback Claude vision แทนเพราะเดายอดเองไม่ได้
    if (qr && qr.valid && qr.amount !== null) {
      if (db.prepare(`SELECT 1 FROM transaction_refs WHERE ref = ?`).get(qr.ref)) {
        return reply(event.replyToken, 'สลิปนี้บันทึกไปแล้วค่ะ');
      }

      const label = qr.merchantName || qr.billNumber || 'จ่ายเงินผ่าน QR';
      // สลิปที่ถ่ายส่งมาถือเป็นรายจ่าย (จ่ายเงินออกผ่าน QR) ตามค่าเริ่มต้นเดียวกับพิมพ์ข้อความ
      return offerAccountChoice(event, {
        label,
        amount: -Math.abs(qr.amount),
        ref: qr.ref,
        source: 'qr',
      });
    }
  }

  // ไม่มี QR ที่ใช้ได้ → ส่งรูปให้ Claude อ่าน+สกัดชื่อผู้รับ/ยอดเงิน/เลขอ้างอิง เป็น JSON
  let slip;
  try {
    slip = await extractSlip(buffer);
  } catch (err) {
    console.error('extractSlip error:', err);
    return reply(event.replyToken, 'อ่านสลิปไม่สำเร็จ ลองส่งใหม่อีกครั้งค่ะ');
  }
  console.log('slip extracted:', JSON.stringify(slip));

  if (!slip) {
    return reply(event.replyToken, 'อ่านรูปแล้วแต่ไม่เจอข้อมูลธุรกรรม ลองส่งสลิปที่ชัดกว่านี้นะคะ');
  }

  if (slip.ref && db.prepare(`SELECT 1 FROM transaction_refs WHERE ref = ?`).get(slip.ref)) {
    return reply(event.replyToken, 'สลิปนี้บันทึกไปแล้วค่ะ');
  }

  const signedAmount = slip.direction === 'income' ? Math.abs(slip.amount) : -Math.abs(slip.amount);
  return offerAccountChoice(event, {
    label: slip.payee,
    amount: signedAmount,
    ref: slip.ref || undefined,
    source: 'slip',
    date: slip.date || undefined,
  });
}

// นำเข้า statement PDF แบบหลายขั้น: รับไฟล์ → เลือกธนาคาร (handleImportBank) → ถอดรายการด้วย AI
// → พรีวิวรายการทั้งหมดให้ตรวจ+ยืนยัน (handleImportReview) → เลือกบัญชีแล้วบันทึกเข้า Actual (handleImportAccount)
async function handleFile(event) {
  const fileName = event.message.fileName || '';
  if (!fileName.toLowerCase().endsWith('.pdf')) {
    return reply(event.replyToken, 'รองรับเฉพาะไฟล์ PDF statement ค่ะ (ส่งไฟล์ .pdf มาได้เลย)');
  }

  // ดาวน์โหลดไฟล์จาก LINE แล้วเก็บลงดิสก์ระหว่างรอผู้ใช้เลือกธนาคาร (postback มีแค่ token)
  const stream = await blobClient.getMessageContent(event.message.id);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);

  const token = crypto.randomBytes(9).toString('hex');
  const filePath = path.join(IMPORT_DIR, `${token}.pdf`);
  fs.writeFileSync(filePath, buffer);

  db.prepare(
    `INSERT INTO pending_import (token, line_user_id, file_path, status) VALUES (?, ?, ?, 'await_bank')`
  ).run(token, event.source.userId, filePath);
  sweepStaleImports(); // เก็บกวาดไฟล์/รายการค้างเก่ากัน disk บวม

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'flex',
        altText: 'เลือกธนาคารของ statement',
        contents: buildBankPickerBubble(token, fileName),
      },
    ],
  });
}

// เลือกธนาคารแล้ว → ถอดรหัส PDF (ถ้าตั้งไว้ใน PDF_PASSWORDS) → แปลงเป็นรูป → ให้ Gemini ถอดรายการ
// ขั้นนี้ช้าสุด (แปลงรูป + เรียก AI หลายหน้า) จึงต่อ loading ยาว + ตอบผลด้วย push (กัน reply token หมดอายุ)
async function handleImportBank(event, data) {
  const userId = event.source.userId;
  const token = data.get('token');
  const bank = data.get('bank');
  const row = token && db.prepare(`SELECT * FROM pending_import WHERE token = ?`).get(token);
  if (!row || row.status !== 'await_bank') {
    return reply(event.replyToken, 'รายการนำเข้านี้หมดอายุแล้ว ส่งไฟล์ใหม่อีกครั้งค่ะ');
  }

  await showLoading(userId, 60);
  const bankLabel = BANKS.find((b) => b.key === bank)?.label || null;

  let transactions;
  try {
    const buffer = fs.readFileSync(row.file_path);
    const images = await renderPdfToImages(buffer, PDF_PASSWORDS[bank] || null);
    if (images.length === 0) {
      cleanupImport(row);
      return push(userId, 'เปิด PDF ไม่ได้หรือไม่มีหน้าให้อ่าน ลองส่งไฟล์ใหม่ค่ะ');
    }
    transactions = await extractStatement(images, bankLabel);
  } catch (err) {
    console.error('handleImportBank error:', err);
    cleanupImport(row);
    if (err.code === 'PDF_DECRYPT_FAILED') {
      return push(userId, `ถอดรหัส PDF ไม่สำเร็จ — ตรวจรหัสผ่านของ ${bankLabel || bank} ใน PDF_PASSWORDS อีกครั้งค่ะ`);
    }
    if (err.code === 'PDF_MAYBE_ENCRYPTED') {
      return push(userId, `PDF นี้น่าจะติดรหัสผ่าน แต่ยังไม่ได้ตั้งรหัสของ ${bankLabel || bank} ไว้ใน PDF_PASSWORDS ค่ะ`);
    }
    return push(userId, 'อ่าน statement ไม่สำเร็จ ลองใหม่อีกครั้งค่ะ');
  }

  if (transactions.length === 0) {
    cleanupImport(row);
    return push(userId, 'อ่านไฟล์แล้วแต่ไม่พบรายการธุรกรรม ลองเลือกธนาคารให้ตรง หรือส่งไฟล์ที่ชัดกว่านี้ค่ะ');
  }

  db.prepare(
    `UPDATE pending_import SET bank = ?, transactions = ?, status = 'await_review' WHERE token = ?`
  ).run(bank, JSON.stringify(transactions), token);

  // โชว์รายการที่อ่านได้ทั้งหมดให้ตรวจก่อน แล้วค่อยกดยืนยันไปเลือกบัญชี (ขั้นนี้ผลมาช้าใช้ push)
  return push(userId, {
    type: 'flex',
    altText: `พบ ${transactions.length} รายการ — ตรวจแล้วกดยืนยัน`,
    contents: buildImportPreviewCarousel(token, transactions),
  });
}

// ยืนยันรายการแล้ว → ไปเลือกบัญชีปลายทาง
async function handleImportReview(event, data) {
  const token = data.get('token');
  const row = token && db.prepare(`SELECT * FROM pending_import WHERE token = ?`).get(token);
  if (!row || row.status !== 'await_review') {
    return reply(event.replyToken, 'รายการนำเข้านี้หมดอายุแล้ว ส่งไฟล์ใหม่อีกครั้งค่ะ');
  }

  await showLoading(event.source.userId, 60); // getAccounts ครั้งแรกจะ trigger actual.init()+downloadBudget อาจช้า
  const accounts = (await actual.getAccounts()).filter((a) => !a.closed);
  if (accounts.length === 0) {
    cleanupImport(row);
    return reply(event.replyToken, 'ยังไม่มีบัญชีใน Actual Budget ให้เลือกนำเข้า');
  }

  db.prepare(`UPDATE pending_import SET status = 'await_account' WHERE token = ?`).run(token);
  const transactions = JSON.parse(row.transactions);

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'flex',
        altText: 'เลือกบัญชีที่จะนำเข้า',
        contents: buildImportAccountPickerBubble(token, transactions, accounts),
      },
    ],
  });
}

// เลือกบัญชีแล้ว → บันทึกทุกรายการเข้า Actual ในบัญชีนั้นทันที (แปลง direction เป็นยอด +/-)
async function handleImportAccount(event, data) {
  const token = data.get('token');
  const accountId = data.get('accountId');
  const row = token && db.prepare(`SELECT * FROM pending_import WHERE token = ?`).get(token);
  if (!row || row.status !== 'await_account') {
    return reply(event.replyToken, 'รายการนำเข้านี้หมดอายุหรือถูกบันทึกไปแล้วค่ะ');
  }

  await showLoading(event.source.userId, 60); // บันทึกหลายรายการเข้า Actual อาจใช้เวลาหลายวินาที
  const transactions = JSON.parse(row.transactions);
  const categories = await actual.getCategories();
  const txs = transactions.map((t) => {
    const isIncome = t.direction === 'income';
    const amount = isIncome ? Math.abs(t.amount) : -Math.abs(t.amount);
    const category = guessCategory(t.description, categories, isIncome);
    return {
      date: t.date || undefined,
      amount,
      payee: extractPayee(t.description), // ชื่อร้านที่ทำความสะอาดแล้ว (ตัด gateway/location/เลขอ้างอิง)
      category: category?.id,
      notes: t.description, // เก็บรายละเอียดดิบเต็มไว้ใน notes
    };
  });

  try {
    await actual.addTransactions(accountId, txs);
  } catch (err) {
    console.error('handleImportAccount addTransactions error:', err);
    return reply(event.replyToken, 'บันทึกรายการไม่สำเร็จ ลองใหม่อีกครั้งค่ะ');
  }

  cleanupImport(row); // ใช้ครั้งเดียว ลบไฟล์ + รายการค้าง กดซ้ำจะขึ้นหมดอายุ
  const accountName = (await actual.getAccounts()).find((a) => a.id === accountId)?.name || accountId;

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'flex',
        altText: `นำเข้าเรียบร้อย ${txs.length} รายการ`,
        contents: buildImportDoneBubble(txs, accountName),
      },
    ],
  });
}

// สีธีมจิยุ (โทนครีม + ชมพูมาเจนต้า) ให้การ์ดนำเข้าเข้าชุดกับการ์ดจดรายการเดี่ยว
const THEME = {
  cream: '#F4EEE2', // พื้นหัวการ์ด
  ink: '#3D2C1F', // ตัวอักษรหลักบนครีม
  muted: '#9B8B7A', // ตัวอักษรรอง
  magenta: '#C2185B', // สีแบรนด์ (badge/รายจ่าย/ยอดติดลบ)
  green: '#2E9E5B', // รายรับ/ยอดบวก
};

// pill badge เล็กๆ พื้นสี + ตัวอักษรขาว (เหมือน badge "รายจ่าย" ในการ์ดจดรายการเดี่ยว)
function badge(text, color) {
  return {
    type: 'box',
    layout: 'baseline',
    flex: 0,
    backgroundColor: color,
    cornerRadius: 'xl',
    paddingAll: 'xs',
    paddingStart: 'md',
    paddingEnd: 'md',
    contents: [{ type: 'text', text, size: 'xs', weight: 'bold', color: '#FFFFFF' }],
  };
}

// Flex: สรุปผลนำเข้าสำเร็จ — สไตล์ธีมจิยุ (หัวครีม + subtitle + รูปจิยุ) แยกรายรับ/รายจ่าย + ยอดสุทธิ
function buildImportDoneBubble(txs, accountName) {
  const income = txs.reduce((s, t) => (t.amount > 0 ? s + t.amount : s), 0);
  const expense = txs.reduce((s, t) => (t.amount < 0 ? s + t.amount : s), 0);
  const net = income + expense;

  // หัวการ์ด: ข้อความซ้าย + รูปจิยุขวา (ถ้าตั้ง CHIYU_HERO_URL) บนพื้นครีม
  const headerTexts = {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    flex: CHIYU_HERO_URL ? 7 : 1,
    contents: [
      { type: 'text', text: 'นำเข้าสำเร็จ ✅', weight: 'bold', size: 'lg', color: THEME.ink, wrap: true },
      {
        type: 'text',
        text: 'อย่าลืมตรวจสอบรายการที่จดด้วยนะคะ',
        size: 'sm',
        color: THEME.muted,
        wrap: true,
      },
    ],
  };

  const sumRow = (label, text, color) => ({
    type: 'box',
    layout: 'horizontal',
    alignItems: 'center',
    contents: [
      badge(label, color),
      { type: 'text', text, size: 'md', weight: 'bold', align: 'end', color, wrap: true },
    ],
  });

  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'horizontal',
      paddingAll: 'lg',
      backgroundColor: THEME.cream,
      spacing: 'md',
      contents: [
        headerTexts,
        ...(CHIYU_HERO_URL
          ? [{ type: 'image', url: CHIYU_HERO_URL, flex: 3, size: 'full', aspectMode: 'fit', gravity: 'center' }]
          : []),
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          alignItems: 'center',
          contents: [
            badge(`${txs.length} รายการ`, THEME.magenta),
            { type: 'text', text: accountName, size: 'sm', weight: 'bold', align: 'end', color: THEME.ink, wrap: true },
          ],
        },
        { type: 'separator' },
        sumRow('รายรับ', `+${fmtAmount(income)}`, THEME.green),
        sumRow('รายจ่าย', `-${fmtAmount(expense)}`, THEME.magenta),
        { type: 'separator' },
        {
          type: 'box',
          layout: 'horizontal',
          alignItems: 'center',
          contents: [
            { type: 'text', text: 'ยอดสุทธิ', size: 'md', weight: 'bold', color: THEME.ink },
            {
              type: 'text',
              text: `${net >= 0 ? '+' : '-'}${fmtAmount(net)} บาท`,
              size: 'lg',
              weight: 'bold',
              align: 'end',
              color: net >= 0 ? THEME.green : THEME.magenta,
              wrap: true,
            },
          ],
        },
      ],
    },
  };
}

async function handleImportCancel(event, data) {
  const token = data.get('token');
  const row = token && db.prepare(`SELECT * FROM pending_import WHERE token = ?`).get(token);
  if (row) cleanupImport(row);
  return reply(event.replyToken, 'ยกเลิกการนำเข้าแล้วค่ะ');
}

// เลือกสีตัวอักษร (ขาว/ดำ) ให้ตัดกับพื้นหลังชัดสุด ด้วยค่าความสว่าง YIQ — สีอ่อน(เหลือง)ได้ตัวดำ, สีเข้มได้ตัวขาว
function textColorFor(bg) {
  const hex = (bg || '').replace('#', '');
  if (hex.length !== 6) return '#FFFFFF';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? '#1A1A1A' : '#FFFFFF';
}

// Flex: เลือกธนาคารของ statement — แต่ละธนาคารเป็น box กดได้ ผูก postback imp_bank
// พื้นหลังใช้สีประจำธนาคาร (b.color) ตัวอักษรเลือกขาว/ดำอัตโนมัติให้ตัดกับพื้นหลัง
function buildBankPickerBubble(token, fileName) {
  const bankRows = BANKS.map((b) => ({
    type: 'box',
    layout: 'horizontal',
    paddingAll: 'md',
    cornerRadius: 'md',
    backgroundColor: b.color || '#6B7280',
    margin: 'sm',
    action: {
      type: 'postback',
      data: `action=imp_bank&token=${token}&bank=${b.key}`,
      displayText: `ธนาคาร: ${b.label}`,
    },
    contents: [
      { type: 'text', text: b.label, wrap: true, weight: 'bold', color: textColorFor(b.color), size: 'sm' },
    ],
  }));

  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: 'นำเข้า statement', weight: 'bold', size: 'lg' },
        { type: 'text', text: fileName, size: 'sm', color: '#8A8A8A', wrap: true },
        { type: 'separator', margin: 'lg' },
        { type: 'text', text: 'เลือกธนาคารของ statement นี้', size: 'sm', color: '#8A8A8A', margin: 'md' },
        ...bankRows,
      ],
    },
  };
}

// Flex: เลือกบัญชีปลายทางหลังถอดรายการได้แล้ว — คล้าย buildAccountPickerBubble แต่ผูก postback imp_account
function buildImportAccountPickerBubble(token, transactions, accounts) {
  const accountRows = accounts.slice(0, 20).map((a) => ({
    type: 'box',
    layout: 'horizontal',
    paddingAll: 'md',
    cornerRadius: 'md',
    backgroundColor: '#F3F6F9',
    margin: 'sm',
    action: {
      type: 'postback',
      data: `action=imp_account&token=${token}&accountId=${encodeURIComponent(a.id)}`,
      displayText: `เลือกบัญชี: ${a.name}`,
    },
    contents: [{ type: 'text', text: a.name, wrap: true, weight: 'bold', color: '#1F6FEB', size: 'sm' }],
  }));

  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: `พบ ${transactions.length} รายการ`, weight: 'bold', size: 'lg' },
        { type: 'text', text: 'เลือกบัญชีที่จะนำเข้ารายการทั้งหมด', size: 'sm', color: '#8A8A8A', wrap: true },
        { type: 'separator', margin: 'lg' },
        ...accountRows,
      ],
    },
  };
}

const IMPORT_DESC_MAX = 100; // ตัดรายละเอียดยาวเกิน 100 ตัวอักษรแล้วต่อ … (ตามที่ผู้ใช้ขอ)
function fmtAmount(n) {
  return Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// แถวธุรกรรม 1 รายการใน Flex: วันที่ + รายละเอียด(ตัด) + ยอด (สีเขียวรับเข้า/แดงจ่ายออก)
function previewRow(t) {
  const isIncome = t.direction === 'income';
  const desc =
    t.description.length > IMPORT_DESC_MAX ? t.description.slice(0, IMPORT_DESC_MAX) + '…' : t.description;
  return {
    type: 'box',
    layout: 'horizontal',
    margin: 'md',
    spacing: 'sm',
    contents: [
      { type: 'text', text: t.date || '-', size: 'xxs', color: '#8A8A8A', flex: 3, gravity: 'top' },
      { type: 'text', text: desc, size: 'xs', wrap: true, flex: 7, gravity: 'top' },
      {
        type: 'text',
        text: `${isIncome ? '+' : '-'}${fmtAmount(t.amount)}`,
        size: 'xs',
        align: 'end',
        weight: 'bold',
        color: isIncome ? '#17803D' : '#D93025',
        flex: 4,
        gravity: 'top',
      },
    ],
  };
}

// Flex carousel: โชว์รายการที่ AI อ่านได้ "ทุกรายการ" ให้ตรวจก่อน แล้วกดยืนยันไปเลือกบัญชี
// แบ่งเป็นหลาย bubble (LINE จำกัด ~50KB/ข้อความ และ 12 bubble/carousel) — ทุก bubble มีปุ่มยืนยัน/ยกเลิก
// สรุปยอดสุทธิอยู่หัวทุก bubble เพื่อให้ยืนยันจาก bubble ไหนก็ได้ ไม่ต้องปัดไปหน้าสุดท้าย
function buildImportPreviewCarousel(token, transactions) {
  // จำกัดให้ JSON ทั้งข้อความไม่เกิน limit ~50KB ของ Flex (worst case desc 100 ตัวอักษร ~84 แถว ≈ 40KB)
  // แถวที่เกินยังถูกนำเข้าครบ (import จาก transactions เต็ม) แค่ไม่โชว์ในพรีวิว — โชว์เป็นหมายเหตุแทน
  const ROWS_PER_BUBBLE = 12;
  const MAX_BUBBLES = 7;
  const total = transactions.length;
  const net = transactions.reduce(
    (s, t) => s + (t.direction === 'income' ? Math.abs(t.amount) : -Math.abs(t.amount)),
    0
  );

  const chunks = [];
  for (let i = 0; i < transactions.length; i += ROWS_PER_BUBBLE) {
    chunks.push(transactions.slice(i, i + ROWS_PER_BUBBLE));
  }
  const shown = chunks.slice(0, MAX_BUBBLES);
  const hiddenCount = total - shown.reduce((s, c) => s + c.length, 0); // รายการที่เกิน 12 bubble (จะนำเข้าครบอยู่ดี)

  const bubbles = shown.map((chunk, idx) => {
    const startNo = idx * ROWS_PER_BUBBLE + 1;
    const endNo = startNo + chunk.length - 1;
    const isLast = idx === shown.length - 1;
    return {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: `พบ ${total} รายการ`, weight: 'bold', size: 'md', flex: 5 },
              {
                type: 'text',
                text: `สุทธิ ${net >= 0 ? '+' : '-'}${fmtAmount(net)}`,
                size: 'sm',
                weight: 'bold',
                align: 'end',
                color: net >= 0 ? '#17803D' : '#D93025',
                flex: 5,
              },
            ],
          },
          { type: 'text', text: `รายการที่ ${startNo}–${endNo}`, size: 'xs', color: '#8A8A8A' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'none',
        contents: [
          ...chunk.map(previewRow),
          ...(isLast && hiddenCount > 0
            ? [
                { type: 'separator', margin: 'md' },
                {
                  type: 'text',
                  text: `… ซ่อนอีก ${hiddenCount} รายการ (จะนำเข้าครบทั้งหมด)`,
                  size: 'xs',
                  color: '#8A8A8A',
                  margin: 'md',
                  wrap: true,
                },
              ]
            : []),
        ],
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'postback',
              label: 'ยกเลิก',
              data: `action=imp_cancel&token=${token}`,
              displayText: 'ยกเลิก',
            },
          },
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            color: '#17803D',
            action: {
              type: 'postback',
              label: 'ยืนยันรายการ',
              data: `action=imp_review&token=${token}`,
              displayText: 'ยืนยันรายการ',
            },
          },
        ],
      },
    };
  });

  return { type: 'carousel', contents: bubbles };
}

// ลบไฟล์ PDF ต้นฉบับ + รายการค้างใน DB (เรียกตอนยืนยัน/ยกเลิก/error)
function cleanupImport(row) {
  if (row.file_path) fs.rmSync(row.file_path, { force: true });
  db.prepare(`DELETE FROM pending_import WHERE token = ?`).run(row.token);
}

// เก็บกวาดรายการนำเข้าค้างเกิน 1 วัน (ผู้ใช้ส่งไฟล์แล้วไม่ทำต่อ) พร้อมลบไฟล์ PDF ที่ค้างบนดิสก์
function sweepStaleImports() {
  const stale = db
    .prepare(`SELECT * FROM pending_import WHERE created_at < datetime('now', '-1 day')`)
    .all();
  for (const row of stale) cleanupImport(row);
}

async function reply(replyToken, text) {
  return client.replyMessage({ replyToken, messages: [{ type: 'text', text }] });
}

// ส่งข้อความแบบ push (ไม่ผูก reply token) — ใช้กับผลลัพธ์ที่ประมวลผลนานจน reply token อาจหมดอายุ
async function push(userId, message) {
  const messages = typeof message === 'string' ? [{ type: 'text', text: message }] : [message];
  return client.pushMessage({ to: userId, messages });
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`line-bot listening on ${port}`));
