// The `toucan` helper object handed to agent exec code and canvas scripts, next to
// `editor` (the live tldraw Editor) and `tl` (the tldraw module).
//
// Shapes created through these helpers carry a stable key: their id is derived from
// it and it is stored in meta.key, so re-running a generator updates shapes in place
// instead of duplicating them, and hand-made moves survive unless asked otherwise.

import ELK from 'elkjs/lib/elk.bundled.js'
import { createShapeId, createBindingId, toRichText, renderPlaintextFromRichText, fitFrameToContent } from 'tldraw'
import { fromTldraw, layoutMissing } from '../lib/tg.mjs'
import { pulse as glow } from './pulses'

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
	const keyOf = (s) => s.meta?.key ?? s.id.replace(/^shape:/, '')
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

	/** Create or update a box. `move: true` repositions an existing one. */
	function node(key, { x = 0, y = 0, w = 180, h = 64, text: label = key, geo = 'rectangle', color = 'black', fill = 'semi', dash = 'draw', size = 's', parent, meta = {}, move = false } = {}) {
		const id = idFor(key)
		// Always explicit: without it tldraw drops new shapes into whatever frame is under them.
		const parentId = parent ? idFor(parent) : editor.getCurrentPageId()
		const existing = editor.getShape(id)
		const props = { geo, w, h, color, fill, dash, size, richText: toRichText(label) }
		if (existing) {
			// Keep shape-level extras added outside this helper (for example GitHub URLs).
			if (existing.props.url) props.url = existing.props.url
			if (existing.props.font) props.font = existing.props.font
			const update = { id, type: 'geo', props, meta: { ...existing.meta, ...meta, key } }
			if (move) Object.assign(update, { x, y })
			editor.updateShape(update)
		} else {
			editor.createShape({ id, type: 'geo', x, y, parentId, props, meta: { ...meta, key } })
		}
		return id
	}

	/** Create or update a frame (a titled container). */
	function frame(key, { x = 0, y = 0, w = 800, h = 600, name = key, color = 'black', meta = {}, move = false } = {}) {
		const id = idFor(key)
		const existing = editor.getShape(id)
		if (existing) {
			const update = { id, type: 'frame', props: { name, color }, meta: { ...existing.meta, ...meta, key } }
			if (move) Object.assign(update, { x, y, props: { name, color, w, h } })
			editor.updateShape(update)
		} else {
			editor.createShape({ id, type: 'frame', x, y, parentId: editor.getCurrentPageId(), props: { w, h, name, color }, meta: { ...meta, key } })
		}
		return id
	}

	/** Create or update an arrow bound to two keyed shapes. */
	function edge(from, to, { text: label = '', color = 'grey', dash = 'solid', size = 's', kind = 'arc', bend = 0, meta = {} } = {}) {
		const a = get(from), b = get(to)
		if (!a || !b) throw new Error(`edge ${from} -> ${to}: missing ${!a ? from : to}`)
		const key = `edge:${from}->${to}`
		const id = idFor(key)
		const props = { color, dash, size, kind, bend, richText: toRichText(label), arrowheadEnd: 'arrow' }
		if (editor.getShape(id)) {
			editor.updateShape({ id, type: 'arrow', props, meta: { ...meta, key, from, to } })
			return id
		}
		const ab = editor.getShapePageBounds(a), bb = editor.getShapePageBounds(b)
		editor.createShape({ id, type: 'arrow', parentId: editor.getCurrentPageId(), x: ab.center.x, y: ab.center.y, props: { ...props, start: { x: 0, y: 0 }, end: { x: bb.center.x - ab.center.x, y: bb.center.y - ab.center.y } }, meta: { ...meta, key, from, to } })
		const bind = (terminal, target) => ({ id: createBindingId(), type: 'arrow', fromId: id, toId: target.id, props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } })
		editor.createBindings([bind('start', a), bind('end', b)])
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
		if (within) editor.updateShape({ id: idFor(within), type: 'frame', props: { w: res.width, h: res.height } })
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
	async function applyGraph(tg, { move = false, prune = false, direction } = {}) {
		editor.markHistoryStoppingPoint('apply graph')
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
				editor.updateShape({ id: existing.id, type: 'arrow', props, meta: { ...existing.meta, ...e.meta, key, from: e.from, to: e.to } })
				out.updated++
			} else {
				edge(e.from, e.to, { text: e.label ?? '', color: st.color ?? 'grey', dash: st.dash ?? 'solid', size: st.size ?? 's', kind: st.route === 'elbow' ? 'elbow' : 'arc', meta: e.meta ?? {} })
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

	/** Make shapes (ids or keys) glow for a moment in this tab, as agent edits do in every tab. */
	function pulse(idsOrKeys) {
		glow([idsOrKeys].flat().map((k) => (String(k).startsWith('shape:') ? k : idFor(k))))
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

	return { engine: 'tldraw', idFor, get, text, summary, node, frame, edge, remove, layout, find, zoomTo, graph, applyGraph, screenshot, pulse, notes, resolveNote, selection, _track }
}
