require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const line = require('@line/bot-sdk');
const db = require('./db');
const actual = require('./actualClient');
const { parseExpenseText } = require('./handlers/text');
const { guessCategory } = require('./handlers/category');
const { decodeQrFromImage, parseThaiQr } = require('./qr');
const { extractSlip } = require('./slipExtract');

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
    return handlePostback(event);
  }

  if (event.type !== 'message') return;

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
  if (data.get('action') !== 'add_tx') return;

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

async function handleFile(event) {
  // TODO: ดึงไฟล์ผ่าน blobClient.getMessageContent, เช็คว่าเป็น .pdf,
  // แล้วผูก parser ต่อธนาคาร (pdf-parse หรือส่งหน้าที่เป็นรูปเข้า Vision OCR)
  return reply(event.replyToken, 'รับไฟล์แล้ว (parser สำหรับ PDF statement ยังไม่ผูก)');
}

async function reply(replyToken, text) {
  return client.replyMessage({ replyToken, messages: [{ type: 'text', text }] });
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`line-bot listening on ${port}`));
