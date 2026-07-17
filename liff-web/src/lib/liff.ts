// wrapper รอบ LIFF SDK (โหลดจาก CDN ใน src/app.html เป็น global window.liff)
// ตั้งค่า LIFF ID ผ่าน VITE_LIFF_ID ใน .env (ดู .env.example)

let readyPromise: Promise<void> | null = null;

export function ensureLiffReady(): Promise<void> {
	if (!readyPromise) {
		readyPromise = initLiff();
	}
	return readyPromise;
}

async function initLiff(): Promise<void> {
	const liffId = import.meta.env.VITE_LIFF_ID;
	if (!liffId) {
		throw new Error(
			'ยังไม่ได้ตั้งค่า VITE_LIFF_ID — คัดลอก .env.example เป็น .env แล้วใส่ LIFF ID'
		);
	}

	await window.liff.init({ liffId });

	if (!window.liff.isLoggedIn()) {
		window.liff.login();
		// liff.login() จะ redirect ออกจากหน้านี้ทันที ค้าง promise ไว้กันโค้ดด้านล่างรันต่อ
		return new Promise(() => {});
	}
}

export function getAuthHeaders(): HeadersInit {
	const idToken = window.liff.getIDToken();
	if (!idToken) {
		throw new Error('ไม่พบ ID token — ลองปิดแล้วเปิด LIFF ใหม่');
	}
	return { Authorization: `Bearer ${idToken}` };
}
