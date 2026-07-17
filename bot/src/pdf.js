// แปลง PDF statement เป็นรูปทีละหน้า ก่อนส่งให้ Gemini อ่าน (ดู statementExtract.js)
// ใช้ CLI ของ poppler (pdftoppm) + qpdf ผ่าน child_process แทน native module —
// เบา, กิน RAM น้อย, เหมาะกับ VPS 1GB (ต้องติดตั้ง poppler-utils + qpdf ใน Docker image)
// PDF จากธนาคารไทยหลายเจ้าติดรหัสผ่าน (owner/user password) — decrypt ด้วย qpdf ก่อน render

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DPI = Number(process.env.PDF_RENDER_DPI) || 150;
const MAX_PAGES = Number(process.env.PDF_MAX_PAGES) || 15;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

// ถอดรหัส PDF ที่ติดรหัสผ่านออกเป็นไฟล์ใหม่ (qpdf --decrypt) — คืน path ของไฟล์ที่ decrypt แล้ว
// ถ้ารหัสผิด qpdf จะ exit code 2 → โยน error ที่ระบุว่าใส่รหัสผ่าน (จาก PDF_PASSWORDS) ไม่ถูก
async function decryptPdf(inputPath, password, outputPath) {
  try {
    await run('qpdf', [`--password=${password}`, '--decrypt', inputPath, outputPath]);
  } catch (err) {
    // qpdf exit 3 = warning (สำเร็จแต่มี warning) ยังใช้ output ได้; 2 = error จริง (รหัสผิด/ไฟล์เสีย)
    if (err.code === 3 && fs.existsSync(outputPath)) return outputPath;
    const e = new Error(`qpdf decrypt failed: ${err.stderr || err.message}`);
    e.code = 'PDF_DECRYPT_FAILED';
    throw e;
  }
  return outputPath;
}

// pdfBuffer: ไฟล์ PDF ดิบจาก LINE — คืน array ของ Buffer รูป JPEG หน้าละใบ (จำกัด MAX_PAGES หน้าแรก)
// password: null ถ้าไม่ติดรหัส หรือรหัสผ่านจาก PDF_PASSWORDS ต่อธนาคาร
async function renderPdfToImages(pdfBuffer, password) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stmt-'));
  const srcPath = path.join(workDir, 'src.pdf');
  fs.writeFileSync(srcPath, pdfBuffer);

  try {
    // ถ้ามีรหัสผ่าน decrypt ก่อน; ถ้าไม่มีก็ลอง render ตรงๆ (PDF ที่ไม่ติดรหัส หรือติดแค่ owner password
    // ที่เปิดอ่านได้อยู่แล้ว pdftoppm จัดการเองได้ ไม่ต้อง decrypt)
    let inputPath = srcPath;
    if (password) {
      inputPath = await decryptPdf(srcPath, password, path.join(workDir, 'dec.pdf'));
    }

    const prefix = path.join(workDir, 'page');
    try {
      await run('pdftoppm', ['-jpeg', '-r', String(DPI), inputPath, prefix]);
    } catch (err) {
      // pdftoppm อ่านไม่ออกมักเพราะ PDF ติดรหัสแต่ไม่ได้ตั้งรหัสไว้ใน PDF_PASSWORDS
      const e = new Error(`pdftoppm failed: ${err.stderr || err.message}`);
      e.code = password ? 'PDF_RENDER_FAILED' : 'PDF_MAYBE_ENCRYPTED';
      throw e;
    }

    const files = fs
      .readdirSync(workDir)
      .filter((f) => f.startsWith('page') && f.endsWith('.jpg'))
      // pdftoppm ตั้งชื่อ page-1.jpg, page-2.jpg ... เรียงตามเลขหน้า (natural sort กันหน้า 10 มาก่อน 2)
      .sort((a, b) => {
        const na = Number(a.match(/(\d+)\.jpg$/)?.[1] || 0);
        const nb = Number(b.match(/(\d+)\.jpg$/)?.[1] || 0);
        return na - nb;
      })
      .slice(0, MAX_PAGES);

    return files.map((f) => fs.readFileSync(path.join(workDir, f)));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = { renderPdfToImages };
