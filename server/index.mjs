// toucan server: serves the canvas app, relays code from agents to the live editor,
// persists canvases and their scripts, and hosts a Codex app-server chat.
//
//   node server/index.mjs [--host 0.0.0.0] [--port 8893] [--data DIR] [--dev]
//
// Canvases live in --data / TOUCAN_DATA (default: canvases/ in this checkout).
//
// Every HTTP/WS request needs the token from ~/.config/toucan/server.json — the exec
// relay runs arbitrary JS in the canvas and the chat drives an agent with a shell, so
// nothing here is safe to expose unauthenticated, even on a private network.

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, chmodSync, renameSync, statSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { TLSocketRoom } from '@tldraw/sync-core'
import { CodexChat } from './codex.mjs'
import { FORMATS, fromTldraw, fromExcalidraw, toExcalidrawElements } from '../lib/tg.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const CONFIG = join(homedir(), '.config/toucan/server.json')

const args = Object.fromEntries(
	process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : null)).filter(Boolean),
)
const CANVASES = resolve(args.data ?? process.env.TOUCAN_DATA ?? join(ROOT, 'canvases'))
const HOST = args.host ?? process.env.TOUCAN_HOST ?? '127.0.0.1'
const PORT = Number(args.port ?? process.env.TOUCAN_PORT ?? 8893)
const NAME = /^[a-z0-9][a-z0-9-_]{0,63}$/i
// The host printed in links: a loopback-bound server is only reachable as itself.
const PUBLIC_HOST = process.env.TOUCAN_PUBLIC_HOST || (HOST === '0.0.0.0' || HOST === '::' ? hostname() : HOST)

// ---- token -----------------------------------------------------------------
function loadToken() {
	let cfg = {}
	if (existsSync(CONFIG)) cfg = JSON.parse(readFileSync(CONFIG, 'utf8'))
	if (!cfg.token) {
		cfg.token = randomBytes(24).toString('base64url')
		mkdirSync(dirname(CONFIG), { recursive: true })
	}
	cfg.port = PORT
	cfg.url = `http://127.0.0.1:${PORT}`
	cfg.public = `http://${PUBLIC_HOST}:${PORT}`
	writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n')
	chmodSync(CONFIG, 0o600)
	return cfg.token
}
const TOKEN = loadToken()
const tokenOk = (t) => {
	if (typeof t !== 'string') return false
	const a = Buffer.from(t), b = Buffer.from(TOKEN)
	return a.length === b.length && timingSafeEqual(a, b)
}
const authed = (req, url) =>
	tokenOk((req.headers.authorization ?? '').replace(/^Bearer /, '')) || tokenOk(url.searchParams.get('token'))

// ---- canvas connections ------------------------------------------------------
// Tabs on a canvas share one synced document, so any of them can run agent code.
// Try the most recently focused tab first; a tab that does not ack quickly (asleep,
// crashed, stale build) is skipped for the next one.
const tabs = new Map() // canvas -> [ws...] (most recently focused last)
const pending = new Map() // exec id -> {resolve, reject, timer, acked}
let execSeq = 0
const ACK_MS = 2500

function exec(canvas, code, timeoutMs = 30000) {
	const candidates = [...(tabs.get(canvas) ?? [])].reverse().filter((w) => w.readyState === 1)
	if (!candidates.length) return Promise.reject(new Error(`no browser tab has canvas "${canvas}" open — open ${publicUrl(canvas)}`))
	return new Promise((resolve, reject) => {
		const tryTab = (i) => {
			if (i >= candidates.length) return reject(new Error(`no open tab on "${canvas}" responded`))
			const id = ++execSeq
			const p = { resolve, reject, acked: false }
			p.timer = setTimeout(() => {
				pending.delete(id)
				p.acked ? reject(new Error('exec timed out')) : tryTab(i + 1)
			}, ACK_MS)
			p.extend = () => {
				clearTimeout(p.timer)
				p.timer = setTimeout(() => (pending.delete(id), reject(new Error('exec timed out'))), timeoutMs)
			}
			pending.set(id, p)
			candidates[i].send(JSON.stringify({ type: 'exec', id, code }))
		}
		tryTab(0)
	})
}

// ---- sync rooms (one authoritative document per canvas) ---------------------------
const rooms = new Map() // canvas -> { room, timer }
function getRoom(canvas) {
	if (rooms.has(canvas)) return rooms.get(canvas).room
	let initialSnapshot
	if (existsSync(docPath(canvas))) {
		const saved = JSON.parse(readFileSync(docPath(canvas), 'utf8'))
		initialSnapshot = saved.room ?? saved.document // .document: pre-sync snapshot format
	}
	const entry = { timer: null }
	const persist = () => writeFileSync(docPath(canvas), JSON.stringify({ room: entry.room.getCurrentSnapshot() }))
	entry.room = new TLSocketRoom({
		initialSnapshot,
		onDataChange: () => {
			entry.changed = Date.now()
			clearTimeout(entry.timer)
			entry.timer = setTimeout(persist, 1000)
		},
		onSessionRemoved: (room, { numSessionsRemaining }) => {
			if (numSessionsRemaining > 0) return
			clearTimeout(entry.timer)
			persist()
			room.close()
			rooms.delete(canvas)
		},
	})
	rooms.set(canvas, entry)
	return entry.room
}

// ---- Excalidraw scenes (one authoritative element list per canvas) ------------------------
// Tabs send the elements they changed; the server keeps, per element id, the higher `version`
// (ties: the lower `versionNonce`, Excalidraw's own rule), persists, and forwards what it kept to the
// other tabs, which merge it with reconcileElements. Deletions are elements with isDeleted.
const scenes = new Map() // canvas -> { elements: Map, sockets: Set, timer, changed }
function getScene(canvas) {
	if (scenes.has(canvas)) return scenes.get(canvas)
	const saved = existsSync(scenePath(canvas)) ? JSON.parse(readFileSync(scenePath(canvas), 'utf8')) : { elements: [] }
	const scene = { elements: new Map(saved.elements.map((e) => [e.id, e])), sockets: new Set(), timer: null, changed: 0 }
	scene.persist = () => writeFileSync(scenePath(canvas), JSON.stringify({ type: 'excalidraw', version: 2, source: 'toucan', elements: [...scene.elements.values()], appState: {}, files: {} }))
	scenes.set(canvas, scene)
	return scene
}
const sceneElements = (n) => (scenes.has(n) ? [...scenes.get(n).elements.values()] : existsSync(scenePath(n)) ? JSON.parse(readFileSync(scenePath(n), 'utf8')).elements : [])
const newer = (a, b) => !b || a.version > b.version || (a.version === b.version && a.versionNonce < b.versionNonce)

function onScene(ws, canvas) {
	if (!NAME.test(canvas ?? '') || engineOf(canvas) !== 'excalidraw') return ws.close()
	const scene = getScene(canvas)
	scene.sockets.add(ws)
	ws.send(JSON.stringify({ type: 'scene', elements: [...scene.elements.values()] }))
	ws.on('message', (raw) => {
		const msg = JSON.parse(raw)
		if (msg.type !== 'update' || !Array.isArray(msg.elements)) return
		const kept = msg.elements.filter((e) => e?.id && newer(e, scene.elements.get(e.id)))
		if (!kept.length) return
		for (const e of kept) scene.elements.set(e.id, e)
		scene.changed = Date.now()
		for (const other of scene.sockets) if (other !== ws && other.readyState === 1) other.send(JSON.stringify({ type: 'update', elements: kept }))
		clearTimeout(scene.timer)
		scene.timer = setTimeout(scene.persist, 1000)
	})
	ws.on('close', () => {
		scene.sockets.delete(ws)
		if (scene.sockets.size) return
		clearTimeout(scene.timer)
		scene.persist()
		scenes.delete(canvas)
	})
}

// ---- storage ---------------------------------------------------------------
mkdirSync(CANVASES, { recursive: true })
const docPath = (n) => join(CANVASES, `${n}.json`)
const scriptsDir = (n) => join(CANVASES, `${n}.scripts`)
function listScripts(n) {
	const dir = scriptsDir(n)
	if (!existsSync(dir)) return []
	return readdirSync(dir).filter((f) => f.endsWith('.js')).sort().map((f) => ({ name: f.slice(0, -3), code: readFileSync(join(dir, f), 'utf8') }))
}
const thumbPath = (n) => join(CANVASES, `${n}.thumb.png`)
const scenePath = (n) => join(CANVASES, `${n}.excalidraw`) // Excalidraw canvases: an .excalidraw file
const seedPath = (n) => join(CANVASES, `${n}.seed.json`) // a TG a tldraw canvas's first tab applies
const ENGINES = ['tldraw', 'excalidraw']
const engineOf = (n) => readIndex()[n]?.engine ?? (existsSync(scenePath(n)) ? 'excalidraw' : 'tldraw')
const ARCHIVE = join(CANVASES, '.archive')

// canvases/_index.json (a name no canvas can take) holds what the files can't: a title and a description per canvas.
const INDEX = join(CANVASES, '_index.json')
const readIndex = () => (existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {})
const writeIndex = (idx) => writeFileSync(INDEX, JSON.stringify(idx, null, 2) + '\n')
const canvasNames = () => {
	const names = new Set(Object.keys(readIndex()))
	for (const f of readdirSync(CANVASES)) {
		const m = /^(.+)\.(json|excalidraw)$/.exec(f)
		if (m && NAME.test(m[1])) names.add(m[1])
	}
	return [...names].sort()
}
/** The canvas as a toucan graph (lib/tg.mjs), read from the server's copy — no tab needed. */
function graphOf(n, opts) {
	if (engineOf(n) === 'excalidraw') return fromExcalidraw(sceneElements(n))
	const snapshot = rooms.has(n) ? rooms.get(n).room.getCurrentSnapshot() : existsSync(docPath(n)) ? JSON.parse(readFileSync(docPath(n), 'utf8')).room : null
	return fromTldraw((snapshot?.documents ?? []).map((d) => d.state), opts)
}
function describe(n, idx) {
	const engine = engineOf(n)
	const mtime = (f) => (existsSync(f) ? statSync(f).mtimeMs : 0)
	let shapes = 0, pages = 1
	if (engine === 'excalidraw') shapes = sceneElements(n).filter((e) => !e.isDeleted && !e.containerId).length
	else {
		const snapshot = rooms.has(n) ? rooms.get(n).room.getCurrentSnapshot() : existsSync(docPath(n)) ? JSON.parse(readFileSync(docPath(n), 'utf8')).room : null
		const records = (snapshot?.documents ?? []).map((d) => d.state)
		shapes = records.filter((r) => r.typeName === 'shape').length
		pages = records.filter((r) => r.typeName === 'page').length
	}
	return {
		engine,
		name: n,
		title: idx[n]?.title ?? n,
		description: idx[n]?.description ?? '',
		created: idx[n]?.created ?? null,
		updated: Math.round(Math.max(mtime(docPath(n)), mtime(scenePath(n)), rooms.get(n)?.changed ?? 0, scenes.get(n)?.changed ?? 0)) || null,
		shapes,
		pages,
		seeded: existsSync(seedPath(n)),
		scripts: listScripts(n).map((s) => s.name),
		open: (tabs.get(n) ?? []).length,
		thumb: existsSync(thumbPath(n)) ? Math.round(mtime(thumbPath(n))) : null,
	}
}

function broadcast(canvas, msg) {
	for (const ws of tabs.get(canvas) ?? []) ws.send(JSON.stringify(msg))
}

// ---- http ------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.ttf': 'font/ttf', '.woff': 'font/woff', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }
const publicUrl = (canvas) => `http://${PUBLIC_HOST}:${PORT}/${canvas ? `?canvas=${canvas}` : ''}`

async function rawBody(req, limit = 8 << 20) {
	const chunks = []
	let size = 0
	for await (const c of req) {
		if ((size += c.length) > limit) throw new Error('body too large')
		chunks.push(c)
	}
	return Buffer.concat(chunks)
}
const body = async (req) => (await rawBody(req)).toString('utf8')
const json = (res, status, data) => {
	res.writeHead(status, { 'content-type': 'application/json' })
	res.end(JSON.stringify(data))
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x')
	try {
		if (!url.pathname.startsWith('/api/')) return serveStatic(url, res)
		if (!authed(req, url)) return json(res, 401, { error: 'missing or bad token' })
		const [, , route, canvas, sub, subName] = url.pathname.split('/')
		if (route === 'canvases' && !canvas && req.method === 'GET') {
			const idx = readIndex()
			return json(res, 200, { canvases: canvasNames().map((n) => describe(n, idx)) })
		}
		if (route === 'canvases' && !canvas && req.method === 'POST') {
			const { name, title, description, engine = 'tldraw', from, graph } = JSON.parse(await body(req))
			if (!NAME.test(name ?? '')) return json(res, 400, { error: 'name: letters, digits, - and _, up to 64' })
			if (!ENGINES.includes(engine)) return json(res, 400, { error: `engine: one of ${ENGINES.join(', ')}` })
			if (canvasNames().includes(name)) return json(res, 409, { error: `${name} already exists` })
			if (from && !canvasNames().includes(from)) return json(res, 404, { error: `no canvas ${from} to copy from` })
			// Seeding goes through the graph, so it works across engines: tldraw → TG → Excalidraw, and back.
			const seed = graph ?? (from ? graphOf(from) : null)
			const idx = readIndex()
			idx[name] = { title: title || name, description: description ?? '', engine, created: new Date().toISOString(), ...(from && { from }) }
			writeIndex(idx)
			if (engine === 'excalidraw') writeFileSync(scenePath(name), JSON.stringify({ type: 'excalidraw', version: 2, source: 'toucan', elements: seed ? toExcalidrawElements(seed) : [], appState: {}, files: {} }))
			else if (seed) writeFileSync(seedPath(name), JSON.stringify(seed))
			return json(res, 201, describe(name, idx))
		}
		if (route !== 'canvases' || !NAME.test(canvas ?? '')) return json(res, 404, { error: 'not found' })

		if (sub === 'info' && req.method === 'GET') return json(res, 200, canvasNames().includes(canvas) ? describe(canvas, readIndex()) : { name: canvas, engine: 'tldraw', new: true })
		if (sub === 'graph' && req.method === 'GET') {
			const format = url.searchParams.get('format') ?? 'tg'
			if (!FORMATS[format]?.export) return json(res, 400, { error: `format: one of ${Object.keys(FORMATS).join(', ')}` })
			const tg = { ...graphOf(canvas, { raw: url.searchParams.has('raw') }), canvas }
			if (format === 'tg') return json(res, 200, tg)
			res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
			return res.end(FORMATS[format].export(tg, {}))
		}
		if (sub === 'seed' && req.method === 'GET') return existsSync(seedPath(canvas)) ? json(res, 200, JSON.parse(readFileSync(seedPath(canvas), 'utf8'))) : (res.writeHead(204), res.end())
		if (sub === 'seed' && req.method === 'DELETE') {
			rmSync(seedPath(canvas), { force: true })
			return json(res, 200, { ok: true })
		}
		if (sub === 'meta' && req.method === 'PATCH') {
			const patch = JSON.parse(await body(req))
			const idx = readIndex()
			const cur = idx[canvas] ?? { created: null }
			for (const k of ['title', 'description']) if (typeof patch[k] === 'string') cur[k] = patch[k]
			idx[canvas] = cur
			writeIndex(idx)
			return json(res, 200, describe(canvas, idx))
		}
		if (sub === 'thumb' && req.method === 'PUT') {
			const png = await rawBody(req, 4 << 20)
			if (png.subarray(1, 4).toString() !== 'PNG') return json(res, 400, { error: 'expected a PNG' })
			writeFileSync(thumbPath(canvas), png)
			return json(res, 200, { ok: true })
		}
		if (sub === 'thumb' && req.method === 'GET') {
			if (!existsSync(thumbPath(canvas))) return json(res, 404, { error: 'no thumbnail yet' })
			res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=31536000, immutable' })
			return res.end(readFileSync(thumbPath(canvas)))
		}
		// Archiving moves the canvas's files aside (canvases/.archive/<name>-<time>/); nothing is deleted.
		if (sub === 'archive' && req.method === 'POST') {
			if ((tabs.get(canvas) ?? []).length || rooms.has(canvas) || scenes.has(canvas)) return json(res, 409, { error: `${canvas} is open in a tab — close it first` })
			const dest = join(ARCHIVE, `${canvas}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
			mkdirSync(dest, { recursive: true })
			for (const f of [docPath(canvas), scenePath(canvas), seedPath(canvas), scriptsDir(canvas), thumbPath(canvas)]) if (existsSync(f)) renameSync(f, join(dest, f.slice(CANVASES.length + 1)))
			const idx = readIndex()
			if (idx[canvas]) writeFileSync(join(dest, 'index-entry.json'), JSON.stringify(idx[canvas], null, 2) + '\n')
			delete idx[canvas]
			writeIndex(idx)
			return json(res, 200, { ok: true, archivedTo: dest })
		}

		if (!sub && req.method === 'GET') {
			if (engineOf(canvas) === 'excalidraw') return json(res, 200, { type: 'excalidraw', elements: sceneElements(canvas) })
			if (rooms.has(canvas)) return json(res, 200, { room: rooms.get(canvas).room.getCurrentSnapshot() })
			return existsSync(docPath(canvas)) ? json(res, 200, JSON.parse(readFileSync(docPath(canvas), 'utf8'))) : json(res, 404, { error: 'empty' })
		}
		if (sub === 'exec' && req.method === 'POST') {
			const { code, timeoutMs } = JSON.parse(await body(req))
			try {
				return json(res, 200, { ok: true, result: await exec(canvas, code, timeoutMs) })
			} catch (e) {
				return json(res, 200, { ok: false, error: String(e.message ?? e) })
			}
		}
		if (sub === 'scripts' && req.method === 'GET') return json(res, 200, { scripts: listScripts(canvas) })
		if (sub === 'scripts' && NAME.test(subName ?? '')) {
			const file = join(scriptsDir(canvas), `${subName}.js`)
			if (req.method === 'PUT') {
				mkdirSync(scriptsDir(canvas), { recursive: true })
				writeFileSync(file, await body(req))
			} else if (req.method === 'DELETE') {
				rmSync(file, { force: true })
			} else return json(res, 405, { error: 'method' })
			broadcast(canvas, { type: 'scripts', scripts: listScripts(canvas) })
			return json(res, 200, { ok: true })
		}
		return json(res, 404, { error: 'not found' })
	} catch (e) {
		json(res, 500, { error: String(e.message ?? e) })
	}
})

function serveStatic(url, res) {
	let file = join(DIST, url.pathname === '/' ? 'index.html' : url.pathname)
	if (!file.startsWith(DIST) || !existsSync(file)) file = join(DIST, 'index.html')
	if (!existsSync(file)) {
		res.writeHead(503, { 'content-type': 'text/plain' })
		return res.end('app not built — run `npm run build` (or use `npm run dev`)\n')
	}
	res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
	res.end(readFileSync(file))
}

// ---- websockets --------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true })
const chat = new CodexChat({ root: ROOT, port: PORT, engineOf, data: CANVASES })

server.on('upgrade', (req, socket, head) => {
	const url = new URL(req.url, 'http://x')
	if (!authed(req, url)) return socket.destroy()
	wss.handleUpgrade(req, socket, head, (ws) => {
		wss.emit('connection', ws, req)
		const canvas = url.searchParams.get('canvas')
		if (url.pathname === '/ws/sync' && NAME.test(canvas ?? '') && engineOf(canvas) === 'tldraw') getRoom(canvas).handleSocketConnect({ sessionId: url.searchParams.get('sessionId') ?? randomBytes(8).toString('hex'), socket: ws })
		else if (url.pathname === '/ws/excalidraw') onScene(ws, canvas)
		else if (url.pathname === '/ws/canvas') onCanvas(ws, canvas)
		else if (url.pathname === '/ws/chat') chat.attach(ws, url.searchParams.get('canvas'))
		else ws.close()
	})
})

function onCanvas(ws, canvas) {
	if (!NAME.test(canvas ?? '')) return ws.close()
	const list = tabs.get(canvas) ?? []
	list.push(ws)
	tabs.set(canvas, list)
	ws.send(JSON.stringify({ type: 'scripts', scripts: listScripts(canvas) }))
	ws.on('message', (raw) => {
		const msg = JSON.parse(raw)
		if (msg.type === 'focus') {
			const l = tabs.get(canvas).filter((w) => w !== ws)
			l.push(ws)
			tabs.set(canvas, l)
		} else if (msg.type === 'ack' && pending.has(msg.id)) {
			const p = pending.get(msg.id)
			p.acked = true
			p.extend()
		} else if (msg.type === 'result' && pending.has(msg.id)) {
			const p = pending.get(msg.id)
			pending.delete(msg.id)
			clearTimeout(p.timer)
			msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error))
		}
	})
	ws.on('close', () => tabs.set(canvas, (tabs.get(canvas) ?? []).filter((w) => w !== ws)))
}

// Drop sockets whose browser went away without closing (sleep, network change).
setInterval(() => {
	for (const ws of wss.clients) {
		if (ws.isAlive === false) {
			ws.terminate()
			continue
		}
		ws.isAlive = false
		ws.ping()
	}
}, 20000)
wss.on('connection', (ws) => {
	ws.isAlive = true
	ws.on('pong', () => (ws.isAlive = true))
})

server.listen(PORT, HOST, () => {
	console.log(`toucan listening on ${HOST}:${PORT}`)
	console.log(`open: ${publicUrl()} — sign in once with \`node bin/toucan.mjs url\` (token stays out of logs)`)
	if (args.dev) console.log(`dev: vite serves the app on :5173 and proxies /api and /ws here`)
})
