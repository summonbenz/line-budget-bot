// LIFF SDK ต้องการ window/browser APIs ล้วนๆ และหน้านี้เป็น dashboard เดี่ยวไม่มี multi-route
// ปิด SSR ทั้งแอป แล้วให้ adapter-static build เป็น SPA (fallback: 'index.html', ดู vite.config.ts)
export const ssr = false;
