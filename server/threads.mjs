// Threads: conversations attached to part of a canvas, to a shape (or several) or a region of the page. People and
// agents go back and forth in them, and close them out. They live beside the canvas, in <data>/<name>.threads.json,
// not in its document: so they work the same on every engine and with no tab open, survive undo and version
// restores, and stay out of exports.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const threadsPath = (dir, canvas) => join(dir, `${canvas}.threads.json`)

function load(dir, canvas) {
	const f = threadsPath(dir, canvas)
	return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { next: 1, threads: [] }
}
function store(dir, canvas, data) {
	const f = threadsPath(dir, canvas)
	writeFileSync(`${f}.tmp`, JSON.stringify(data, null, 1) + '\n')
	renameSync(`${f}.tmp`, f)
}
function change(dir, canvas, id, fn) {
	const data = load(dir, canvas)
	const thread = data.threads.find((t) => t.id === Number(id))
	if (!thread) throw new NotFound(`no thread ${id}`)
	fn(thread)
	store(dir, canvas, data)
	return thread
}

export class NotFound extends Error {}
export class Invalid extends Error {}

const finite = (n) => typeof n === 'number' && Number.isFinite(n)
/** An anchor is { shapes: [keys], box } or { region: {x, y, w, h} }. `box` is where it was, for when a shape goes. */
export function cleanAnchor(a) {
	const page = typeof a?.page === 'string' ? { page: a.page } : {}
	if (Array.isArray(a?.shapes) && a.shapes.length && a.shapes.every((k) => typeof k === 'string')) return { shapes: a.shapes.slice(0, 50), ...(a.box && isBox(a.box) && { box: a.box }), ...page }
	if (a?.region && isBox(a.region)) return { region: a.region, ...page }
	throw new Invalid('anchor: { shapes: [keys] } or { region: { x, y, w, h } }')
}
const isBox = (b) => [b.x, b.y, b.w, b.h].every(finite)

function message(author, text) {
	const clean = String(text ?? '').trim()
	if (!clean) throw new Invalid('text: what to say')
	return { author: { kind: author?.kind === 'agent' ? 'agent' : 'person', name: String(author?.name || (author?.kind === 'agent' ? 'Agent' : 'Someone')).slice(0, 60) }, text: clean.slice(0, 20000), t: new Date().toISOString() }
}

export const list = (dir, canvas) => load(dir, canvas).threads
export const get = (dir, canvas, id) => {
	const thread = load(dir, canvas).threads.find((t) => t.id === Number(id))
	if (!thread) throw new NotFound(`no thread ${id}`)
	return thread
}

export function create(dir, canvas, { anchor, author, text, source }) {
	const data = load(dir, canvas)
	const thread = { id: data.next++, anchor: cleanAnchor(anchor), status: 'open', created: new Date().toISOString(), messages: [message(author, text)], ...(source && { source }) }
	data.threads.push(thread)
	store(dir, canvas, data)
	return thread
}

/** Adds to a thread. Saying something in a closed thread opens it again. */
export const reply = (dir, canvas, id, { author, text }) =>
	change(dir, canvas, id, (t) => {
		t.messages.push(message(author, text))
		if (t.status === 'closed') {
			t.status = 'open'
			delete t.closed
		}
	})

/**
 * The thread's own agent finishing a turn. It may have been closed meanwhile, by a person or at their request, and
 * this doesn't undo that. Its own words count as seen by its conversation, if it had seen everything before them.
 */
export const agentAnswered = (dir, canvas, id, text) =>
	change(dir, canvas, id, (t) => {
		const upToDate = (t.seen ?? 0) === t.messages.length
		t.messages.push(message({ kind: 'agent' }, text))
		if (upToDate) t.seen = t.messages.length
	})

/** The thread's own conversation has now been told everything so far. */
export const markSeen = (dir, canvas, id) => change(dir, canvas, id, (t) => void (t.seen = t.messages.length))

export const close = (dir, canvas, id, { by, reply: last }) =>
	change(dir, canvas, id, (t) => {
		if (last) t.messages.push(message(by, last))
		t.status = 'closed'
		t.closed = { by: message(by, 'x').author, t: new Date().toISOString() }
	})

export const reopen = (dir, canvas, id) =>
	change(dir, canvas, id, (t) => {
		t.status = 'open'
		delete t.closed
	})

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const clip = (s, n = 80) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** What a thread is attached to, read from the canvas's graph: its shapes as they are now, or what's in its region. */
export function describeAnchor(thread, tg) {
	const rows = [...(tg.nodes ?? []).map((n) => ({ key: n.key, text: n.text, box: n.box, detail: n.meta?.detail })), ...(tg.groups ?? []).map((g) => ({ key: g.key, text: g.label, box: g.box, frame: true }))]
	const a = thread.anchor
	if (a.shapes) {
		const found = a.shapes.map((key) => {
			const row = rows.find((r) => r.key === key)
			const edge = (tg.edges ?? []).find((e) => e.key === key)
			return row ? { key, text: clip(row.text), box: row.box, ...(row.detail && { detail: clip(row.detail, 400) }) } : edge ? { key, arrow: `${edge.from} -> ${edge.to}` } : { key, unlisted: true, ...(a.box && { box: a.box }) }
		})
		return { on: found }
	}
	return { region: a.region, inside: rows.filter((r) => !r.frame && r.box && overlaps(r.box, a.region)).map((r) => ({ key: r.key, text: clip(r.text), box: r.box })) }
}

/** The same, in a line, for the model and the list. */
export function anchorLine(thread, tg) {
	const d = describeAnchor(thread, tg)
	if (d.on) return `on ${d.on.map((s) => (s.unlisted ? `${s.key} (not listed: a drawing or image, or since removed${s.box ? `; it was at ${Math.round(s.box.x)},${Math.round(s.box.y)}` : ''})` : s.arrow ? `the arrow ${s.arrow}` : `${s.key} ("${s.text}"${s.detail ? `; its detail reads: ${s.detail}` : ''})`)).join(', ')}`
	const r = d.region
	return `on the region ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}${d.inside.length ? `, around ${d.inside.slice(0, 12).map((s) => `${s.key} ("${s.text}")`).join(', ')}` : ', with nothing in it yet'}`
}

/**
 * What a thread's agent gets: what the thread is on, and everything its conversation hasn't been told yet. That's
 * tracked rather than inferred, since others (the main chat, a terminal agent, people) also speak in a thread.
 */
export function promptFor(thread, tg) {
	const fresh = thread.messages.slice(thread.seen ?? 0).map((m) => `${m.author.name}: ${m.text}`).join('\n')
	return `Comment thread #${thread.id}, ${anchorLine(thread, tg)}.\n${fresh || 'Nothing new has been said: take this thread from where it stands.'}`
}

/** The whole conversation, for handing a thread to someone new. */
export const transcript = (thread) => thread.messages.map((m) => `${m.author.name}: ${m.text}`).join('\n')

/** Sticky notes (the older way of leaving a message for the agent) that haven't become threads yet. */
export function adoptableNotes(dir, canvas, tg) {
	const done = new Set(load(dir, canvas).threads.map((t) => t.source?.note).filter(Boolean))
	return (tg.nodes ?? []).filter((n) => n.style?.geo === 'note' && !done.has(n.key))
}

/** Brings sticky notes in as threads, attached to the note itself and carrying any reply and resolution. The notes stay. */
export function adoptNotes(dir, canvas, tg, page) {
	// A note doesn't say who wrote it, only that a person did.
	const author = { kind: 'person', name: 'Sticky note' }
	return adoptableNotes(dir, canvas, tg).map((n) => {
		const text = n.meta?.noteText ?? n.text
		const thread = create(dir, canvas, { anchor: { shapes: [n.key], box: n.box, ...(page && { page }) }, author, text: text || '(empty note)', source: { note: n.key } })
		if (n.meta?.resolved) return close(dir, canvas, thread.id, { by: { kind: 'agent' }, reply: n.meta.reply })
		return thread
	})
}
