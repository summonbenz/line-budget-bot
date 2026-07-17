// parse ข้อความแบบง่าย: "ป้ายกำกับ จำนวน" เช่น "ข้าว 60" หรือ "เงินเดือน +30000"
// การเดาหมวดหมู่จากคำอยู่ที่ handlers/category.js
// TODO: จำ payee ที่เคยพิมพ์ไว้

function parseExpenseText(text) {
  const match = text.trim().match(/^(.+?)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;

  const [, label, amountStr] = match;
  const amount = parseFloat(amountStr);
  const isIncome = amountStr.trim().startsWith('+');

  return {
    label: label.trim(),
    amount: isIncome ? Math.abs(amount) : -Math.abs(amount),
  };
}

module.exports = { parseExpenseText };
