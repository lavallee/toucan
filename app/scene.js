// The canvas as the tidying routines and the diagram check see it, the same on either engine: every shape as an item in page
// coordinates, every arrow with what it's bound to and how it runs, and a few ways to change them. app/tidy.js and app/measure.js
// are written against this, so `toucan.tidy` and `toucan.measure()` behave alike on tldraw and Excalidraw.
//
// An item:  { id, key, kind, type, x, y, w, h, maxX, maxY, parent, frame, geo, text, color, dash, size, fontSize, grown, meta }
//   kind     box (a tldraw geo shape; an Excalidraw rectangle, ellipse or diamond), frame, text (free text), note (tldraw only),
//            arrow, or other (lines, drawings, images…)
//   local    its x, y, w and h in its parent's coordinates, as the engine stores them
//   parent   the shape it sits in (a frame, or a tldraw group), or null on the page; frame: the nearest frame round it, or null
//   geo      rectangle, ellipse, diamond, cloud…; color: a tldraw colour name; dash: draw solid dashed dotted none
//   size     s m l xl; fontSize: its text's size in px; grown: how far its text runs past the box drawn for it (tldraw's growY,
//            which is part of h there; on Excalidraw the text spills instead); base: the box's height before its text grew it
// An arrow: { id, key, from, to, kind: 'arc' | 'elbow', bend, elbowMid, anchors: { from, to }, text }
//   from/to  the ids it's bound to (or null); bend 0 is straight; anchors are {x, y} in 0..1 across the box, or null for
//            "aim at the middle"
//
// Changes, in page coordinates:
//   place(id, {x, y, w, h}, {carry, local})   position and size; a frame's contents stay where they are on the page unless
//                                      `carry`; with `local`, x and y are in the parent's coordinates (item.local)
//   restyle(id, {color, size, text, meta})          meta is merged into what's there
//   setArrow(id, {kind, bend, elbowMid, anchors, labelAt})   only what's given changes; labelAt (0..1 along it) is tldraw's
//                                      alone: Excalidraw puts a label at the middle (limits.labelAt)
//   moveEnds(id, map)                  an arrow's unbound ends go where map(point) says (its bound ends follow their shapes)
//   saveArrow(id) / restoreArrow(id, saved)          to try routes and put one back
//   batch(fn), fit()
//
// tldraw writes at once, and the exec relay makes one run one undo step. Excalidraw keeps changes in a working copy until the
// outermost batch ends (the exec relay holds one open for the whole run), then makes them in one updateScene, so a run is one
// undo step there too. On Excalidraw, moving a box moves its label with it and redraws the arrows bound to it.

import { COLORS, colorName } from '../lib/tg.mjs'
import { GAP, endAt as endOn, outline as outlineOf, routePath } from '../lib/route.mjs'

const FONT = { s: 18, m: 22, l: 26, xl: 32 } // tldraw's label sizes
const withEdges = (b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, maxX: b.x + b.w, maxY: b.y + b.h })

// ---- tldraw -------------------------------------------------------------------------------------------------------------

// `text` and `toRichText` come from the tldraw helpers, so this file doesn't bring tldraw into an Excalidraw canvas.
export function tldrawScene(editor, { keyOf, text: textOf, toRichText }) {
	const KIND = { geo: 'box', frame: 'frame', text: 'text', note: 'note', arrow: 'arrow' }
	const pageBox = (s) => {
		const b = editor.getShapePageBounds(s)
		return b ? withEdges(b) : { x: s.x, y: s.y, w: 0, h: 0, maxX: s.x, maxY: s.y }
	}
	// A geo shape's or a frame's own size, exactly as stored (page bounds go through a transform, and pick up rounding).
	const localOf = (s) => (s.type === 'geo' || s.type === 'frame' ? { x: s.x, y: s.y, w: s.props.w, h: s.props.h + (s.props.growY ?? 0) } : { x: s.x, y: s.y, ...(({ w, h }) => ({ w, h }))(pageBox(s)) })
	const itemOf = (s) => {
		const item = {
			id: s.id, type: s.type, kind: KIND[s.type] ?? 'other', ...pageBox(s),
			parent: s.parentId.startsWith('shape:') ? s.parentId : null, local: localOf(s),
			geo: s.props.geo ?? (s.type === 'note' ? 'note' : undefined), color: s.props.color, dash: s.props.dash, size: s.props.size,
			fontSize: FONT[s.props.size], grown: s.props.growY ?? 0, base: s.props.h, meta: s.meta ?? {},
		}
		// Text and keys are read only when asked for: the tidying passes look at positions many times over.
		Object.defineProperties(item, {
			key: { get: () => keyOf(s), enumerable: true },
			text: { get: () => textOf(s), enumerable: true },
			frame: { get: () => editor.getShapeAncestors(s).findLast((a) => a.type === 'frame')?.id ?? null, enumerable: true },
		})
		return item
	}
	const ends = (a) => {
		const bindings = editor.getBindingsFromShape(a, 'arrow')
		const at = (terminal) => bindings.find((b) => b.props.terminal === terminal)
		return { start: at('start'), end: at('end') }
	}
	const anchorOf = (b) => (b?.props.isPrecise ? { ...b.props.normalizedAnchor } : null)

	const scene = {
		engine: 'tldraw',
		items: () => editor.getCurrentPageShapes().map(itemOf),
		get: (id) => {
			const s = editor.getShape(id)
			return s ? itemOf(s) : null
		},
		children: (id) => editor.getSortedChildIdsForParent(id).map((c) => editor.getShape(c)).filter(Boolean).map(itemOf),
		/** Ids of the shapes round this one, from the page down. */
		ancestors: (id) => editor.getShapeAncestors(id).map((a) => a.id),
		/** Where a parent's own coordinates start on the page (the page's are 0, 0). */
		origin: (id) => (id ? editor.getShapePageTransform(id).applyToPoint({ x: 0, y: 0 }) : { x: 0, y: 0 }),
		arrows: () =>
			editor.getCurrentPageShapes().filter((s) => s.type === 'arrow').map((a) => {
				const { start, end } = ends(a)
				return {
					id: a.id, key: keyOf(a), from: start?.toId ?? null, to: end?.toId ?? null,
					kind: a.props.kind === 'elbow' ? 'elbow' : 'arc', bend: a.props.bend ?? 0, elbowMid: a.props.elbowMidPoint ?? 0.5,
					anchors: { from: anchorOf(start), to: anchorOf(end) }, text: textOf(a),
				}
			}),
		/** The arrow as drawn: a polyline in page coordinates. */
		arrowPath: (id) => {
			const a = editor.getShape(id)
			return editor.getShapePageTransform(a).applyToPoints(editor.getShapeGeometry(a).vertices)
		},
		arrowLabelBox: (id) => {
			const a = editor.getShape(id)
			const label = editor.getShapeGeometry(a).children?.find((c) => c.isLabel)
			if (!label) return null
			const pts = editor.getShapePageTransform(a).applyToPoints(label.vertices)
			const x = Math.min(...pts.map((p) => p.x)), y = Math.min(...pts.map((p) => p.y))
			return withEdges({ x, y, w: Math.max(...pts.map((p) => p.x)) - x, h: Math.max(...pts.map((p) => p.y)) - y })
		},
		bounds: () => {
			const b = editor.getCurrentPageBounds()
			return b ? withEdges(b) : null
		},
		viewport: () => {
			const v = editor.getViewportScreenBounds()
			return { w: v.w, h: v.h }
		},

		place(id, box, { carry = false, local = false } = {}) {
			const s = editor.getShape(id)
			if (!s) return
			const was = pageBox(s)
			// Given in the parent's coordinates, the position is used as it is, so a tidy number stays tidy.
			const to = (k) => (box[k] === undefined ? s[k] : local ? box[k] : s[k] + box[k] - was[k])
			const nx = to('x'), ny = to('y'), dx = nx - s.x, dy = ny - s.y
			const props = {}
			if ((s.type === 'geo' || s.type === 'frame') && box.w !== undefined) props.w = box.w
			if ((s.type === 'geo' || s.type === 'frame') && box.h !== undefined) props.h = box.h
			if (s.type === 'geo' && box.h !== undefined) props.growY = 0
			const updates = [{ id: s.id, type: s.type, x: nx, y: ny, ...(Object.keys(props).length && { props }) }]
			// A shape's position is relative to its parent, so what's inside a frame moves with it unless moved back.
			if (!carry && (dx || dy)) for (const c of editor.getSortedChildIdsForParent(s.id).map((c) => editor.getShape(c))) updates.push({ id: c.id, type: c.type, x: c.x - dx, y: c.y - dy })
			editor.updateShapes(updates)
		},
		restyle(id, { color, size, text, meta } = {}) {
			const s = editor.getShape(id)
			if (!s) return
			const props = {}
			if (color !== undefined && 'color' in s.props) props.color = color
			if (size !== undefined && 'size' in s.props) props.size = size
			if (text !== undefined && 'richText' in s.props) props.richText = toRichText(text)
			editor.updateShape({ id: s.id, type: s.type, ...(Object.keys(props).length && { props }), ...(meta && { meta: { ...s.meta, ...meta } }) })
		},
		setArrow(id, { kind, bend, elbowMid, anchors, labelAt } = {}) {
			const a = editor.getShape(id)
			if (!a) return
			const props = {}
			if (kind !== undefined) props.kind = kind
			if (bend !== undefined) props.bend = bend
			if (elbowMid !== undefined) props.elbowMidPoint = elbowMid
			if (labelAt !== undefined) props.labelPosition = labelAt
			if (Object.keys(props).length) editor.updateShape({ id, type: 'arrow', props })
			if (!anchors) return
			const { start, end } = ends(a)
			const set = (b, at) => (b && at !== undefined ? [{ id: b.id, type: 'arrow', props: { ...b.props, ...(at ? { normalizedAnchor: at, isPrecise: true, isExact: false } : { normalizedAnchor: { x: 0.5, y: 0.5 }, isPrecise: false }) } }] : [])
			const updates = [...set(start, anchors.from), ...set(end, anchors.to)]
			if (updates.length) editor.updateBindings(updates)
		},
		moveEnds(id, map) {
			const a = editor.getShape(id)
			if (!a) return
			const t = editor.getShapePageTransform(a)
			const bound = editor.getBindingsFromShape(a, 'arrow').map((b) => b.props.terminal)
			const origin = map(t.applyToPoint({ x: 0, y: 0 }))
			const p = scene.origin(a.parentId.startsWith('shape:') ? a.parentId : null)
			const props = {}
			for (const end of ['start', 'end']) {
				if (bound.includes(end)) continue
				const at = map(t.applyToPoint(a.props[end]))
				props[end] = { x: at.x - origin.x, y: at.y - origin.y }
			}
			editor.updateShape({ id, type: 'arrow', x: origin.x - p.x, y: origin.y - p.y, ...(Object.keys(props).length && { props }) })
		},
		saveArrow: (id) => {
			const a = editor.getShape(id)
			const { kind, bend, elbowMidPoint, labelPosition } = a.props
			// Where its ends are anchored too: trying routes can move them to other sides.
			return { kind, bend, elbowMidPoint, labelPosition, ends: editor.getBindingsFromShape(a, 'arrow').map((b) => ({ id: b.id, props: { ...b.props } })) }
		},
		restoreArrow: (id, saved) => {
			const { ends, ...props } = saved
			editor.updateShape({ id, type: 'arrow', props })
			const now = new Map(editor.getBindingsFromShape(id, 'arrow').map((b) => [b.id, b]))
			const back = (ends ?? []).filter((b) => now.has(b.id) && JSON.stringify(now.get(b.id).props) !== JSON.stringify(b.props))
			if (back.length) editor.updateBindings(back.map((b) => ({ id: b.id, type: 'arrow', props: b.props })))
		},
		/** A point to come back to within a run: rollback(mark) undoes what was changed since, and nothing is left to undo. */
		checkpoint: () => editor.markHistoryStoppingPoint('checkpoint'),
		rollback: (mark) => editor.bailToMark(mark),
		batch: (fn) => fn(),
		fit: () => editor.zoomToFit({ animation: { duration: 250 } }),
		/** What this engine can't do, for a routine to say in its summary; nothing on tldraw. */
		limits: {},
	}
	return scene
}

// ---- Excalidraw ---------------------------------------------------------------------------------------------------------

const EX_SIZES = { s: 16, m: 20, l: 28, xl: 36 } // Excalidraw's own font sizes
const PAD = 5 // Excalidraw's BOUND_TEXT_PADDING

export function excalidrawScene(api, ex) {
	// The engine's own read, kept before the helpers wrap it to land pending changes first (a read in the middle of a batch
	// would land them early). Writes go through whatever updateScene is now: by then nothing is pending.
	const read = api.getSceneElementsIncludingDeleted

	let work = null // id → element: the working copy while a batch has changes
	let depth = 0, fitAfter = false
	const routes = new Map() // arrow id → how it runs, from when the working copy was taken
	const touched = new Set() // arrows redrawn, whose route is saved on them at commit

	const all = () => (work ? [...work.values()] : read())
	const live = () => all().filter((e) => !e.isDeleted)
	const byId = (id) => (work ? work.get(id) : read().find((e) => e.id === id))
	const element = (id) => {
		const e = byId(id)
		return e && !e.isDeleted ? e : null
	}
	const labelOf = (e) => {
		const id = (e?.boundElements ?? []).find((b) => b.type === 'text')?.id
		const t = id && element(id)
		return t?.type === 'text' ? t : null
	}
	const isLabel = (e) => e.type === 'text' && e.containerId && element(e.containerId)
	const KIND = { rectangle: 'box', ellipse: 'box', diamond: 'box', frame: 'frame', magicframe: 'frame', text: 'text', arrow: 'arrow' }
	const boxOf = (e) => {
		if (e.type === 'arrow' || e.type === 'line' || e.type === 'freedraw') {
			const xs = e.points.map((p) => e.x + p[0]), ys = e.points.map((p) => e.y + p[1])
			const x = Math.min(...xs), y = Math.min(...ys)
			return withEdges({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y })
		}
		return withEdges({ x: Math.min(e.x, e.x + e.width), y: Math.min(e.y, e.y + e.height), w: Math.abs(e.width), h: Math.abs(e.height) })
	}
	// The room a container gives its label (Excalidraw's getBoundTextMaxWidth and getBoundTextMaxHeight).
	const room = (c) =>
		c.type === 'ellipse' ? { w: Math.round((c.width / 2) * Math.SQRT2) - PAD * 2, h: Math.round((c.height / 2) * Math.SQRT2) - PAD * 2 }
		: c.type === 'diamond' ? { w: Math.round(c.width / 2) - PAD * 2, h: Math.round(c.height / 2) - PAD * 2 }
		: { w: c.width - PAD * 2, h: c.height - PAD * 2 }
	// …and where it puts it (computeBoundTextPosition).
	const labelAt = (c, t) => {
		const off = c.type === 'ellipse' ? { x: PAD + (c.width / 2) * (1 - Math.SQRT1_2), y: PAD + (c.height / 2) * (1 - Math.SQRT1_2) } : c.type === 'diamond' ? { x: PAD + c.width / 4, y: PAD + c.height / 4 } : { x: PAD, y: PAD }
		const r = room(c)
		const x = t.textAlign === 'left' ? c.x + off.x : t.textAlign === 'right' ? c.x + off.x + r.w - t.width : c.x + off.x + r.w / 2 - t.width / 2
		const y = t.verticalAlign === 'top' ? c.y + off.y : t.verticalAlign === 'bottom' ? c.y + off.y + r.h - t.height : c.y + off.y + r.h / 2 - t.height / 2
		return { x, y }
	}
	const sizeName = (px) => (px <= 16 ? 's' : px <= 22 ? 'm' : px <= 30 ? 'l' : 'xl')
	const dashOf = (e) => (e.strokeColor === 'transparent' ? 'none' : e.strokeStyle === 'solid' ? 'solid' : e.strokeStyle)
	const textOf = (e) => (e.type === 'text' ? e.originalText ?? e.text : e.type === 'frame' || e.type === 'magicframe' ? e.name ?? '' : labelOf(e)?.originalText ?? '')

	const itemOf = (e) => {
		const label = labelOf(e)
		const font = label?.fontSize ?? (e.type === 'text' ? e.fontSize : undefined)
		const frame = e.frameId && element(e.frameId) ? e.frameId : null
		const item = {
			id: e.id, type: e.type, kind: KIND[e.type] ?? 'other', ...boxOf(e), parent: frame, frame,
			local: { x: boxOf(e).x - (frame ? element(frame).x : 0), y: boxOf(e).y - (frame ? element(frame).y : 0), w: boxOf(e).w, h: boxOf(e).h },
			geo: e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond' ? e.type : undefined,
			color: colorName(e.strokeColor), dash: dashOf(e), size: font ? sizeName(font) : undefined, fontSize: font,
			grown: label && KIND[e.type] === 'box' ? Math.max(0, label.height - room(e).h) : 0, base: Math.abs(e.height), meta: e.customData?.meta ?? {},
		}
		Object.defineProperties(item, {
			key: { get: () => keyOf(e), enumerable: true },
			text: { get: () => textOf(e), enumerable: true },
		})
		return item
	}
	const items = () => live().filter((e) => !isLabel(e)).map(itemOf)
	// A duplicated element keeps its original's customData.key, and the key belongs to the first (as in the helpers' keyOf, but
	// read from the working copy: the helpers' reads would land what's pending).
	const keyOf = (e) => {
		const key = e.customData?.key
		return key && live().find((o) => o.customData?.key === key && !isLabel(o))?.id === e.id ? key : e.id
	}

	// ---- arrows: how one runs, and drawing it again from that ----------------------------------------------------------
	const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
	// The geometry is shared with the layouts (lib/route.mjs), so a route chosen before drawing is the route drawn here.
	const shapeOf = (e) => ({ ...boxOf(e), geo: e.type })
	const outline = (e, to, gap = GAP) => outlineOf(shapeOf(e), to, gap)
	const endAt = (e, at, toward) => endOn(shapeOf(e), at, toward)
	const pointsOf = (a) => a.points.map(([x, y]) => ({ x: a.x + x, y: a.y + y }))
	const perp = (p0, p1, m) => {
		const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy) || 1
		return ((m.x - (p0.x + p1.x) / 2) * -dy + (m.y - (p0.y + p1.y) / 2) * dx) / len
	}

	/** How an arrow runs now: read from what's drawn, and from the route saved on it when that still matches. */
	function routeOf(a) {
		const pts = pointsOf(a)
		const from = a.startBinding && element(a.startBinding.elementId), to = a.endBinding && element(a.endBinding.elementId)
		const first = pts[0], last = pts.at(-1)
		const kind = a.elbowed ? 'elbow' : 'arc'
		const free = !a.elbowed && pts.length > 3 ? pts.slice(1, -1) : null // a person's own waypoints
		const bend = a.elbowed || pts.length < 3 ? 0 : pts.length === 3 ? perp(first, last, pts[1]) : perp(first, last, pts.reduce((m, p) => (Math.abs(perp(first, last, p)) > Math.abs(perp(first, last, m)) ? p : m), pts[1]))
		const saved = a.customData?.route
		const guess = (e, p, other) => {
			if (!e) return null
			const fixed = a.elbowed && (e === from ? a.startBinding : a.endBinding)?.fixedPoint
			if (fixed) return { x: Math.min(1, Math.max(0, Math.round(fixed[0] * 100) / 100)), y: Math.min(1, Math.max(0, Math.round(fixed[1] * 100) / 100)) }
			// Aimed at the middle, whether drawn with our gap or touching the box (as applyGraph and Excalidraw itself draw them).
			const target = other ? centre(boxOf(other)) : p
			if ([GAP, 0].some((gap) => { const aim = outline(e, target, gap); return Math.hypot(aim.x - p.x, aim.y - p.y) < 3 })) return null
			const b = boxOf(e)
			const nx = (p.x - b.x) / (b.w || 1), ny = (p.y - b.y) / (b.h || 1)
			const clamp = (v) => Math.min(1, Math.max(0, v))
			// Just outside an edge is on that edge.
			const dist = { l: Math.abs(nx * b.w), r: Math.abs((1 - nx) * b.w), t: Math.abs(ny * b.h), b: Math.abs((1 - ny) * b.h) }
			const side = Object.entries(dist).sort((p, q) => p[1] - q[1])[0][0]
			return side === 'l' ? { x: 0, y: clamp(ny) } : side === 'r' ? { x: 1, y: clamp(ny) } : side === 't' ? { x: clamp(nx), y: 0 } : { x: clamp(nx), y: 1 }
		}
		const route = { kind, bend, elbowMid: 0.5, free, anchors: { from: guess(from, first, to), to: guess(to, last, from) } }
		if (saved && from && to) {
			// What was saved still holds if drawing from it puts the ends where they are.
			const trial = draw(a, { ...route, anchors: saved.anchors ?? route.anchors, elbowMid: saved.elbowMid ?? 0.5 })
			const p = trial && pointsOf(trial)
			if (p && Math.hypot(p[0].x - first.x, p[0].y - first.y) < 3 && Math.hypot(p.at(-1).x - last.x, p.at(-1).y - last.y) < 3) Object.assign(route, { anchors: saved.anchors, elbowMid: saved.elbowMid ?? 0.5 })
		}
		return route
	}

	/** The arrow element drawn from a route between its two bound boxes, or null if it isn't bound at both ends. */
	function draw(a, route) {
		const from = a.startBinding && element(a.startBinding.elementId), to = a.endBinding && element(a.endBinding.elementId)
		if (!from || !to) return null
		const fixed = {}
		const drawn = routePath(shapeOf(from), shapeOf(to), route)
		const pts = drawn.points
		if (route.kind === 'elbow') {
			const [at0, at1] = drawn.at
			// Excalidraw keeps an elbow's ends as a fraction across each box (0.5 nudged off the middle, as it does itself).
			const nudge = (v) => (Math.abs(v - 0.5) < 0.0001 ? 0.5001 : v)
			Object.assign(fixed, { start: [nudge(at0.x), nudge(at0.y)], end: [nudge(at1.x), nudge(at1.y)] })
		}
		const o = pts[0]
		const rel = pts.map((p) => [p.x - o.x, p.y - o.y])
		const xs = rel.map((p) => p[0]), ys = rel.map((p) => p[1])
		const binding = (b, f) => {
			const { fixedPoint, ...rest } = b
			return route.kind === 'elbow' ? { ...rest, focus: 0, fixedPoint: f } : { ...rest }
		}
		return {
			...a, x: o.x, y: o.y, points: rel, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
			elbowed: route.kind === 'elbow', roundness: route.kind === 'elbow' ? null : route.bend || route.free ? { type: 2 } : a.roundness ?? { type: 2 },
			startBinding: binding(a.startBinding, fixed.start), endBinding: binding(a.endBinding, fixed.end),
			...(route.kind === 'elbow' ? { fixedSegments: null, startIsSpecial: null, endIsSpecial: null } : {}),
		}
	}

	/** Where Excalidraw puts an arrow's label: the middle point, or the middle of the middle segment. */
	const middleOf = (pts) => {
		if (pts.length % 2) return pts[(pts.length - 1) / 2]
		const a = pts[pts.length / 2 - 1], b = pts[pts.length / 2]
		return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
	}
	/** The path as Excalidraw draws it: a curve through three points with rounded corners is sampled. */
	const pathOf = (a) => {
		const pts = pointsOf(a)
		if (a.elbowed || !a.roundness || pts.length !== 3) return pts
		const [p0, m, p1] = pts
		const c = { x: 2 * m.x - (p0.x + p1.x) / 2, y: 2 * m.y - (p0.y + p1.y) / 2 }
		return Array.from({ length: 17 }, (_, i) => {
			const t = i / 16, u = 1 - t
			return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y }
		})
	}

	// ---- the working copy ----------------------------------------------------------------------------------------------
	function open() {
		if (work) return
		work = new Map(read().map((e) => [e.id, e]))
		// Read every arrow's route before anything moves: afterwards its ends no longer say where it was anchored.
		for (const a of work.values()) if (a.type === 'arrow' && !a.isDeleted) routes.set(a.id, routeOf(a))
	}
	const put = (e, patch) => {
		open()
		const next = ex.newElementWith(work.get(e.id), patch)
		work.set(e.id, next)
		return next
	}
	function redrawArrow(id) {
		const a = element(id)
		const route = routes.get(id)
		if (!a || !route) return
		const drawn = draw(a, route)
		if (!drawn) return
		const { x, y, points, width, height, elbowed, roundness, startBinding, endBinding } = drawn
		const next = put(a, { x, y, points, width, height, elbowed, roundness, startBinding, endBinding, ...(elbowed ? { fixedSegments: null, startIsSpecial: null, endIsSpecial: null } : {}) })
		touched.add(id)
		const label = labelOf(next)
		if (label) {
			const m = middleOf(pointsOf(next))
			put(label, { x: m.x - label.width / 2, y: m.y - label.height / 2 })
		}
	}
	const arrowsOn = (ids) => live().filter((a) => a.type === 'arrow' && (ids.has(a.startBinding?.elementId) || ids.has(a.endBinding?.elementId))).map((a) => a.id)
	/** A container's label after the container changed: moved with it, or wrapped again and centred if its size or text did. */
	function fitLabel(c, { rewrap = false, text, fontSize } = {}) {
		const label = labelOf(c)
		if (!label) return
		if (!rewrap) return void put(label, labelAt(element(c.id), label))
		const draft = { ...label, ...(text !== undefined && { originalText: text, text }), ...(fontSize && { fontSize }) }
		const [, measured] = ex.restoreElements([element(c.id), draft], null, { refreshDimensions: true, repairBindings: true })
		const dims = { text: measured.text, width: measured.width, height: measured.height }
		// Text taller than its box grows the box, as Excalidraw does when someone types.
		const container = element(c.id)
		const need = dims.height - room(container).h
		if (need > 0.5) put(container, { height: container.height + need, y: container.y - need / 2 })
		put(label, { ...(text !== undefined && { originalText: text }), ...(fontSize && { fontSize }), ...dims, ...labelAt(element(c.id), { ...label, ...dims }) })
	}
	function moveElement(e, dx, dy) {
		if (!dx && !dy) return
		if (e.type === 'arrow' && (e.startBinding || e.endBinding)) return // redrawn from what it's bound to
		put(e, { x: e.x + dx, y: e.y + dy })
		const label = labelOf(e)
		if (label) put(label, { x: label.x + dx, y: label.y + dy })
	}

	function commit() {
		if (!work) return
		for (const id of touched) {
			const a = element(id), r = routes.get(id)
			if (a && r) put(a, { customData: { ...a.customData, route: { anchors: r.anchors, ...(r.kind === 'elbow' && { elbowMid: r.elbowMid }) } } })
		}
		const elements = [...work.values()]
		const changed = elements.some((e) => e !== read().find((o) => o.id === e.id))
		work = null
		routes.clear()
		touched.clear()
		if (changed) api.updateScene({ elements, captureUpdate: ex.CaptureUpdateAction.IMMEDIATELY })
		if (fitAfter) {
			fitAfter = false
			api.scrollToContent(undefined, { fitToContent: true, animate: true })
		}
	}

	const scene = {
		engine: 'excalidraw',
		items,
		get: (id) => {
			const e = element(id)
			return e && !isLabel(e) ? itemOf(e) : null
		},
		children: (id) => live().filter((e) => e.frameId === id && !isLabel(e)).map(itemOf),
		ancestors: (id) => {
			const f = element(id)?.frameId
			return f && element(f) ? [f] : []
		},
		origin: (id) => {
			const e = id && element(id)
			return e ? { x: e.x, y: e.y } : { x: 0, y: 0 }
		},
		arrows: () =>
			live().filter((a) => a.type === 'arrow').map((a) => {
				const r = routes.get(a.id) ?? routeOf(a)
				const at = (b) => (b && element(b.elementId) ? b.elementId : null)
				return { id: a.id, key: keyOf(a), from: at(a.startBinding), to: at(a.endBinding), kind: r.kind, bend: r.bend, elbowMid: r.elbowMid, anchors: r.anchors, text: labelOf(a)?.originalText ?? '' }
			}),
		arrowPath: (id) => pathOf(element(id)),
		arrowLabelBox: (id) => {
			const l = labelOf(element(id))
			return l ? boxOf(l) : null
		},
		bounds: () => {
			const els = live()
			if (!els.length) return null
			const boxes = els.map(boxOf)
			const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y))
			return withEdges({ x, y, w: Math.max(...boxes.map((b) => b.maxX)) - x, h: Math.max(...boxes.map((b) => b.maxY)) - y })
		},
		viewport: () => {
			const s = api.getAppState()
			return { w: s.width, h: s.height }
		},

		place(id, box, { carry = false, local = false } = {}) {
			if (local) {
				const o = scene.origin(element(id)?.frameId)
				box = { ...box, ...(box.x !== undefined && { x: box.x + o.x }), ...(box.y !== undefined && { y: box.y + o.y }) }
			}
			scene.batch(() => {
				const e = element(id)
				if (!e || isLabel(e)) return
				const was = boxOf(e)
				const dx = box.x === undefined ? 0 : box.x - was.x, dy = box.y === undefined ? 0 : box.y - was.y
				const resized = (box.w !== undefined && Math.abs(box.w - was.w) > 0.01) || (box.h !== undefined && Math.abs(box.h - was.h) > 0.01)
				if (e.type === 'arrow') return void moveElement(e, dx, dy)
				if (!dx && !dy && !resized) return
				const moved = new Set([e.id])
				put(e, { x: e.x + dx, y: e.y + dy, ...(box.w !== undefined && { width: box.w }), ...(box.h !== undefined && { height: box.h }) })
				if (resized) fitLabel(e, { rewrap: true })
				else fitLabel(e)
				// Excalidraw's frames don't carry what's in them: move it along when asked to.
				if (carry && (e.type === 'frame' || e.type === 'magicframe')) {
					for (const c of live().filter((c) => c.frameId === e.id && !isLabel(c))) {
						moveElement(c, dx, dy)
						moved.add(c.id)
					}
				}
				for (const a of arrowsOn(moved)) redrawArrow(a)
			})
		},
		restyle(id, { color, size, text, meta } = {}) {
			scene.batch(() => {
				const e = element(id)
				if (!e) return
				const patch = {}
				if (color !== undefined && COLORS[color]) {
					const hex = COLORS[color], old = e.strokeColor
					// A box is outlined in its colour and filled with it, solid or faint; its label is the colour too unless it's white.
					if (e.strokeColor !== 'transparent') patch.strokeColor = hex
					if (e.type !== 'arrow' && e.type !== 'text' && e.backgroundColor && e.backgroundColor !== 'transparent') patch.backgroundColor = e.backgroundColor.length === 9 ? hex + e.backgroundColor.slice(7) : hex
					if (e.type === 'text') patch.strokeColor = hex
					const label = labelOf(e)
					if (label && label.strokeColor.toLowerCase() === old.toLowerCase()) put(label, { strokeColor: hex })
				}
				if (meta) patch.customData = { ...e.customData, meta: { ...e.customData?.meta, ...meta } }
				if (Object.keys(patch).length) put(e, patch)
				const px = size !== undefined ? EX_SIZES[size] : undefined
				if (e.type === 'text') {
					if (px || text !== undefined) {
						const draft = { ...element(e.id), ...(px && { fontSize: px }), ...(text !== undefined && { originalText: text, text }) }
						const [measured] = ex.restoreElements([draft], null, { refreshDimensions: true })
						put(e, { ...(px && { fontSize: px }), ...(text !== undefined && { originalText: text }), text: measured.text, width: measured.width, height: measured.height })
					}
				} else if (px || text !== undefined) fitLabel(element(e.id), { rewrap: true, text, fontSize: px })
				if (e.type !== 'arrow') for (const a of arrowsOn(new Set([e.id]))) redrawArrow(a)
			})
		},
		setArrow(id, { kind, bend, elbowMid, anchors } = {}) {
			scene.batch(() => {
				const a = element(id)
				if (!a) return
				open()
				const r = routes.get(id) ?? routeOf(a)
				const next = {
					...r,
					...(kind !== undefined && { kind }), ...(bend !== undefined && { bend }), ...(elbowMid !== undefined && { elbowMid }),
					...(anchors && { anchors: { from: anchors.from === undefined ? r.anchors.from : anchors.from, to: anchors.to === undefined ? r.anchors.to : anchors.to } }),
				}
				// A route given anew replaces a person's waypoints.
				if (kind !== undefined || bend !== undefined) next.free = null
				routes.set(id, next)
				redrawArrow(id)
			})
		},
		moveEnds(id, map) {
			scene.batch(() => {
				const a = element(id)
				if (!a || a.type !== 'arrow') return
				const pts = pointsOf(a)
				const bound = { 0: a.startBinding && element(a.startBinding.elementId), [pts.length - 1]: a.endBinding && element(a.endBinding.elementId) }
				if (bound[0] && bound[pts.length - 1]) return redrawArrow(id)
				const next = pts.map((p, i) => (bound[i] ? p : map(p)))
				const o = next[0]
				put(a, { x: o.x, y: o.y, points: next.map((p) => [p.x - o.x, p.y - o.y]) })
				if (bound[0] || bound[pts.length - 1]) redrawArrow(id)
			})
		},
		saveArrow: (id) => {
			open()
			const a = element(id)
			const ends = [a?.startBinding, a?.endBinding].map((b) => (b && element(b.elementId) ? boxOf(element(b.elementId)) : null))
			return { element: a, route: routes.get(id), ends }
		},
		/** Back as it was: the very element if what it joins hasn't moved since, else drawn again from its route. */
		restoreArrow(id, saved) {
			scene.batch(() => {
				if (!saved?.element) return
				open()
				if (saved.route) routes.set(id, saved.route)
				const a = element(id)
				const ends = [a?.startBinding, a?.endBinding].map((b) => (b && element(b.elementId) ? boxOf(element(b.elementId)) : null))
				const same = ends.every((b, i) => (!b && !saved.ends[i]) || (b && saved.ends[i] && ['x', 'y', 'w', 'h'].every((k) => Math.abs(b[k] - saved.ends[i][k]) < 0.01)))
				if (!same && saved.route && draw(a, saved.route)) return redrawArrow(id)
				work.set(id, ex.newElementWith(saved.element, {}))
				touched.delete(id)
				const label = labelOf(saved.element)
				if (label) {
					const m = middleOf(pointsOf(saved.element))
					put(label, { x: m.x - label.width / 2, y: m.y - label.height / 2 })
				}
			})
		},
		/** A point to come back to within a run: rollback(mark) undoes what was changed since, and nothing is left to undo. */
		checkpoint: () => {
			open()
			return { work: new Map(work), routes: new Map(routes), touched: new Set(touched) }
		},
		rollback(mark) {
			if (!mark || !work) return
			work = new Map(mark.work)
			routes.clear()
			for (const [k, v] of mark.routes) routes.set(k, v)
			touched.clear()
			for (const k of mark.touched) touched.add(k)
		},
		/** Changes inside land together, in one updateScene, when the outermost batch ends. */
		batch(fn) {
			depth++
			try {
				return fn()
			} finally {
				if (--depth === 0) commit()
			}
		},
		/** Async work in one batch, for the exec relay: open before the run, close after it. */
		begin: () => void depth++,
		end: () => void (--depth === 0 && commit()),
		/** Make what's pending land now (the helpers do this before reading or writing the scene themselves). */
		flush: () => work && commit(),
		get pending() {
			return !!work
		},
		fit: () => {
			if (depth) fitAfter = true
			else api.scrollToContent(undefined, { fitToContent: true, animate: true })
		},
		// Excalidraw keeps an elbow's sides (fixedPoint), but aims a straight or curved arrow's end at the box's middle (focus) when
		// someone drags the box, and toucan can't set that focus through the API.
		limits: { anchors: 'On Excalidraw, a straight or curved arrow keeps its side only until someone drags a box it joins.', labelAt: 'On Excalidraw an arrow\'s label is always at its middle.' },
	}
	return scene
}
