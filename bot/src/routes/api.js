// API สำหรับ LIFF dashboard เท่านั้น — ทุก route ผ่าน verifyLiffUser ก่อนเสมอ

const express = require('express');
const actual = require('../actualClient');
const db = require('../db');
const { verifyLiffUser } = require('../auth');

const router = express.Router();
// json parser ใส่เฉพาะ router นี้ (mount ที่ /api) — ห้ามใส่ global เพราะ /webhook ต้องอ่าน raw body
router.use(express.json());
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
      .prepare(`SELECT actual_account_id, credit_limit FROM cards WHERE actual_account_id IS NOT NULL`)
      .all();
    const limits = new Map(cardRows.map((r) => [r.actual_account_id, r.credit_limit]));

    const open = accounts.filter((a) => !a.closed);
    const withBalance = await Promise.all(
      open.map(async (a) => ({
        id: a.id,
        name: a.name,
        offBudget: !!a.offbudget,
        isCard: limits.has(a.id),
        creditLimit: limits.get(a.id) != null ? Math.round(limits.get(a.id) * 100) : null,
        balance: await actual.getAccountBalance(a.id),
      }))
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
    const { creditLimit } = req.body || {};
    if (
      creditLimit !== null &&
      (typeof creditLimit !== 'number' || !Number.isFinite(creditLimit) || creditLimit < 0)
    ) {
      return res.status(400).json({ error: 'creditLimit must be a non-negative number or null' });
    }

    const accounts = await actual.getAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      return res.status(404).json({ error: 'account not found' });
    }

    const existing = db.prepare(`SELECT id FROM cards WHERE actual_account_id = ?`).get(accountId);
    if (existing) {
      db.prepare(`UPDATE cards SET credit_limit = ?, name = ? WHERE actual_account_id = ?`).run(
        creditLimit,
        account.name,
        accountId
      );
    } else {
      db.prepare(
        `INSERT INTO cards (line_user_id, name, actual_account_id, credit_limit) VALUES (?, ?, ?, ?)`
      ).run(req.lineUserId, account.name, accountId, creditLimit);
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

router.get('/cashflow', async (req, res) => {
  try {
    const monthsBack = Number(req.query.months) || 6;
    const cardAccountIds = getCardAccountIds();

    const months = [];
    const now = new Date();

    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0); // วันสุดท้ายของเดือนนั้น
      const asOfDate = d.toISOString().slice(0, 10);
      const monthLabel = asOfDate.slice(0, 7);

      const balances = await Promise.all(
        cardAccountIds.map((id) => actual.getAccountBalance(id, asOfDate))
      );
      const totalDebt = balances.reduce((sum, b) => sum + (b < 0 ? Math.abs(b) : 0), 0);

      months.push({ month: monthLabel, totalDebt });
    }

    res.json({ months });
  } catch (err) {
    console.error('GET /api/cashflow error:', err);
    res.status(500).json({ error: 'failed to load cashflow' });
  }
});

module.exports = router;
