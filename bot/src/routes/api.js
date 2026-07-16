// API สำหรับ LIFF dashboard เท่านั้น — ทุก route ผ่าน verifyLiffUser ก่อนเสมอ

const express = require('express');
const actual = require('../actualClient');
const db = require('../db');
const { verifyLiffUser } = require('../auth');

const router = express.Router();
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
    const accounts = accountId ? [{ id: accountId }] : await actual.getAccounts();

    const lists = await Promise.all(
      accounts.map((a) => actual.getTransactions(a.id, since))
    );

    const transactions = lists
      .flat()
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 30)
      .map((t) => ({
        id: t.id,
        date: t.date,
        amount: t.amount,
        payee: t.payee_name || t.imported_payee || null,
        notes: t.notes || null,
      }));

    res.json({ transactions });
  } catch (err) {
    console.error('GET /api/transactions error:', err);
    res.status(500).json({ error: 'failed to load transactions' });
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
