import { useEffect, useRef, useState } from 'react'
import { ArrowLeftIcon, ArrowRightIcon, BookOpenIcon, MessageSquarePlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getFormat, useFormat } from './formats'
import { getThreads, openThread, update as updateThreads, useThreads } from './threads-store'
import { hostOf, isWeb, nameOf, openReference } from './references-store'

type Step = { key: string; text: string }

// Web addresses and references in a box's details open in the References panel; a modifier key opens a new tab instead.
const LINK = /(https?:\/\/[^\s<>"'`)\]]+[^\s<>"'`)\].,;:!?]|\b(?:files|project|agent)\/[^\s<>"'`)\]]+[^\s<>"'`)\].,;:!?])/g
function linked(text: string) {
	return text.split(LINK).map((part, i) =>
		i % 2 ? (
			<a
				key={i}
				href={isWeb(part) ? part : '#'}
				target="_blank"
				rel="noopener noreferrer"
				className="text-primary underline underline-offset-2"
				onClick={(e) => {
					if (isWeb(part) && (e.metaKey || e.ctrlKey || e.shiftKey)) return
					e.preventDefault()
					openReference(part)
				}}
			>
				{part}
			</a>
		) : (
			part
		),
	)
}
const CARD_W = 320

/**
 * A box stays short, and what's behind it opens when it's selected: its detail, the threads on it, and, on a canvas
 * with a format, the way to walk on from it with ← and →. It takes no focus and blocks nothing, and doesn't appear for a
 * box with nothing to show on a canvas with no format, so plain canvases work as they always have.
 */
export function DetailsCard({ toucan, subscribe }: { toucan: any; subscribe: (onChange: () => void) => () => void }) {
	const format = useFormat()
	const { threads, active, draft, placing } = useThreads()
	const host = useRef<HTMLDivElement>(null)
	const [key, setKey] = useState<string | null>(null)
	const [dismissed, setDismissed] = useState<string | null>(null)
	const [, redraw] = useState(0)

	useEffect(() => {
		let frame = 0
		let last: string | null = null
		const read = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => {
				const selected = toucan.selectedKey()
				// A card closed by hand stays closed until the selection really changes, which a drag doesn't do.
				if (selected !== last) setDismissed(null)
				last = selected
				setKey(selected && toucan.isIdle() ? selected : null)
				if (selected) redraw((n) => n + 1)
			})
		}
		read()
		const stop = subscribe(read)
		const stopCamera = toucan.onCamera?.(read)
		return () => {
			cancelAnimationFrame(frame)
			stop()
			stopCamera?.()
		}
	}, [toucan, subscribe])

	const detail = key ? toucan.detailOf(key) : ''
	const steps: { next: Step[]; prev: Step[] } = key && format ? toucan.neighbours(key, format.walk) : { next: [], prev: [] }
	const walkTo = (to: string) => toucan.walkTo(to)
	const see: (Step & { label?: string })[] = key ? toucan.seeAlsoOf(key) : []
	const refs: { ref: string; label?: string }[] = key ? (toucan.refsOf?.(key) ?? []) : []

	const onThis = key ? threads.filter((t) => t.status === 'open' && t.anchor.shapes?.includes(key)) : []
	const nothingToShow = !detail && !format && !see.length && !refs.length
	const showing = !!key && key !== dismissed && !nothingToShow && active === null && !draft && !placing

	// ← and → walk the canvas while a card is open, instead of nudging the shape.
	useEffect(() => {
		if (!showing || !getFormat()) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
			if ((e.target as HTMLElement).closest?.('input, textarea, [contenteditable]') || !toucan.isIdle()) return
			const to = e.key === 'ArrowRight' ? steps.next[0] : steps.prev[0]
			e.preventDefault()
			e.stopPropagation()
			if (to) walkTo(to.key)
		}
		window.addEventListener('keydown', onKey, true)
		return () => window.removeEventListener('keydown', onKey, true)
	})

	if (!showing) return <div ref={host} className="pointer-events-none absolute inset-0" aria-hidden />
	const box = toucan.boundsOf([key!])
	const at = box ? toucan.toViewport({ x: box.x + box.w, y: box.y }) : { x: 40, y: 40 }
	const width = host.current?.clientWidth ?? 800, height = host.current?.clientHeight ?? 600
	const title = toucan.text(toucan.get(key!)) || key!
	return (
		<div ref={host} className="toucan-ui pointer-events-none absolute inset-0 z-[430] overflow-hidden !bg-transparent">
			<section
				aria-label="Details"
				onKeyDown={(e) => e.stopPropagation()}
				className="pointer-events-auto absolute flex max-h-[60%] w-80 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl border bg-background text-sm shadow-lg max-md:inset-x-2 max-md:bottom-2 max-md:w-auto"
				style={width < 768 ? undefined : { left: Math.max(8, Math.min(at.x + 16, width - CARD_W - 8)), top: Math.max(8, Math.min(at.y, height - 240)) }}
			>
				<header className="flex items-start gap-1 py-2 pr-1.5 pl-3">
					<h2 className="min-w-0 flex-1 font-medium break-words whitespace-pre-line">{title}</h2>
					<Button variant="ghost" size="icon-xs" aria-label="Close details" title="Close (select nothing to keep it closed)" onClick={() => setDismissed(key)}>
						<XIcon />
					</Button>
				</header>
				{detail && <p className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 break-words whitespace-pre-line text-muted-foreground">{linked(detail)}</p>}
				{refs.length > 0 && (
					<ul aria-label="References" className="border-t px-1.5 py-1 text-xs">
						{refs.map((r) => (
							<li key={r.ref}>
								<button type="button" title={r.ref} className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left outline-none hover:bg-muted focus-visible:bg-muted" onClick={() => openReference(r.ref)}>
									<BookOpenIcon className="size-3 shrink-0 text-muted-foreground" />
									<span className="truncate font-medium">{r.label || nameOf(r.ref)}</span>
									{r.label && <span className="truncate text-muted-foreground">{isWeb(r.ref) ? hostOf(r.ref) : r.ref}</span>}
								</button>
							</li>
						))}
					</ul>
				)}
				{onThis.length > 0 && (
					<ul className="border-t px-1.5 py-1 text-xs">
						{onThis.map((t) => (
							<li key={t.id}>
								<button type="button" className="w-full truncate rounded px-1.5 py-1 text-left outline-none hover:bg-muted focus-visible:bg-muted" onClick={() => openThread(t)}>
									#{t.id} {t.messages.at(-1)?.text}
								</button>
							</li>
						))}
					</ul>
				)}
				{see.length > 0 && (
					<ul aria-label="See also" className="border-t px-1.5 py-1 text-xs">
						{see.map((s) => (
							<li key={s.key}>
								<button type="button" className="w-full rounded px-1.5 py-1 text-left outline-none hover:bg-muted focus-visible:bg-muted" onClick={() => walkTo(s.key)}>
									<span className="font-medium">{s.text.split('\n')[0]}</span>
									{s.label && <span className="text-muted-foreground"> · {s.label}</span>}
								</button>
							</li>
						))}
					</ul>
				)}
				<footer className="flex max-h-32 flex-wrap items-center gap-1 overflow-y-auto border-t p-1.5">
					{steps.prev.map((s, i) => (
						<Button key={s.key} variant="ghost" size="xs" className="max-w-36" title={`${i ? '' : '← '}${s.text}`} onClick={() => walkTo(s.key)}>
							<ArrowLeftIcon /> <span className="truncate">{s.text.split('\n')[0]}</span>
						</Button>
					))}
					{steps.next.map((s, i) => (
						<Button key={s.key} variant="ghost" size="xs" className={cn('max-w-36', i === 0 && 'bg-muted')} title={`${i ? '' : '→ '}${s.text}`} onClick={() => walkTo(s.key)}>
							<span className="truncate">{s.text.split('\n')[0]}</span> <ArrowRightIcon />
						</Button>
					))}
					<Button
						variant="outline"
						size="xs"
						className="ml-auto"
						onClick={() => updateThreads({ draft: { shapes: [key], box: toucan.boundsOf([key]) ?? undefined, page: toucan.pageId?.() }, active: null })}
					>
						<MessageSquarePlusIcon /> Comment
					</Button>
				</footer>
			</section>
		</div>
	)
}
