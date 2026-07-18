// วันที่/เวลาปัจจุบันตามเวลาไทย (Asia/Bangkok) แบบไม่พึ่ง TZ ของเครื่อง
// เพราะใน Docker บน VPS ตัว container เป็น UTC — ถ้าใช้ new Date() ตรงๆ วันที่/เวลาจะเพี้ยน

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function bangkokNow() {
  const parts = {};
  for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`, // 'YYYY-MM-DD'
    time: `${parts.hour}:${parts.minute}`, // 'HH:MM'
  };
}

module.exports = { bangkokNow };
