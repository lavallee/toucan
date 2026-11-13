// Drawing a plan's views on a tldraw canvas (server/plan.mjs sends the graph; lib/plan.mjs made it).
//
// This is not applyGraph, on purpose. A plan redraw happens while people work, many times a day, and what it may do is
// narrow: place shapes carrying meta.plan exactly where the graph says, and nothing else.
//   - No fitting, no reflow: a frame's box is the one the renderer gave it.
//   - A view stays on the page, and inside whatever frame, a person left it: its own frame is never reparented.
//   - What someone is dragging or typing in is left as it is, and the caller is told, so it can come back for it.
//   - Before a managed frame is removed, anything of a person's inside it is moved out to where the frame was.
//   - None of it is a step in this tab's undo: Cmd-Z never undoes what upstream said.

import { toRichText } from 'tldraw'

/** The keys of the shapes this tab's person has hold of right now: being typed in, or selected mid-drag, with all that is inside them. */
export function planBusy(editor, keyOf) {
	const ids = new Set()
	const editing = editor.getEditingShapeId()
	if (editing) ids.add(editing)
	// Any state of the select tool but idle is a gesture on the selection: pointing, translating, resizing, rotating, cropping.
	if (editor.isIn('select') && !editor.isIn('select.idle') && !editor.isIn('select.editing_shape')) for (const id of editor.getSelectedShapeIds()) ids.add(id)
	if (!ids.size) return []
	return [...editor.getShapeAndDescendantIds([...ids])].map((id) => editor.getShape(id)).filter(Boolean).map(keyOf)
}

export function planRender(editor, { idFor, get, keyOf, text, edge }, { tg, remove = [], release = [], rev, reveal = false, skip = [], pages = {}, seen = {} }) {
	const held = new Set([...skip, ...planBusy(editor, keyOf)])
	// A box that isn't where the server last saw it was moved here a moment ago, and the server hasn't heard: it is left alone,
	// like one still being dragged, so the move is read before anything is drawn over it.
	for (const [key, was] of Object.entries(seen)) {
		const s = get(key)
		if (!s || s.rotation) continue
		const at = editor.getShapePageTransform(s).point(), parent = editor.getShape(s.parentId)
		const now = [parent?.type === 'frame' ? keyOf(parent) : '', Math.round(at.x), Math.round(at.y), Math.round(s.props.w ?? 0)].join('|')
		if (now !== was) held.add(key)
	}
	// What is inside a frame someone has hold of goes with it.
	for (const key of [...held]) {
		const s = get(key)
		if (s) for (const id of editor.getShapeAndDescendantIds([s.id])) held.add(keyOf(editor.getShape(id)))
	}
	const skipped = new Set()
	const isHeld = (key, group) => (held.has(key) || (group && held.has(group)) ? (skipped.add(key), true) : false)
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
	const origin = (parentId) => (String(parentId).startsWith('shape:') ? editor.getShapePageTransform(parentId).point() : { x: 0, y: 0 })
	/** Page coordinates as coordinates inside a parent. */
	const within = (parentId, box) => {
		const o = origin(parentId)
		return { x: box.x - o.x, y: box.y - o.y }
	}
	const pageOf = (view) => (pages[view] && editor.getPage(pages[view]) ? pages[view] : editor.getCurrentPageId())
	let created = 0, updated = 0, removed = 0, released = 0
	const out = { pages: {} }

	editor.run(() => {
		const place = (s, parentId, box, props, meta) => {
			if (s.parentId !== parentId) editor.reparentShapes([s.id], parentId)
			const at = within(parentId, box), now = editor.getShape(s.id)
			// A shape someone turned is stood up again: what the plan draws is upright, and its place is read upright.
			const turned = !!now.rotation
			const moved = turned || Math.round(now.x) !== Math.round(at.x) || Math.round(now.y) !== Math.round(at.y)
			const changed = Object.entries(props).filter(([k, v]) => !same(now.props[k], v))
			const metaChanged = Object.entries(meta).some(([k, v]) => !same(now.meta?.[k], v))
			if (!moved && !changed.length && !metaChanged && s.parentId === parentId) return
			editor.updateShape({ id: s.id, type: s.type, ...(moved && at), ...(turned && { rotation: 0 }), props: Object.fromEntries(changed), meta: { ...now.meta, ...meta } })
			updated++
		}
		// Frames, the view's own first.
		for (const g of [...tg.groups].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0))) {
			if (isHeld(g.key, g.parent)) continue
			const s = get(g.key)
			const props = { w: g.box.w, h: g.box.h, name: g.label ?? '' }
			const meta = { plan: g.meta.plan, key: g.key }
			// The view's own frame stays where a person put it: on its page, in their frame. Its columns and lanes belong inside it.
			const parentId = g.parent ? get(g.parent)?.id ?? s?.parentId ?? pageOf(g.meta.plan.view) : s?.parentId ?? pageOf(g.meta.plan.view)
			if (s?.type === 'frame') place(s, parentId, g.box, props, meta)
			else if (!s) {
				editor.createShape({ id: idFor(g.key), type: 'frame', parentId, ...within(parentId, g.box), props: { ...props, color: 'black' }, meta })
				created++
			}
			if (!g.parent) out.pages[g.meta.plan.view] = editor.getAncestorPageId(get(g.key))
		}
		// Boxes.
		for (const n of tg.nodes) {
			if (isHeld(n.key, n.group)) continue
			const s = get(n.key)
			const parentId = (n.group && get(n.group)?.id) ?? s?.parentId ?? pageOf(n.meta.plan.view)
			const st = n.style ?? {}
			const meta = { plan: n.meta.plan, ...(n.meta.detail !== undefined && { detail: n.meta.detail }), key: n.key }
			// A title standing beside its bar starts at the bar, rather than floating in the middle of the room left for it.
			const props = { geo: st.geo ?? 'rectangle', w: n.box.w, h: n.box.h, growY: 0, color: st.color ?? 'black', fill: st.fill ?? 'semi', dash: st.dash ?? 'solid', size: st.size ?? 's', scale: 1, align: n.meta.plan.label ? 'start' : 'middle' }
			if (s?.type === 'geo') {
				// Text is compared as text: the same words are the same, however the editor stores them.
				if (text(s) !== (n.text ?? '')) props.richText = toRichText(n.text ?? '')
				else delete props.richText
				place(s, parentId, n.box, props, meta)
			} else if (s) place(s, parentId, n.box, {}, meta) // a shape of another sort that became an item's card: only where it is, and whose it is
			else {
				editor.createShape({ id: idFor(n.key), type: 'geo', parentId, ...within(parentId, n.box), props: { ...props, richText: toRichText(n.text ?? '') }, meta })
				created++
			}
		}
		// Arrows the view draws (dependencies): made once, then left to follow their boxes.
		for (const e of tg.edges) {
			const key = `edge:${e.from}->${e.to}`
			if (get(key) || !get(e.from) || !get(e.to)) continue
			const st = e.style ?? {}
			edge(e.from, e.to, { text: e.label ?? '', color: st.color ?? 'grey', dash: st.dash ?? 'solid', size: st.size ?? 's', kind: st.route === 'elbow' ? 'elbow' : 'arc', bend: st.bend ?? 0, elbowMid: st.elbowMid, head: st.head, anchors: st.anchors, meta: e.meta ?? {} })
			created++
		}

		// What the views no longer draw. Only shapes that carry meta.plan go, and nothing someone has hold of.
		const managed = (key) => {
			const s = get(key)
			return s?.meta?.plan && !held.has(key) ? s : null
		}
		const gone = remove.map(managed).filter(Boolean)
		const goneIds = new Set(gone.map((s) => s.id))
		// tldraw deletes what is inside a frame with the frame. A note, a box or an arrow a person put there is theirs: it moves out
		// to the nearest frame that stays (or the page), exactly where it was on the page.
		for (const frame of gone.filter((s) => s.type === 'frame')) {
			let target = frame.parentId
			while (goneIds.has(target)) target = editor.getShape(target).parentId
			const theirs = editor.getSortedChildIdsForParent(frame.id).filter((id) => !goneIds.has(id) && !editor.getShape(id)?.meta?.plan)
			if (theirs.length) editor.reparentShapes(theirs, target)
			// (A managed shape still inside that isn't in the list is one someone has hold of: it moves out too, rather than go with the frame.)
			const kept = editor.getSortedChildIdsForParent(frame.id).filter((id) => !goneIds.has(id))
			if (kept.length) editor.reparentShapes(kept, target)
		}
		editor.deleteShapes([...goneIds])
		removed = gone.length
		const freed = release.map(managed).filter(Boolean)
		editor.updateShapes(freed.map((s) => ({ id: s.id, type: s.type, meta: { ...s.meta, plan: null } })))
		released = freed.length
		// Last, so that once the server sees this number, it has seen everything above. One frame carries it.
		const marker = tg.groups.map((g) => get(g.key)).find(Boolean)
		if (marker) editor.updateShape({ id: marker.id, type: marker.type, meta: { ...marker.meta, planRev: rev } })
	}, { history: 'ignore', ignoreShapeLock: true })

	return { created, updated, removed, released, skipped: [...skipped], pages: out.pages, _quiet: !reveal }
}
