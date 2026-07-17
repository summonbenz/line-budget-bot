// เดาหมวดหมู่ Actual จากคำในป้ายกำกับ (label) ที่พิมพ์มา เทียบกับชื่อหมวดหมู่จริงที่มีอยู่
// เป็น keyword mapping ง่ายๆ ไม่ใช่ NLP — คำใน keywords เป็นภาษาไทยที่คาดว่าผู้ใช้จะพิมพ์
// hints คือคำ (ส่วนใหญ่เป็นอังกฤษ) ที่คาดว่าจะอยู่ในชื่อหมวดหมู่จริงใน Actual ปรับได้ตามหมวดหมู่ที่ตั้งไว้จริง

const EXPENSE_RULES = [
  {
    keywords: ['ข้าว', 'กับข้าว', 'อาหาร', 'กิน', 'ก๋วยเตี๋ยว', 'ส้มตำ', 'ร้านอาหาร', 'เดลิเวอรี่', 'แกร็บฟู้ด', 'foodpanda', 'กาแฟ', 'ชา', 'นม', 'ขนม', 'เครื่องดื่ม'],
    hints: ['food', 'dining'],
  },
  {
    keywords: ['รถไฟฟ้า', 'แท็กซี่', 'วินมอไซค์', 'น้ำมัน', 'ทางด่วน', 'แกร็บ', 'grab', 'bts', 'mrt', 'เดินทาง', 'รถ'],
    hints: ['transportation'],
  },
  {
    keywords: ['หนัง', 'เกม', 'เที่ยว', 'บันเทิง', 'คอนเสิร์ต', 'cineplex', 'cinema', 'major', 'sf world', 'sf cinema'],
    hints: ['entertainment'],
  },
  {
    keywords: ['เติมเกม', 'เติมเงินเกม', 'in-app', 'แอป', 'ซื้อแอป', 'สติกเกอร์ไลน์'],
    hints: ['in-app'],
  },
  {
    keywords: ['ช้อป', 'เสื้อผ้า', 'กระเป๋า', 'รองเท้า', 'ของใช้'],
    hints: ['shopping'],
  },
  {
    keywords: ['ค่าไฟ', 'ค่าน้ำ', 'ค่าเน็ต', 'ค่าโทรศัพท์', 'อินเทอร์เน็ต', 'มือถือ', 'ค่าบิล'],
    hints: ['bills & utilities', 'bills'],
  },
  {
    keywords: ['ค่าเช่า', 'ค่าหอ', 'ผ่อนบ้าน', 'ผ่อนคอนโด'],
    hints: ['rentals'],
  },
  {
    keywords: ['หมอ', 'ยา', 'โรงพยาบาล', 'ประกัน', 'คลินิก'],
    hints: ['healthcare'],
  },
  {
    keywords: ['ซ่อม', 'ช่าง', 'ซ่อมบ้าน', 'ซ่อมรถ'],
    hints: ['maintenance', 'repairs'],
  },
  {
    keywords: ['หนี้', 'ผ่อนบัตร', 'จ่ายหนี้', 'ผ่อนของ'],
    hints: ['debt'],
  },
  {
    keywords: ['ถอนเงิน', 'atm', 'กดเงิน'],
    hints: ['atm withdrawal', 'atm'],
  },
  {
    keywords: ['โอนเงิน', 'โอน'],
    hints: ['transfer'],
  },
  {
    keywords: ['ค่าธรรมเนียม', 'ค่าปรับ'],
    hints: ['bank fees', 'fees'],
  },
  {
    keywords: ['ออมเงิน', 'เก็บเงิน', 'ฝากออม'],
    hints: ['savings'],
  },
];

const INCOME_RULES = [
  {
    keywords: ['เงินเดือน', 'เงินโบนัส', 'โบนัส', 'รายได้', 'ค่าจ้าง', 'เงินได้'],
    hints: ['income'],
  },
  {
    keywords: ['เงินคืน', 'cashback', 'แคชแบ็ก'],
    hints: ['cashback'],
  },
  {
    keywords: ['จ่ายบัตร', 'ชำระบัตร', 'ชำระหนี้'],
    hints: ['payment'],
  },
];

// categories: ผลลัพธ์จาก actual.getCategories() — { id, name, is_income, hidden, ... }[]
// isIncome: true ถ้ายอดเป็นบวก (รายรับ), false ถ้าเป็นรายจ่าย
function guessCategory(label, categories, isIncome = false) {
  if (!label || !categories?.length) return null;
  const visible = categories.filter((c) => !c.hidden && Boolean(c.is_income) === isIncome);
  const rules = isIncome ? INCOME_RULES : EXPENSE_RULES;
  const lowerLabel = label.toLowerCase();

  for (const rule of rules) {
    if (!rule.keywords.some((kw) => lowerLabel.includes(kw.toLowerCase()))) continue;
    for (const hint of rule.hints) {
      const found = visible.find((c) => c.name.toLowerCase().includes(hint.toLowerCase()));
      if (found) return found;
    }
  }

  // เผื่อผู้ใช้พิมพ์ชื่อตรงกับหมวดหมู่อยู่แล้ว เช่น "food 60"
  return (
    visible.find(
      (c) => lowerLabel.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(lowerLabel)
    ) || null
  );
}

module.exports = { guessCategory };
