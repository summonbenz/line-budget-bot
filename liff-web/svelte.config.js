import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	// Force runes mode for the project (libraries in node_modules ยังใช้ auto-detect ตามเดิม)
	compilerOptions: {
		runes: true
	},

	kit: {
		// เสิร์ฟผ่าน Chiyu เป็น static file ตรงๆ (ดู ../Caddyfile และ ../docker-compose.yml)
		// ssr ปิดทั้งแอปใน src/routes/+layout.ts เลยใช้ fallback แบบ SPA แทนการ prerender
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html'
		}),

		// แอปถูกเสิร์ฟใต้ subpath /app (ดู Caddyfile: handle /app/*)
		// ต้องตั้ง base เพื่อให้ asset ชี้เป็น /app/_app/... ไม่งั้นเบราว์เซอร์โหลดจาก /_app/ ที่ root แล้วพัง (หน้าขาว)
		paths: {
			base: '/app'
		}
	}
};

export default config;
