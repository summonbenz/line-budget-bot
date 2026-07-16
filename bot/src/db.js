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
`);

module.exports = db;
