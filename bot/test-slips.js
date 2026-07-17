// ทดสอบ slipExtract (Gemini) กับรูปในโฟลเดอร์ test-slip/ ทั้งหมด
//   cd bot
//   node test-slips.js
// อ่าน key จาก ../.env (GEMINI_API_KEY หรือ GOOGLE_VISION_API_KEY)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { extractSlip } = require('./src/slipExtract');

const dir = path.join(__dirname, 'test-slip');

(async () => {
  const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f));
  for (const f of files) {
    try {
      const buffer = fs.readFileSync(path.join(dir, f));
      const result = await extractSlip(buffer);
      console.log(f.padEnd(22), JSON.stringify(result));
    } catch (e) {
      console.log(f.padEnd(22), 'ERROR:', e.message.slice(0, 200));
    }
  }
})();
