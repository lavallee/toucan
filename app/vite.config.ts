import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const server = `http://127.0.0.1:${process.env.TOUCAN_PORT ?? 8893}`

export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	// tldraw reads VITE_TLDRAW_LICENSE_KEY itself. Keep deployment values out of release bundles.
	envPrefix: [],
	plugins: [react(), tailwindcss()],
	resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
	build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
	server: {
		port: 5180,
		proxy: { '/api': server, '/ws': { target: server.replace('http', 'ws'), ws: true } },
	},
})
