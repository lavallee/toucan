// Activity: what happens on a canvas while an agent works, so the agent notices it.
//
// People edit a canvas while an agent is at work on it, comment on its shapes, and select what they mean by "this". The
// server sees all of it as it happens (the sync room, the Excalidraw scene, each tab's reports over /ws/canvas), so it keeps
// a feed per canvas: each shape a person added, changed or removed, each comment, and each selection, in order.
//
// Who changed a shape: an agent's run reports the shapes it touched (the tab's _track), and those claims are matched
// against the next diff of the document. A change no run claims is a person's. Reflexes and a plan's own drawing claim
// theirs too, and the feed leaves those out: they are the canvas tending itself, not news.
//
// Readers (a chat conversation, a terminal agent by name) each keep their place in the feed. `pending` gives what's new
// for one, leaving out its own edits; `ack` moves its place on once it has been told. The chat agent is told between its
// tool calls (a steer of the turn in progress, server/codex.mjs); a terminal agent with its next command (bin/toucan.mjs).
// Nothing is kept on disk: it is about the work in progress, and a restart starts afresh.

import { richTextToPlain } from '../lib/tg.mjs'

const MOVE_PX = 4 // a nudge smaller than this is noise, not a move
const CLAIM_MS = 30000 // how long a run's report of what it touched can wait for those edits to arrive through sync
const MAX_TEXT = 80
const MAX_LINES = 25

const clip = (s, n = MAX_TEXT) => {
	const t = String(s ?? '').replace(/\s+/g, ' ').trim()
	return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const round = (n) => Math.round(Number(n) || 0)

// ---- what a shape is, for noticing changes to it ------------------------------------------------------------------------

/** Every shape on a tldraw document (all pages) as a row: id, key, kind, text, where, and what it looks like. */
export function tldrawRows(records) {
	const byId = new Map(records.map((r) => [r.id, r]))
	const shapes = records.filter((r) => r.typeName === 'shape')
	// A duplicated box keeps its original's meta.key, and the key belongs to the original (as in lib/tg.mjs).
	const owner = new Map()
	for (const s of shapes) {
		const k = s.meta?.key
		if (k && (!owner.has(k) || s.id === `shape:${String(k).replace(/[^\w.:-]/g, '_')}`)) owner.set(k, s.id)
	}
	const keyOf = (s) => (s.meta?.key && owner.get(s.meta.key) === s.id ? s.meta.key : s.id.replace(/^shape:/, ''))
	const abs = new Map()
	const origin = (s) => {
		if (abs.has(s.id)) return abs.get(s.id)
		const parent = byId.get(s.parentId)
		const o = parent?.typeName === 'shape' ? origin(parent) : { x: 0, y: 0 }
		const p = { x: o.x + (s.x ?? 0), y: o.y + (s.y ?? 0) }
		abs.set(s.id, p)
		return p
	}
	const pageOf = (s) => {
		while (s && s.typeName === 'shape') s = byId.get(s.parentId)
		return s?.typeName === 'page' ? s.name : undefined
	}
	const frameOf = (s) => {
		for (let p = byId.get(s.parentId); p?.typeName === 'shape'; p = byId.get(p.parentId)) if (p.type === 'frame') return keyOf(p)
		return null
	}
	const ends = new Map()
	for (const b of records) if (b.typeName === 'binding' && b.type === 'arrow' && byId.has(b.toId)) ends.set(`${b.fromId}:${b.props?.terminal}`, keyOf(byId.get(b.toId)))
	const plain = (s) => {
		const p = s.props ?? {}
		if (s.type === 'frame') return p.name ?? ''
		if (p.richText) return richTextToPlain(p.richText)
		return p.text ?? ''
	}
	const rows = new Map()
	for (const s of shapes) {
		const p = s.props ?? {}, o = origin(s)
		const kind = s.type === 'geo' ? 'box' : s.type
		rows.set(s.id, {
			id: s.id,
			key: keyOf(s),
			kind,
			text: plain(s),
			x: round(o.x), y: round(o.y), w: round(p.w), h: round((p.h ?? 0) + (p.growY ?? 0)),
			page: pageOf(s),
			frame: frameOf(s),
			look: [p.color, p.fill, p.dash, p.size, p.geo].join('|'),
			...(s.type === 'arrow' && { from: ends.get(`${s.id}:start`) ?? null, to: ends.get(`${s.id}:end`) ?? null }),
		})
	}
	return rows
}

/** Every live Excalidraw element as a row. A container's label is part of the container. */
export function excalidrawRows(elements) {
	const live = elements.filter((e) => e && !e.isDeleted)
	const byId = new Map(live.map((e) => [e.id, e]))
	const owner = new Map()
	for (const e of live) if (e.customData?.key && !owner.has(e.customData.key)) owner.set(e.customData.key, e.id)
	const keyOf = (e) => (e.customData?.key && owner.get(e.customData.key) === e.id ? e.customData.key : e.id)
	const label = (e) => (e.boundElements ?? []).map((b) => byId.get(b.id)).find((t) => t?.type === 'text')
	const rows = new Map()
	for (const e of live) {
		if (e.type === 'text' && e.containerId && byId.has(e.containerId)) continue // read with its container
		const t = label(e)
		const kind = ['rectangle', 'ellipse', 'diamond'].includes(e.type) ? 'box' : e.type
		const frame = e.frameId && byId.get(e.frameId) ? keyOf(byId.get(e.frameId)) : null
		const at = (b) => (b?.elementId && byId.get(b.elementId) ? keyOf(byId.get(b.elementId)) : null)
		rows.set(e.id, {
			id: e.id,
			key: keyOf(e),
			kind,
			text: e.type === 'frame' || e.type === 'magicframe' ? e.name ?? '' : e.type === 'text' ? e.originalText ?? e.text ?? '' : t?.originalText ?? t?.text ?? '',
			x: round(e.x), y: round(e.y), w: round(e.width), h: round(e.height),
			frame,
			look: [e.strokeColor, e.backgroundColor, e.fillStyle, e.strokeStyle, e.type].join('|'),
			...(t && { parts: [t.id] }),
			...(e.type === 'arrow' && { from: at(e.startBinding), to: at(e.endBinding) }),
		})
	}
	return rows
}

/** What differs between two rows of one shape, as a list of what changed: text, moved, resized, look, frame, ends, page. */
export function rowChanges(a, b) {
	const what = []
	if (clip(a.text, 400) !== clip(b.text, 400)) what.push('text')
	if (a.kind !== 'arrow') {
		if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= MOVE_PX) what.push('moved')
		if (Math.abs(a.w - b.w) + Math.abs(a.h - b.h) >= MOVE_PX) what.push('resized')
	}
	if (a.look !== b.look) what.push('look')
	if ((a.frame ?? null) !== (b.frame ?? null)) what.push('frame')
	if (a.kind === 'arrow' && (a.from !== b.from || a.to !== b.to)) what.push('ends')
	if (a.page !== b.page) what.push('page')
	return what
}

// ---- the feed ---------------------------------------------------------------------------------------------------------------

/**
 * `rowsOf(canvas)`: the canvas's shapes now (tldrawRows / excalidrawRows), or null when the server doesn't hold it open.
 * `busy(canvas)`: a run is in flight there, so wait for its report before deciding who changed what.
 */
export function createActivity({ rowsOf, busy = () => false, now = () => Date.now(), quietMs = 400, maxWaitMs = 3000, keep = 1000 } = {}) {
	const canvases = new Map() // canvas -> { base, timer, since, events, claims, selections }
	const readers = new Map() // reader key -> { canvas, seq, seen: Map(user -> selection last told) }
	let seq = 0

	const stateOf = (canvas) => {
		if (!canvases.has(canvas)) canvases.set(canvas, { base: null, timer: null, since: 0, events: [], claims: new Map(), selections: new Map() })
		return canvases.get(canvas)
	}
	const push = (canvas, event) => {
		const st = stateOf(canvas)
		st.events.push({ seq: ++seq, t: now(), ...event })
		if (st.events.length > keep) st.events.splice(0, st.events.length - keep)
	}

	/** The server has the canvas open: what it looks like now is the starting point. */
	function open(canvas) {
		const st = stateOf(canvas)
		if (!st.base) st.base = rowsOf(canvas)
	}

	/** The server is letting go of the canvas: what changed last goes in first. */
	function close(canvas) {
		const st = canvases.get(canvas)
		if (!st) return
		settle(canvas)
		clearTimeout(st.timer)
		st.timer = null
		st.base = null
	}

	/** The document changed: look once edits pause (or every few seconds while they don't). */
	function touched(canvas) {
		const st = stateOf(canvas)
		if (!st.since) st.since = now()
		clearTimeout(st.timer)
		const wait = now() - st.since > maxWaitMs ? 0 : quietMs
		st.timer = setTimeout(() => {
			st.timer = null
			// A run is in flight: its report says which of these changes are its own. Give it a while.
			if (busy(canvas) && now() - st.since < CLAIM_MS / 3) return touched(canvas)
			settle(canvas)
		}, wait)
		st.timer.unref?.()
	}

	/** A run finished and reported what it touched. `actor`: { kind: 'agent' | 'canvas', name }. */
	function ran(canvas, actor, changes) {
		if (!changes) return
		const st = stateOf(canvas)
		const t = now()
		for (const list of [changes.added, changes.updated, changes.removed]) for (const c of list ?? []) if (c?.id) st.claims.set(c.id, { actor, t })
	}

	/** Compare the document with how it was last seen; each difference becomes an event, by whoever made it. */
	function settle(canvas, { actor: as } = {}) {
		const st = stateOf(canvas)
		st.since = 0
		const next = rowsOf(canvas)
		if (!next) return
		if (!st.base) return void (st.base = next)
		const prev = st.base
		st.base = next
		const t = now()
		for (const [id, c] of st.claims) if (t - c.t > CLAIM_MS) st.claims.delete(id)
		const who = (row) => {
			if (as) return as
			for (const id of [row.id, ...(row.parts ?? [])]) {
				const c = st.claims.get(id)
				if (c) {
					st.claims.delete(id)
					return c.actor
				}
			}
			return { kind: 'person' }
		}
		// A shape that moved only because its frame did hasn't moved as far as anyone meant: the frame did.
		const byKey = (rows) => new Map([...rows.values()].map((r) => [r.key, r]))
		const prevKeys = byKey(prev), nextKeys = byKey(next)
		const carried = (a, b) => {
			const fa = a.frame && prevKeys.get(a.frame), fb = b.frame && nextKeys.get(b.frame)
			return fa && fb && a.frame === b.frame && Math.abs(b.x - a.x - (fb.x - fa.x)) + Math.abs(b.y - a.y - (fb.y - fa.y)) < MOVE_PX
		}
		for (const [id, b] of next) {
			const a = prev.get(id)
			if (!a) push(canvas, { type: 'shape', change: 'added', actor: who(b), id, after: b })
			else {
				const what = rowChanges(a, b).filter((w) => w !== 'moved' || !carried(a, b))
				if (what.length) push(canvas, { type: 'shape', change: 'updated', actor: who(b), id, before: a, after: b, what })
			}
		}
		for (const [id, a] of prev) if (!next.has(id)) push(canvas, { type: 'shape', change: 'removed', actor: who(a), id, before: a })
	}

	/** A person's tab says what they have selected. Only a change is news. */
	function selected(canvas, tab, user, keys) {
		const st = stateOf(canvas)
		const now_ = [...new Set(keys)].slice(0, 50)
		const was = st.selections.get(tab)
		if (was && was.keys.join('\n') === now_.join('\n') && was.user === user) return
		st.selections.set(tab, { user, keys: now_, t: now() })
		push(canvas, { type: 'select', actor: { kind: 'person', name: user || undefined }, tab, keys: now_ })
	}

	/** A tab went away: its selection with it. */
	function left(canvas, tab) {
		canvases.get(canvas)?.selections.delete(tab)
	}

	/** Who in a tab has what selected, the most recent report first. */
	function selections(canvas) {
		return [...(canvases.get(canvas)?.selections.values() ?? [])].sort((a, b) => b.t - a.t)
	}

	/** Something said on the canvas: a comment, a version restored. `actor` as for runs, or { kind: 'person', name }. */
	function note(canvas, event) {
		push(canvas, { type: 'note', ...event })
	}

	/** Where a reader is in a canvas's feed; a new reader starts at the present (it has the canvas as it is now). */
	function reader(key, canvas) {
		let r = readers.get(key)
		if (!r || r.canvas !== canvas) {
			r = { canvas, seq, seen: new Map() }
			for (const s of selections(canvas)) r.seen.set(s.user ?? '', s.keys.join('\n'))
			readers.set(key, r)
			return { reader: r, fresh: true }
		}
		return { reader: r, fresh: false }
	}

	/**
	 * What's new for a reader: events after its place, less its own (`mine(actor)`) and what it shouldn't be told
	 * (`skip(event)`), with how far that goes (pass it to `ack`). Settles the document first, so a person's edit from
	 * a moment ago is in.
	 */
	function pending(key, canvas, { mine = () => false, skip = () => false } = {}) {
		const { reader: r, fresh } = reader(key, canvas)
		if (fresh) return { events: [], upto: r.seq, fresh }
		const st = canvases.get(canvas)
		if (st?.base) {
			clearTimeout(st.timer)
			st.timer = null
			settle(canvas)
		}
		const events = (st?.events ?? []).filter((e) => e.seq > r.seq && e.actor?.kind !== 'canvas' && !mine(e.actor) && !skip(e))
		return { events, upto: seq, reader: r }
	}

	function ack(key, upto, events = []) {
		const r = readers.get(key)
		if (!r) return
		r.seq = Math.max(r.seq, upto)
		for (const e of events) if (e.type === 'select') r.seen.set(e.actor?.name ?? '', e.keys.join('\n'))
	}

	function forget(prefix) {
		for (const k of [...readers.keys()]) if (k === prefix || k.startsWith(`${prefix}#`) || k.startsWith(`${prefix}@`)) readers.delete(k)
	}

	return { open, close, touched, ran, settle, selected, left, selections, note, reader, pending, ack, forget, get seq() { return seq } }
}

// ---- telling an agent -----------------------------------------------------------------------------------------------------

const whoName = (actor, person) => {
	if (actor?.kind === 'agent') return `${actor.name || 'an agent'} (agent)`
	return actor?.name || person || 'someone'
}
const label = (row) => `${row.kind === 'box' ? 'box' : row.kind} ${row.key}${row.text ? ` "${clip(row.text, 60)}"` : ''}`

/**
 * Events as lines an agent can act on, oldest first. Several edits to one shape by one hand read as one: where it started
 * and where it ended up. `person` names people when the events don't (who's at the canvas, if only one is). `seen` is the
 * selection the reader last heard of per user, so a selection that went and came back isn't news.
 */
export function describe(events, { person, seen = new Map(), max = MAX_LINES } = {}) {
	const merged = new Map() // actor+shape -> { first, last, at }
	const lines = []
	const order = []
	const selection = new Map() // user -> last keys
	for (const e of events) {
		if (e.type === 'shape') {
			const k = `${e.actor?.kind}:${e.actor?.name ?? ''}:${e.id}`
			if (!merged.has(k)) {
				merged.set(k, { first: e, last: e, what: new Set(e.what ?? []) })
				order.push({ k })
			} else {
				const m = merged.get(k)
				m.last = e
				for (const w of e.what ?? []) m.what.add(w)
			}
		} else if (e.type === 'select') {
			const user = e.actor?.name ?? ''
			if (!selection.has(user)) order.push({ select: user })
			selection.set(user, e.keys)
		} else if (e.type === 'note') order.push({ note: e })
	}
	for (const item of order) {
		if (item.k) {
			const { first, last, what: said } = merged.get(item.k)
			const who = whoName(first.actor, person)
			const before = first.change === 'added' ? null : first.before
			const after = last.change === 'removed' ? null : last.after
			if (!before && !after) continue // made and removed again: nothing to tell
			if (!before) lines.push(`${who} added ${label(after)} at ${after.x},${after.y}${after.frame ? ` in frame ${after.frame}` : ''}${after.kind === 'arrow' && after.from && after.to ? ` (${after.from} → ${after.to})` : ''}`)
			else if (!after) lines.push(`${who} removed ${label(before)}`)
			else {
				// What it differs in now, of what was noticed changing (a box carried along by its frame wasn't moved itself).
				const what = rowChanges(before, after).filter((w) => said.has(w))
				if (!what.length) continue // changed and changed back
				const parts = []
				if (what.includes('text')) parts.push(`text "${clip(before.text, 50)}" → "${clip(after.text, 50)}"`)
				if (what.includes('moved')) parts.push(`moved to ${after.x},${after.y}`)
				if (what.includes('resized')) parts.push(`resized to ${after.w}x${after.h}`)
				if (what.includes('frame')) parts.push(after.frame ? `into frame ${after.frame}` : `out of frame ${before.frame}`)
				if (what.includes('ends')) parts.push(`now ${after.from ?? '?'} → ${after.to ?? '?'}`)
				if (what.includes('page')) parts.push(`to page "${after.page}"`)
				if (what.includes('look')) parts.push('restyled')
				lines.push(`${who} changed ${label(after)}: ${parts.join('; ')}`)
			}
		} else if (item.select !== undefined) {
			const keys = selection.get(item.select)
			if ((seen.get(item.select) ?? '') === keys.join('\n')) continue
			const who = item.select || person || 'someone'
			lines.push(keys.length ? `${who} selected ${keys.slice(0, 20).join(', ')}${keys.length > 20 ? ` and ${keys.length - 20} more` : ''}` : `${who} cleared their selection`)
		} else if (item.note) {
			const e = item.note
			lines.push(e.actor ? `${whoName(e.actor, person)} ${e.text}` : e.text)
		}
	}
	if (lines.length > max) return [...lines.slice(0, max), `… and ${lines.length - max} more changes: run \`summary\` for the canvas as it is now.`]
	return lines
}

/** The block an agent reads: null when there's nothing to tell. */
export function format(lines, { canvas, intro } = {}) {
	if (!lines.length) return null
	const head = intro ?? 'While you were working, people changed the canvas (oldest first).'
	return [`<canvas_activity${canvas ? ` canvas="${canvas}"` : ''}>${head} Keep what they did: build on it rather than undo it, and don't redo what they removed. It needs no reply unless it changes what you're doing.`, ...lines.map((l) => `- ${l}`), '</canvas_activity>'].join('\n')
}
