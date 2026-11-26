// Renditions: a named, published picture of part of a canvas, so other documents can include it by name and know
// whether it is current. Kept in <data>/<canvas>.renditions/: NAME.json (the definition, and once published its
// manifest) and NAME.svg or NAME.png (the picture). A rendition is drawn only when someone asks (`toucan rendition
// publish NAME`), never on a canvas save: a document already sent never changes under its reader.
//
// Publishing also registers the picture in the include catalogue this machine's tools share (Copycat's docs/includes.md, "The
// catalogue", version 1) as `toucan:CANVAS/NAME`, so a document can say `<!-- include: toucan:CANVAS/NAME -->`.
// This file changes only Toucan's own entries there.
//
// Everything here is plain data and files; drawing the picture is the server's (server/index.mjs).

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/
export const FORMATS = ['svg', 'png']

export class RenditionError extends Error {
	constructor(status, message) {
		super(message)
		this.status = status
	}
}
const bad = (message) => new RenditionError(400, message)

export const renditionsDir = (dir, canvas) => join(dir, `${canvas}.renditions`)
const defPath = (dir, canvas, name) => join(renditionsDir(dir, canvas), `${name}.json`)
export const picturePath = (dir, canvas, name, format) => join(renditionsDir(dir, canvas), `${name}.${format}`)

export function checkName(name) {
	if (typeof name !== 'string' || !NAME.test(name)) throw bad(`"${name}" isn't a rendition name: lower case letters, digits, and . _ - after the first, up to 64`)
	return name
}

/** What a rendition shows: `{ all: true }`, `{ frame: KEY }` or `{ keys: [KEY, ...] }`. */
export function checkSelect(select) {
	if (!select || typeof select !== 'object' || Array.isArray(select)) throw bad('select: { all: true }, { frame: KEY } or { keys: [KEY, ...] }')
	const given = ['all', 'frame', 'keys'].filter((k) => select[k] !== undefined && select[k] !== false)
	if (given.length !== 1) throw bad('select one of: all, a frame, or a list of keys')
	if (given[0] === 'all') return { all: true }
	if (given[0] === 'frame') {
		if (typeof select.frame !== 'string' || !select.frame) throw bad('select.frame: the key of a frame')
		return { frame: select.frame }
	}
	const keys = [select.keys].flat().map(String).map((k) => k.trim()).filter(Boolean)
	if (!keys.length) throw bad('select.keys: at least one shape key')
	return { keys: [...new Set(keys)] }
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex')

// ---- what a rendition shows, and whether it has changed ------------------------------------------
// A canvas as a list of { key, parent, frame, content }: every shape on the page with its own key (as the CLI and
// `summary` name it), the key of what it sits in, and its record as text. Picking a shape takes in what is inside it,
// which is what the picture of it shows too.

/** tldraw records (a room snapshot's document states): the shapes on the first page. */
export function treeFromTldraw(records) {
	const byId = new Map(records.map((r) => [r.id, r]))
	const pages = records.filter((r) => r.typeName === 'page').sort((a, b) => (a.index < b.index ? -1 : 1))
	const shapes = records.filter((r) => r.typeName === 'shape')
	// The same rule as lib/tg.mjs: a duplicated shape keeps its original's meta.key, and the key belongs to the original.
	const owner = new Map()
	for (const s of shapes) {
		const k = s.meta?.key
		if (k && (!owner.has(k) || s.id === `shape:${String(k).replace(/[^\w.:-]/g, '_')}`)) owner.set(k, s.id)
	}
	const keyOf = (s) => (s.meta?.key && owner.get(s.meta.key) === s.id ? s.meta.key : s.id.replace(/^shape:/, ''))
	const pageOf = (s) => {
		while (s && s.typeName === 'shape') s = byId.get(s.parentId)
		return s?.id
	}
	const first = pages[0]?.id
	return shapes
		.filter((s) => pageOf(s) === first)
		.map((s) => {
			const parent = byId.get(s.parentId)
			return { key: keyOf(s), parent: parent?.typeName === 'shape' ? keyOf(parent) : null, frame: s.type === 'frame', content: JSON.stringify(s) }
		})
}

/** Excalidraw elements: live ones, a box's label counted as part of its box, and what a frame holds as its children. */
export function treeFromExcalidraw(elements) {
	const live = elements.filter((e) => !e.isDeleted)
	const byId = new Map(live.map((e) => [e.id, e]))
	const owner = new Map()
	for (const e of live) if (e.customData?.key && !owner.has(e.customData.key)) owner.set(e.customData.key, e.id)
	const keyOf = (e) => (e.customData?.key && owner.get(e.customData.key) === e.id ? e.customData.key : e.id)
	// Excalidraw's bookkeeping changes on every save without changing the picture.
	const clean = ({ version, versionNonce, updated, seed, ...e }) => JSON.stringify(e)
	const out = new Map()
	for (const e of live) {
		if (e.containerId && byId.has(e.containerId)) continue
		const frame = e.frameId && byId.get(e.frameId)
		out.set(e.id, { key: keyOf(e), parent: frame ? keyOf(frame) : null, frame: e.type === 'frame' || e.type === 'magicframe', content: clean(e) })
	}
	for (const e of live) if (e.containerId && out.has(e.containerId)) out.get(e.containerId).content += clean(e)
	return [...out.values()]
}

/** The keys a selection covers (with everything inside them), or an error naming what isn't on the canvas. */
export function pick(tree, select) {
	select = checkSelect(select)
	if (select.all) return new Set(tree.map((s) => s.key))
	const asked = select.frame ? [select.frame] : select.keys
	const known = new Map(tree.map((s) => [s.key, s]))
	const missing = asked.filter((k) => !known.has(k))
	if (missing.length) throw bad(`not on the canvas: ${missing.join(', ')}`)
	if (select.frame && !known.get(select.frame).frame) throw bad(`${select.frame} isn't a frame; use --keys for other shapes`)
	const keys = new Set(asked)
	for (let grew = true; grew; ) {
		grew = false
		for (const s of tree) if (s.parent && keys.has(s.parent) && !keys.has(s.key)) keys.add(s.key), (grew = true)
	}
	return keys
}

/** A sha256 of the picked shapes' records: equal exactly when none of them has changed, been added or gone. */
export function shapesHash(tree, keys) {
	const lines = tree.filter((s) => keys.has(s.key)).map((s) => `${s.key}\0${sha256(s.content)}`).sort()
	return sha256(lines.join('\n'))
}

/** The part of a toucan graph (lib/tg.mjs) a selection shows, to describe it in words. */
export function subGraph(tg, keys) {
	const nodes = (tg.nodes ?? []).filter((n) => keys.has(n.key))
	const groups = (tg.groups ?? []).filter((g) => keys.has(g.key))
	const edges = (tg.edges ?? []).filter((e) => keys.has(e.key) || (keys.has(e.from) && keys.has(e.to)))
	return { ...tg, nodes, groups, edges }
}

/**
 * tldraw names the ids inside an exported SVG after a counter of exports in that page (`_export_3_r_1k_…`), so the same
 * drawing comes out different each time. Each such prefix becomes one named after the rendition, numbered in the order
 * they appear: the same drawing gives the same bytes (and the same hash), and two renditions inlined in one page still
 * don't share an id.
 */
export function stableIds(svg, name) {
	const seen = new Map()
	const stem = String(name).replace(/[^a-z0-9]/g, '_')
	return svg.replace(/_export_\d+_r_[0-9a-z]+_/g, (p) => {
		if (!seen.has(p)) seen.set(p, `_rendition_${stem}_${seen.size}_`)
		return seen.get(p)
	})
}

// ---- definitions and manifests ---------------------------------------------------------------

function readDef(dir, canvas, name) {
	const file = defPath(dir, canvas, name)
	return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}
function writeDef(dir, canvas, def) {
	mkdirSync(renditionsDir(dir, canvas), { recursive: true, mode: 0o700 })
	const file = defPath(dir, canvas, def.name)
	const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
	writeFileSync(tmp, JSON.stringify(def, null, 2) + '\n')
	renameSync(tmp, file)
	return def
}

export const get = (dir, canvas, name) => readDef(dir, canvas, checkName(name))

export function list(dir, canvas) {
	const at = renditionsDir(dir, canvas)
	if (!existsSync(at)) return []
	return readdirSync(at).filter((f) => f.endsWith('.json') && NAME.test(f.slice(0, -5))).sort().map((f) => readDef(dir, canvas, f.slice(0, -5))).filter(Boolean)
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Defines a rendition, or changes one. What isn't given keeps its value; a new one shows the whole canvas, as an SVG.
 * A published one keeps its picture and manifest until it is published again, marked as changed meanwhile.
 */
export function define(dir, canvas, name, { select, format, alt, title } = {}, { now = Date.now() } = {}) {
	checkName(name)
	if (format !== undefined && !FORMATS.includes(format)) throw bad(`format: one of ${FORMATS.join(', ')}`)
	for (const [k, v] of [['alt', alt], ['title', title]]) if (v !== undefined && v !== null && typeof v !== 'string') throw bad(`${k}: text`)
	const was = readDef(dir, canvas, name)
	const def = {
		name,
		canvas,
		select: select !== undefined ? checkSelect(select) : was?.select ?? { all: true },
		format: format ?? was?.format ?? 'svg',
		alt: alt !== undefined ? alt || null : was?.alt ?? null,
		title: title !== undefined ? title || null : was?.title ?? null,
		version: was?.version ?? null,
		hash: was?.hash ?? null,
		published: was?.published ?? null,
		defined: was?.defined ?? new Date(now).toISOString(),
	}
	if (was?.published && ['select', 'format', 'alt', 'title'].some((k) => !same(was[k], def[k]))) def.changed = true
	else if (was?.changed) def.changed = true
	return { rendition: writeDef(dir, canvas, def), created: !was }
}

/**
 * Writes a freshly drawn picture beside its definition, and the manifest into the definition: the canvas version and
 * the hash of the shapes it was drawn from, and the picture's own hash. An unchanged picture keeps its `published`.
 */
export function publish(dir, canvas, name, { bytes, version, now = Date.now() }) {
	const def = readDef(dir, canvas, checkName(name))
	if (!def) throw new RenditionError(404, `no rendition ${name} on ${canvas}`)
	const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
	if (!buf.length) throw bad('nothing to publish: the picture is empty')
	const hash = sha256(buf)
	const file = picturePath(dir, canvas, name, def.format)
	const unchanged = def.hash === hash && def.published && existsSync(file)
	if (!unchanged) {
		const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
		writeFileSync(tmp, buf)
		renameSync(tmp, file)
	}
	for (const f of FORMATS) if (f !== def.format) rmSync(picturePath(dir, canvas, name, f), { force: true })
	const { changed, ...rest } = def
	const manifest = { ...rest, version, hash, published: unchanged ? def.published : new Date(now).toISOString() }
	writeDef(dir, canvas, manifest)
	return { rendition: manifest, picture: file, unchanged: !!unchanged }
}

/** Takes a rendition away: its definition and its picture. Returns what it was, or null. */
export function remove(dir, canvas, name) {
	const def = readDef(dir, canvas, checkName(name))
	if (!def) return null
	rmSync(defPath(dir, canvas, name), { force: true })
	for (const f of FORMATS) rmSync(picturePath(dir, canvas, name, f), { force: true })
	return def
}

/**
 * Is a rendition current? `unpublished` until it is drawn; `behind` when its definition changed since, or the shapes it
 * shows have (`shapes`: their hash now, or null when they can't be found); else `current`.
 */
export function status(def, shapes) {
	if (!def.published) return { state: 'unpublished' }
	if (def.changed) return { state: 'behind', why: 'its definition changed since it was published' }
	if (shapes === null) return { state: 'behind', why: 'some of what it shows is no longer on the canvas' }
	if (shapes !== def.version?.shapes) return { state: 'behind', why: 'the shapes it shows have changed' }
	return { state: 'current' }
}

// ---- the include catalogue (one per machine, shared by every tool; Copycat docs/includes.md, "The catalogue") -----------

const ENTRY = /^[a-z0-9][a-z0-9._:/-]{0,199}$/

export function cataloguePath(env = process.env) {
	if (env.INCLUDES_CATALOGUE) return env.INCLUDES_CATALOGUE
	return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'includes', 'catalogue.json')
}

/**
 * The catalogue's name for a rendition. Catalogue names are lower case and have no underscore, which a canvas name may,
 * so `My_Map` is written `my-map`; two canvases that differ only that way can't both register (see `register`).
 */
export function entryName(canvas, name) {
	const entry = `toucan:${canvas.toLowerCase().replace(/_/g, '-')}/${name}`
	if (!ENTRY.test(entry)) throw bad(`${entry} can't be a catalogue name`)
	return entry
}

export function entryFor(def, picture) {
	return {
		kind: 'picture',
		path: picture,
		...(def.title && { title: def.title }),
		...(def.alt && { alt: def.alt }),
		source: { tool: 'toucan', canvas: def.canvas, rendition: def.name, version: def.version, hash: def.hash, published: def.published },
	}
}

function readCatalogue(file) {
	if (!existsSync(file)) return { v: 1, entries: {} }
	let cat
	try {
		cat = JSON.parse(readFileSync(file, 'utf8'))
	} catch (e) {
		throw new RenditionError(409, `the include catalogue at ${file} isn't JSON (${e.message}); left as it is`)
	}
	if (cat?.v !== 1 || !cat.entries || typeof cat.entries !== 'object' || Array.isArray(cat.entries)) throw new RenditionError(409, `the include catalogue at ${file} isn't version 1 ({ "v": 1, "entries": {} }); left as it is`)
	return cat
}
function writeCatalogue(file, cat) {
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
	const tmp = join(dirname(file), `.${randomBytes(6).toString('hex')}.catalogue.tmp`)
	writeFileSync(tmp, JSON.stringify(cat, null, 2) + '\n', { mode: 0o600 })
	renameSync(tmp, file)
}
const ours = (entry, canvas) => entry?.source?.tool === 'toucan' && (canvas === undefined || entry.source.canvas === canvas)

/** Puts a rendition in the catalogue, or replaces its entry. Every other entry is left exactly as it was. */
export function register(def, picture, { file = cataloguePath() } = {}) {
	const name = entryName(def.canvas, def.name)
	const cat = readCatalogue(file)
	const there = cat.entries[name]
	if (there && !ours(there, def.canvas)) throw new RenditionError(409, `the include catalogue already has ${name}, from ${there.source?.tool === 'toucan' ? `canvas ${there.source.canvas}` : 'something other than toucan'}; left as it is`)
	cat.entries[name] = entryFor(def, picture)
	writeCatalogue(file, cat)
	return { file, name }
}

/** Takes a rendition's entry out of the catalogue, if it is there and toucan's. */
export function unregister(canvas, name, { file = cataloguePath() } = {}) {
	const entry = entryName(canvas, name)
	if (!existsSync(file)) return { file, name: entry, removed: false }
	const cat = readCatalogue(file)
	if (!ours(cat.entries[entry], canvas)) return { file, name: entry, removed: false }
	delete cat.entries[entry]
	writeCatalogue(file, cat)
	return { file, name: entry, removed: true }
}
