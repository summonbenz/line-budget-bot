// shared state ข้ามแท็บ — dataVersion เพิ่มทีละ 1 ทุกครั้งที่มีการเขียนข้อมูล
// (เพิ่มรายการ/แก้งบ) แท็บอื่นเทียบกับเวอร์ชันที่ตัวเองโหลดไว้ แล้ว refetch เมื่อถูกเปิดอีกครั้ง

export const appState = $state({
	dataVersion: 0
});

export function markDataChanged(): void {
	appState.dataVersion += 1;
}
