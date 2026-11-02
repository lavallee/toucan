import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { PanelBottomIcon, PanelLeftIcon, PanelRightIcon, PictureInPicture2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type Dock = 'right' | 'left' | 'bottom' | 'float'
type Layout = { dock: Dock; width: number; height: number; float: { x: number; y: number; w: number; h: number } }

const KEY = 'toucan.chatLayout'
const DEFAULT: Layout = { dock: 'right', width: 380, height: 300, float: { x: 80, y: 40, w: 380, h: 520 } }
const MIN_W = 280, MIN_H = 180, EDGE = 64

const DOCK_NAMES = ['right', 'left', 'bottom', 'float']
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, Math.max(lo, hi)))
function load(): Layout {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null')
		return saved?.float && DOCK_NAMES.includes(saved.dock) ? { ...DEFAULT, ...saved } : DEFAULT
	} catch {
		return DEFAULT
	}
}

/** Where the chat panel sits, kept per browser. On a narrow screen it is always along the bottom. */
export function useChatLayout() {
	const [layout, set] = useState(load)
	const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 767px)').matches)
	useEffect(() => {
		const m = matchMedia('(max-width: 767px)')
		const on = () => setNarrow(m.matches)
		m.addEventListener('change', on)
		return () => m.removeEventListener('change', on)
	}, [])
	useEffect(() => {
		try {
			localStorage.setItem(KEY, JSON.stringify(layout))
		} catch {}
	}, [layout])
	return { layout, set, narrow, dock: narrow ? ('bottom' as Dock) : layout.dock }
}

const DOCKS: { dock: Dock; label: string; Icon: typeof PanelLeftIcon }[] = [
	{ dock: 'left', label: 'Dock left', Icon: PanelLeftIcon },
	{ dock: 'bottom', label: 'Dock bottom', Icon: PanelBottomIcon },
	{ dock: 'right', label: 'Dock right', Icon: PanelRightIcon },
	{ dock: 'float', label: 'Float over the canvas', Icon: PictureInPicture2Icon },
]

/** The four places the panel can go, as buttons in its header (dragging the header does the same). */
export function DockButtons({ dock, onDock }: { dock: Dock; onDock: (d: Dock) => void }) {
	return (
		<div role="radiogroup" aria-label="Chat position" className="hidden items-center md:flex">
			{DOCKS.map(({ dock: d, label, Icon }) => (
				<Button key={d} variant="ghost" size="icon-xs" role="radio" aria-checked={dock === d} aria-label={label} title={label} className={cn('text-muted-foreground', dock === d && 'bg-muted text-foreground')} onClick={() => onDock(d)}>
					<Icon />
				</Button>
			))}
		</div>
	)
}

type Chat = ReturnType<typeof useChatLayout>

/**
 * The panel around the chat: docked beside or under the canvas, or floating over it. Drag its header to
 * float it, and drop it against an edge to dock it there; drag the inner edge (or the corner) to resize.
 */
export function ChatDock({ chat, stage, children }: { chat: Chat; stage: RefObject<HTMLDivElement | null>; children: (startDrag: (e: ReactPointerEvent) => void) => ReactNode }) {
	const { layout, set, dock, narrow } = chat
	const [zone, setZone] = useState<Dock | null>(null)
	const zoneRef = useRef<Dock | null>(null)

	// Keep a floating panel reachable when the window shrinks.
	useEffect(() => {
		const fit = () => {
			const r = stage.current?.getBoundingClientRect()
			if (!r) return
			set((l) => ({ ...l, float: { ...l.float, x: clamp(l.float.x, 0, r.width - 120), y: clamp(l.float.y, 0, r.height - 48) } }))
		}
		fit()
		window.addEventListener('resize', fit)
		return () => window.removeEventListener('resize', fit)
	}, [set, stage])

	/** Follows the pointer from a press until release. */
	const track = useCallback((e: ReactPointerEvent, move: (ev: PointerEvent) => void, end?: () => void) => {
		e.preventDefault()
		document.body.style.userSelect = 'none'
		const stop = () => {
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', stop)
			window.removeEventListener('pointercancel', stop)
			document.body.style.userSelect = ''
			end?.()
		}
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', stop)
		window.addEventListener('pointercancel', stop)
	}, [])

	const startDrag = useCallback(
		(e: ReactPointerEvent) => {
			if (narrow || e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, textarea')) return
			const startX = e.clientX, startY = e.clientY
			const panel = (e.currentTarget as HTMLElement).closest('[data-slot=chat-dock]')!.getBoundingClientRect()
			const grabX = Math.min(e.clientX - panel.left, 200)
			const grabY = e.clientY - panel.top
			let dragging = false
			track(
				e,
				(ev) => {
					if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return
					dragging = true
					const r = stage.current!.getBoundingClientRect()
					const z: Dock | null = ev.clientX - r.left < EDGE ? 'left' : r.right - ev.clientX < EDGE ? 'right' : r.bottom - ev.clientY < EDGE ? 'bottom' : null
					zoneRef.current = z
					setZone(z)
					set((l) => ({ ...l, dock: 'float', float: { ...l.float, x: clamp(ev.clientX - r.left - grabX, 0, r.width - 120), y: clamp(ev.clientY - r.top - grabY, 0, r.height - 48) } }))
				},
				() => {
					const dropped = zoneRef.current
					if (dragging && dropped) set((l) => ({ ...l, dock: dropped }))
					zoneRef.current = null
					setZone(null)
				},
			)
		},
		[narrow, set, stage, track],
	)

	const startResize = (e: ReactPointerEvent) => {
		const r = stage.current!.getBoundingClientRect()
		track(e, (ev) => {
			set((l) => {
				if (dock === 'right') return { ...l, width: clamp(r.right - ev.clientX, MIN_W, r.width - 320) }
				if (dock === 'left') return { ...l, width: clamp(ev.clientX - r.left, MIN_W, r.width - 320) }
				if (dock === 'bottom') return { ...l, height: clamp(r.bottom - ev.clientY, MIN_H, r.height - 200) }
				return { ...l, float: { ...l.float, w: clamp(ev.clientX - r.left - l.float.x, MIN_W, r.width - l.float.x), h: clamp(ev.clientY - r.top - l.float.y, MIN_H, r.height - l.float.y) } }
			})
		})
	}
	// With the keyboard: arrows on the focused handle resize by 24px.
	const onResizeKey = (e: React.KeyboardEvent) => {
		const sign = { ArrowLeft: dock === 'left' ? -1 : 1, ArrowRight: dock === 'left' ? 1 : -1, ArrowUp: 1, ArrowDown: -1 }[e.key]
		if (!sign || dock === 'float') return
		e.preventDefault()
		const r = stage.current!.getBoundingClientRect()
		if (dock === 'bottom') set((l) => ({ ...l, height: clamp(l.height + sign * 24, MIN_H, r.height - 200) }))
		else set((l) => ({ ...l, width: clamp(l.width + sign * 24, MIN_W, r.width - 320) }))
	}

	const size = narrow
		? { height: '45%' }
		: dock === 'bottom'
			? { height: layout.height, maxHeight: 'calc(100% - 200px)' }
			: dock === 'float'
				? { left: layout.float.x, top: layout.float.y, width: layout.float.w, height: layout.float.h, maxWidth: '100%', maxHeight: '100%' }
				: { width: layout.width, maxWidth: 'calc(100% - 320px)' }
	const handleClass = cn(
		'toucan-dock-handle absolute z-10',
		dock === 'right' && '-left-1 inset-y-0 w-2 cursor-col-resize',
		dock === 'left' && '-right-1 inset-y-0 w-2 cursor-col-resize',
		dock === 'bottom' && '-top-1 inset-x-0 h-2 cursor-row-resize',
		dock === 'float' && 'right-0 bottom-0 size-4 cursor-nwse-resize',
	)
	return (
		<>
			{zone && <div aria-hidden className={cn('pointer-events-none absolute z-[590] rounded-lg border-2 border-primary/40 bg-primary/10', zone === 'left' && 'inset-y-1 left-1 w-[380px] max-w-[45%]', zone === 'right' && 'inset-y-1 right-1 w-[380px] max-w-[45%]', zone === 'bottom' && 'inset-x-1 bottom-1 h-[300px] max-h-[45%]')} />}
			<div
				data-slot="chat-dock"
				data-dock={dock}
				style={size}
				className={cn(
					'relative flex min-h-0 min-w-0 shrink-0 flex-col bg-background',
					dock === 'right' && 'border-l',
					dock === 'left' && 'border-r',
					dock === 'bottom' && 'border-t',
					dock === 'float' && 'absolute z-[600] overflow-hidden rounded-xl border shadow-xl',
				)}
			>
				{!narrow && (
					<div
						role="separator"
						tabIndex={dock === 'float' ? -1 : 0}
						aria-orientation={dock === 'bottom' ? 'horizontal' : 'vertical'}
						aria-label="Resize chat"
						className={handleClass}
						onPointerDown={startResize}
						onKeyDown={onResizeKey}
					/>
				)}
				{children(startDrag)}
			</div>
		</>
	)
}
