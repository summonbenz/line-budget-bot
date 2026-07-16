/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_LIFF_ID: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

// LIFF SDK โหลดจาก CDN แบบ global script ใน src/app.html ไม่ได้ติดตั้งผ่าน npm
// เลยประกาศ type คร่าวๆ เอง (ดูรายละเอียดจริงได้ที่ https://developers.line.biz/en/reference/liff/)
interface LiffGlobal {
	init(config: { liffId: string }): Promise<void>;
	isLoggedIn(): boolean;
	login(config?: { redirectUri?: string }): void;
	getIDToken(): string | null;
}

declare global {
	interface Window {
		liff: LiffGlobal;
		Chart: unknown;
	}
}

export {};
