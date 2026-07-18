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

// importedId (ไม่บังคับ): ฝังเป็น imported_id ของธุรกรรม ใช้ resolve หา id จริงทีหลัง
// เพราะ addTransactions ของ @actual-app/api คืนแค่ "ok" ไม่คืน id ของรายการที่สร้าง
async function addTransaction({ accountId, amount, payee, category, date, notes, importedId }) {
  await init();
  return actualApi.addTransactions(accountId, [
    {
      date: date || new Date().toISOString().slice(0, 10),
      amount: Math.round(amount * 100), // Actual เก็บยอดเป็นหน่วยสตางค์ (cents)
      payee_name: payee,
      category,
      notes,
      imported_id: importedId,
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
      cleared: false,
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

// ตั้งงบของหมวดหมู่ในเดือนนั้น — amount หน่วยสตางค์ (integer) ตามที่ Actual เก็บ
async function setBudgetAmount(month, categoryId, amount) {
  await init();
  return actualApi.setBudgetAmount(month, categoryId, Math.round(amount));
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

// ช่วงวันที่กว้างสุดสำหรับค้นธุรกรรมทั้งบัญชี — getTransactions ปกติ default until = วันนี้
// ซึ่งจะมองไม่เห็นรายการที่ลงวันที่อนาคต เลยใช้ขอบบนไกลๆ แทน
const ALL_SINCE = '2000-01-01';
const ALL_UNTIL = '2100-01-01';

// หาธุรกรรมจาก imported_id ที่เราฝังไว้ตอน addTransaction (ดูคอมเมนต์บน addTransaction)
async function findTransactionByImportedId(accountId, importedId) {
  await init();
  const txs = await actualApi.getTransactions(accountId, ALL_SINCE, ALL_UNTIL);
  return txs.find((t) => t.imported_id === importedId) || null;
}

// หาธุรกรรมจาก id ตรงๆ — @actual-app/api ไม่มี get-by-id เลยดึงทั้งบัญชีแล้วกรองเอง
// (single-user รายการไม่เยอะ รับได้)
async function getTransactionById(accountId, txId) {
  await init();
  const txs = await actualApi.getTransactions(accountId, ALL_SINCE, ALL_UNTIL);
  return txs.find((t) => t.id === txId) || null;
}

async function updateTransaction(id, fields) {
  await init();
  return actualApi.updateTransaction(id, fields);
}

async function deleteTransaction(id) {
  await init();
  return actualApi.deleteTransaction(id);
}

async function getPayees() {
  await init();
  return actualApi.getPayees();
}

// updateTransaction รับแค่ payee เป็น id (ไม่รับ payee_name แบบตอน add)
// เลยต้องหา payee เดิมจากชื่อก่อน ถ้าไม่มีค่อยสร้างใหม่ — คืน payee id
async function findOrCreatePayee(name) {
  await init();
  const wanted = name.trim();
  const payees = await actualApi.getPayees();
  const found = payees.find((p) => (p.name || '').trim().toLowerCase() === wanted.toLowerCase());
  if (found) return found.id;
  return actualApi.createPayee({ name: wanted });
}

module.exports = {
  init,
  addTransaction,
  addTransactions,
  getAccounts,
  getCategories,
  getCategoryBudget,
  setBudgetAmount,
  getTransactions,
  getAccountBalance,
  findTransactionByImportedId,
  getTransactionById,
  getPayees,
  updateTransaction,
  deleteTransaction,
  findOrCreatePayee,
};
