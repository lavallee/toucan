// Versions: the evolution of a canvas, one full snapshot at a time, so anyone can step back through it
// and restore any point. Saved in <data>/<name>.versions/: index.json (what each version is) and
// <n>.json.gz (the engine's own document). Engine-neutral: a caller passes the document plus its
// `shapes`, a map of shape key -> comparable content, used to skip no-op saves and describe each step.
// A key starting with ~ is other content (a page, a binding): it counts as a change but isn't reported.
//
// Restoring never loses anything: the current state is saved first, and a restore is a new version too.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

const HOUR = 36e5
const DAY = 24 * HOUR

export const versionsDir = (dir, canvas) => join(dir, `${canvas}.versions`)
const indexPath = (dir, canvas) => join(versionsDir(dir, canvas), 'index.json')
const filePath = (dir, canvas, n) => join(versionsDir(dir, canvas), `${n}.json.gz`)

function readStore(dir, canvas) {
	return existsSync(indexPath(dir, canvas)) ? JSON.parse(readFileSync(indexPath(dir, canvas), 'utf8')) : { next: 1, versions: [] }
}
function writeStore(dir, canvas, store) {
	const tmp = `${indexPath(dir, canvas)}.tmp`
	writeFileSync(tmp, JSON.stringify(store, null, 1) + '\n')
	renameSync(tmp, indexPath(dir, canvas))
}

const hashOf = (shapes) => {
	const h = createHash('sha256')
	for (const k of Object.keys(shapes).sort()) h.update(`${k}\0${shapes[k]}\0`)
	return h.digest('base64url').slice(0, 22)
}

const shapeKeys = (shapes) => Object.keys(shapes).filter((k) => !k.startsWith('~'))

/** What changed between two `shapes` maps: added, updated and removed keys. */
export function diffShapes(before, after) {
	const added = [], updated = [], removed = []
	for (const k of shapeKeys(after)) (!(k in before) ? added : before[k] !== after[k] ? updated : null)?.push(k)
	for (const k of shapeKeys(before)) if (!(k in after)) removed.push(k)
	return { added, updated, removed }
}

const KEEP_KEYS = 12
const summarise = ({ added, updated, removed }) => ({
	added: added.length, updated: updated.length, removed: removed.length,
	keys: [...added, ...updated, ...removed].slice(0, KEEP_KEYS),
})

/**
 * Saves a version; returns it, or null when nothing changed since the last one (unless the save is
 * named: naming the current state labels the latest version instead of copying it).
 */
export function save(dir, canvas, { label, source = 'edit', data, shapes, named = false, now = Date.now() }) {
	mkdirSync(versionsDir(dir, canvas), { recursive: true })
	const store = readStore(dir, canvas)
	const hash = hashOf(shapes)
	const last = store.versions.at(-1)
	if (last?.hash === hash) {
		if (!named) return null
		Object.assign(last, { label, named: true })
		writeStore(dir, canvas, store)
		return last
	}
	const prior = last && existsSync(filePath(dir, canvas, last.n)) ? JSON.parse(gunzipSync(readFileSync(filePath(dir, canvas, last.n)))).shapes : {}
	const n = store.next++
	writeFileSync(filePath(dir, canvas, n), gzipSync(JSON.stringify({ data, shapes })))
	const version = { n, t: new Date(now).toISOString(), source, hash, count: shapeKeys(shapes).length, ...summarise(diffShapes(prior, shapes)), ...(label && { label: String(label).slice(0, 200) }), ...(named && { named: true }) }
	store.versions.push(version)
	for (const gone of prune(store.versions, now)) rmSync(filePath(dir, canvas, gone.n), { force: true })
	store.versions = store.versions.filter((v) => !v.pruned)
	writeStore(dir, canvas, store)
	return version
}

/**
 * Thins automatic versions as they age: every one for a day, then the last of each hour for a week,
 * then the last of each day. Named versions and restores stay, and so does the newest.
 */
function prune(versions, now) {
	const gone = []
	const seen = new Set()
	for (let i = versions.length - 2; i >= 0; i--) {
		const v = versions[i], age = now - Date.parse(v.t)
		if (v.named || v.source === 'restore' || age < DAY) continue
		const bucket = age < 7 * DAY ? `h${Math.floor(Date.parse(v.t) / HOUR)}` : `d${Math.floor(Date.parse(v.t) / DAY)}`
		if (seen.has(bucket)) (v.pruned = true), gone.push(v)
		else seen.add(bucket)
	}
	return gone
}

/** Versions, newest first. */
export const list = (dir, canvas) => readStore(dir, canvas).versions.map(({ hash, ...v }) => v).reverse()

/** One version with its document, or null. */
export function read(dir, canvas, n) {
	const v = readStore(dir, canvas).versions.find((x) => x.n === Number(n))
	if (!v || !existsSync(filePath(dir, canvas, v.n))) return null
	const { hash, ...meta } = v
	return { ...meta, data: JSON.parse(gunzipSync(readFileSync(filePath(dir, canvas, v.n)))).data }
}

/** Does the canvas differ from its latest version? */
export function isCurrent(dir, canvas, shapes) {
	return readStore(dir, canvas).versions.at(-1)?.hash === hashOf(shapes)
}
