// References: what people read beside a canvas. A canvas's own files (what agents write for it), the project it belongs
// to, and pages on the web, shown in the app's References panel without leaving the canvas.
//
// A reference is a string. `files/notes/plan.md` is in the canvas's files folder, `project/README.md` in the project
// `toucan init` linked to the canvas, and `https://…` is a page on the web. Nothing outside those two folders can be read,
// hidden files and build output are left out, and the server fetches web pages itself, refusing any address on this
// machine or its local network unless TOUCAN_FETCH_PRIVATE=1 says otherwise.

import { lookup as dnsLookup } from 'node:dns'
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { PROJECTS, readJson } from '../lib/paths.mjs'

export const MAX_FILE = 25 << 20
export const MAX_FETCH = 15 << 20
const SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__', 'coverage'])
const MAX_LISTED = 4000

const TYPES = {
	md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', text: 'text/plain', log: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values',
	json: 'application/json', jsonl: 'application/json', yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/plain', xml: 'text/xml', mmd: 'text/plain', dot: 'text/plain',
	html: 'text/html', htm: 'text/html', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
	pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav',
}
const CODE = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cs', 'swift', 'kt', 'sh', 'bash', 'zsh', 'css', 'scss', 'sql', 'lua', 'php', 'r', 'ini', 'env.example'])

/** What a file is, from its name: how the panel shows it, and what to tell the browser it is. */
export function kindOf(name) {
	const ext = extname(name).slice(1).toLowerCase()
	const type = TYPES[ext] ?? (CODE.has(ext) ? 'text/plain' : null)
	const kind = ext === 'md' || ext === 'markdown' ? 'markdown'
		: ext === 'pdf' ? 'pdf'
		: type?.startsWith('image/') ? 'image'
		: type?.startsWith('video/') ? 'video'
		: type?.startsWith('audio/') ? 'audio'
		: ext === 'html' || ext === 'htm' ? 'html'
		: ext === 'csv' || ext === 'tsv' ? 'table'
		: type || CODE.has(ext) || !ext ? 'text'
		: 'other'
	return { kind, type: type ?? 'application/octet-stream', ext }
}

/** Headers for anything served to the panel: never run as a page of toucan's, never tell another site where it was read. */
export const SAFE_HEADERS = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'no-referrer',
	'cache-control': 'no-store',
	'content-security-policy': "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; media-src blob: data:",
}

/** The projects linked to a canvas (a canvas can belong to more than one checkout). */
export function projectsOf(canvas, links = readJson(PROJECTS)) {
	return Object.entries(links).filter(([, c]) => c === canvas).map(([root]) => root).filter((root) => existsSync(root)).sort()
}

/** The folders a canvas's references can come from, by the name a reference starts with. */
export function rootsOf(canvas, { filesDir, links, agent = [] } = {}) {
	const roots = [{ id: 'files', label: "This canvas's files", dir: filesDir(canvas) }]
	projectsOf(canvas, links).forEach((dir, i) => roots.push({ id: i ? `project-${i + 1}` : 'project', label: basename(dir), dir }))
	// The folders a canvas's agent profile shares (server/profiles.mjs): its notebook, say.
	agent.forEach((r, i) => roots.push({ id: i ? `agent-${i + 1}` : 'agent', label: r.label, dir: r.dir }))
	return roots
}

const hidden = (part) => part.startsWith('.')

/** A reference to a file, as a path on disk, or an error saying why not. Symlinks that lead outside don't count. */
export function resolveRef(ref, roots) {
	const [id, ...rest] = String(ref).split('/')
	const root = roots.find((r) => r.id === id)
	if (!root) return { error: `a reference starts with ${roots.map((r) => `${r.id}/`).join(', ')} or https://` }
	const parts = rest.filter((p) => p && p !== '.')
	if (!parts.length) return { error: 'name a file' }
	if (parts.some((p) => p === '..' || hidden(p) || SKIP.has(p))) return { error: `${ref} isn't something toucan shows` }
	if (!existsSync(root.dir)) return { error: `no such file: ${ref}` }
	const base = realpathSync(root.dir)
	const path = resolve(base, ...parts)
	if (!existsSync(path)) return { error: `no such file: ${ref}` }
	const real = realpathSync(path)
	if (real !== base && !real.startsWith(base + sep)) return { error: `${ref} leads outside ${root.id}/` }
	// A link inside the folder can still lead to something hidden there, like .env.
	if (relative(base, real).split(sep).some((p) => hidden(p) || SKIP.has(p))) return { error: `${ref} isn't something toucan shows` }
	const st = statSync(real)
	if (!st.isFile()) return { error: `${ref} is a folder` }
	if (st.size > MAX_FILE) return { error: `${ref} is too big to show (${Math.round(st.size / 1048576)} MB)` }
	return { path: real, size: st.size, root, rel: parts.join('/'), ...kindOf(real) }
}

/**
 * Every file a canvas can show, with the folders it's in. Big trees are cut short rather than slow, and the walk is
 * asynchronous so a large checkout doesn't hold up every other canvas while it's read.
 */
export async function listRefs(roots) {
	const files = []
	let cut = false
	for (const root of roots) {
		if (!existsSync(root.dir)) continue
		const walk = async (dir, prefix) => {
			let entries
			try {
				entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
			} catch {
				return
			}
			for (const e of entries) {
				if (files.length >= MAX_LISTED) return void (cut = true)
				if (hidden(e.name) || SKIP.has(e.name)) continue
				if (e.isDirectory()) await walk(join(dir, e.name), `${prefix}${e.name}/`)
				else if (e.isFile()) {
					const { kind } = kindOf(e.name)
					if (kind === 'other') continue
					let size = 0
					try {
						size = (await stat(join(dir, e.name))).size
					} catch {}
					files.push({ ref: `${root.id}/${prefix}${e.name}`, root: root.id, path: `${prefix}${e.name}`, kind, size })
				}
			}
		}
		await walk(root.dir, '')
	}
	return { roots: roots.map(({ id, label }) => ({ id, label })), files, cut }
}

// The panel lists on open, and people open and close it; a few seconds' memory saves walking a big checkout each time.
const recent = new Map()
export function listRefsCached(key, roots, ms = 5000) {
	const hit = recent.get(key)
	if (hit && Date.now() - hit.t < ms) return hit.list
	const list = listRefs(roots)
	recent.set(key, { t: Date.now(), list })
	list.catch(() => recent.delete(key))
	return list
}

/** Streams a resolved file to the response. */
export function sendFile(res, file) {
	res.writeHead(200, { 'content-type': file.kind === 'markdown' || file.type.startsWith('text/') ? `${file.type}; charset=utf-8` : file.type, 'content-length': file.size, 'x-toucan-kind': file.kind, ...SAFE_HEADERS })
	// Readable when stat'ed isn't readable now: a locked file, or one an agent just removed, must not take the server down.
	createReadStream(file.path).on('error', () => res.destroy()).pipe(res)
}

// ---- the web ----------------------------------------------------------------------------------------------------------------

/** An address on this machine or a private network, which a page on the web has no business reaching through toucan. */
export function isPrivate(address) {
	const v = isIP(address)
	if (v === 4) {
		const [a, b] = address.split('.').map(Number)
		return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
	}
	if (v === 6) {
		const h = hextets(address)
		if (!h) return true
		// An IPv4 address carried inside: mapped (::ffff:a.b.c.d, which URLs write as ::ffff:7f00:1), compatible (::a.b.c.d)
		// or NAT64 (64:ff9b::a.b.c.d). Judge the address it carries.
		const v4 = () => `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`
		if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) return h[5] === 0 && h[6] === 0 && h[7] <= 1 ? true : isPrivate(v4())
		if (h[0] === 0x64 && h[1] === 0xff9b) return isPrivate(v4())
		return (h[0] & 0xfe00) === 0xfc00 || (h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xff00) === 0xff00 || h[0] === 0x2001 && h[1] === 0xdb8
	}
	return true
}

/** An IPv6 address as its eight 16-bit groups, or null. */
function hextets(address) {
	let s = address.toLowerCase().split('%')[0]
	const tail = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
	if (tail) {
		const [a, b, c, d] = tail.slice(1).map(Number)
		s = s.slice(0, tail.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
	}
	const [head, rest] = s.split('::')
	const left = head ? head.split(':') : [], right = rest ? rest.split(':') : []
	const parts = s.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left
	if (parts.length !== 8) return null
	const out = parts.map((p) => parseInt(p, 16))
	return out.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : out
}

const allowPrivate = () => /^(1|true|yes)$/i.test(process.env.TOUCAN_FETCH_PRIVATE ?? '')

// The check happens when the connection is made, so a name can't resolve to one address for the check and another for the fetch.
function guardedLookup(hostname, options, callback) {
	dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
		if (err) return callback(err)
		const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }]
		const bad = list.find((a) => isPrivate(a.address))
		if (bad && !allowPrivate()) return callback(Object.assign(new Error(`${hostname} is on this machine or a private network, so toucan won't fetch it`), { code: 'TOUCAN_PRIVATE' }))
		if (options.all) return callback(null, list)
		callback(null, list[0].address, list[0].family)
	})
}

/** Fetches a page for the panel: http(s) only, redirects checked like the first request, a size cap and a timeout. */
export async function fetchExternal(raw, { maxBytes = MAX_FETCH, timeout = 15000, redirects = 5 } = {}) {
	let url
	try {
		url = new URL(raw)
	} catch {
		throw new Error(`not a web address: ${raw}`)
	}
	for (let hop = 0; ; hop++) {
		if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`only http and https pages can be shown, not ${url.protocol}`)
		if (url.username || url.password) throw new Error("addresses with a name and password in them aren't fetched")
		const host = url.hostname.replace(/^\[|\]$/g, '')
		if (isIP(host) && isPrivate(host) && !allowPrivate()) throw new Error(`${host} is on this machine or a private network, so toucan won't fetch it`)
		const out = await new Promise((resolveIt, rejectIt) => {
			let done = resolveIt, fail = rejectIt
			const lib = url.protocol === 'https:' ? https : http
			// The whole fetch has a deadline, not just each pause: a page that sends a byte at a time still ends.
			const deadline = setTimeout(() => req.destroy(new Error(`${url.host} took too long to answer`)), timeout * 2)
			const finish = (f) => (v) => (clearTimeout(deadline), f(v))
			done = finish(done)
			fail = finish(fail)
			const req = lib.get(url, { lookup: guardedLookup, timeout, headers: { 'user-agent': 'toucan-reference-viewer', accept: 'text/html,text/markdown,text/plain,application/pdf,image/*,*/*;q=0.5', 'accept-encoding': 'identity' } }, (res) => {
				if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
					res.resume()
					try {
						return done({ redirect: new URL(res.headers.location, url) })
					} catch {
						return fail(new Error(`${url.host} redirected to an address that isn't one`))
					}
				}
				const chunks = []
				let size = 0
				res.on('data', (c) => {
					size += c.length
					if (size > maxBytes) {
						req.destroy()
						fail(new Error(`${url.host} sent more than ${Math.round(maxBytes / 1048576)} MB`))
					} else chunks.push(c)
				})
				res.on('end', () => done({ status: res.statusCode, type: String(res.headers['content-type'] ?? 'application/octet-stream'), body: Buffer.concat(chunks) }))
				res.on('error', fail)
			})
			req.on('timeout', () => req.destroy(new Error(`${url.host} took too long to answer`)))
			req.on('error', fail)
		})
		if (!out.redirect) return { ...out, url: url.href }
		if (hop >= redirects) throw new Error(`${raw} redirected too many times`)
		url = out.redirect
	}
}

/** What kind of thing a fetched page is, for the panel. */
export function kindOfType(type, url = '') {
	const t = type.split(';')[0].trim().toLowerCase()
	if (t === 'text/html' || t === 'application/xhtml+xml') return 'html'
	if (t === 'text/markdown' || /\.md$/i.test(new URL(url, 'http://x').pathname)) return 'markdown'
	if (t === 'application/pdf') return 'pdf'
	if (t.startsWith('image/')) return 'image'
	if (t.startsWith('video/')) return 'video'
	if (t.startsWith('audio/')) return 'audio'
	if (t === 'text/csv') return 'table'
	if (t.startsWith('text/') || t.includes('json') || t.includes('xml') || t.includes('yaml')) return 'text'
	return 'other'
}

/** A reference written as a path on disk becomes one the panel understands, if it's somewhere the panel can read. */
export function refForPath(path, roots) {
	const abs = resolve(path)
	for (const root of roots) {
		if (!existsSync(root.dir)) continue
		const base = realpathSync(root.dir)
		const real = existsSync(abs) ? realpathSync(abs) : abs
		const rel = relative(base, real)
		if (rel && !rel.startsWith('..') && !rel.startsWith(sep)) return `${root.id}/${rel.split(sep).join('/')}`
	}
	return null
}
