// เก็บ metadata ที่ Actual Budget ไม่มี native field ให้ (บัตร, dedupe ref)
// ใช้ SQLite ธรรมดา ไฟล์เดียว เบาสุดสำหรับ single-user

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'bot.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  line_user_id TEXT PRIMARY KEY,
  display_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  actual_account_id TEXT,
  credit_limit REAL,
  due_day INTEGER,
  statement_day INTEGER,
  apr REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transaction_refs (
  ref TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  amount REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- รายการที่รอผู้ใช้เลือกบัญชี (Flex) — เก็บ payload เต็มไว้ที่นี่ แล้วใส่แค่ token สั้นๆ ใน postback
-- กันชน limit 300 ตัวอักษรของ postback data (ชื่อร้าน/บัญชีไทยยาวๆ พอ encode แล้วบานเกิน)
CREATE TABLE IF NOT EXISTS pending_tx (
  token TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- สถานะการนำเข้า statement PDF แบบหลายขั้นตอน (เลือกธนาคาร → ถอด statement → เลือกบัญชี → ยืนยัน)
-- LINE ไม่มี session ในตัว เลยเก็บ state ต่อการนำเข้าไว้ที่นี่ อ้างถึงด้วย token สั้นๆ ใน postback
-- transactions = JSON รายการที่ AI ถอดได้ (เก็บหลังเลือกธนาคาร), file_path = PDF ต้นฉบับบนดิสก์
CREATE TABLE IF NOT EXISTS pending_import (
  token TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  file_path TEXT,
  bank TEXT,
  account_id TEXT,
  transactions TEXT,
  status TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

module.exports = db;
