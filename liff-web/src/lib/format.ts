// helper แปลงหน่วยสตางค์ → ข้อความภาษาไทย ใช้ร่วมกันทุกแท็บ

const bahtFormatter = new Intl.NumberFormat('th-TH', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

const bahtWholeFormatter = new Intl.NumberFormat('th-TH', {
	maximumFractionDigits: 0
});

/** สตางค์ → '1,234.56' (ไม่มีสัญลักษณ์ ฿) */
export function baht(cents: number): string {
	return bahtFormatter.format(cents / 100);
}

/** สตางค์ → '฿1,234.56' */
export function bahtSign(cents: number): string {
	return `฿${bahtFormatter.format(cents / 100)}`;
}

/** สตางค์ → '฿1,235' (ปัดเศษ ใช้กับตัวเลขใหญ่ๆ เช่น net worth) */
export function bahtWhole(cents: number): string {
	return `฿${bahtWholeFormatter.format(cents / 100)}`;
}

const THAI_MONTHS_SHORT = [
	'ม.ค.',
	'ก.พ.',
	'มี.ค.',
	'เม.ย.',
	'พ.ค.',
	'มิ.ย.',
	'ก.ค.',
	'ส.ค.',
	'ก.ย.',
	'ต.ค.',
	'พ.ย.',
	'ธ.ค.'
];

/** 'YYYY-MM' → 'ก.ค. 2569' (พ.ศ.) */
export function thaiMonth(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return `${THAI_MONTHS_SHORT[m - 1]} ${y + 543}`;
}

/** 'YYYY-MM' → 'ก.ค.' อย่างเดียว (ใช้กับแกนกราฟ) */
export function thaiMonthShort(month: string): string {
	const m = Number(month.split('-')[1]);
	return THAI_MONTHS_SHORT[m - 1];
}

/** 'YYYY-MM-DD' → 'วันนี้' / 'เมื่อวาน' / 'จ. 14 ก.ค.' */
export function thaiDate(date: string): string {
	const today = new Date();
	const todayStr = localDateString(today);
	const yesterday = new Date(today);
	yesterday.setDate(today.getDate() - 1);

	if (date === todayStr) return 'วันนี้';
	if (date === localDateString(yesterday)) return 'เมื่อวาน';

	const [y, m, d] = date.split('-').map(Number);
	const dt = new Date(y, m - 1, d);
	const days = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
	const yearSuffix = y === today.getFullYear() ? '' : ` ${y + 543}`;
	return `${days[dt.getDay()]} ${d} ${THAI_MONTHS_SHORT[m - 1]}${yearSuffix}`;
}

/** Date → 'YYYY-MM-DD' ตามเวลาท้องถิ่น (ไม่ใช่ UTC) */
export function localDateString(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** เดือนปัจจุบันแบบ 'YYYY-MM' ตามเวลาท้องถิ่น */
export function currentMonth(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** เลื่อนเดือน 'YYYY-MM' ไป +1 / -1 */
export function shiftMonth(month: string, delta: number): string {
	const [y, m] = month.split('-').map(Number);
	const d = new Date(y, m - 1 + delta, 1);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
