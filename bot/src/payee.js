// สกัด "ชื่อร้าน/ผู้รับ" ที่อ่านง่ายจากรายละเอียดธุรกรรมใน statement (รายละเอียดดิบเก็บใน notes)
// พัฒนาต่อจาก extract_payee ใน telegram_statement_bot/bot/bot.py แต่ปรับให้เข้ากับข้อความจาก Gemini
// ซึ่งสะอาดกว่า OCR (มีตัวพิมพ์เล็ก/ใหญ่ปน + มักลงท้ายด้วยเมือง/ประเทศ เช่น "... BANGKOK THA")
//
// ลำดับการทำงาน:
//   1) จับแบรนด์ที่รู้จักจาก keyword (ครอบคลุมทั้งกรณีมี prefix เกตเวย์ เช่น OMISE*Pizza hut, AMP*AIS)
//   2) ถ้าไม่เข้าแบรนด์ไหน → ทำความสะอาดทั่วไป: ตัด prefix เกตเวย์/ช่องทาง, โดเมนเว็บ, ตัดหางเมือง/ประเทศ/เลขอ้างอิง

// [regex, ชื่อที่ต้องการ] — ทดสอบกับข้อความดิบแบบ case-insensitive เรียงจากเจาะจงไปกว้าง
// (เอา BTS/MRT ไว้ก่อน LINE Pay เพราะสลิปมักเป็น "LINEPAY*LP_BTS" ต้องได้ BTS ไม่ใช่ LINE Pay)
const MERCHANTS = [
  [/7-?11|7-?eleven|tmn7-?11/i, '7-Eleven'],
  [/\bbts\b|lp[_-]?bts/i, 'BTS'],
  [/\bmrt\b|\bbem\b/i, 'MRT'],
  [/grab/i, 'Grab'],
  [/shopee ?food/i, 'Shopee Food'],
  [/shopee/i, 'Shopee'],
  [/lazada/i, 'Lazada'],
  [/foodpanda/i, 'foodpanda'],
  [/lineman|line ?man/i, 'LINE MAN'],
  [/robinhood/i, 'Robinhood'],
  [/lotus/i, 'Lotus'],
  [/makro/i, 'Makro'],
  [/big ?c|bigc/i, 'Big C'],
  [/\btops\b/i, 'Tops'],
  [/villa ?market|villa-/i, 'Villa Market'],
  [/gourmet ?market/i, 'Gourmet Market'],
  [/netflix/i, 'Netflix'],
  [/spotify/i, 'Spotify'],
  [/youtube/i, 'YouTube'],
  [/disney/i, 'Disney+'],
  [/google ?one|googlegoogleoneg/i, 'Google One'],
  [/google/i, 'Google'],
  [/apple\.com|itunes|apple ?music/i, 'Apple'],
  [/steam ?games|steampowered|\bsteam\b/i, 'Steam'],
  [/playstation|psn/i, 'PlayStation'],
  [/microsoft|msft/i, 'Microsoft'],
  [/tiktok/i, 'TikTok'],
  [/facebook|meta ?platforms|\bmeta\b/i, 'Facebook'],
  [/openai|chatgpt/i, 'OpenAI'],
  [/\bais\b|\badvanced ?info/i, 'AIS'],
  [/truemove|true ?money|truemoney/i, 'TrueMoney'],
  [/\btrue\b/i, 'True'],
  [/\bdtac\b/i, 'dtac'],
  [/\bkfc\b/i, 'KFC'],
  [/mcdonald|\bmcd\b/i, "McDonald's"],
  [/burger ?king|\bbk-/i, 'Burger King'],
  [/starbucks/i, 'Starbucks'],
  [/mister ?donut/i, 'Mister Donut'],
  [/dunkin/i, "Dunkin'"],
  [/pizza ?hut/i, 'Pizza Hut'],
  [/the ?pizza ?company/i, 'The Pizza Company'],
  [/swensen/i, "Swensen's"],
  [/mk ?restaurant|\bmk\b ?(?:suki)?/i, 'MK'],
  [/\bptt\b|pttor|pttst/i, 'PTT'],
  [/bangchak|\bbsrc\b/i, 'Bangchak'],
  [/\bshell\b/i, 'Shell'],
  [/\besso\b/i, 'Esso'],
  [/caltex/i, 'Caltex'],
  [/line ?shopping|lplineshoppin/i, 'LINE Shopping'],
  [/line ?pay|linepay/i, 'LINE Pay'],
  [/paypal/i, 'PayPal'],
  [/agoda/i, 'Agoda'],
  [/booking\.com/i, 'Booking.com'],
  [/airasia/i, 'AirAsia'],
  [/uniqlo/i, 'Uniqlo'],
  [/watsons/i, 'Watsons'],
  [/\bboots\b/i, 'Boots'],
  [/central ?world|centralworld/i, 'CentralWorld'],
  [/\bcentral\b/i, 'Central'],
  [/\bsf\b ?cinema|sfcinema|sfcc/i, 'SF Cinema'],
  [/major ?cine|majorcineplex/i, 'Major Cineplex'],
];

// คำบอกสถานที่/ประเทศที่มักต่อท้ายชื่อร้าน — ใช้ตัดหางออก (เมืองไทยหลัก + ประเทศ/รัฐที่พบบ่อย)
const LOCATION_RE = new RegExp(
  '\\s+(' +
    [
      'bangkok', 'nonthaburi', 'pathum ?thani', 'samut ?prakan', 'samut ?sakhon',
      'chachoengsao', 'chon ?buri', 'chiang ?mai', 'chiang ?rai', 'nakhon\\w*',
      'phuket', 'rayong', 'ayutthaya', 'khon ?kaen', 'udon\\w*', 'surat\\w*',
      'hat ?yai', 'pattaya', 'krabi', 'mountain ?view', 'bellevue', 'singapore',
      'london', 'cork', 'dublin', 'tha\\b', 'thailand', '\\bth\\b', 'irl', 'usa?\\b',
    ].join('|') +
    ')',
  'i'
);

// prefix เกตเวย์/ช่องทางที่ไม่ใช่ชื่อร้านจริง — ตัดทิ้งตอน cleanup ทั่วไป
const GATEWAY_PREFIX_RE = /^(omise|2c2p|paysolutions|paysol|amp|ksher|gbprimepay|gb ?pay|mpay|tmn|linepay\*?lp|lp)[_\-*\s]+/i;

function cleanupGeneric(raw) {
  let s = raw;

  // "GATEWAY*ชื่อร้าน" → เอาส่วนหลัง * (เกตเวย์มักนำหน้าชื่อร้านจริง)
  if (s.includes('*')) s = s.slice(s.indexOf('*') + 1);

  s = s.replace(GATEWAY_PREFIX_RE, '').trim();

  // เว็บ/โดเมน "brand.com ..." → เอาชื่อแบรนด์จากโดเมน
  s = s.replace(/^www\./i, '');
  const domain = s.match(/^([a-z0-9][a-z0-9\-]*)\.(?:com|co|net|org|io|shop)\b/i);
  if (domain) return domain[1];

  // ตัดหางตั้งแต่คำบอกสถานที่แรกเป็นต้นไป ("Netflix Bangkok THA" → "Netflix")
  const loc = s.search(LOCATION_RE);
  if (loc > 0) s = s.slice(0, loc);

  // ตัดเลขอ้างอิง/รหัสสาขาที่ห้อยท้าย และเครื่องหมายคั่นที่ค้าง
  s = s.replace(/[\s\-_/#]+\d[\d\s\-/#]*$/g, '').trim();
  s = s.replace(/[\-_*/.\s]+$/g, '').trim();

  return s || raw.trim();
}

// description: รายละเอียดดิบของธุรกรรม — คืนชื่อร้าน/ผู้รับที่อ่านง่าย (ไม่คืนค่าว่าง)
function extractPayee(description) {
  const raw = (description || '').replace(/\s+/g, ' ').trim();
  if (!raw) return 'รายการ';

  for (const [re, name] of MERCHANTS) {
    if (re.test(raw)) return name;
  }

  const cleaned = cleanupGeneric(raw);
  // กันเคสตัดจนสั้นเกินไปหรือเหลือแต่ตัวเลข → ใช้ 40 ตัวอักษรแรกของข้อความดิบแทน
  if (cleaned.length < 2 || /^\d+$/.test(cleaned)) {
    return raw.length > 40 ? raw.slice(0, 40).trim() : raw;
  }
  return cleaned;
}

module.exports = { extractPayee };
