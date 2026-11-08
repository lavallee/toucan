// The `toucan` helper object handed to agent exec code and canvas scripts, next to
// `editor` (the live tldraw Editor) and `tl` (the tldraw module).
//
// Shapes created through these helpers carry a stable key: their id is derived from
// it and it is stored in meta.key, so re-running a generator updates shapes in place
// instead of duplicating them, and hand-made moves survive unless asked otherwise.

import ELK from 'elkjs/lib/elk.bundled.js'
import { Box as tl_Box, createShapeId, createBindingId, toRichText, renderPlaintextFromRichText, fitFrameToContent } from 'tldraw'
import { fromTldraw, layoutMissing } from '../lib/tg.mjs'
import { pulse as glow } from './pulses'
import { measureDiagram, scoreDiagram } from './measure'
import { makeTidy } from './tidy'
import { tldrawScene } from './scene'
import { refsOfShape } from './reference-links'

const elk = new ELK()

export function makeHelpers(editor) {
	const idFor = (key) => createShapeId(key.replace(/[^\w.:-]/g, '_'))
	const get = (key) => editor.getShape(idFor(key))

	function text(shape) {
		return shape?.props?.richText ? renderPlaintextFromRichText(editor, shape.props.richText) : shape?.props?.name ?? ''
	}

	/** Compact, model-friendly view of the page (or of one frame). */
	function summary({ within, limit = 400 } = {}) {
		let shapes = editor.getCurrentPageShapesSorted()
		if (within) {
			const root = get(within)
			const ids = root ? editor.getShapeAndDescendantIds([root.id]) : new Set()
			shapes = shapes.filter((s) => ids.has(s.id))
		}
		const out = shapes.slice(0, limit).map((s) => {
			const b = editor.getShapePageBounds(s)
			const row = { id: s.id, key: s.meta?.key, type: s.type, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }
			const t = text(s)
			if (t) row.text = t.slice(0, 120)
			if (s.parentId.startsWith('shape:')) row.parent = editor.getShape(s.parentId)?.meta?.key ?? s.parentId
			if (s.props.color) row.color = s.props.color
			if (s.type === 'arrow') {
				for (const bd of editor.getBindingsFromShape(s, 'arrow')) {
					const target = editor.getShape(bd.toId)
					row[bd.props.terminal === 'start' ? 'from' : 'to'] = target?.meta?.key ?? bd.toId
				}
			}
			if (s.meta && Object.keys(s.meta).length > 1) row.meta = s.meta
			return row
		})
		const openNotes = notes().length
		const selected = editor.getSelectedShapes().map(keyOf)
		return { page: editor.getCurrentPage().name, count: shapes.length, ...(selected.length && { selected }), ...(openNotes && { openNotes }), shapes: out }
	}

	// ---- proposals: dashed = proposed ------------------------------------------------------------
	// An agent can propose shapes instead of just making them: they are drawn dashed and carry
	// meta.proposed = { dash } (the dash to restore). A person accepts (made solid again) or rejects
	// (removed) them from the bar above the canvas, or an agent does so when asked. A shape a person drew
	// dashed is not a proposal: only meta.proposed counts.
	const DASHED = new Set(['geo', 'arrow', 'draw', 'line'])
	const isProposal = (s) => !!s?.meta?.proposed

	/** Mark existing shapes (keys) as proposed. Frames, notes and text can't be dashed, so they're skipped. */
	function propose(...keys) {
		const shapes = keys.flat().map(get).filter((s) => s && DASHED.has(s.type) && !isProposal(s))
		editor.updateShapes(shapes.map((s) => ({ id: s.id, type: s.type, props: { dash: 'dashed' }, meta: { ...s.meta, proposed: { dash: s.props.dash } } })))
		return shapes.map(keyOf)
	}

	/** Open proposals, with what each connects or says. */
	function proposals() {
		return editor.getCurrentPageShapes().filter(isProposal).map((s) => {
			const row = { key: keyOf(s), type: s.type, ...(text(s) && { text: text(s).slice(0, 120) }) }
			if (s.type === 'arrow') for (const bd of editor.getBindingsFromShape(s, 'arrow')) row[bd.props.terminal === 'start' ? 'from' : 'to'] = keyOf(editor.getShape(bd.toId))
			return row
		})
	}

	const proposalsFor = (keys) => (keys?.length ? keys.flat().map((k) => editor.getCurrentPageShapes().find((s) => keyOf(s) === k)) : editor.getCurrentPageShapes()).filter(isProposal)

	/** Accept proposals (keys, or all): drawn solid again, as ordinary shapes. One undo step. */
	function accept(...keys) {
		const shapes = proposalsFor(keys)
		editor.markHistoryStoppingPoint('accept proposals')
		editor.updateShapes(shapes.map((s) => {
			// tldraw merges meta on update, so the flag is cleared to null rather than left out.
			const dash = s.meta.proposed.dash ?? 'solid'
			return { id: s.id, type: s.type, props: { dash }, meta: { ...s.meta, proposed: null } }
		}))
		return { accepted: shapes.map(keyOf) }
	}

	/** Reject proposals (keys, or all): removed, with any proposed arrows left dangling. One undo step. */
	function reject(...keys) {
		const shapes = proposalsFor(keys)
		const gone = new Set(shapes.map((s) => s.id))
		const arrows = editor.getCurrentPageShapes().filter((a) => a.type === 'arrow' && isProposal(a) && !gone.has(a.id) && editor.getBindingsFromShape(a, 'arrow').some((b) => gone.has(b.toId)))
		editor.markHistoryStoppingPoint('reject proposals')
		editor.deleteShapes([...gone, ...arrows.map((a) => a.id)])
		return { rejected: [...shapes, ...arrows].map(keyOf) }
	}

	/** Proposals among the current selection, for the person's accept/reject bar. */
	const selectedProposals = () => editor.getSelectedShapes().filter(isProposal).map(keyOf)

	/**
	 * What people have selected, to resolve "this" and "these". `here`: the selection in the tab running
	 * this code (the person's most recently focused tab). `others`: other tabs' selections on this page,
	 * from tldraw presence, most recently active first.
	 */
	function selection() {
		const row = (s) => {
			const b = editor.getShapePageBounds(s)
			return { key: keyOf(s), type: s.type, ...(text(s) && { text: text(s).slice(0, 120) }), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }
		}
		const others = editor
			.getCollaboratorsOnCurrentPage()
			.filter((p) => p.selectedShapeIds.length)
			.sort((a, b) => b.lastActivityTimestamp - a.lastActivityTimestamp)
			.map((p) => ({ user: p.userName, shapes: p.selectedShapeIds.map((id) => editor.getShape(id)).filter(Boolean).map(row) }))
		return { here: editor.getSelectedShapes().map(row), others }
	}

	// ---- notes: sticky notes on the canvas addressed to the agent ----------------------------------
	// Convention: every tldraw `note` shape (the sticky-note tool) is for the agent. A note is open until
	// it is resolved: then it turns green, gains a one-line reply, and keeps meta.resolved. Never deleted.
	// A duplicated box keeps its original's meta.key, and that key has to lead back to this shape, not the original.
	const keyOf = (s) => (s.meta?.key && idFor(s.meta.key) === s.id ? s.meta.key : s.id.replace(/^shape:/, ''))
	const noteByKey = (key) => editor.getCurrentPageShapes().find((s) => s.type === 'note' && keyOf(s) === key)

	/**
	 * Open notes (or all, with resolved ones) with what they sit on and next to, so "merge these" can be
	 * resolved spatially: `on` lists shapes the note overlaps, `near` the closest others (gap in page
	 * px, and which side of the note they are on), `inside` the frame it is in.
	 */
	function notes({ all = false, radius = 240 } = {}) {
		const page = editor.getCurrentPageShapes()
		const others = page.filter((s) => s.type !== 'note' && s.type !== 'arrow')
		return page
			.filter((s) => s.type === 'note' && (all || !s.meta?.resolved))
			.map((n) => {
				const b = editor.getShapePageBounds(n)
				const row = { key: keyOf(n), text: n.meta?.noteText ?? text(n), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }
				if (n.meta?.resolved) Object.assign(row, { resolved: n.meta.resolved, reply: n.meta.reply })
				const frame = editor.getShapeAncestors(n).reverse().find((a) => a.type === 'frame')
				if (frame) row.inside = { key: keyOf(frame), text: text(frame) }
				const on = [], near = []
				let nearest = null
				for (const s of others) {
					if (s.type === 'frame' && s.id === frame?.id) continue
					const o = editor.getShapePageBounds(s)
					const dx = Math.max(o.minX - b.maxX, b.minX - o.maxX, 0), dy = Math.max(o.minY - b.maxY, b.minY - o.maxY, 0)
					const item = { key: keyOf(s), type: s.type, ...(text(s) && { text: text(s).slice(0, 80) }) }
					if (!dx && !dy) {
						on.push(item)
						continue
					}
					if (s.type === 'frame') continue
					const side = dx >= dy ? (o.minX >= b.maxX ? 'right' : 'left') : o.minY >= b.maxY ? 'below' : 'above'
					const close = { ...item, gap: Math.round(Math.hypot(dx, dy)), side }
					if (close.gap <= radius) near.push(close)
					if (!nearest || close.gap < nearest.gap) nearest = close
				}
				if (on.length) row.on = on
				// A note in empty space ("missing: …") still gets its closest shape, as an anchor.
				if (near.length || nearest) row.near = near.length ? near.sort((p, q) => p.gap - q.gap).slice(0, 6) : [nearest]
				return row
			})
	}

	/** Mark a note handled: green, with `reply` as a last line. The note's own text stays; nothing is deleted. */
	function resolveNote(key, reply) {
		const n = noteByKey(key)
		if (!n) throw new Error(`no note ${key} (keys come from toucan.notes())`)
		if (!reply) throw new Error('a resolved note needs a one-line reply')
		const original = n.meta?.noteText ?? text(n)
		const line = String(reply).replace(/\s+/g, ' ').trim()
		editor.updateShape({ id: n.id, type: 'note', props: { color: 'green', richText: toRichText(`${original}\n↳ ${line}`) }, meta: { ...n.meta, noteText: original, reply: line, resolved: new Date().toISOString() } })
		return { key, reply: line }
	}

	/**
	 * Internal (the exec relay): an edit nobody can see hasn't landed. When a run adds shapes outside the view,
	 * or starts an empty canvas, fit the canvas in view, unless the person is in the middle of doing something.
	 */
	function reveal(addedIds) {
		const added = addedIds.map((id) => editor.getShape(id)).filter(Boolean)
		if (!added.length || !editor.isIn('select.idle')) return
		const view = editor.getViewportPageBounds()
		const startedEmpty = editor.getCurrentPageShapeIds().size === added.length
		if (startedEmpty || added.some((s) => !view.contains(editor.getShapePageBounds(s)))) editor.zoomToFit({ animation: { duration: 250 } })
	}

	// ---- the canvas as comment threads see it (app/Threads.tsx): page coordinates, and what's where ------
	const unionOf = (boxes) => {
		const found = boxes.filter(Boolean)
		if (!found.length) return null
		const x = Math.min(...found.map((b) => b.x)), y = Math.min(...found.map((b) => b.y))
		return { x, y, w: Math.max(...found.map((b) => b.x + b.w)) - x, h: Math.max(...found.map((b) => b.y + b.h)) - y }
	}
	const boundsOf = (keys) => unionOf(keys.map((k) => get(k)).filter(Boolean).map((s) => {
		const { x, y, w, h } = editor.getShapePageBounds(s)
		return { x, y, w, h }
	}))
	/** The key of the shape at a page point: the smallest one it's inside, so a box beats the frame around it. */
	const shapeAt = (point) => {
		const s = editor.getShapeAtPoint(point, { hitInside: true, hitFrameInside: true, hitLabels: true, margin: 4 })
		return s ? keyOf(s) : null
	}
	const shapesIn = (box) => editor.getCurrentPageShapes().filter((s) => {
		if (s.type === 'frame' || s.type === 'arrow') return false
		const b = editor.getShapePageBounds(s)
		return b.x < box.x + box.w && box.x < b.maxX && b.y < box.y + box.h && box.y < b.maxY
	}).map(keyOf)
	// ---- what's behind a box, and how to walk on from it (app/Details.tsx) ------------------------------
	const stepOf = (s) => ({ key: keyOf(s), text: text(s) || keyOf(s) })
	/** Who a box connects to, ignoring proposals and dotted cross-references: those aren't the way through. */
	function viaEdges(key) {
		const me = get(key)
		const out = { next: [], prev: [] }
		if (!me) return out
		for (const b of editor.getBindingsToShape(me, 'arrow')) {
			const arrow = editor.getShape(b.fromId)
			if (!arrow || arrow.meta?.proposed || arrow.props.dash === 'dotted') continue
			const other = editor.getBindingsFromShape(arrow, 'arrow').find((o) => o.toId !== me.id)
			const shape = other && editor.getShape(other.toId)
			if (shape) out[b.props.terminal === 'end' ? 'prev' : 'next'].push(stepOf(shape))
		}
		return out
	}
	/** Its neighbours along the frame it's in, left to right. */
	function viaLanes(key) {
		const me = get(key)
		if (!me) return { next: [], prev: [] }
		const row = editor.getSortedChildIdsForParent(me.parentId).map((id) => editor.getShape(id)).filter((s) => s && s.type !== 'arrow' && s.type !== 'frame').sort((a, b) => a.x - b.x || a.y - b.y)
		const i = row.findIndex((s) => s.id === me.id)
		if (i < 0) return { next: [], prev: [] } // a frame or an arrow isn't on the lane
		return { next: row[i + 1] ? [stepOf(row[i + 1])] : [], prev: i > 0 ? [stepOf(row[i - 1])] : [] }
	}
	const walkView = {
		// Meta comes from synced documents and from agents, so its shape can't be taken on trust.
		detailOf: (key) => {
			const detail = get(key)?.meta?.detail
			return typeof detail === 'string' ? detail : ''
		},
		/** What a box points at to read: its meta.refs, and web addresses in its details and text. */
		refsOf: (key) => {
			const s = get(key)
			return s ? refsOfShape({ meta: s.meta, text: text(s), link: s.props?.url }) : []
		},
		/** Everything on the page that points at something to read, with the shape it's on. */
		referencesOnCanvas: () =>
			editor.getCurrentPageShapes().flatMap((s) => refsOfShape({ meta: s.meta, text: text(s), link: s.props?.url }).map((r) => ({ ...r, key: keyOf(s), on: (text(s) || '').split('\n')[0].slice(0, 80) }))),
		seeAlsoOf: (key) => {
			const see = get(key)?.meta?.see
			return (Array.isArray(see) ? see : []).filter((s) => typeof s?.key === 'string' && get(s.key)).map((s) => ({ key: s.key, ...(typeof s.label === 'string' && { label: s.label }), text: text(get(s.key)) || s.key }))
		},
		/** The selected shape's key if exactly one is selected. Cheap enough to ask on every store change. */
		selectedKey: () => {
			const only = editor.getOnlySelectedShape()
			return only ? keyOf(only) : null
		},
		neighbours: (key, walk) => (walk === 'lanes' ? viaLanes(key) : viaEdges(key)),
		isIdle: () => editor.isIn('select.idle') && !editor.getEditingShapeId(),
		walkTo: (key) => {
			const s = get(key)
			if (!s) return
			editor.select(s.id)
			// Close enough to read, and no closer than that.
			const b = editor.getShapePageBounds(s)
			editor.centerOnPoint({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, { animation: { duration: 300 } })
			if (editor.getZoomLevel() < 0.6) editor.setCamera({ ...editor.getCamera(), z: 0.8 }, { animation: { duration: 0 } }), editor.centerOnPoint({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, { animation: { duration: 300 } })
		},
	}

	const threadView = {
		...walkView,
		boundsOf,
		shapeAt,
		shapesIn,
		pageId: () => editor.getCurrentPageId(),
		pageOf: (key) => {
			const s = get(key)
			return s ? editor.getAncestorPageId(s) : undefined
		},
		goToPage: (page) => {
			if (editor.getPage(page) && editor.getCurrentPageId() !== page) editor.setCurrentPage(page)
		},
		toViewport: (p) => editor.pageToViewport(p),
		fromClient: (p) => editor.screenToPage(p),
		onCamera: (f) => editor.store.listen(f, { scope: 'session' }),
		showBox: (box) => {
			const view = editor.getViewportPageBounds()
			const inView = box.x >= view.minX && box.y >= view.minY && box.x + box.w <= view.maxX && box.y + box.h <= view.maxY
			if (inView) return
			if (box.w || box.h) editor.zoomToBounds(new tl_Box(box.x, box.y, box.w, box.h), { inset: 160, animation: { duration: 250 } })
			else editor.centerOnPoint(box, { animation: { duration: 250 } })
		},
	}

	const GAP = 40
	/** A free spot for a new box given no position: under what's in its frame, or right of everything on the page. */
	function freeSpot(frameId) {
		if (!frameId) {
			const page = editor.getCurrentPageBounds()
			return page ? { x: page.maxX + GAP, y: page.minY } : { x: 0, y: 0 }
		}
		const kids = editor.getSortedChildIdsForParent(frameId).map((id) => editor.getShape(id)).filter((s) => s && s.type !== 'arrow')
		const bottom = kids.reduce((m, s) => Math.max(m, s.y + editor.getShapeGeometry(s).bounds.h), 0)
		return { x: GAP, y: kids.length ? bottom + GAP : GAP }
	}
	/** A frame clips what spills out, so it grows to hold a box placed for it. */
	function growToHold(frameId, x, y, w, h) {
		const frame = editor.getShape(frameId)
		if (frame && (y + h + GAP > frame.props.h || x + w + GAP > frame.props.w)) editor.updateShape({ id: frameId, type: 'frame', props: { h: Math.max(frame.props.h, y + h + GAP), w: Math.max(frame.props.w, x + w + GAP) } })
	}

	/**
	 * Create or update a box. An existing box changes only in what you pass, and keeps its position unless
	 * `move: true`. A new box with no position goes somewhere free (see freeSpot).
	 */
	function node(key, { x, y, w, h, text: label, geo, color, fill, dash, size, parent, meta = {}, move = false, proposed = false } = {}) {
		const id = idFor(key)
		const existing = editor.getShape(id)
		const passed = Object.fromEntries(Object.entries({ geo, w, h, color, fill, dash, size }).filter(([, v]) => v !== undefined))
		if (label !== undefined) passed.richText = toRichText(label)
		if (existing) {
			const update = { id, type: existing.type, props: passed, meta: { ...existing.meta, ...meta, key } }
			if (move) Object.assign(update, x !== undefined && { x }, y !== undefined && { y })
			editor.updateShape(update)
		} else {
			// Always explicit: without it tldraw drops new shapes into whatever frame is under them.
			const parentId = parent ? idFor(parent) : editor.getCurrentPageId()
			const props = { geo: 'rectangle', w: 180, h: 64, color: 'black', fill: 'semi', dash: 'solid', size: 's', richText: toRichText(key), ...passed }
			const spot = x === undefined || y === undefined ? freeSpot(parent ? parentId : null) : null
			const at = { x: x ?? spot.x, y: y ?? spot.y }
			if (spot && parent) growToHold(parentId, at.x, at.y, props.w, props.h)
			editor.createShape({ id, type: 'geo', ...at, parentId, props, meta: { ...meta, key } })
		}
		if (proposed) propose(key)
		return id
	}

	/** Create or update a frame (a titled container). An existing frame changes only in what you pass. */
	function frame(key, { x, y, w, h, name, color, meta = {}, move = false } = {}) {
		// tldraw rejects a frame with no width or height, and the error takes the person's tab down: never write one.
		const positive = (v) => Number.isFinite(v) && v > 0
		if (!positive(w)) w = undefined
		if (!positive(h)) h = undefined
		const id = idFor(key)
		const existing = editor.getShape(id)
		const passed = Object.fromEntries(Object.entries({ name, color }).filter(([, v]) => v !== undefined))
		if (existing) {
			const update = { id, type: 'frame', props: passed, meta: { ...existing.meta, ...meta, key } }
			if (move) {
				Object.assign(update, x !== undefined && { x }, y !== undefined && { y })
				Object.assign(passed, w !== undefined && { w }, h !== undefined && { h })
			}
			editor.updateShape(update)
		} else {
			editor.createShape({ id, type: 'frame', x: x ?? 0, y: y ?? 0, parentId: editor.getCurrentPageId(), props: { w: w ?? 800, h: h ?? 600, name: key, color: 'black', ...passed }, meta: { ...meta, key } })
		}
		return id
	}

	/** Create or update an arrow bound to two keyed shapes. */
	function edge(from, to, { text: label = '', color = 'grey', dash = 'solid', size = 's', kind = 'arc', bend = 0, head = 'arrow', anchors, labelAt, meta = {}, proposed = false } = {}) {
		const id = edgeOnly(from, to, { text: label, color, dash, size, kind, bend, head, anchors, labelAt, meta })
		if (proposed) propose(`edge:${from}->${to}`)
		return id
	}
	function edgeOnly(from, to, { text: label, color, dash, size, kind, bend, head, anchors, labelAt, meta }) {
		const a = get(from), b = get(to)
		if (!a || !b) throw new Error(`edge ${from} -> ${to}: missing ${!a ? from : to}`)
		const key = `edge:${from}->${to}`
		const id = idFor(key)
		const props = { color, dash, size, kind, bend, richText: toRichText(label), arrowheadEnd: head === 'none' ? 'none' : 'arrow', ...(labelAt !== undefined && { labelPosition: labelAt }) }
		if (editor.getShape(id)) {
			editor.updateShape({ id, type: 'arrow', props, meta: { ...meta, key, from, to } })
			return id
		}
		const ab = editor.getShapePageBounds(a), bb = editor.getShapePageBounds(b)
		editor.createShape({ id, type: 'arrow', parentId: editor.getCurrentPageId(), x: ab.center.x, y: ab.center.y, props: { ...props, start: { x: 0, y: 0 }, end: { x: bb.center.x - ab.center.x, y: bb.center.y - ab.center.y } }, meta: { ...meta, key, from, to } })
		const bind = (terminal, target) => ({ id: createBindingId(), type: 'arrow', fromId: id, toId: target.id, props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } })
		const anchored = (binding, at) => (at ? { ...binding, props: { ...binding.props, normalizedAnchor: at, isPrecise: true, isExact: false } } : binding)
		editor.createBindings([anchored(bind('start', a), anchors?.from), anchored(bind('end', b), anchors?.to)])
		return id
	}

	/** Delete keyed shapes (and arrows bound to them). */
	function remove(...keys) {
		editor.deleteShapes(keys.flat().map(idFor).filter((id) => editor.getShape(id)))
	}

	/**
	 * Lay out keyed nodes with ELK. Edges are taken from arrows between them.
	 * opts.within: a frame key — lays out its children inside it (and resizes it).
	 */
	async function layout(keys, { within, algorithm = 'layered', direction = 'RIGHT', spacing = 40, layerSpacing = 90, animate = true } = {}) {
		let shapes
		if (keys?.length) shapes = keys.map(get).filter(Boolean)
		else if (within) shapes = editor.getSortedChildIdsForParent(idFor(within)).map((id) => editor.getShape(id)).filter((s) => s.type !== 'arrow')
		else shapes = editor.getCurrentPageShapes().filter((s) => s.type === 'geo' && s.parentId.startsWith('page:'))
		const ids = new Set(shapes.map((s) => s.id))
		const edges = editor.getCurrentPageShapes().filter((s) => s.type === 'arrow').flatMap((arrow) => {
			const bs = editor.getBindingsFromShape(arrow, 'arrow')
			const st = bs.find((b) => b.props.terminal === 'start')?.toId, en = bs.find((b) => b.props.terminal === 'end')?.toId
			return st && en && ids.has(st) && ids.has(en) ? [{ id: arrow.id, sources: [st], targets: [en] }] : []
		})
		const graph = {
			id: 'root',
			layoutOptions: { 'elk.algorithm': algorithm, 'elk.direction': direction, 'elk.spacing.nodeNode': String(spacing), 'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing), 'elk.padding': '[top=60,left=40,bottom=40,right=40]' },
			children: shapes.map((s) => {
				const b = editor.getShapeGeometry(s).bounds
				return { id: s.id, width: b.w, height: b.h }
			}),
			edges,
		}
		const res = await elk.layout(graph)
		const origin = within ? { x: 0, y: 0 } : editor.getShapePageBounds(shapes[0]) ?? { x: 0, y: 0 }
		const updates = res.children.map((c) => ({ id: c.id, type: editor.getShape(c.id).type, x: origin.x + c.x, y: origin.y + c.y }))
		if (animate && updates.length < 300) editor.animateShapes(updates, { animation: { duration: 300 } })
		else editor.updateShapes(updates)
		if (within && res.width > 0 && res.height > 0) editor.updateShape({ id: idFor(within), type: 'frame', props: { w: res.width, h: res.height } })
		return { nodes: updates.length, edges: edges.length, width: Math.round(res.width), height: Math.round(res.height) }
	}

	/** Find shapes whose text or key contains `q`. */
	function find(q) {
		const needle = q.toLowerCase()
		return summary({ limit: 10000 }).shapes.filter((s) => (s.key ?? '').toLowerCase().includes(needle) || (s.text ?? '').toLowerCase().includes(needle))
	}

	function zoomTo(keys) {
		const ids = keys ? [keys].flat().map(idFor) : null
		if (ids) editor.zoomToBounds(editor.getShapesPageBounds(ids), { animation: { duration: 300 }, inset: 80 })
		else editor.zoomToFit({ animation: { duration: 300 } })
	}

	/** The current page as a toucan graph (lib/tg.mjs). */
	function graph({ raw = false } = {}) {
		return fromTldraw(editor.store.allRecords(), { page: editor.getCurrentPageId(), raw })
	}

	/**
	 * Keyed upsert of a toucan graph onto the current page — how imports (Mermaid, JSON Canvas,
	 * Excalidraw, another canvas) land. Existing shapes get only the fields the graph carries (text,
	 * the style keys present, meta, membership) and keep their position and size unless `move`.
	 * New shapes take the graph's box; ones without (text formats) are laid out with ELK. Arrows are
	 * matched by endpoints (edge:<from>-><to>). Nothing is deleted unless `prune`, which removes keyed
	 * boxes, frames and arrows the graph doesn't mention.
	 */
	async function applyGraph(tg, { move = false, prune = false, propose: asProposal = false, direction } = {}) {
		editor.markHistoryStoppingPoint('apply graph')
		// A graph may leave out what it has none of.
		tg = { ...tg, groups: tg?.groups ?? [], nodes: tg?.nodes ?? [], edges: tg?.edges ?? [] }
		tg = await layoutMissing(tg, { existing: graph(), elk, direction })
		const raw = tg.extra?.tldraw ?? {}
		const out = { created: [], updated: 0, pruned: 0, skippedEdges: [] }
		const pageId = editor.getCurrentPageId()
		const tgGroup = new Map(tg.groups.map((g) => [g.key, g]))
		const pageBounds = editor.getCurrentPageBounds()
		const styleProps = (st = {}, type) => {
			const p = {}
			for (const k of ['color', 'fill', 'dash', 'size']) if (st[k] && (type !== 'text' || k === 'color' || k === 'size')) p[k] = st[k]
			if (type === 'geo' && st.geo && !['note', 'text'].includes(st.geo)) p.geo = st.geo
			return p
		}
		const depth = (g) => (g?.parent ? 1 + depth(tgGroup.get(g.parent)) : 0)
		const grown = new Set() // existing frames that gained shapes

		for (const g of [...tg.groups].sort((a, b) => depth(a) - depth(b))) {
			const existing = get(g.key)
			if (existing) {
				const update = { id: existing.id, type: 'frame', props: { name: g.label ?? existing.props.name }, meta: { ...existing.meta, ...g.meta, key: g.key } }
				if (move && g.box) Object.assign(update, { x: g.box.x, y: g.box.y, props: { ...update.props, w: g.box.w, h: g.box.h } })
				editor.updateShape(update)
				out.updated++
			} else {
				const b = g.box ?? { x: (pageBounds?.maxX ?? 0) + 200, y: pageBounds?.minY ?? 0, w: 600, h: 400 }
				frame(g.key, { x: b.x, y: b.y, w: b.w, h: b.h, name: g.label ?? g.key, meta: g.meta ?? {} })
				out.created.push(g.key)
			}
			// TG boxes are page coordinates; reparenting keeps a shape's page position.
			const parentId = g.parent && get(g.parent) ? idFor(g.parent) : pageId
			if (get(g.key).parentId !== parentId) editor.reparentShapes([idFor(g.key)], parentId)
		}

		for (const n of tg.nodes) {
			const existing = get(n.key)
			const parentId = n.group && get(n.group) ? idFor(n.group) : pageId
			if (existing) {
				const props = styleProps(n.style, existing.type)
				if (n.text !== undefined && existing.props.richText) props.richText = toRichText(n.text)
				const update = { id: existing.id, type: existing.type, props, meta: { ...existing.meta, ...n.meta, key: n.key } }
				if (move && n.box) {
					if ('w' in existing.props) Object.assign(props, { w: n.box.w, h: n.box.h })
				}
				editor.updateShape(update)
				if (n.group !== undefined && existing.parentId !== parentId) {
					editor.reparentShapes([existing.id], parentId)
					// Reparenting keeps the page position, which can sit outside the frame (and be clipped
					// out of sight). A shape that joins a frame without its own box moves inside it.
					if (parentId !== pageId && !(move && n.box)) {
						placeInsideFrame(existing.id, parentId)
						grown.add(n.group)
					}
				}
				if (move && n.box) editor.updateShape({ id: existing.id, type: existing.type, ...pagePointToParent(parentId, n.box) })
				out.updated++
				continue
			}
			const r = raw[n.key]
			const b = n.box ?? { x: 0, y: 0, w: 220, h: 100 }
			const id = idFor(n.key)
			const type = r?.type ?? (n.style?.geo === 'note' ? 'note' : n.style?.geo === 'text' ? 'text' : 'geo')
			const props = r ? { ...r.props } : { ...(type === 'geo' && { w: b.w, h: b.h, geo: 'rectangle' }), ...(type === 'text' && { w: b.w, autoSize: false }), ...styleProps(n.style, type) }
			props.richText = toRichText(n.text ?? n.key)
			if (type === 'geo' && n.box) Object.assign(props, { w: b.w, h: b.h })
			editor.createShape({ id, type, parentId, ...pagePointToParent(parentId, b), props, meta: { ...n.meta, key: n.key } })
			out.created.push(n.key)
			if (n.group && !out.created.includes(n.group)) grown.add(n.group)
		}

		for (const e of tg.edges) {
			if (!get(e.from) || !get(e.to)) {
				out.skippedEdges.push(`${e.from}->${e.to}`)
				continue
			}
			const key = `edge:${e.from}->${e.to}`
			const existing = get(key)
			const st = e.style ?? {}
			if (existing) {
				const props = { ...styleProps(st, 'arrow'), ...(e.label !== undefined && { richText: toRichText(e.label ?? '') }) }
				if (st.route) props.kind = st.route === 'elbow' ? 'elbow' : 'arc'
				if (st.bend !== undefined) props.bend = st.bend
				if (st.head) props.arrowheadEnd = st.head === 'none' ? 'none' : 'arrow'
				if (st.labelAt !== undefined) props.labelPosition = st.labelAt
				editor.updateShape({ id: existing.id, type: 'arrow', props, meta: { ...existing.meta, ...e.meta, key, from: e.from, to: e.to } })
				if (st.anchors) {
					const ends = editor.getBindingsFromShape(existing, 'arrow')
					const at = { start: st.anchors.from, end: st.anchors.to }
					editor.updateBindings(ends.filter((b) => at[b.props.terminal]).map((b) => ({ id: b.id, type: 'arrow', props: { ...b.props, normalizedAnchor: at[b.props.terminal], isPrecise: true, isExact: false } })))
				}
				out.updated++
			} else {
				edge(e.from, e.to, { text: e.label ?? '', color: st.color ?? 'grey', dash: st.dash ?? 'solid', size: st.size ?? 's', kind: st.route === 'elbow' ? 'elbow' : 'arc', bend: st.bend ?? 0, head: st.head, anchors: st.anchors, labelAt: st.labelAt, meta: e.meta ?? {} })
				const r = raw[key] ?? raw[e.key]
				if (r?.type === 'arrow') {
					const { start, end, richText, ...rest } = r.props
					editor.updateShape({ id: idFor(key), type: 'arrow', props: rest })
				}
				out.created.push(key)
			}
		}

		for (const g of grown) if (get(g)) fitFrameToContent(editor, idFor(g), { padding: 40 })

		if (prune) {
			const keep = new Set([...tg.groups.map((g) => g.key), ...tg.nodes.map((n) => n.key), ...tg.edges.map((e) => `edge:${e.from}->${e.to}`)])
			const gone = editor.getCurrentPageShapes().filter((s) => s.meta?.key && !keep.has(s.meta.key) && ['geo', 'frame', 'arrow', 'note', 'text'].includes(s.type))
			editor.deleteShapes(gone.map((s) => s.id))
			out.pruned = gone.length
		}
		// `propose`: what this import adds arrives as a proposal (dashed) for a person to accept or reject.
		if (asProposal) propose(...out.created)
		return { ...out, created: out.created.length }
	}

	/** If a frame's child lies outside the frame, move it to a free row below the frame's other children. */
	function placeInsideFrame(id, frameId) {
		const frame = editor.getShape(frameId), shape = editor.getShape(id)
		const size = (s) => editor.getShapeGeometry(s).bounds
		const { w, h } = size(shape)
		if (shape.x >= 0 && shape.y >= 0 && shape.x + w <= frame.props.w && shape.y + h <= frame.props.h) return
		const others = editor.getSortedChildIdsForParent(frameId).filter((c) => c !== id).map((c) => editor.getShape(c)).filter((s) => s.type !== 'arrow')
		const y = others.length ? Math.max(...others.map((s) => s.y + size(s).h)) + 40 : 60
		editor.updateShape({ id, type: shape.type, x: 40, y })
	}

	/** Page point → coordinates in a parent's space (frames aren't rotated here). */
	function pagePointToParent(parentId, { x, y }) {
		if (!parentId.startsWith('shape:')) return { x, y }
		const p = editor.getShapePageTransform(parentId).point()
		return { x: x - p.x, y: y - p.y }
	}

	/** PNG of the page (or of some keys) as base64, at most `max` px on its long side. */
	async function screenshot({ keys, max = 1800 } = {}) {
		const ids = keys?.length ? keys.map(idFor) : [...editor.getCurrentPageShapeIds()]
		if (!ids.length) return null
		const b = editor.getShapesPageBounds(ids)
		const scale = Math.min(1, max / Math.max(b.w + 64, b.h + 64))
		const { blob } = await editor.toImage(ids, { format: 'png', background: true, scale, pixelRatio: 1, padding: 32 })
		const buf = new Uint8Array(await blob.arrayBuffer())
		let s = ''
		for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
		return btoa(s)
	}

	/** Make shapes (ids or keys) glow for a moment in this tab, as agent edits do in every tab; the agent's cursor moves there. */
	function pulse(idsOrKeys, via) {
		glow([idsOrKeys].flat().map((k) => (String(k).startsWith('shape:') ? k : idFor(k))), via)
	}

	/**
	 * Internal (the exec relay): start recording this tab's own shape changes; the returned function
	 * stops and gives { added, updated, removed }, each a list of { id, key, type, text }.
	 * The run is also one undo step: a history stopping point goes before it, so one Cmd-Z in the tab
	 * that ran it undoes the whole agent action, and it doesn't merge with the action before it. (What
	 * comes after sets its own stopping point: tldraw's tools mark each interaction, and so does the next exec.)
	 */
	function _track() {
		editor.markHistoryStoppingPoint('agent exec')
		const seen = { added: new Map(), updated: new Map(), removed: new Map() }
		const row = (s) => ({ id: s.id, key: s.meta?.key ?? s.id.replace(/^shape:/, ''), type: s.type, ...(text(s) && { text: text(s).slice(0, 80) }) })
		// Side effects fire synchronously (store.listen is batched), and 'user' means this tab's own changes.
		const offs = [
			editor.sideEffects.registerAfterCreateHandler('shape', (s, source) => source === 'user' && seen.added.set(s.id, s)),
			editor.sideEffects.registerAfterChangeHandler('shape', (_, s, source) => source === 'user' && !seen.added.has(s.id) && seen.updated.set(s.id, s)),
			editor.sideEffects.registerAfterDeleteHandler('shape', (s, source) => {
				if (source !== 'user' || seen.added.delete(s.id)) return // made and removed in one run: nothing to report
				seen.updated.delete(s.id)
				seen.removed.set(s.id, s)
			}),
		]
		return () => {
			offs.forEach((off) => off())
			const list = (m, cap = 200) => [...m.values()].slice(0, cap).map(row)
			return { added: list(seen.added), updated: list(seen.updated), removed: list(seen.removed) }
		}
	}

	// The canvas as the tidying and the diagram check see it, the same on both engines (app/scene.js).
	const scene = tldrawScene(editor, { keyOf, text, toRichText })
	const api = { engine: 'tldraw', idFor, get, text, summary, node, frame, edge, remove, layout, find, zoomTo, graph, applyGraph, screenshot, pulse, notes, resolveNote, selection, propose, proposals, accept, reject, selectedProposals, _track, reveal, ...threadView, keyOf, scene, measure: () => {
		const m = measureDiagram(scene)
		return { ...m, score: scoreDiagram(m) }
	}, tidy: makeTidy(scene) }
	return api
}
