require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const db = require('./db');
const actual = require('./actualClient');
const { ocrImage } = require('./vision');
const { parseExpenseText } = require('./handlers/text');

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
  const parsed = parseExpenseText(event.message.text);
  if (!parsed) {
    return reply(
      event.replyToken,
      'พิมพ์แบบ "รายการ จำนวน" เช่น "ข้าว 60" หรือ "เงินเดือน +30000"'
    );
  }

  // TODO: map ไป accountId จริง (default cash account หรือให้เลือกบัตร) ก่อนเรียก addTransaction
  // await actual.addTransaction({ accountId, amount: parsed.amount, payee: parsed.label });

  return reply(event.replyToken, `บันทึกแล้ว: ${parsed.label} ${parsed.amount} บาท`);
}

async function handleImage(event) {
  const stream = await blobClient.getMessageContent(event.message.id);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const base64 = Buffer.concat(chunks).toString('base64');

  const text = await ocrImage(base64);

  // TODO: parse ยอดเงิน/เลขอ้างอิงธุรกรรมจาก text ที่ OCR ได้
  // TODO: เช็ค transaction_refs กันบันทึกซ้ำก่อนเรียก actual.addTransaction
  return reply(event.replyToken, `อ่านสลิปได้ (ยังไม่ผูก parser):\n${text.slice(0, 200)}`);
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
