// wrapper คุยกับ actual-server ผ่าน @actual-app/api (internal docker network)

const actualApi = require('@actual-app/api');
const fs = require('fs');

let ready = false;

async function init() {
  if (ready) return;
  const dataDir = '/app/data/actual-cache';
  fs.mkdirSync(dataDir, { recursive: true }); // actualApi.init() ไม่สร้าง dir ให้เอง ต้องมีอยู่ก่อน
  await actualApi.init({
    dataDir, // ต้องอยู่ใน volume ที่ persist กัน re-download ทุกครั้งที่ restart
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_SERVER_PASSWORD,
  });
  await actualApi.downloadBudget(process.env.ACTUAL_SYNC_ID);
  ready = true;
}

async function addTransaction({ accountId, amount, payee, category, date, notes }) {
  await init();
  return actualApi.addTransactions(accountId, [
    {
      date: date || new Date().toISOString().slice(0, 10),
      amount: Math.round(amount * 100), // Actual เก็บยอดเป็นหน่วยสตางค์ (cents)
      payee_name: payee,
      category,
      notes,
    },
  ]);
}

// เพิ่มหลายรายการพร้อมกัน (นำเข้าจาก statement PDF) — txs: [{ date, amount, payee, category, notes }]
// amount เป็นบาท (มีเครื่องหมาย +/- แล้ว) แปลงเป็นสตางค์ให้ตรงกับที่ Actual เก็บ
async function addTransactions(accountId, txs) {
  await init();
  const today = new Date().toISOString().slice(0, 10);
  return actualApi.addTransactions(
    accountId,
    txs.map((t) => ({
      date: t.date || today,
      amount: Math.round(t.amount * 100),
      payee_name: t.payee,
      category: t.category,
      notes: t.notes,
    }))
  );
}

async function getAccounts() {
  await init();
  return actualApi.getAccounts();
}

async function getCategories() {
  await init();
  return actualApi.getCategories();
}

async function getCategoryBudget(month) {
  await init();
  return actualApi.getBudgetMonth(month); // month format: 'YYYY-MM'
}

async function getTransactions(accountId, since, until) {
  await init();
  return actualApi.getTransactions(
    accountId,
    since || '2000-01-01',
    until || new Date().toISOString().slice(0, 10)
  );
}

// ยอดคงเหลือ ณ วันที่กำหนด (หน่วยสตางค์) — คำนวณจากผลรวม transaction เพราะ
// getAccounts() ของ @actual-app/api ไม่คืน balance มาตรงๆ ในบางเวอร์ชัน
// เช็ค method ล่าสุดที่ https://actualbudget.org/docs/api/ ก่อน deploy จริง
// ถ้าเวอร์ชันที่ติดตั้งมี field balance ให้ใช้ค่านั้นแทนเพื่อความเร็ว (ไม่ต้อง sum เอง)
async function getAccountBalance(accountId, asOfDate) {
  await init();
  const until = asOfDate || new Date().toISOString().slice(0, 10);
  const transactions = await actualApi.getTransactions(accountId, '2000-01-01', until);
  return transactions.reduce((sum, t) => sum + t.amount, 0);
}

module.exports = {
  init,
  addTransaction,
  addTransactions,
  getAccounts,
  getCategories,
  getCategoryBudget,
  getTransactions,
  getAccountBalance,
};
