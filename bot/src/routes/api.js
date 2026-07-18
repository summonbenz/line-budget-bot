// API สำหรับ LIFF dashboard เท่านั้น — ทุก route ผ่าน verifyLiffUser ก่อนเสมอ

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const actual = require('../actualClient');
const db = require('../db');
const { verifyLiffUser } = require('../auth');

// โฟลเดอร์รูปสลิปหลักฐาน (เดียวกับ SLIP_DIR ใน src/index.js)
const SLIP_DIR = path.join(__dirname, '..', '..', 'data', 'slips');

const router = express.Router();
// json parser ใส่เฉพาะ router นี้ (mount ที่ /api) — ห้ามใส่ global เพราะ /webhook ต้องอ่าน raw body
// limit 8mb เผื่อรูปสลิปที่หน้าแก้ไขส่งมาเป็น base64 ใน body (PUT /tx/:id)
router.use(express.json({ limit: '8mb' }));
router.use(verifyLiffUser);

function getCardAccountIds() {
  // บัตรเครดิตคือ account ที่ user ผูกไว้ในตาราง cards (bot/src/db.js)
  // ต้องเพิ่มแถวในตารางนี้เองตอน setup บัตรแต่ละใบ (ยังไม่มีคำสั่งเพิ่มบัตรผ่าน Line ในสคาฟโฟลด์นี้)
  const rows = db.prepare(`SELECT actual_account_id FROM cards WHERE actual_account_id IS NOT NULL`).all();
  return rows.map((r) => r.actual_account_id);
}

router.get('/summary', async (req, res) => {
  try {
    const accounts = await actual.getAccounts();
    const cardAccountIds = new Set(getCardAccountIds());

    const accountsWithBalance = await Promise.all(
      accounts.map(async (a) => ({
        id: a.id,
        name: a.name,
        isCard: cardAccountIds.has(a.id),
        balance: await actual.getAccountBalance(a.id),
      }))
    );

    const totalDebt = accountsWithBalance
      .filter((a) => a.isCard && a.balance < 0)
      .reduce((sum, a) => sum + Math.abs(a.balance), 0);

    const totalCash = accountsWithBalance
      .filter((a) => !a.isCard)
      .reduce((sum, a) => sum + a.balance, 0);

    res.json({
      month: req.query.month || new Date().toISOString().slice(0, 7),
      accounts: accountsWithBalance,
      totalDebt,
      totalCash,
    });
  } catch (err) {
    console.error('GET /api/summary error:', err);
    res.status(500).json({ error: 'failed to load summary' });
  }
});

router.get('/transactions', async (req, res) => {
  try {
    const { accountId, since } = req.query;
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const allAccounts = await actual.getAccounts();
    const accounts = accountId ? allAccounts.filter((a) => a.id === accountId) : allAccounts;

    const accountNames = new Map(allAccounts.map((a) => [a.id, a.name]));
    const categories = await actual.getCategories();
    const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

    const lists = await Promise.all(
      accounts.map((a) => actual.getTransactions(a.id, since))
    );

    const transactions = lists
      .flat()
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, limit)
      .map((t) => ({
        id: t.id,
        date: t.date,
        amount: t.amount,
        payee: t.payee_name || t.imported_payee || null,
        notes: t.notes || null,
        accountId: t.account,
        accountName: accountNames.get(t.account) || null,
        category: categoryNames.get(t.category) || null,
      }));

    res.json({ transactions });
  } catch (err) {
    console.error('GET /api/transactions error:', err);
    res.status(500).json({ error: 'failed to load transactions' });
  }
});

// quick-add จากแท็บ "เพิ่ม" ใน LIFF — amount หน่วยบาท (มีเครื่องหมาย +/- มาแล้วจาก frontend)
router.post('/transactions', async (req, res) => {
  try {
    const { accountId, amount, payee, categoryId, notes, date } = req.body || {};
    if (!accountId || typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ error: 'accountId and non-zero amount required' });
    }

    await actual.addTransaction({
      accountId,
      amount,
      payee: payee || undefined, // payee_name — Actual สร้าง payee ใหม่ให้เองถ้ายังไม่มี
      category: categoryId || undefined,
      notes: notes || undefined,
      date: date || undefined,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/transactions error:', err);
    res.status(500).json({ error: 'failed to add transaction' });
  }
});

// งบประมาณรายเดือนจาก Actual (ทุกยอดหน่วยสตางค์) — สำหรับแท็บ Budget
router.get('/budget', async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const data = await actual.getCategoryBudget(month);

    const groups = (data.categoryGroups || [])
      .filter((g) => !g.hidden)
      .map((g) => ({
        id: g.id,
        name: g.name,
        isIncome: !!g.is_income,
        budgeted: g.budgeted || 0,
        spent: g.spent || 0,
        balance: g.balance || 0,
        categories: (g.categories || [])
          .filter((c) => !c.hidden)
          .map((c) => ({
            id: c.id,
            name: c.name,
            budgeted: c.budgeted || 0,
            spent: c.spent ?? c.received ?? 0, // หมวดรายรับใช้ field received แทน spent
            balance: c.balance || 0,
          })),
      }));

    res.json({
      month,
      totalIncome: data.totalIncome || 0,
      totalSpent: data.totalSpent || 0,
      totalBudgeted: data.totalBudgeted || 0,
      toBudget: data.toBudget || 0,
      groups,
    });
  } catch (err) {
    console.error('GET /api/budget error:', err);
    res.status(500).json({ error: 'failed to load budget' });
  }
});

// แก้งบ inline จากแท็บ Budget — amount หน่วยสตางค์
router.put('/budget', async (req, res) => {
  try {
    const { month, categoryId, amount } = req.body || {};
    if (!month || !categoryId || typeof amount !== 'number' || !Number.isFinite(amount)) {
      return res.status(400).json({ error: 'month, categoryId and amount required' });
    }

    await actual.setBudgetAmount(month, categoryId, amount);
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/budget error:', err);
    res.status(500).json({ error: 'failed to set budget' });
  }
});

// บัญชีทั้งหมด (ไม่รวมที่ปิดแล้ว) + on/off budget + วงเงินบัตร — สำหรับแท็บ Accounts
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await actual.getAccounts();
    // credit_limit ใน SQLite เก็บหน่วยบาท (REAL) — แปลงเป็นสตางค์ให้ตรงกับยอดอื่นๆ ใน API
    const cardRows = db
      .prepare(
        `SELECT actual_account_id, credit_limit, due_day FROM cards WHERE actual_account_id IS NOT NULL`
      )
      .all();
    const cardInfo = new Map(cardRows.map((r) => [r.actual_account_id, r]));

    const open = accounts.filter((a) => !a.closed);
    const withBalance = await Promise.all(
      open.map(async (a) => {
        const info = cardInfo.get(a.id);
        return {
          id: a.id,
          name: a.name,
          offBudget: !!a.offbudget,
          isCard: !!info,
          creditLimit: info?.credit_limit != null ? Math.round(info.credit_limit * 100) : null,
          dueDay: info?.due_day ?? null,
          balance: await actual.getAccountBalance(a.id),
        };
      })
    );

    res.json({ accounts: withBalance });
  } catch (err) {
    console.error('GET /api/accounts error:', err);
    res.status(500).json({ error: 'failed to load accounts' });
  }
});

// ตั้ง/แก้วงเงินบัตรเครดิต — upsert ลงตาราง cards (ผูกบัญชี Actual เข้ากับ SQLite)
// นี่เป็นช่องทางเดียวตอนนี้ที่เขียน cards.actual_account_id (ยังไม่มีคำสั่งฝั่ง LINE bot)
// creditLimit หน่วยบาทตาม schema เดิมของตาราง (REAL)
router.put('/cards/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { creditLimit, dueDay } = req.body || {};
    if (
      creditLimit !== null &&
      (typeof creditLimit !== 'number' || !Number.isFinite(creditLimit) || creditLimit < 0)
    ) {
      return res.status(400).json({ error: 'creditLimit must be a non-negative number or null' });
    }
    const dueDayValue = dueDay ?? null; // วันครบกำหนดชำระ (1-31) — ไม่บังคับ
    if (dueDayValue !== null && (!Number.isInteger(dueDayValue) || dueDayValue < 1 || dueDayValue > 31)) {
      return res.status(400).json({ error: 'dueDay must be an integer 1-31 or null' });
    }

    const accounts = await actual.getAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      return res.status(404).json({ error: 'account not found' });
    }

    const existing = db.prepare(`SELECT id FROM cards WHERE actual_account_id = ?`).get(accountId);
    if (existing) {
      db.prepare(
        `UPDATE cards SET credit_limit = ?, due_day = ?, name = ? WHERE actual_account_id = ?`
      ).run(creditLimit, dueDayValue, account.name, accountId);
    } else {
      db.prepare(
        `INSERT INTO cards (line_user_id, name, actual_account_id, credit_limit, due_day) VALUES (?, ?, ?, ?, ?)`
      ).run(req.lineUserId, account.name, accountId, creditLimit, dueDayValue);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/cards error:', err);
    res.status(500).json({ error: 'failed to save card limit' });
  }
});

// หมวดหมู่ทั้งหมด (ไม่รวม hidden) — สำหรับ picker ในแท็บเพิ่มรายการ
router.get('/categories', async (req, res) => {
  try {
    const categories = await actual.getCategories();
    res.json({
      categories: categories
        .filter((c) => !c.hidden)
        .map((c) => ({ id: c.id, name: c.name, isIncome: !!c.is_income })),
    });
  } catch (err) {
    console.error('GET /api/categories error:', err);
    res.status(500).json({ error: 'failed to load categories' });
  }
});

// รายรับ vs รายจ่ายย้อนหลัง N เดือน — สำหรับแท็บ Reflect (หน่วยสตางค์, spent เป็นค่าลบ)
router.get('/reflect', async (req, res) => {
  try {
    const monthsBack = Math.min(Number(req.query.months) || 6, 12);
    const now = new Date();
    const months = [];

    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      try {
        const data = await actual.getCategoryBudget(month);
        months.push({ month, income: data.totalIncome || 0, spent: data.totalSpent || 0 });
      } catch {
        // เดือนที่อยู่นอกช่วง budget ของ Actual — ถือว่าเป็นศูนย์
        months.push({ month, income: 0, spent: 0 });
      }
    }

    res.json({ months });
  } catch (err) {
    console.error('GET /api/reflect error:', err);
    res.status(500).json({ error: 'failed to load reflect data' });
  }
});

// หนี้บัตรรวม ณ สิ้นเดือนย้อนหลัง N เดือน (สูงสุด 24) — สำหรับกราฟแนวโน้มหนี้ในแท็บ Reflect
// totalDebt หน่วยสตางค์ ค่าบวก (รวมเฉพาะบัตรที่ยอดติดลบ)
router.get('/cashflow', async (req, res) => {
  try {
    const monthsBack = Math.min(Number(req.query.months) || 6, 24);
    const cardAccountIds = getCardAccountIds();

    // ดึง transaction ของแต่ละบัตรครั้งเดียวแล้วรวมยอดสะสมเอง — ถ้าเรียก getAccountBalance
    // ทีละเดือนจะ fetch transaction ชุดเดิมซ้ำทุกเดือน (แพงมากที่ 24 เดือน)
    const txLists = await Promise.all(cardAccountIds.map((id) => actual.getTransactions(id)));

    const months = [];
    const now = new Date();

    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0); // วันสุดท้ายของเดือนนั้น
      // ประกอบ string ตามเวลาท้องถิ่นเอง — toISOString() เป็น UTC จะถอยไปเป็นวันก่อนหน้า
      const asOfDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;

      const totalDebt = txLists.reduce((sum, txs) => {
        const balance = txs.reduce((s, t) => s + (t.date <= asOfDate ? t.amount : 0), 0);
        return sum + (balance < 0 ? Math.abs(balance) : 0);
      }, 0);

      months.push({ month: asOfDate.slice(0, 7), totalDebt });
    }

    res.json({ months });
  } catch (err) {
    console.error('GET /api/cashflow error:', err);
    res.status(500).json({ error: 'failed to load cashflow' });
  }
});

// ---------- แก้ไขรายการที่จดผ่านบอท (ตาราง tx_entries + ธุรกรรมใน Actual) ----------

// หา "ธุรกรรมฝั่ง Actual" ของ entry — ปกติ actual_tx_id ถูก resolve ไว้แล้วตอนจด
// แต่บางแถวอาจเป็น null (resolve ไม่ทัน) เลย fallback ไปหาใหม่จาก imported_id แล้ว cache กลับลง DB
async function resolveActualTx(row) {
  if (row.actual_tx_id) {
    const tx = await actual.getTransactionById(row.account_id, row.actual_tx_id);
    if (tx) return tx;
  }
  const tx = await actual.findTransactionByImportedId(row.account_id, row.id);
  if (tx && tx.id !== row.actual_tx_id) {
    db.prepare(`UPDATE tx_entries SET actual_tx_id = ? WHERE id = ?`).run(tx.id, row.id);
  }
  return tx;
}

// หา/สร้างแถว tx_entries จาก :id — รองรับทั้ง entry id (เปิดจากปุ่มบนการ์ดในแชท)
// และ id ธุรกรรมฝั่ง Actual (เปิดจากหน้ารายการใน LIFF ซึ่งลิสต์มาจาก Actual ตรงๆ)
// รายการที่ไม่ได้จดผ่านบอท (นำเข้า statement / เพิ่มใน Actual เอง) จะถูกสร้าง entry ให้อัตโนมัติ
// โดย occurred_at ใส่แค่วันที่ (ไม่รู้เวลา — GET จะคืน time เป็น null ให้หน้าเว็บ default เอง)
async function findOrCreateEntry(id, accountIdHint) {
  let row = db.prepare(`SELECT * FROM tx_entries WHERE id = ?`).get(id);
  if (row) return row;
  row = db.prepare(`SELECT * FROM tx_entries WHERE actual_tx_id = ?`).get(id);
  if (row) return row;

  // ไม่ใช่ entry ฝั่งเรา → ลองตีความเป็น id ธุรกรรมของ Actual (accountIdHint ช่วยให้ไม่ต้องไล่ทุกบัญชี)
  let tx = null;
  let accountId = accountIdHint || null;
  if (accountId) {
    tx = await actual.getTransactionById(accountId, id);
  } else {
    for (const a of await actual.getAccounts()) {
      tx = await actual.getTransactionById(a.id, id);
      if (tx) {
        accountId = a.id;
        break;
      }
    }
  }
  if (!tx) return null;

  const entryId = crypto.randomBytes(9).toString('hex');
  db.prepare(
    `INSERT INTO tx_entries (id, actual_tx_id, account_id, occurred_at, slip_path) VALUES (?, ?, ?, ?, NULL)`
  ).run(entryId, tx.id, accountId, tx.date);
  return db.prepare(`SELECT * FROM tx_entries WHERE id = ?`).get(entryId);
}

// ข้อมูลรายการเดียวสำหรับหน้าแก้ไข /app/edit/{id} — ยอด/หมวด/วันที่ยึดจาก Actual เป็นหลัก
// (เผื่อผู้ใช้ไปแก้จากหน้าเว็บ Actual เอง) ส่วนเวลา + สลิปอยู่ฝั่ง SQLite
// หมายเหตุ: id ที่คืน (field `id`) คือ entry id เสมอ — หน้าเว็บต้องใช้ค่านี้ยิง PUT/DELETE/slip ต่อ
router.get('/tx/:id', async (req, res) => {
  try {
    const row = await findOrCreateEntry(req.params.id, req.query.accountId);
    if (!row) return res.status(404).json({ error: 'entry not found' });

    const tx = await resolveActualTx(row);
    if (!tx) return res.status(404).json({ error: 'transaction not found in actual' });

    const accounts = await actual.getAccounts();
    const timePart = (row.occurred_at || '').split(' ')[1] || null;

    // getTransactions คืน payee เป็น id — ต้องแปลงเป็นชื่อเอง (imported_payee เป็นชื่อดิบตอนสร้าง
    // ใช้เป็น fallback เท่านั้น เพราะไม่อัปเดตตามเมื่อผู้ใช้แก้ชื่อรายละเอียดทีหลัง)
    let payeeName = null;
    if (tx.payee) {
      const payees = await actual.getPayees();
      payeeName = payees.find((p) => p.id === tx.payee)?.name || null;
    }

    res.json({
      id: row.id,
      accountId: row.account_id,
      accountName: accounts.find((a) => a.id === row.account_id)?.name || null,
      amount: tx.amount, // สตางค์ มีเครื่องหมาย +/- ตามที่ Actual เก็บ
      payee: payeeName || tx.imported_payee || null,
      notes: tx.notes || null,
      categoryId: tx.category || null,
      date: tx.date, // 'YYYY-MM-DD'
      time: timePart, // 'HH:MM' — เก็บฝั่งเรา (Actual ไม่มี field เวลา)
      hasSlip: !!(row.slip_path && fs.existsSync(row.slip_path)),
    });
  } catch (err) {
    console.error('GET /api/tx/:id error:', err);
    res.status(500).json({ error: 'failed to load transaction' });
  }
});

// บันทึกการแก้ไข — ยอด/รายละเอียด/หมวด/วันที่ อัปเดตเข้า Actual, เวลา + สลิปอัปเดตฝั่ง SQLite
// amount หน่วยบาท มีเครื่องหมาย +/- แล้ว (เหมือน POST /transactions), slipBase64 = data URL รูปสลิปใหม่
router.put('/tx/:id', async (req, res) => {
  try {
    const row = db.prepare(`SELECT * FROM tx_entries WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'entry not found' });

    const { amount, payee, categoryId, date, time, slipBase64, removeSlip } = req.body || {};
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ error: 'non-zero amount required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    if (!/^\d{2}:\d{2}$/.test(time || '')) {
      return res.status(400).json({ error: 'time must be HH:MM' });
    }

    // ตรวจรูปสลิปก่อนแตะอะไรทั้งนั้น — จะได้ไม่อัปเดต Actual ไปแล้วค่อยพังกลางทาง
    let slipBuffer = null;
    let slipExt = null;
    if (slipBase64) {
      const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(slipBase64);
      if (!m) return res.status(400).json({ error: 'slipBase64 must be an image data URL' });
      slipExt = m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : 'jpg';
      slipBuffer = Buffer.from(m[2], 'base64');
    }

    const tx = await resolveActualTx(row);
    if (!tx) return res.status(404).json({ error: 'transaction not found in actual' });

    const fields = {
      amount: Math.round(amount * 100), // Actual เก็บหน่วยสตางค์
      date,
      category: categoryId || null,
    };
    // เปลี่ยนชื่อรายละเอียด/ผู้รับเงิน — updateTransaction รับแค่ payee id เลยหา/สร้าง payee จากชื่อก่อน
    if (typeof payee === 'string' && payee.trim()) {
      fields.payee = await actual.findOrCreatePayee(payee);
    }
    await actual.updateTransaction(tx.id, fields);

    // เวลา + สลิป เก็บฝั่งเรา
    let slipPath = row.slip_path;
    if (removeSlip && slipPath) {
      fs.rmSync(slipPath, { force: true });
      slipPath = null;
    }
    if (slipBuffer) {
      if (slipPath) fs.rmSync(slipPath, { force: true }); // รูปเดิมอาจคนละนามสกุล ลบทิ้งก่อน
      fs.mkdirSync(SLIP_DIR, { recursive: true });
      slipPath = path.join(SLIP_DIR, `${row.id}.${slipExt}`);
      fs.writeFileSync(slipPath, slipBuffer);
    }
    db.prepare(`UPDATE tx_entries SET occurred_at = ?, slip_path = ? WHERE id = ?`).run(
      `${date} ${time}`,
      slipPath,
      row.id
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/tx/:id error:', err);
    res.status(500).json({ error: 'failed to update transaction' });
  }
});

// ลบรายการ — ลบทั้งธุรกรรมใน Actual (ถ้ายังอยู่) ไฟล์สลิป และแถว tx_entries
router.delete('/tx/:id', async (req, res) => {
  try {
    const row = db.prepare(`SELECT * FROM tx_entries WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'entry not found' });

    const tx = await resolveActualTx(row);
    if (tx) await actual.deleteTransaction(tx.id);

    if (row.slip_path) fs.rmSync(row.slip_path, { force: true });
    db.prepare(`DELETE FROM tx_entries WHERE id = ?`).run(row.id);

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/tx/:id error:', err);
    res.status(500).json({ error: 'failed to delete transaction' });
  }
});

// รูปสลิปหลักฐานของรายการ — ผ่าน auth ของ router อยู่แล้ว ฝั่งเว็บ fetch เป็น blob (ใส่ header เองไม่ได้ใน <img>)
router.get('/tx/:id/slip', (req, res) => {
  try {
    const row = db.prepare(`SELECT slip_path FROM tx_entries WHERE id = ?`).get(req.params.id);
    if (!row?.slip_path || !fs.existsSync(row.slip_path)) {
      return res.status(404).json({ error: 'no slip' });
    }
    res.sendFile(path.resolve(row.slip_path));
  } catch (err) {
    console.error('GET /api/tx/:id/slip error:', err);
    res.status(500).json({ error: 'failed to load slip' });
  }
});

module.exports = router;
