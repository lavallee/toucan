// Headless pages: when an agent's exec finds no browser tab on a canvas, the server can open the
// canvas itself in headless Chromium (Playwright) and run the code there. The page is the normal
// app, so edits still go through the real editor and sync like anyone else's; it registers on
// /ws/canvas like a tab, behind every human tab, and closes after it has sat idle.
//
// Opt-in (--headless / TOUCAN_HEADLESS=1). playwright-core is an optional dependency: without it,
// or without its Chromium, the server runs as before and exec says why it can't go headless.
//
// The token reaches the page through an init script that puts it in the page's localStorage (an
// in-memory, throwaway browser context), never through a URL. Each page also gets a random nonce
// that its relay socket presents, so the server knows which socket is the page it launched.

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const IDLE_MS = Number(process.env.TOUCAN_HEADLESS_IDLE ?? 120) * 1000
const MAX = Number(process.env.TOUCAN_HEADLESS_MAX ?? 2)
const START_MS = 30000

// Browsers a machine may already have, so that most people never download one.
function systemBrowsers({ platform = process.platform, env = process.env } = {}) {
	if (platform === 'darwin') return ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser'].map((a) => `/Applications/${a}.app/Contents/MacOS/${a}`)
	if (platform === 'win32') {
		const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)
		return roots.flatMap((r) => ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].map((p) => join(r, p)))
	}
	const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean)
	return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'].flatMap((n) => dirs.map((d) => join(d, n)))
}

/** Start headless Chromium: Playwright's own if it was downloaded, otherwise whichever Chromium-family browser is here. */
export async function launchBrowser(pw) {
	// The server decides when the browser goes: on a signal it first waits for the page's last edits to arrive.
	const opts = { headless: true, args: ['--disable-dev-shm-usage'], handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }
	let first
	try {
		return { browser: await pw.chromium.launch(opts), how: "Playwright's Chromium" }
	} catch (e) {
		first = e
	}
	for (const executablePath of systemBrowsers().filter((p) => existsSync(p))) {
		try {
			return { browser: await pw.chromium.launch({ ...opts, executablePath }), how: executablePath }
		} catch {} // try the next one
	}
	throw new Error(`no browser for headless mode (${String(first.message ?? first).split('\n')[0]}). Install Chrome or Chromium, or run \`toucan setup --browser\`.`)
}

export function createHeadless({ enabled, port, token, log = console.log }) {
	const pages = new Map() // canvas -> { nonce, page, context, ready: Promise<ws>, ws, timer, last, busy }
	let browser // Promise<Browser>, shared by every page; closed when the last page goes

	async function launch() {
		let pw
		try {
			pw = await import('playwright-core')
		} catch {
			throw new Error('headless mode needs playwright-core, an optional dependency that is missing here: reinstall toucan with optional dependencies')
		}
		const { browser: b } = await launchBrowser(pw)
		b.on('disconnected', () => (browser = undefined))
		return b
	}

	async function close(canvas, why = 'idle') {
		const p = pages.get(canvas)
		if (!p) return
		pages.delete(canvas)
		clearTimeout(p.timer)
		await p.context?.close().catch(() => {})
		log(`headless: closed ${canvas} (${why})`)
		if (!pages.size && browser) {
			const b = browser
			browser = undefined
			await (await b).close().catch(() => {})
		}
	}

	/** Keep the page while it is used; close it IDLE_MS after its last exec finished. */
	function touch(canvas, busy) {
		const p = pages.get(canvas)
		if (!p) return
		p.last = Date.now()
		p.busy = Math.max(0, p.busy + (busy ? 1 : -1))
		clearTimeout(p.timer)
		if (!p.busy) p.timer = setTimeout(() => close(canvas), IDLE_MS)
	}

	/** The headless page's relay socket on `canvas`, opening the page if there isn't one. */
	function ensure(canvas) {
		if (!enabled) return Promise.reject(new Error('headless mode is off (start the server with --headless or TOUCAN_HEADLESS=1)'))
		if (pages.has(canvas)) return pages.get(canvas).ready
		if (pages.size >= MAX) {
			// Make room by closing the least recently used idle page; refuse if every page is working.
			const idle = [...pages].filter(([, p]) => !p.busy).sort((a, b) => a[1].last - b[1].last)[0]
			if (!idle) return Promise.reject(new Error(`all ${MAX} headless pages are busy (TOUCAN_HEADLESS_MAX); try again shortly or open the canvas in a browser`))
			close(idle[0], 'making room')
		}
		const p = { nonce: randomBytes(12).toString('hex'), busy: 0, last: Date.now(), timer: null }
		let settle
		p.ready = new Promise((resolve, reject) => (settle = { resolve, reject }))
		p.ready.catch(() => {})
		p.settle = settle
		pages.set(canvas, p)
		const started = Date.now()
		const fail = (e) => {
			settle.reject(e)
			close(canvas, 'failed to start')
		}
		const deadline = setTimeout(() => fail(new Error(`headless page on "${canvas}" did not come up within ${START_MS / 1000}s`)), START_MS)
		p.ready.then(() => (clearTimeout(deadline), log(`headless: opened ${canvas} in ${Date.now() - started} ms`)), () => clearTimeout(deadline))
		;(async () => {
			browser ??= launch()
			const b = await browser
			if (pages.get(canvas) !== p) return
			p.context = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
			if (pages.get(canvas) !== p) return void p.context.close().catch(() => {})
			await p.context.addInitScript(([t, n]) => {
				localStorage.setItem('toucan.token', t)
				window.__toucanHeadless = n
			}, [token, p.nonce])
			const page = (p.page = await p.context.newPage())
			page.on('pageerror', (e) => log(`headless ${canvas}: ${e.message}`))
			await page.goto(`http://127.0.0.1:${port}/?canvas=${encodeURIComponent(canvas)}`)
		})().catch((e) => {
			browser = undefined
			fail(e)
		})
		return p.ready
	}

	/** Called for every /ws/canvas socket; true when it is one of our pages (it is then marked `headless`). */
	function claim(canvas, ws, nonce) {
		const p = pages.get(canvas)
		if (!nonce || !p || p.nonce !== nonce) return false
		ws.headless = true
		p.ws = ws
		ws.on('close', () => pages.get(canvas) === p && close(canvas, 'socket closed'))
		p.settle.resolve(ws)
		touch(canvas, false)
		return true
	}

	const shutdown = async () => Promise.all([...pages.keys()].map((c) => close(c, 'server stopping')))

	return { enabled, ensure, claim, touch, close, shutdown, has: (canvas) => pages.has(canvas), idleMs: IDLE_MS, max: MAX }
}
