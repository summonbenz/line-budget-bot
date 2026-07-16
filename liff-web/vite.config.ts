import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// เสิร์ฟผ่าน Caddy เป็น static file ตรงๆ (ดู ../Caddyfile และ ../docker-compose.yml)
			// ssr ปิดไว้ทั้งแอปใน src/routes/+layout.ts เลยใช้ fallback แบบ SPA แทนการ prerender
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: 'index.html'
			})
		})
	],
	server: {
		// dev เฉยๆ ก็ยิง /api ไปหา line-bot ที่รันคู่กันได้เลย ไม่ต้องผูก CORS
		// แก้ port ตามที่ line-bot รันจริงถ้าไม่ใช่ 3000
		proxy: {
			'/api': 'http://localhost:3000'
		}
	}
});
