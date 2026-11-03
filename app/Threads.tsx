import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { CheckIcon, LoaderCircleIcon, MessageSquarePlusIcon, MessagesSquareIcon, RotateCcwIcon, SendIcon, SquareIcon, StickyNoteIcon, XIcon } from 'lucide-react'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
	adoptNotes,
	answerApproval,
	closeThread,
	createThread,
	getThreads,
	lastAsk,
	notesToAdopt,
	onReveal,
	openThread,
	rememberAsk,
	reopenThread,
	replyTo,
	routeThread,
	stateOf,
	stopThread,
	update,
	useThreads,
	type Anchor,
	type Ask,
	type Box,
	type Thread,
} from './threads-store'

const CARD_W = 320
const time = (t: string) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const PIN: Record<ReturnType<typeof stateOf>, string> = {
	working: 'bg-violet-600 text-white',
	yours: 'bg-amber-400 text-amber-950',
	open: 'bg-primary text-primary-foreground',
	closed: 'bg-muted text-muted-foreground',
}
const STATE_LABEL: Record<ReturnType<typeof stateOf>, string> = { working: 'The agent is on it', yours: 'Waiting on you', open: 'Open', closed: 'Closed' }
const ASKS: { value: Ask; label: string; title: string }[] = [
	{ value: 'agent', label: 'Agent', title: 'This thread’s own agent works on it and replies here' },
	{ value: 'chat', label: 'Main chat', title: 'Send it to the main chat, adjusting what that agent is doing now' },
	{ value: 'none', label: 'People', title: 'Just leave it here, for people' },
]

/** Where a message goes. The choice sticks, since people tend to work one way for a while. */
function AskPicker({ ask, onChange }: { ask: Ask; onChange: (a: Ask) => void }) {
	return (
		<div role="radiogroup" aria-label="Send to" className="flex items-center rounded-md border p-px">
			{ASKS.map(({ value, label, title }) => (
				<button key={value} type="button" role="radio" aria-checked={ask === value} title={title} onClick={() => onChange(value)} className={cn('rounded-[5px] px-1.5 py-0.5 text-xs whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50', ask === value && 'bg-muted text-foreground')}>
					{label}
				</button>
			))}
		</div>
	)
}

function Composer({ placeholder, autoFocus, submitLabel, onSend }: { placeholder: string; autoFocus?: boolean; submitLabel: string; onSend: (text: string, ask: Ask) => Promise<unknown> }) {
	const [text, setText] = useState('')
	const [ask, setAsk] = useState(lastAsk)
	const [error, setError] = useState('')
	const form = useRef<HTMLFormElement>(null)
	const box = useRef<HTMLTextAreaElement>(null)
	async function submit(e: FormEvent) {
		e.preventDefault()
		const said = text.trim()
		if (!said) return
		setText('')
		setError('')
		try {
			await onSend(said, ask)
		} catch (err: any) {
			setText(said)
			setError(err.message)
		}
	}
	return (
		<form ref={form} onSubmit={submit} className="space-y-1.5">
			{error && (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			)}
			<Textarea
				ref={box}
				value={text}
				onChange={(e) => setText(e.target.value)}
				placeholder={placeholder}
				aria-label={placeholder}
				autoFocus={autoFocus}
				className="max-h-32 min-h-14 text-sm"
				onKeyDown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
						e.preventDefault()
						form.current?.requestSubmit()
					}
				}}
			/>
			<div className="flex items-center gap-1.5">
				<AskPicker
					ask={ask}
					onChange={(a) => {
						setAsk(a)
						rememberAsk(a)
						box.current?.focus()
					}}
				/>
				<span className="flex-1" />
				<Button type="submit" size="sm" disabled={!text.trim()}>
					<SendIcon /> {submitLabel}
				</Button>
			</div>
		</form>
	)
}

/** One thread: what was said, what the agent is doing, and how to answer or finish it. */
function ThreadBody({ thread }: { thread: Thread }) {
	const end = useRef<HTMLDivElement>(null)
	useEffect(() => {
		end.current?.scrollIntoView({ block: 'nearest' })
	}, [thread.messages.length, thread.working])
	const state = stateOf(thread)
	return (
		<>
			<ol className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">
				{thread.messages.map((m, i) => (
					<li key={i}>
						<p className="flex items-baseline gap-1.5 text-xs">
							<span className={cn('font-medium', m.author.kind === 'agent' && 'text-violet-600 dark:text-violet-400')}>{m.author.name}</span>
							<span className="text-muted-foreground">{time(m.t)}</span>
						</p>
						{m.author.kind === 'agent' ? <Markdown className="text-sm">{m.text}</Markdown> : <p className="text-sm break-words whitespace-pre-wrap">{m.text}</p>}
					</li>
				))}
				{thread.approval && (
					<li className="rounded-md border p-2 text-xs">
						<p className="font-medium break-words">{thread.approval.command ? `Run ${thread.approval.command}?` : 'Edit files?'}</p>
						<p className="mt-0.5 text-muted-foreground">{thread.approval.reason || 'The agent is asking to go outside its sandbox.'}</p>
						<div className="mt-1.5 flex justify-end gap-1.5">
							<Button size="xs" variant="outline" onClick={() => answerApproval(thread.id, thread.approval!.key, 'decline')}>
								Deny
							</Button>
							<Button size="xs" onClick={() => answerApproval(thread.id, thread.approval!.key, 'accept')}>
								Allow
							</Button>
						</div>
					</li>
				)}
				{thread.working && !thread.approval && (
					<li className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
						<LoaderCircleIcon className="size-3.5 animate-spin" /> The agent is working
						<Button size="xs" variant="ghost" className="ml-auto" onClick={() => stopThread(thread.id)}>
							<SquareIcon className="fill-current" /> Stop
						</Button>
					</li>
				)}
				<div ref={end} />
			</ol>
			<footer className="space-y-2 border-t p-2">
				{state === 'closed' ? (
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<span className="flex-1">
							Closed{thread.closed ? ` by ${thread.closed.by.name}, ${time(thread.closed.t)}` : ''}
						</span>
						<Button size="xs" variant="outline" onClick={() => reopenThread(thread.id)}>
							<RotateCcwIcon /> Reopen
						</Button>
					</div>
				) : (
					<Composer placeholder={thread.working ? 'Add to what it’s doing…' : 'Reply…'} submitLabel="Send" onSend={(text, ask) => replyTo(thread.id, text, ask)} />
				)}
			</footer>
		</>
	)
}

function ThreadHeader({ thread, label, onClose }: { thread: Thread; label: string; onClose: () => void }) {
	const state = stateOf(thread)
	return (
		<header className="flex items-center gap-1.5 border-b py-1.5 pr-1.5 pl-3">
			<span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', PIN[state])}>{thread.id}</span>
			<div className="min-w-0 flex-1">
				<p className="truncate text-xs font-medium" title={label}>
					{label}
				</p>
				<p className="text-[11px] text-muted-foreground">{STATE_LABEL[state]}</p>
			</div>
			{state !== 'closed' && (
				<>
					<Button variant="ghost" size="icon-sm" title="Send to the main chat" aria-label="Send to the main chat" onClick={() => routeThread(thread.id, 'chat')}>
						<MessagesSquareIcon />
					</Button>
					<Button variant="ghost" size="icon-sm" title="Close this thread" aria-label="Close this thread" onClick={() => closeThread(thread.id)}>
						<CheckIcon />
					</Button>
				</>
			)}
			<Button variant="ghost" size="icon-sm" title="Hide" aria-label="Hide this thread" onClick={onClose}>
				<XIcon />
			</Button>
		</header>
	)
}

const stop = {
	onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
	onKeyUp: (e: React.SyntheticEvent) => e.stopPropagation(),
	onPaste: (e: React.SyntheticEvent) => e.stopPropagation(),
	onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
	onWheel: (e: React.SyntheticEvent) => e.stopPropagation(),
}

type Point = { x: number; y: number }

/**
 * What people see on the canvas: a numbered pin on each open thread, the thread itself beside its pin, and the tool
 * for leaving a new one. Click a shape to comment on it, drag out a region, or click empty space. Engine-neutral: it
 * reads the canvas through the engine's \`toucan\` helpers, in page coordinates.
 */
export function ThreadsLayer({ toucan, subscribe }: { toucan: any; subscribe: (onChange: () => void) => () => void }) {
	const { threads, active, placing, showClosed, draft, panel } = useThreads()
	const host = useRef<HTMLDivElement>(null)
	const [, redraw] = useState(0)
	const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null)

	// Pins follow the camera and the shapes they're on.
	useEffect(() => {
		let frame = 0
		const again = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => redraw((n) => n + 1))
		}
		const stopWatching = subscribe(again)
		const stopCamera = toucan.onCamera?.(again)
		return () => {
			cancelAnimationFrame(frame)
			stopWatching()
			stopCamera?.()
		}
	}, [toucan, subscribe])

	const boxOf = useCallback((a: Anchor): Box | null => a.region ?? (a.shapes && toucan.boundsOf(a.shapes)) ?? a.box ?? null, [toucan])

	// The panel asks for a thread: bring it into view.
	useEffect(() => {
		onReveal((t) => {
			if (t.anchor.page) toucan.goToPage?.(t.anchor.page)
			const box = boxOf(t.anchor)
			if (box) toucan.showBox(box)
		})
	}, [toucan, boxOf])

	const labelOf = useCallback(
		(a: Anchor) => {
			if (a.region) {
				const inside = toucan.shapesIn(a.region).map((k: string) => toucan.text(toucan.get(k))).filter(Boolean)
				return inside.length ? `Region around ${inside.slice(0, 3).join(', ')}${inside.length > 3 ? ` +${inside.length - 3}` : ''}` : 'Region'
			}
			const names = (a.shapes ?? []).map((k) => {
				const s = toucan.get(k)
				return s ? toucan.text(s) || k : `${k} (removed)`
			})
			return names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '')
		},
		[toucan],
	)

	const here = (e: { clientX: number; clientY: number }): Point => {
		const r = host.current!.getBoundingClientRect()
		return { x: e.clientX - r.left, y: e.clientY - r.top }
	}
	const toScreen = (p: Point): Point => {
		const s = toucan.toViewport(p)
		return { x: s.x, y: s.y }
	}

	function startPlacing(e: ReactPointerEvent) {
		e.preventDefault()
		;(e.target as Element).setPointerCapture(e.pointerId)
		const at = here(e)
		setDrag({ from: at, to: at })
	}
	function finishPlacing(e: ReactPointerEvent) {
		if (!drag) return
		const to = here(e)
		const wide = Math.abs(to.x - drag.from.x), high = Math.abs(to.y - drag.from.y)
		setDrag(null)
		const a = toucan.fromClient({ x: e.clientX, y: e.clientY })
		if (wide > 8 || high > 8) {
			const r = host.current!.getBoundingClientRect()
			const b = toucan.fromClient({ x: drag.from.x + r.left, y: drag.from.y + r.top })
			const region = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
			return update({ placing: false, draft: { region, page: toucan.pageId?.() }, active: null })
		}
		const hit = toucan.shapeAt(a)
		if (hit) return update({ placing: false, draft: { shapes: [hit], box: toucan.boundsOf([hit]) ?? undefined, page: toucan.pageId?.() }, active: null })
		update({ placing: false, draft: { region: { x: a.x, y: a.y, w: 0, h: 0 }, page: toucan.pageId?.() }, active: null })
	}

	// Hold Esc to back out of leaving a comment.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return
			const { placing, draft, active } = getThreads()
			if (placing || draft) update({ placing: false, draft: null })
			else if (active !== null) update({ active: null })
			else return
			e.stopPropagation()
		}
		window.addEventListener('keydown', onKey, true)
		return () => window.removeEventListener('keydown', onKey, true)
	}, [])

	const page = toucan.pageId?.()
	// An anchor made outside a tab may not say its page; its shapes do.
	const onPage = (a: Anchor) => {
		const at = a.page ?? (a.shapes?.length ? toucan.pageOf?.(a.shapes[0]) : undefined)
		return !at || !page || at === page
	}
	const shown = threads.filter((t) => onPage(t.anchor) && (t.status === 'open' || showClosed || t.id === active))
	const width = host.current?.clientWidth ?? 0, height = host.current?.clientHeight ?? 0
	const pinOf = (a: Anchor): Point | null => {
		const b = boxOf(a)
		return b ? toScreen({ x: b.x + b.w, y: b.y }) : null
	}
	// Threads on the same spot sit side by side.
	const taken = new Map<string, number>()
	const pins = shown.flatMap((t) => {
		const p = pinOf(t.anchor)
		if (!p) return []
		const spot = `${Math.round(p.x)},${Math.round(p.y)}`
		const n = taken.get(spot) ?? 0
		taken.set(spot, n + 1)
		return [{ t, x: p.x + n * 26, y: p.y }]
	})
	const activeThread = shown.find((t) => t.id === active)
	const highlight = draft ?? activeThread?.anchor
	const lit = highlight ? boxOf(highlight) : null
	const litTop = lit && toScreen({ x: lit.x, y: lit.y })
	const litEnd = lit && toScreen({ x: lit.x + lit.w, y: lit.y + lit.h })
	const cardAt = (a: Anchor) => {
		if (width < 768) return undefined // a narrow screen docks the card along the bottom
		const p = pinOf(a) ?? { x: 40, y: 40 }
		// Clear of the panel when it's open, which takes the same strip at the right.
		const room = panel ? width - 336 : width
		return { left: Math.max(8, Math.min(p.x + 18, room - CARD_W - 8)), top: Math.max(8, Math.min(p.y - 8, height - 420)) }
	}

	return (
		<div ref={host} className="toucan-ui pointer-events-none absolute inset-0 z-[440] overflow-hidden !bg-transparent" aria-label="Comment threads">
			{placing && (
				<div className="pointer-events-auto absolute inset-0 cursor-crosshair" onPointerDown={startPlacing} onPointerMove={(e) => drag && setDrag({ ...drag, to: here(e) })} onPointerUp={finishPlacing} onPointerCancel={() => setDrag(null)}>
					<p className="absolute top-2 left-1/2 -translate-x-1/2 rounded-md border bg-background px-2 py-1 text-xs whitespace-nowrap shadow-sm">Click a shape, or drag out a region. Esc to cancel.</p>
					{drag && <div className="absolute rounded-sm border-2 border-dashed border-violet-500 bg-violet-500/10" style={{ left: Math.min(drag.from.x, drag.to.x), top: Math.min(drag.from.y, drag.to.y), width: Math.abs(drag.to.x - drag.from.x), height: Math.abs(drag.to.y - drag.from.y) }} />}
				</div>
			)}
			{litTop && litEnd && <div aria-hidden className="absolute rounded-sm border-2 border-dashed border-violet-500/70" style={{ left: litTop.x - 4, top: litTop.y - 4, width: litEnd.x - litTop.x + 8, height: litEnd.y - litTop.y + 8 }} />}
			{pins.map(({ t, x, y }) => (
				<button
					key={t.id}
					type="button"
					aria-label={`Thread ${t.id}: ${STATE_LABEL[stateOf(t)]}`}
					aria-expanded={t.id === active}
					title={t.messages[0]?.text.slice(0, 100)}
					onClick={() => update({ active: t.id === active ? null : t.id, draft: null })}
					className={cn('pointer-events-auto absolute z-10 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full rounded-bl-none text-xs font-semibold shadow-md ring-2 ring-background outline-none focus-visible:ring-ring', PIN[stateOf(t)], t.id === active && 'scale-110')}
					style={{ left: x, top: y }}
				>
					{t.working ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : t.id}
				</button>
			))}
			{draft && (
				<section {...stop} aria-label="New comment" className="pointer-events-auto absolute flex w-80 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl border bg-background text-sm shadow-xl max-md:inset-x-2 max-md:bottom-2 max-md:w-auto" style={cardAt(draft)}>
					<header className="flex items-center gap-1.5 border-b py-1.5 pr-1.5 pl-3">
						<p className="min-w-0 flex-1 truncate text-xs font-medium">{labelOf(draft)}</p>
						<Button variant="ghost" size="icon-sm" aria-label="Cancel" title="Cancel (Esc)" onClick={() => update({ draft: null })}>
							<XIcon />
						</Button>
					</header>
					<div className="p-2">
						<Composer
							autoFocus
							placeholder="Leave a comment…"
							submitLabel="Comment"
							onSend={async (text, ask) => {
								const made = await createThread(draft, text, ask)
								update({ draft: null, active: made.id })
							}}
						/>
					</div>
				</section>
			)}
			{activeThread && !draft && (
				<section {...stop} aria-label={`Thread ${activeThread.id}`} className="pointer-events-auto absolute flex max-h-[420px] w-80 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl border bg-background text-sm shadow-xl max-md:inset-x-2 max-md:bottom-2 max-md:w-auto" style={cardAt(activeThread.anchor)}>
					<ThreadHeader thread={activeThread} label={labelOf(activeThread.anchor)} onClose={() => update({ active: null })} />
					<ThreadBody key={activeThread.id} thread={activeThread} />
				</section>
			)}
		</div>
	)
}

/** The app bar's way in: leave a comment on what's selected, or pick a spot. Comes with the list's count. */
export function CommentButton({ onComment }: { onComment: () => void }) {
	const { placing } = useThreads()
	return (
		<Button variant="ghost" size="sm" aria-pressed={placing} aria-label="Comment" title="Comment on a shape or a region" className={cn(placing && 'bg-muted')} onClick={onComment}>
			<MessageSquarePlusIcon />
			<span className="max-lg:hidden">Comment</span>
		</Button>
	)
}

export function ThreadsButton() {
	const { threads, panel } = useThreads()
	const open = threads.filter((t) => t.status === 'open')
	const yours = open.filter((t) => stateOf(t) === 'yours').length
	return (
		<Button variant="ghost" size="sm" aria-expanded={panel} aria-label={`Threads, ${open.length} open`} title="Threads" className={cn(panel && 'bg-muted')} onClick={() => update({ panel: !panel })}>
			<MessagesSquareIcon />
			<span className="max-lg:hidden">Threads</span>
			{open.length > 0 && <span className={cn('rounded-full px-1.5 text-[11px] font-semibold tabular-nums', yours ? 'bg-amber-400 text-amber-950' : 'bg-muted text-muted-foreground')}>{open.length}</span>}
		</Button>
	)
}

/** Every thread on the canvas, with whose move it is, and the sticky notes that could become threads. */
export function ThreadsPanel() {
	const { threads, showClosed, active } = useThreads()
	const [notes, setNotes] = useState(0)
	useEffect(() => {
		notesToAdopt().then(setNotes, () => {})
	}, [threads.length])
	const open = threads.filter((t) => t.status === 'open')
	const closed = threads.filter((t) => t.status === 'closed')
	const order = { yours: 0, working: 1, open: 2, closed: 3 }
	const rows = [...open].sort((a, b) => order[stateOf(a)] - order[stateOf(b)] || b.id - a.id).concat(showClosed ? [...closed].reverse() : [])
	return (
		<section {...stop} aria-label="Threads" className="toucan-ui absolute inset-y-2 right-2 z-[460] flex w-80 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl border bg-background text-sm shadow-lg max-md:inset-x-2 max-md:top-auto max-md:h-[55%] max-md:w-auto">
			<header className="flex items-center gap-1.5 border-b py-1.5 pr-1.5 pl-3">
				<MessagesSquareIcon className="size-4 text-muted-foreground" />
				<h2 className="font-medium">Threads</h2>
				<span className="flex-1" />
				<Button variant="ghost" size="icon-sm" aria-label="Close threads" onClick={() => update({ panel: false })}>
					<XIcon />
				</Button>
			</header>
			<ol className="min-h-0 flex-1 overflow-y-auto py-1">
				{!rows.length && <li className="px-3 py-2 text-xs text-muted-foreground">{closed.length ? 'Nothing open.' : 'No threads yet. Use Comment to leave one on a shape or a region.'}</li>}
				{rows.map((t) => {
					const last = t.messages.at(-1)!
					const state = stateOf(t)
					return (
						<li key={t.id}>
							<button type="button" onClick={() => openThread(t)} aria-current={t.id === active} className={cn('flex w-full items-start gap-2 px-3 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted', t.id === active && 'bg-muted')}>
								<span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', PIN[state])}>{t.id}</span>
								<span className="min-w-0 flex-1">
									<span className="line-clamp-2 break-words">{t.messages[0].text}</span>
									<span className="block truncate text-xs text-muted-foreground">
										{STATE_LABEL[state]}
										{t.messages.length > 1 && ` · ${last.author.name}: ${last.text}`}
									</span>
								</span>
							</button>
						</li>
					)
				})}
			</ol>
			{(closed.length > 0 || notes > 0) && (
				<footer className="flex items-center gap-2 border-t p-2 text-xs">
					{closed.length > 0 && (
						<label className="flex items-center gap-1.5 text-muted-foreground">
							<input type="checkbox" checked={showClosed} onChange={(e) => update({ showClosed: e.target.checked })} /> Show {closed.length} closed
						</label>
					)}
					{notes > 0 && (
						<Button size="xs" variant="outline" className="ml-auto" title="Each sticky note becomes a thread attached to it. The notes stay." onClick={() => adoptNotes()}>
							<StickyNoteIcon /> Bring in {notes} {notes === 1 ? 'note' : 'notes'}
						</Button>
					)}
				</footer>
			)}
		</section>
	)
}
