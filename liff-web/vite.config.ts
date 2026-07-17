import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// หมายเหตุ: adapter / compilerOptions ย้ายไปอยู่ใน svelte.config.js แล้ว
// (SvelteKit อ่าน config จากไฟล์นั้น ไม่ได้อ่าน options ที่ส่งเข้า sveltekit() plugin)
export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		// dev เฉยๆ ก็ยิง /api ไปหา line-bot ที่รันคู่กันได้เลย ไม่ต้องผูก CORS
		// แก้ port ตามที่ line-bot รันจริงถ้าไม่ใช่ 3000
		proxy: {
			'/api': 'http://localhost:3000'
		}
	}
});
