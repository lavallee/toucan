import { useState } from 'react'
import { atom, computed, useValue, type Editor, type TLShape } from 'tldraw'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Past a certain distance a system diagram's boxes can't be read and its arrows are just a tangle. So, zoomed out, it
// shows what can be read: its frames, and how many connections run between them. Nothing in the document changes, and
// agents, exports and thumbnails still see every shape.

const READABLE_ZOOM = 0.35
export const systemFormat = atom('toucan system format', false)
const showEverything = atom('toucan show everything', false)
/** Set while taking a picture of the canvas, so the picture has every shape in it. */
const picturesInProgress = atom('toucan pictures in progress', 0)

const cache = new WeakMap<Editor, { showing: { get(): boolean }; hiding: { get(): boolean } }>()
/** Computed, so that only crossing the threshold touches each shape's visibility, not every step of a zoom. */
function stateFor(editor: Editor) {
	let state = cache.get(editor)
	if (!state) {
		const showing = computed('toucan overview showing', () => systemFormat.get() && !showEverything.get() && editor.getZoomLevel() < READABLE_ZOOM)
		const hiding = computed('toucan overview hiding', () => showing.get() && picturesInProgress.get() === 0)
		state = { showing, hiding }
		cache.set(editor, state)
	}
	return state
}
export const overviewShowing = (editor: Editor) => stateFor(editor).showing.get()

/** For tldraw's getShapeVisibility: arrows and what's inside a frame step back, and a person's sticky note never does. */
export function overviewVisibility(shape: TLShape, editor: Editor): 'hidden' | 'inherit' | 'visible' {
	if (!stateFor(editor).hiding.get()) return 'inherit'
	if (shape.type === 'note') return 'visible'
	if (shape.type === 'arrow') return 'hidden'
	return editor.getShapeAncestors(shape).some((a) => a.type === 'frame') ? 'hidden' : 'inherit'
}

/**
 * Anything drawn from the document (screenshots, tldraw's Export and Copy as) gets every shape, whatever the view is
 * showing: tldraw leaves hidden shapes out of pictures, so they're shown for as long as a picture takes.
 */
export function keepPicturesWhole(editor: Editor) {
	const draw = editor.getSvgElement.bind(editor)
	editor.getSvgElement = (async (...args: Parameters<typeof draw>) => {
		picturesInProgress.update((n) => n + 1)
		try {
			return await draw(...args)
		} finally {
			picturesInProgress.update((n) => n - 1)
		}
	}) as typeof editor.getSvgElement
}

type Box = { x: number; y: number; w: number; h: number }
const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
/** Where the line from a box's centre towards a point leaves the box. */
function edgeToward(b: Box, to: { x: number; y: number }) {
	const c = centre(b), dx = to.x - c.x, dy = to.y - c.y
	if (!dx && !dy) return c
	const scale = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity)
	return { x: c.x + dx * scale, y: c.y + dy * scale }
}

function plain(editor: Editor, s: TLShape) {
	const text = (window as any).toucan?.text?.(s) ?? ''
	return String(text).split('\n')[0] || s.id.replace(/^shape:/, '')
}

/** The frames and the connections between them, in page coordinates, read from the current page. */
function readGraph(editor: Editor) {
	const top = (id: any): any => {
		let s = editor.getShape(id)
		while (s && s.parentId.startsWith('shape:')) s = editor.getShape(s.parentId as any)
		return s
	}
	const shapes = editor.getCurrentPageShapes()
	const parts = new Map<string, number>()
	for (const s of shapes) if (s.type !== 'arrow' && s.type !== 'note' && s.parentId.startsWith('shape:')) parts.set(top(s.id).id, (parts.get(top(s.id).id) ?? 0) + 1)
	const links = new Map<string, { a: any; b: any; ab: number; ba: number; names: string[] }>()
	for (const arrow of shapes) {
		if (arrow.type !== 'arrow' || arrow.meta?.proposed) continue
		const ends = editor.getBindingsFromShape(arrow as any, 'arrow')
		const from = ends.find((e: any) => e.props.terminal === 'start'), to = ends.find((e: any) => e.props.terminal === 'end')
		if (!from || !to) continue
		const a = top(from.toId), b = top(to.toId)
		if (!a || !b || a.id === b.id) continue // within a frame: that's what opening it is for
		const forward = a.id < b.id
		const key = forward ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
		const link = links.get(key) ?? { a: forward ? a : b, b: forward ? b : a, ab: 0, ba: 0, names: [] }
		forward ? link.ab++ : link.ba++
		link.names.push(`${plain(editor, editor.getShape(from.toId)!)} → ${plain(editor, editor.getShape(to.toId)!)}`)
		links.set(key, link)
	}
	return {
		frames: shapes.filter((s) => s.type === 'frame' && !s.parentId.startsWith('shape:')).map((s) => ({ id: s.id, name: (s.props as any).name || 'Frame', parts: parts.get(s.id) ?? 0 })),
		links: [...links.values()],
	}
}

/** Drawn over the canvas while the overview is showing. */
export function SystemOverview({ editor }: { editor: Editor }) {
	const active = useValue('overview showing', () => overviewShowing(editor), [editor])
	const off = useValue('overview off', () => showEverything.get(), [])
	const zoomedOut = useValue('zoomed out', () => systemFormat.get() && editor.getZoomLevel() < READABLE_ZOOM, [editor])
	const [hover, setHover] = useState<string | null>(null)
	// The graph changes with the document, and where it's drawn changes with the camera: only the second runs each frame.
	const graph = useValue('overview graph', () => (active ? readGraph(editor) : null), [editor, active])
	const view = useValue(
		'overview view',
		() => {
			if (!graph) return null
			const screen = (id: any): Box | null => {
				const b = editor.getShapePageBounds(id)
				if (!b) return null
				const a = editor.pageToViewport({ x: b.x, y: b.y }), z = editor.pageToViewport({ x: b.maxX, y: b.maxY })
				return { x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y }
			}
			return {
				frames: graph.frames.flatMap((f) => {
					const box = screen(f.id)
					return box ? [{ ...f, box }] : []
				}),
				links: graph.links.flatMap((l) => {
					const a = screen(l.a.id), b = screen(l.b.id)
					if (!a || !b) return []
					const from = edgeToward(a, centre(b)), to = edgeToward(b, centre(a))
					return [{ ...l, aId: l.a.id, bId: l.b.id, from, to, count: l.ab + l.ba }]
				}),
			}
		},
		[editor, graph],
	)
	const open = (id: any) => {
		const b = editor.getShapePageBounds(id)
		if (!b) return
		editor.zoomToBounds(b, { inset: 60, animation: { duration: 0 } })
		// A big frame might not fit at a readable size: then open it close enough to read, from its top left.
		if (editor.getZoomLevel() < READABLE_ZOOM + 0.05) {
			const z = READABLE_ZOOM + 0.1
			editor.setCamera({ x: -b.x + 40 / z, y: -b.y + 40 / z, z }, { animation: { duration: 200 } })
		}
	}
	return (
		<div className="toucan-ui pointer-events-none absolute inset-0 z-[420] overflow-hidden !bg-transparent" aria-label="Overview">
			{view && (
				<>
					<svg className="absolute inset-0 size-full text-foreground" aria-hidden>
						<defs>
							<marker id="toucan-overview-head" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
								<path d="M0 0L10 5L0 10z" fill="currentColor" />
							</marker>
						</defs>
						{view.links.map((l) => {
							const dim = hover && hover !== l.aId && hover !== l.bId
							return <line key={`${l.aId}${l.bId}`} x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y} stroke="currentColor" strokeWidth={1 + Math.log2(l.count) * 1.2} strokeOpacity={dim ? 0.08 : hover ? 0.8 : 0.35} markerEnd={l.ab ? 'url(#toucan-overview-head)' : undefined} markerStart={l.ba ? 'url(#toucan-overview-head)' : undefined} />
						})}
					</svg>
					{view.links.map((l) => {
						const dim = hover && hover !== l.aId && hover !== l.bId
						return (
							<span key={`${l.aId}${l.bId}`} title={l.names.join('\n')} className={cn('pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border bg-background px-1.5 text-[11px] font-medium tabular-nums', dim && 'opacity-20')} style={{ left: (l.from.x + l.to.x) / 2, top: (l.from.y + l.to.y) / 2 }}>
								{l.count}
							</span>
						)
					})}
					{/* Only the name takes clicks, and the rest of the frame stays the canvas: scroll, pan and select all still work. */}
					{view.frames.map((f) => (
						<div key={f.id} className="absolute flex items-center justify-center overflow-hidden p-2" style={{ left: f.box.x, top: f.box.y, width: f.box.w, height: f.box.h }}>
							<button
								type="button"
								title={`Open ${f.name}`}
								aria-label={`Open ${f.name}, ${f.parts} parts`}
								onClick={() => open(f.id)}
								onPointerEnter={() => setHover(f.id)}
								onPointerLeave={() => setHover(null)}
								className="pointer-events-auto flex flex-col items-center rounded-md border bg-background px-2 py-1 text-center shadow-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
							>
								<span className="text-sm leading-tight font-semibold">{f.name}</span>
								<span className="text-xs text-muted-foreground">
									{f.parts} part{f.parts === 1 ? '' : 's'}
								</span>
							</button>
						</div>
					))}
				</>
			)}
			{zoomedOut && (
				<div className="pointer-events-auto absolute top-2 left-[308px] flex items-center gap-2 max-md:top-12 max-md:left-2 rounded-lg border bg-background py-1 pr-1 pl-2.5 text-xs shadow-sm">
					<span className="text-muted-foreground">{off ? 'Showing everything' : 'Frames and their connections. Zoom in, or click a name.'}</span>
					<Button variant="outline" size="xs" onClick={() => showEverything.set(!off)}>
						{off ? 'Show frames' : 'Show everything'}
					</Button>
				</div>
			)}
		</div>
	)
}
