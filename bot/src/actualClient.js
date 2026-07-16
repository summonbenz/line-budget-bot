// wrapper คุยกับ actual-server ผ่าน @actual-app/api (internal docker network)

const actualApi = require('@actual-app/api');

let ready = false;

async function init() {
  if (ready) return;
  await actualApi.init({
    dataDir: '/app/data/actual-cache', // ต้องอยู่ใน volume ที่ persist กัน re-download ทุกครั้งที่ restart
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
      notes,
    },
  ]);
}

async function getAccounts() {
  await init();
  return actualApi.getAccounts();
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
  getAccounts,
  getCategoryBudget,
  getTransactions,
  getAccountBalance,
};
