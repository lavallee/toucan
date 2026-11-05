// toucan server: serves the canvas app, relays code from agents to the live editor,
// persists canvases and their scripts, and hosts a Codex app-server chat.
//
//   node server/index.mjs [--host 0.0.0.0] [--port 8893] [--data DIR] [--dev] [--headless]
//
// Canvases live in --data / TOUCAN_DATA (default: the platform's data directory; see lib/paths.mjs).
//
// Every HTTP/WS request needs the token from ~/.config/toucan/server.json — the exec
// relay runs arbitrary JS in the canvas and the chat drives an agent with a shell, so
// nothing here is safe to expose unauthenticated, even on a private network.

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, renameSync, statSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { TLSocketRoom } from '@tldraw/sync-core'
import { CodexChat } from './codex.mjs'
import { createHeadless } from './headless.mjs'
import * as trail from './trail.mjs'
import * as versions from './versions.mjs'
import { createRoutines } from './routines.mjs'
import { formatBrief, parseDirect } from './brief.mjs'
import * as threads from './threads.mjs'
import { FORMATS as CANVAS_FORMATS, formatList } from './formats.mjs'
import { layOut } from '../lib/layouts.mjs'
import { templateById, templateList } from '../templates/index.mjs'
import { FORMATS, fromTldraw, fromExcalidraw, toExcalidrawElements } from '../lib/tg.mjs'
import { CONFIG, ensureToken, readJson, resolveData, writeConfig } from '../lib/paths.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

const args = Object.fromEntries(
	process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : null)).filter(Boolean),
)
const CANVASES = resolveData({ flag: args.data, root: ROOT }).dir
mkdirSync(CANVASES, { recursive: true, mode: 0o700 }) // documents: a new directory is private to its owner
const HOST = args.host ?? process.env.TOUCAN_HOST ?? '127.0.0.1'
const PORT = Number(args.port ?? process.env.TOUCAN_PORT ?? 8893)
const MANAGED = process.env.TOUCAN_MANAGED === '1' // started by `toucan start`, so `toucan stop` may stop it
delete process.env.TOUCAN_MANAGED // nothing this server starts was started by toucan start
const NAME = /^[a-z0-9][a-z0-9-_]{0,63}$/i
// The host printed in links: a loopback-bound server is only reachable as itself.
const PUBLIC_HOST = process.env.TOUCAN_PUBLIC_HOST || (HOST === '0.0.0.0' || HOST === '::' ? hostname() : HOST)

// ---- token -----------------------------------------------------------------
/** Say where this server is, once it has the port: until then another server may own the address. */
function advertise() {
	writeConfig({ ...readJson(CONFIG), port: PORT, url: `http://127.0.0.1:${PORT}`, public: `http://${PUBLIC_HOST}:${PORT}`, pid: process.pid, managed: MANAGED, data: CANVASES })
}
const TOKEN = ensureToken()
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
// crashed, stale build) is skipped for the next one. People's tabs always come first;
// with --headless, the server's own headless page (server/headless.mjs) is the last resort.
const tabs = new Map() // canvas -> [ws...] (most recently focused last)
const unlanded = new Map() // canvas -> { sentAt, changes } of its last run that changed something, whose changes reach this server through sync
const pending = new Map() // exec id -> {resolve, reject, timer, acked}
let execSeq = 0
const ACK_MS = 2500
const HEADLESS_ACK_MS = 30000 // a page the server just opened is still loading, and on a slow machine that takes a while; a person's silent tab gets skipped quickly
const headless = createHeadless({ enabled: !!(args.headless ?? /^(1|true|yes)$/i.test(process.env.TOUCAN_HEADLESS ?? '')), port: PORT, token: TOKEN })

/**
 * Agent at work: tell every tab on the canvas that an agent's call started and when it ends, so people
 * see who is busy and on what (app/pulses.tsx). `who` = { agent, doing } from the CLI.
 */
function exec(canvas, code, timeoutMs, label, who = {}) {
	const agent = String(who.agent || 'agent').slice(0, 40)
	broadcast(canvas, { type: 'agent-activity', phase: 'start', agent, doing: String(who.doing || label || 'working on the canvas').slice(0, 120) })
	const end = () => broadcast(canvas, { type: 'agent-activity', phase: 'end', agent })
	return run(canvas, code, timeoutMs, label, agent).finally(end)
}

function run(canvas, code, timeoutMs = 30000, label, agent) {
	// So the person's edits and the agent's stay separate steps, note the unsaved state before a run; it's
	// saved only if the run turns out to change something, so reads (summary, notes) cost nothing.
	// (A previous run still reaching the server's copy waits its turn: quick runs share one version.)
	const pendingEdits = unsaved.get(canvas)
	const before = pendingEdits && !pendingEdits.label ? currentDocument(canvas) : null
	const live = [...(tabs.get(canvas) ?? [])].reverse().filter((w) => w.readyState === 1)
	const candidates = [...live.filter((w) => !w.headless), ...live.filter((w) => w.headless)]
	if (!candidates.length && !headless.enabled) return Promise.reject(new Error(`no browser tab has canvas "${canvas}" open — open it with \`toucan open ${canvas}\`, or ask the person to open ${publicUrl(canvas)}`))
	return new Promise((resolve, reject) => {
		const send = (ws, next) => {
			const id = ++execSeq
			const done = (f) => (v) => (ws.headless && headless.touch(canvas, false), f(v))
			const p = { resolve: done(resolve), reject: done(reject), acked: false, ws, canvas, code, label, before, sentAt: Date.now(), agent }
			if (ws.headless) headless.touch(canvas, true)
			p.timer = setTimeout(() => {
				pending.delete(id)
				p.acked ? p.reject(new Error('exec timed out')) : (ws.headless && headless.touch(canvas, false), next())
			}, ws.headless ? HEADLESS_ACK_MS : ACK_MS)
			p.extend = () => {
				clearTimeout(p.timer)
				p.timer = setTimeout(() => (pending.delete(id), p.reject(new Error('exec timed out'))), timeoutMs)
			}
			pending.set(id, p)
			ws.send(JSON.stringify({ type: 'exec', id, code, agent }))
		}
		const tryTab = (i) => {
			if (i < candidates.length) return send(candidates[i], () => tryTab(i + 1))
			if (!headless.enabled || candidates.some((w) => w.headless)) return reject(new Error(`no open tab on "${canvas}" responded`))
			headless.ensure(canvas).then((ws) => send(ws, () => reject(new Error(`the headless page on "${canvas}" did not respond`))), reject)
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
	entry.persist = persist
	entry.room = new TLSocketRoom({
		initialSnapshot,
		onDataChange: () => {
			entry.changed = Date.now()
			clearTimeout(entry.timer)
			entry.timer = setTimeout(persist, 1000)
			snapshotSoon(canvas)
		},
		onSessionRemoved: (room, { numSessionsRemaining }) => {
			if (numSessionsRemaining > 0) return
			clearTimeout(entry.timer)
			persist()
			snapshotNow(canvas)
			room.close()
			rooms.delete(canvas)
		},
	})
	rooms.set(canvas, entry)
	snapshotNow(canvas) // anything from before this server ran, and a first version for an older canvas
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
	snapshotNow(canvas)
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
		snapshotSoon(canvas)
	})
	ws.on('close', () => {
		scene.sockets.delete(ws)
		if (scene.sockets.size) return
		clearTimeout(scene.timer)
		scene.persist()
		snapshotNow(canvas)
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
// What agents write for a canvas (research, helper scripts) goes here, not in the checkout they run from.
const filesDir = (n) => join(CANVASES, `${n}.files`)
const listFiles = (n) => {
	const walk = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]))
	return existsSync(filesDir(n)) ? walk(filesDir(n)).sort() : []
}

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
		openThreads: threads.list(CANVASES, n).filter((t) => t.status === 'open').length,
		format: idx[n]?.format ?? null,
		open: (tabs.get(n) ?? []).filter((w) => !w.headless).length,
		headless: headless.has(n),
		thumb: existsSync(thumbPath(n)) ? Math.round(mtime(thumbPath(n))) : null,
	}
}

function broadcast(canvas, msg) {
	for (const ws of tabs.get(canvas) ?? []) if (ws.readyState === 1) ws.send(JSON.stringify(msg))
}

// ---- versions: the evolution of a canvas (server/versions.mjs) ---------------------------------
// A version is saved once edits go quiet (or every few minutes during a long session), after each agent
// run that changed something, when the last tab leaves, and whenever someone names one.
const QUIET_MS = Number(process.env.TOUCAN_VERSION_QUIET ?? 30) * 1000
const MAX_WAIT_MS = Number(process.env.TOUCAN_VERSION_MAX_WAIT ?? 300) * 1000
const AFTER_AGENT_MS = 1500 // the tab's edit reaches the server's copy just after its result does
const unsaved = new Map() // canvas -> { timer, since, label }

function currentDocument(n) {
	if (engineOf(n) === 'excalidraw') {
		const elements = sceneElements(n)
		return { data: { elements }, shapes: excalidrawShapes(elements) }
	}
	const room = rooms.has(n) ? rooms.get(n).room.getCurrentSnapshot() : existsSync(docPath(n)) ? JSON.parse(readFileSync(docPath(n), 'utf8')).room : null
	return room ? { data: { room }, shapes: tldrawShapes(room) } : null
}
// A tab joining writes a `user` record into the document; that isn't an edit to the canvas.
const tldrawShapes = (room) => Object.fromEntries((room.documents ?? []).filter((d) => d.state.typeName !== 'user').map(({ state: r }) => [r.typeName === 'shape' ? r.meta?.key ?? r.id.replace(/^shape:/, '') : `~${r.id}`, JSON.stringify(r)]))
// Excalidraw's bookkeeping changes on every save, and deleted elements are still in the list. A box's
// label is a separate element here, so it counts as part of the box.
function excalidrawShapes(elements) {
	const out = {}
	const live = elements.filter((e) => !e.isDeleted)
	const keyOf = (e) => e.customData?.key ?? e.id
	const clean = ({ version, versionNonce, updated, seed, ...e }) => JSON.stringify(e)
	const byId = new Map(live.map((e) => [e.id, e]))
	for (const e of live) if (!(e.containerId && byId.has(e.containerId))) out[keyOf(e)] = clean(e)
	for (const e of live) if (e.containerId && byId.has(e.containerId)) out[keyOf(byId.get(e.containerId))] += clean(e)
	return out
}

function saveDocument(n, doc, opts = {}) {
	if (!opts.named && !Object.keys(doc.shapes).some((k) => !k.startsWith('~')) && !versions.list(CANVASES, n).length) return null // never edited
	return versions.save(CANVASES, n, { ...doc, ...opts })
}
function saveVersion(n, opts = {}) {
	const doc = currentDocument(n)
	if (!doc) return null
	return saveDocument(n, doc, opts)
}
function snapshotNow(n, opts) {
	const due = unsaved.get(n)
	if (due) clearTimeout(due.timer)
	unsaved.delete(n)
	try {
		return saveVersion(n, { ...(due?.label && { label: due.label, source: 'agent' }), ...opts })
	} catch (e) {
		console.error(`version of ${n} failed: ${e.message}`) // never let history get in the way of an edit
		return null
	}
}
/** The unsaved state from before an agent run that changed something. */
function saveBefore(n, doc) {
	try {
		saveDocument(n, doc)
	} catch (e) {
		console.error(`version of ${n} failed: ${e.message}`)
	}
}
function snapshotSoon(n, { label, delay = QUIET_MS } = {}) {
	const due = unsaved.get(n) ?? { since: Date.now() }
	clearTimeout(due.timer)
	if (label) due.label = label
	const wait = Math.min(due.label ? AFTER_AGENT_MS : delay, Math.max(0, due.since + MAX_WAIT_MS - Date.now()))
	due.timer = setTimeout(() => snapshotNow(n), wait)
	unsaved.set(n, due)
}

/** Puts a version's document back. Every tab follows; what was there is saved first, and this is a version too. */
function restoreVersion(n, version) {
	const before = currentDocument(n)
	// This one must succeed: it is what makes a restore safe. Unlike other saves, a failure stops here.
	const due = unsaved.get(n)
	if (due) clearTimeout(due.timer)
	unsaved.delete(n)
	saveVersion(n, { label: due?.label ?? `Before restoring v${version.n}`, source: due?.label ? 'agent' : 'edit' })
	const undo = versions.list(CANVASES, n)[0]?.n ?? null
	const label = `Restored v${version.n}${version.label ? ` (${version.label})` : ''}`
	if (engineOf(n) === 'excalidraw') restoreScene(n, version.data.elements)
	else if (rooms.has(n)) rooms.get(n).room.loadSnapshot(version.data.room)
	else writeFileSync(docPath(n), JSON.stringify({ room: version.data.room }))
	const saved = snapshotNow(n, { label, source: 'restore' })
	if (!saved) return { ...version, data: undefined, unchanged: true } // it already looked like that
	// Nobody may be watching this one land.
	const after = currentDocument(n)
	if (!(tabs.get(n) ?? []).some((w) => !w.headless) && before && after) trail.record(CANVASES, n, { source: 'restore', label, changes: versions.diffShapes(before.shapes, after.shapes) })
	return { ...saved, undo }
}
/** Excalidraw merges by element version, so restored elements must outrank what tabs hold now. */
function restoreScene(n, target) {
	const open = scenes.get(n)
	const current = open ? open.elements : new Map(sceneElements(n).map((e) => [e.id, e]))
	const wanted = new Map(target.map((e) => [e.id, e]))
	const next = []
	for (const id of new Set([...current.keys(), ...wanted.keys()])) {
		const was = current.get(id), e = wanted.get(id)
		const version = Math.max(was?.version ?? 0, e?.version ?? 0) + 1
		next.push({ ...(e ?? was), ...(!e && { isDeleted: true }), version, versionNonce: randomBytes(4).readUInt32LE() })
	}
	if (!open) return writeFileSync(scenePath(n), JSON.stringify({ type: 'excalidraw', version: 2, source: 'toucan', elements: next, appState: {}, files: {} }))
	for (const e of next) open.elements.set(e.id, e)
	open.changed = Date.now()
	open.persist()
	for (const ws of open.sockets) if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'update', elements: next }))
}

// ---- routines: chores banked once, run on any canvas (server/routines.mjs) ---------------------
const routines = createRoutines({ shipped: join(ROOT, 'routines'), data: CANVASES })
const routineRow = ({ code, ...r }) => r

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
		if (route === 'health' && !canvas) return json(res, 200, { ok: true, version: VERSION, pid: process.pid, managed: MANAGED, data: CANVASES, headless: headless.enabled })
		if (route === 'canvases' && !canvas && req.method === 'GET') {
			const idx = readIndex()
			return json(res, 200, { canvases: canvasNames().map((n) => describe(n, idx)) })
		}
		if (route === 'canvases' && !canvas && req.method === 'POST') {
			const { name, title, description, engine = 'tldraw', from, graph, format, template } = JSON.parse(await body(req))
			const starter = template ? templateById(template) : null
			if (template && !starter) return json(res, 400, { error: `no template ${template}: see toucan templates` })
			if (format && !Object.hasOwn(CANVAS_FORMATS, format)) return json(res, 400, { error: `format: one of ${Object.keys(CANVAS_FORMATS).join(', ')}` })
			if (!NAME.test(name ?? '')) return json(res, 400, { error: 'name: letters, digits, - and _, up to 64' })
			if (!ENGINES.includes(engine)) return json(res, 400, { error: `engine: one of ${ENGINES.join(', ')}` })
			if (canvasNames().includes(name)) return json(res, 409, { error: `${name} already exists` })
			if (from && !canvasNames().includes(from)) return json(res, 404, { error: `no canvas ${from} to copy from` })
			// Seeding goes through the graph, so it works across engines: tldraw → TG → Excalidraw, and back.
			const seed = starter ? await layOut(starter) : graph ?? (from ? graphOf(from) : null)
			const idx = readIndex()
			idx[name] = { title: title || starter?.title || name, description: description ?? starter?.use ?? '', engine, created: new Date().toISOString(), ...(from && { from }), ...((format ?? starter?.format ?? readIndex()[from]?.format) && { format: format ?? starter?.format ?? readIndex()[from]?.format }) }
			writeIndex(idx)
			if (engine === 'excalidraw') writeFileSync(scenePath(name), JSON.stringify({ type: 'excalidraw', version: 2, source: 'toucan', elements: seed ? toExcalidrawElements(seed) : [], appState: {}, files: {} }))
			else if (seed) writeFileSync(seedPath(name), JSON.stringify(seed))
			return json(res, 201, describe(name, idx))
		}
		if (route === 'formats') return json(res, 200, { formats: formatList() })
		if (route === 'templates' && canvas) {
			const spec = templateById(canvas)
			return spec ? json(res, 200, spec) : json(res, 404, { error: `no template ${canvas}` })
		}
		if (route === 'templates') return json(res, 200, { templates: templateList() })
		if (route === 'routines') {
			const name = canvas // /api/routines/<name>
			if (!name && req.method === 'GET') return json(res, 200, { routines: routines.list().map((r) => (url.searchParams.has('code') ? r : routineRow(r))) })
			if (!NAME.test(name ?? '')) return json(res, 404, { error: 'not found' })
			if (req.method === 'GET') {
				const r = routines.get(name)
				return r ? json(res, 200, r) : json(res, 404, { error: `no routine ${name}` })
			}
			if (req.method === 'PUT') {
				const { code, title, description, engines } = JSON.parse(await body(req))
				if (typeof code !== 'string' || !code.trim()) return json(res, 400, { error: 'code: the routine to bank' })
				return json(res, 200, routineRow(routines.save(name, { code, title, description, engines })))
			}
			if (req.method === 'DELETE') return routines.remove(name) ? json(res, 200, { ok: true, restored: routines.get(name)?.source === 'shipped' }) : json(res, 404, { error: `${name} isn't banked here` })
			return json(res, 405, { error: 'method' })
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
			if (typeof patch.format === 'string') {
				if (patch.format && !Object.hasOwn(CANVAS_FORMATS, patch.format)) return json(res, 400, { error: `format: one of ${Object.keys(CANVAS_FORMATS).join(', ')}` })
				if (patch.format) cur.format = patch.format
				else delete cur.format
				broadcast(canvas, { type: 'format', format: cur.format ?? null })
			}
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
			for (const f of [docPath(canvas), scenePath(canvas), seedPath(canvas), scriptsDir(canvas), thumbPath(canvas), trail.trailPath(CANVASES, canvas), versions.versionsDir(CANVASES, canvas), threads.threadsPath(CANVASES, canvas), filesDir(canvas)]) if (existsSync(f)) renameSync(f, join(dest, f.slice(CANVASES.length + 1)))
			chat.forgetThreads(canvas)
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
			const { code, timeoutMs, label, agent, doing } = JSON.parse(await body(req))
			try {
				return json(res, 200, { ok: true, result: await exec(canvas, code, timeoutMs, label, { agent, doing }) })
			} catch (e) {
				return json(res, 200, { ok: false, error: String(e.message ?? e) })
			}
		}
		if (sub === 'routines' && NAME.test(subName ?? '') && url.pathname.endsWith('/run') && req.method === 'POST') {
			const routine = routines.get(subName)
			if (!routine) return json(res, 404, { error: `no routine ${subName}` })
			if (!routine.engines.includes(engineOf(canvas))) return json(res, 400, { error: `${routine.title} runs on ${routine.engines.join(', ')}; this canvas runs ${engineOf(canvas)}` })
			const { args } = JSON.parse((await body(req)) || '{}')
			try {
				return json(res, 200, { ok: true, result: await exec(canvas, routines.program(routine, args), 120000, `routine ${subName}`) })
			} catch (e) {
				return json(res, 200, { ok: false, error: String(e.message ?? e) })
			}
		}
		if (sub === 'threads') {
			const n = /^\d+$/.test(subName ?? '') ? Number(subName) : null
			const action = url.pathname.split('/')[6]
			const input = req.method === 'POST' ? JSON.parse((await body(req)) || '{}') : {}
			try {
				if (subName === undefined && req.method === 'GET') {
					const all = threadsView(canvas).filter((t) => url.searchParams.has('all') || t.status === 'open')
					const notes = pagesOf(canvas).reduce((n, page) => n + threads.adoptableNotes(CANVASES, canvas, graphOf(canvas, page ? { page } : undefined)).length, 0)
					return json(res, 200, { threads: all.map((t) => ({ ...t, attached: threads.describeAnchor(t, graphForThread(canvas, t)) })), notes })
				}
				if (subName === 'adopt-notes' && req.method === 'POST') {
					const adopted = pagesOf(canvas).flatMap((page) => threads.adoptNotes(CANVASES, canvas, graphOf(canvas, page ? { page } : undefined), page))
					announceThreads(canvas)
					return json(res, 200, { adopted: adopted.length })
				}
				if (subName === undefined && req.method === 'POST') {
					const thread = threads.create(CANVASES, canvas, { anchor: input.anchor, author: input.author, text: input.text })
					routeThread(canvas, thread, input.ask, input.mode)
					announceThreads(canvas)
					return json(res, 201, thread)
				}
				if (n === null) return json(res, 404, { error: 'not found' })
				if (!action && req.method === 'GET') return json(res, 200, { ...threads.get(CANVASES, canvas, n), attached: threads.describeAnchor(threads.get(CANVASES, canvas, n), graphForThread(canvas, threads.get(CANVASES, canvas, n))) })
				if (req.method !== 'POST') return json(res, 405, { error: 'method' })
				let thread
				if (action === 'messages') {
					thread = threads.reply(CANVASES, canvas, n, { author: input.author, text: input.text })
					routeThread(canvas, thread, input.ask, input.mode)
				} else if (action === 'close') thread = threads.close(CANVASES, canvas, n, { by: input.author, reply: input.text })
				else if (action === 'reopen') thread = threads.reopen(CANVASES, canvas, n)
				else if (action === 'route') {
					thread = threads.get(CANVASES, canvas, n)
					routeThread(canvas, thread, input.ask, input.mode, true)
				} else if (action === 'stop') {
					thread = threads.get(CANVASES, canvas, n)
					workOf(canvas, n).stop = true // if its turn hasn't started yet, it stops as soon as it does
					await chat.stopThread(canvas, n)
				} else if (action === 'approve') {
					thread = threads.get(CANVASES, canvas, n)
					chat.answer(input.key, input.decision)
				} else return json(res, 404, { error: 'not found' })
				announceThreads(canvas)
				return json(res, 200, thread)
			} catch (e) {
				if (e instanceof threads.NotFound) return json(res, 404, { error: e.message })
				if (e instanceof threads.Invalid) return json(res, 400, { error: e.message })
				throw e
			}
		}
		if (sub === 'versions') {
			const n = /^\d+$/.test(subName ?? '') ? Number(subName) : null
			const action = url.pathname.split('/')[6]
			if (subName === undefined && req.method === 'GET') return json(res, 200, { versions: versions.list(CANVASES, canvas), current: (() => { const d = currentDocument(canvas); return !d || versions.isCurrent(CANVASES, canvas, d.shapes) })() })
			if (subName === undefined && req.method === 'POST') {
				const { label, source } = JSON.parse((await body(req)) || '{}')
				if (typeof label !== 'string' || !label.trim()) return json(res, 400, { error: 'label: what to call this version' })
				const saved = snapshotNow(canvas, { label: label.trim(), named: true, source: source === 'agent' ? 'agent' : 'edit' })
				return saved ? json(res, 201, saved) : json(res, 404, { error: 'nothing to save yet' })
			}
			if (n === null) return json(res, 404, { error: 'not found' })
			const version = versions.read(CANVASES, canvas, n)
			if (!version) return json(res, 404, { error: `no version ${n}` })
			if (!action && req.method === 'GET') return json(res, 200, { ...version, engine: engineOf(canvas) })
			if (action === 'graph' && req.method === 'GET') {
				const format = url.searchParams.get('format') ?? 'tg'
				if (!FORMATS[format]?.export) return json(res, 400, { error: `format: one of ${Object.keys(FORMATS).join(', ')}` })
				const tg = { ...(engineOf(canvas) === 'excalidraw' ? fromExcalidraw(version.data.elements) : fromTldraw((version.data.room.documents ?? []).map((d) => d.state))), canvas }
				if (format === 'tg') return json(res, 200, tg)
				res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
				return res.end(FORMATS[format].export(tg, {}))
			}
			if (action === 'restore' && req.method === 'POST') return json(res, 200, restoreVersion(canvas, version))
			return json(res, 405, { error: 'method' })
		}
		if (sub === 'files' && req.method === 'GET' && !canvasNames().includes(canvas)) return json(res, 404, { error: `no canvas ${canvas}` }) // it hands out a place to write
		if (sub === 'files' && req.method === 'GET') return json(res, 200, { dir: filesDir(canvas), files: listFiles(canvas) })
		// The agent says what it is about to do, and optionally points at shapes (keys): every tab shows it.
		if (sub === 'say' && req.method === 'POST') {
			const { agent, text = '', keys = [] } = JSON.parse(await body(req))
			broadcast(canvas, { type: 'agent-say', agent: String(agent || 'agent').slice(0, 40), text: String(text).slice(0, 200), keys: [keys].flat().map(String).slice(0, 50) })
			return json(res, 200, { ok: true, tabs: (tabs.get(canvas) ?? []).filter((w) => !w.headless).length })
		}
		if (sub === 'log' && req.method === 'GET') return json(res, 200, { entries: trail.read(CANVASES, canvas, url.searchParams.get('since')) })
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
		return res.end('app not built: run `npm install && npm run build` in the toucan checkout (or use `npm run dev`)\n')
	}
	res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
	res.end(readFileSync(file))
}

// ---- websockets --------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true })
const chat = new CodexChat({ root: ROOT, port: PORT, engineOf, data: CANVASES, brief: chatBrief, direct: chatDirect, onThread: onThreadEvent, onTurn: (canvas, key, active) => broadcast(canvas, { type: 'agent-turn', agent: 'Codex', key, active }) })

// ---- comment threads (server/threads.mjs) -------------------------------------------------------
// What's in the file is the conversation. What an agent is doing right now isn't worth saving: it lives here, and
// every tab gets it along with the threads.
const threadWork = new Map() // "canvas#id" -> { working, approvals, last, error, stop }
const workOf = (canvas, id) => {
	const key = `${canvas}#${id}`
	if (!threadWork.has(key)) threadWork.set(key, {})
	return threadWork.get(key)
}
const threadsView = (canvas) =>
	threads.list(CANVASES, canvas).map((t) => {
		const { working, approvals } = threadWork.get(`${canvas}#${t.id}`) ?? {}
		return { ...t, ...(working && { working: true }), ...(approvals?.length && { approval: approvals[0] }) }
	})
const announceThreads = (canvas) => broadcast(canvas, { type: 'threads', threads: threadsView(canvas) })

function onThreadEvent(canvas, id, e) {
	const work = workOf(canvas, id)
	const say = (text) => threads.agentAnswered(CANVASES, canvas, id, text)
	try {
		if (e.type === 'item' && e.phase === 'completed' && e.item?.type === 'agentMessage' && e.item.text) work.last = e.item.text
		else if (e.type === 'approval') (work.approvals ??= []).push({ key: e.key, command: Array.isArray(e.command) ? e.command.join(' ') : e.command, reason: e.reason, kind: e.kind })
		else if (e.type === 'approved') work.approvals = (work.approvals ?? []).filter((a) => a.key !== e.key)
		else if (e.type === 'error') work.error = e.message // the turn's end reports it, once
		else if (e.type === 'send-failed') {
			work.working = false
			say(`Couldn't start: ${e.message}`)
		} else if (e.type === 'direct-done') work.working = false // nothing was running when asked to stop
		else if (e.type === 'turn') {
			work.working = e.status === 'inProgress'
			if (work.working && work.stop) chat.stopThread(canvas, id)
			if (!work.working) {
				delete work.approvals
				delete work.stop
				const said = work.last ?? (e.status === 'interrupted' ? 'Stopped.' : e.error || work.error ? `Couldn't finish: ${e.error || work.error}` : null)
				delete work.last
				delete work.error
				if (said) say(said)
			}
		} else return
		announceThreads(canvas)
	} catch (err) {
		// The canvas may have been archived mid-turn. That mustn't take the server down.
		if (!(err instanceof threads.NotFound)) console.error(`thread ${canvas}#${id}: ${err.message}`)
	}
}

/** A tldraw thread is about one page; its anchor says which. */
const graphForThread = (canvas, thread) => graphOf(canvas, thread.anchor.page ? { page: thread.anchor.page } : undefined)
function pagesOf(canvas) {
	if (engineOf(canvas) !== 'tldraw') return [undefined]
	const snapshot = rooms.has(canvas) ? rooms.get(canvas).room.getCurrentSnapshot() : existsSync(docPath(canvas)) ? JSON.parse(readFileSync(docPath(canvas), 'utf8')).room : null
	const pages = (snapshot?.documents ?? []).filter((d) => d.state.typeName === 'page').map((d) => d.state.id)
	return pages.length ? pages : [undefined]
}

const openThreadLines = (canvas) =>
	threads.list(CANVASES, canvas).filter((t) => t.status === 'open').map((t) => {
		const last = t.messages.at(-1)
		return `#${t.id} ${threads.anchorLine(t, graphForThread(canvas, t))}: ${last.author.name} said "${last.text.replace(/\s+/g, ' ').slice(0, 120)}"`
	})

/** Sends a thread somewhere for an answer. Its own agent by default; the main chat steers whatever's happening there. */
function routeThread(canvas, thread, ask, mode, handover = false) {
	if (ask === 'chat') {
		const said = thread.messages.at(-1)
		const about = `About comment thread #${thread.id}, ${threads.anchorLine(thread, graphForThread(canvas, thread))}.`
		// A new message is the request; handing over a thread with nothing new means the whole conversation is.
		const text = handover ? `${about} Take this thread from here. The conversation so far:\n${threads.transcript(thread)}` : `${about} ${said.author.name} says: ${said.text}`
		chat.enqueue(canvas, text, mode).catch((e) => console.error(`chat: ${e.message}`))
	} else if (ask === 'agent') {
		workOf(canvas, thread.id).working = true
		const prompt = threads.promptFor(thread, graphForThread(canvas, thread))
		threads.markSeen(CANVASES, canvas, thread.id)
		chat.askThread(canvas, thread.id, prompt, mode).catch((e) => onThreadEvent(canvas, thread.id, { type: 'send-failed', message: e.message ?? String(e) }))
	}
}

const guideFor = (canvas) => CANVAS_FORMATS[readIndex()[canvas]?.format]?.guide ?? null

/** Selection and notes need a person's tab; with none, or a slow one, the brief goes without them. */
async function chatBrief(canvas) {
	if (!(tabs.get(canvas) ?? []).some((w) => !w.headless)) {
		return formatBrief(graphOf(canvas), null, openThreadLines(canvas), guideFor(canvas))
	}
	const asked = exec(canvas, `const s = toucan.summary({ limit: 0 }), sel = toucan.selection?.()
return { page: toucan.engine === 'tldraw' ? editor.getCurrentPageId() : undefined, selected: s.selected ?? [], openNotes: s.openNotes, others: (sel?.others ?? []).map((o) => ({ user: o.user, shapes: o.shapes.map((x) => x.key) })) }`, 1000)
	const live = await Promise.race([asked, new Promise((r) => setTimeout(r, 800))]).catch(() => null)
	// The brief describes the page the person is on, not just the first one.
	const tg = graphOf(canvas, live?.page ? { page: live.page } : undefined)
	return formatBrief(tg, live, openThreadLines(canvas), guideFor(canvas))
}

/** A message that needs no agent: run it, and return what to say. Null: it's for the agent. */
async function chatDirect(canvas, text) {
	const what = parseDirect(text)
	if (!what) return null
	try {
		if (what.routine) {
			const routine = routines.get(what.routine)
			if (!routine) return null // not one of ours: perhaps the agent knows what was meant
			if (!routine.engines.includes(engineOf(canvas))) return `${routine.title} doesn't run on ${engineOf(canvas)}.`
			const result = await exec(canvas, routines.program(routine), 120000, `routine ${what.routine}`)
			return `**${routine.title}:** ${result?.summary ?? 'done'}`
		}
		const r = await exec(canvas, `return await toucan.applyGraph(${JSON.stringify(what.graph)}, {})`, 120000, 'Mermaid from chat')
		return `Added ${r?.created ?? 0} and updated ${r?.updated ?? 0} on the canvas.`
	} catch (e) {
		return `Couldn't do that: ${e.message ?? e}`
	}
}

server.on('upgrade', (req, socket, head) => {
	const url = new URL(req.url, 'http://x')
	if (!authed(req, url)) return socket.destroy()
	wss.handleUpgrade(req, socket, head, (ws) => {
		wss.emit('connection', ws, req)
		const canvas = url.searchParams.get('canvas')
		if (url.pathname === '/ws/sync' && NAME.test(canvas ?? '') && engineOf(canvas) === 'tldraw') getRoom(canvas).handleSocketConnect({ sessionId: url.searchParams.get('sessionId') ?? randomBytes(8).toString('hex'), socket: ws })
		else if (url.pathname === '/ws/excalidraw') onScene(ws, canvas)
		else if (url.pathname === '/ws/canvas') onCanvas(ws, canvas, url.searchParams.get('headless'))
		else if (url.pathname === '/ws/chat') chat.attach(ws, url.searchParams.get('canvas'))
		else ws.close()
	})
})

function onCanvas(ws, canvas, nonce) {
	if (!NAME.test(canvas ?? '')) return ws.close()
	headless.claim(canvas, ws, nonce)
	const list = tabs.get(canvas) ?? []
	list.push(ws)
	tabs.set(canvas, list)
	ws.send(JSON.stringify({ type: 'scripts', scripts: listScripts(canvas) }))
	ws.send(JSON.stringify({ type: 'threads', threads: threadsView(canvas) }))
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
			// Nobody watched a headless edit land, so it goes on the canvas's trail.
			if (ws.headless) trail.record(CANVASES, canvas, { source: 'headless', label: p.label, code: p.code, changes: msg.changes, ok: msg.ok, error: msg.error })
			if (msg.changes && (msg.changes.added?.length || msg.changes.updated?.length || msg.changes.removed?.length)) {
				unlanded.set(canvas, { sentAt: p.sentAt, changes: msg.changes })
				if (p.before) saveBefore(canvas, p.before)
				snapshotSoon(canvas, { label: p.label ?? 'Agent edit' })
			}
			msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error))
			// Agent presence: the other tabs glow what this run added or changed (app/pulses.tsx).
			const ids = msg.changes ? [...(msg.changes.added ?? []), ...(msg.changes.updated ?? [])].map((c) => c.id) : []
			if (ids.length) for (const other of tabs.get(canvas) ?? []) if (other !== ws && other.readyState === 1) other.send(JSON.stringify({ type: 'agent-edit', ids, agent: p.agent }))
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

server.on('error', (e) => {
	if (e.code !== 'EADDRINUSE') throw e
	console.error(`toucan: port ${PORT} is already in use. Is a server already running? (\`toucan status\`) Choose another with --port N.`)
	process.exit(1)
})
server.listen(PORT, HOST, () => {
	advertise()
	console.log(`toucan ${VERSION} listening on ${HOST}:${PORT}, canvases in ${CANVASES}`)
	console.log(`open: ${publicUrl()} — \`toucan open\` opens it signed in (the token stays out of logs)`)
	if (args.dev) console.log(`dev: vite serves the app on :5173 and proxies /api and /ws here`)
	if (headless.enabled) console.log(`headless: on — exec with no tab open runs in headless Chromium (idle close ${headless.idleMs / 1000}s, at most ${headless.max} pages)`)
})
/** Write what's only in memory: saves wait a second for edits to pause, and a stop shouldn't lose that second. */
function flushAll() {
	for (const [n, entry] of rooms) {
		clearTimeout(entry.timer)
		entry.persist()
		snapshotNow(n)
	}
	for (const [n, scene] of scenes) {
		clearTimeout(scene.timer)
		scene.persist()
		snapshotNow(n)
	}
}
/**
 * A tab reports a run's result before its edits arrive through sync, so a run that just ended may still be on its way.
 * What it added and removed can be checked by id. An update can't, so any change since the run has to do for those.
 */
function landed(n, { sentAt, changes }) {
	const room = rooms.get(n), scene = scenes.get(n)
	if (!room && !scene) return true // the last tab left, which saved it
	const has = (id) => (room ? !!room.room.getRecord(id) : scene.elements.has(id) && !scene.elements.get(id).isDeleted)
	if (!(changes.added ?? []).every((c) => has(c.id)) || (changes.removed ?? []).some((c) => has(c.id))) return false
	return !changes.updated?.length || (room ?? scene).changed >= sentAt
}
const allLanded = () => [...unlanded].every(([n, run]) => Date.now() - run.sentAt > 30000 || landed(n, run))
for (const sig of ['SIGINT', 'SIGTERM']) {
	process.once(sig, async () => {
		setTimeout(() => process.exit(0), 6000).unref()
		for (let i = 0; i < 70 && !allLanded(); i++) await new Promise((r) => setTimeout(r, 50))
		await new Promise((r) => setTimeout(r, 100)) // and whatever came just behind it
		try {
			flushAll()
		} catch (e) {
			console.error(`toucan: couldn't save on the way out: ${e.message}`)
		}
		// Close Chromium with the server (it would follow anyway once its pipe closes, but not always promptly).
		if (headless.enabled) await headless.shutdown().catch(() => {})
		process.exit(0)
	})
}
