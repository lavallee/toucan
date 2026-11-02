import { useCallback, useEffect, useMemo, useState, type ComponentType, type FormEvent } from 'react'
import { BookmarkIcon, BotIcon, ChevronLeftIcon, ChevronRightIcon, HistoryIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { api, canvasName } from './net'

export type VersionRow = { n: number; t: string; source: string; label?: string; named?: boolean; count: number; added: number; updated: number; removed: number; keys: string[] }
export type VersionPreview = ComponentType<{ data: any }>

const base = `/api/canvases/${encodeURIComponent(canvasName)}/versions`
const day = (t: string) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const time = (t: string) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : 's'}`

function stepTitle(v: VersionRow) {
	if (v.label) return v.label
	return v.source === 'agent' ? 'Agent edit' : 'Edits'
}

/**
 * The evolution of a canvas: every saved version, newest first. Choosing one shows it read-only over the
 * live canvas, which keeps running underneath; restoring puts it back for everyone, after saving what is
 * there now, so it can always be undone from this list.
 */
export function History({ Preview, onClose }: { Preview: VersionPreview; onClose: () => void }) {
	const [versions, setVersions] = useState<VersionRow[] | null>(null)
	const [current, setCurrent] = useState(true)
	const [selected, setSelected] = useState<number | null>(null) // null: the live canvas
	const [data, setData] = useState<{ n: number; data: any } | null>(null)
	const [name, setName] = useState('')
	const [error, setError] = useState('')
	const [restored, setRestored] = useState<{ n: number; undo: number | null } | null>(null)

	const load = useCallback(() => api(base).then((r) => (setVersions(r.versions), setCurrent(r.current)), (e) => setError(String(e.message ?? e))), [])
	useEffect(() => {
		load()
		const t = setInterval(load, 6000)
		return () => clearInterval(t)
	}, [load])

	useEffect(() => {
		if (selected === null) return setData(null)
		let stale = false
		api(`${base}/${selected}`).then((v) => !stale && setData({ n: v.n, data: v.data }), (e) => !stale && setError(String(e.message ?? e)))
		return () => {
			stale = true
		}
	}, [selected])

	// Stepping: older and newer, where "newer" from the newest version comes back to the live canvas.
	const index = versions && selected !== null ? versions.findIndex((v) => v.n === selected) : -1
	const older = () => versions?.length && setSelected(versions[Math.min(index + 1, versions.length - 1)].n)
	const newer = () => versions && setSelected(index > 0 ? versions[index - 1].n : null)
	useEffect(() => {
		const typing = (e: Event) => !!(e.target as HTMLElement).closest?.('input, textarea, [contenteditable]')
		const onKey = (e: KeyboardEvent) => {
			if (typing(e)) return
			if (e.key === 'Escape') selected === null ? onClose() : setSelected(null)
			else if (e.key === 'ArrowLeft') older()
			else if (e.key === 'ArrowRight') newer()
			else {
				// Read-only means it: with a version on screen, no shortcut reaches the live editor beneath.
				if (selected !== null) e.stopPropagation()
				return
			}
			e.preventDefault()
			e.stopPropagation()
		}
		const shield = (e: Event) => {
			if (selected !== null && !typing(e)) e.stopPropagation()
		}
		window.addEventListener('keydown', onKey, true)
		for (const type of ['keyup', 'paste', 'cut', 'copy']) window.addEventListener(type, shield, true)
		return () => {
			window.removeEventListener('keydown', onKey, true)
			for (const type of ['keyup', 'paste', 'cut', 'copy']) window.removeEventListener(type, shield, true)
		}
	})

	async function save(e: FormEvent) {
		e.preventDefault()
		if (!name.trim()) return
		try {
			await api(base, { method: 'POST', body: JSON.stringify({ label: name.trim() }) })
			setName('')
			load()
		} catch (err: any) {
			setError(err.message)
		}
	}
	async function restore(n: number) {
		try {
			const v = await api(`${base}/${n}/restore`, { method: 'POST' })
			const r = await api(base)
			setVersions(r.versions)
			setCurrent(r.current)
			setSelected(null)
			setRestored(v.unchanged ? null : { n, undo: v.undo })
		} catch (err: any) {
			setError(err.message)
		}
	}

	const rows = useMemo(() => {
		const out: ({ day: string } | VersionRow)[] = []
		for (const v of versions ?? []) {
			const d = day(v.t)
			if (!out.some((r) => 'day' in r && r.day === d)) out.push({ day: d })
			out.push(v)
		}
		return out
	}, [versions])
	const shown = versions?.find((v) => v.n === selected)

	return (
		<>
			{selected !== null && (
				<div className="absolute inset-0 z-[450] bg-background">
					{/* Beside the panel on a wide screen, above it on a narrow one, so a fitted version is all in view. */}
					<div className="absolute inset-y-0 left-0 right-0 max-md:bottom-[55%] md:right-[336px]">{data && <Preview data={data.data} />}</div>
					<div aria-hidden className="pointer-events-none absolute inset-0 z-10 border-2 border-amber-500/70" />
					<div className="toucan-ui absolute top-2 left-1/2 z-20 -translate-x-1/2 rounded-md border whitespace-nowrap md:left-[calc((100%-336px)/2)] border-amber-500/40 bg-amber-100 px-2 py-1 text-xs font-medium text-amber-950 dark:bg-amber-950 dark:text-amber-100">
						Viewing v{selected}, read-only
					</div>
				</div>
			)}
			<section aria-label="Version history" className="toucan-ui absolute inset-y-2 right-2 z-[460] flex w-80 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl border bg-background text-sm shadow-lg max-md:inset-x-2 max-md:top-auto max-md:h-[55%] max-md:w-auto">
				<header className="flex items-center gap-1 border-b py-1.5 pr-1.5 pl-3">
					<HistoryIcon className="size-4 text-muted-foreground" />
					<h2 className="font-medium">History</h2>
					<span className="flex-1" />
					<Button variant="ghost" size="icon-sm" aria-label="Older version" title="Older (←)" disabled={!versions?.length || index === versions.length - 1} onClick={older}>
						<ChevronLeftIcon />
					</Button>
					<Button variant="ghost" size="icon-sm" aria-label="Newer version" title="Newer (→)" disabled={selected === null} onClick={newer}>
						<ChevronRightIcon />
					</Button>
					<Button variant="ghost" size="icon-sm" aria-label="Close history" title="Close (Esc)" onClick={onClose}>
						<XIcon />
					</Button>
				</header>

				<form onSubmit={save} className="flex gap-1.5 border-b p-2">
					<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this moment…" aria-label="Version name" className="h-7 text-xs" onKeyDown={(e) => e.stopPropagation()} />
					<Button type="submit" variant="outline" size="sm" disabled={!name.trim()}>
						Save
					</Button>
				</form>

				{restored && (
					<div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-1.5 text-xs" role="status">
						<span className="flex-1">Restored v{restored.n} for everyone.</span>
						{restored.undo !== null && (
							<Button variant="outline" size="xs" onClick={() => restored.undo !== null && restore(restored.undo).then(() => setRestored(null))}>
								Undo
							</Button>
						)}
					</div>
				)}
				{error && (
					<p role="alert" className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive" onClick={() => setError('')}>
						{error}
					</p>
				)}

				<ol className="min-h-0 flex-1 overflow-y-auto py-1">
					<li>
						<button type="button" onClick={() => setSelected(null)} aria-current={selected === null} className={cn('flex w-full items-baseline gap-2 px-3 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted', selected === null && 'bg-muted')}>
							<span className="font-medium">Now</span>
							<span className="text-xs text-muted-foreground">{current ? 'the live canvas' : 'the live canvas, with unsaved edits'}</span>
						</button>
					</li>
					{versions === null && <li className="px-3 py-2 text-xs text-muted-foreground">Loading…</li>}
					{versions?.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">No versions yet. One is saved shortly after the next edit, or name this moment above.</li>}
					{rows.map((r) =>
						'day' in r ? (
							<li key={r.day} className="px-3 pt-3 pb-0.5 text-xs font-medium text-muted-foreground">
								{r.day}
							</li>
						) : (
							<li key={r.n}>
								<button type="button" onClick={() => setSelected(r.n)} aria-current={selected === r.n} title={r.keys.length ? r.keys.join(', ') : undefined} className={cn('flex w-full items-start gap-2 px-3 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted', selected === r.n && 'bg-amber-100 hover:bg-amber-100 dark:bg-amber-950 dark:hover:bg-amber-950')}>
									<span className="w-14 shrink-0 pt-px text-xs text-muted-foreground tabular-nums">{time(r.t)}</span>
									<span className="min-w-0 flex-1">
										<span className={cn('flex items-center gap-1 break-words', r.named && 'font-medium')}>
											{r.named && <BookmarkIcon className="size-3 shrink-0" />}
											{r.source === 'agent' && !r.named && <BotIcon className="size-3 shrink-0 text-violet-500" aria-label="agent" />}
											{r.source === 'restore' && <RotateCcwIcon className="size-3 shrink-0 text-muted-foreground" />}
											<span className="line-clamp-2 min-w-0">{stepTitle(r)}</span>
										</span>
										<span className="block text-xs text-muted-foreground tabular-nums">
											{[r.added && `+${r.added}`, r.updated && `~${r.updated}`, r.removed && `−${r.removed}`].filter(Boolean).join(' ') || 'no shape changes'} · {plural(r.count, 'shape')}
										</span>
									</span>
								</button>
							</li>
						),
					)}
				</ol>

				{shown && (
					<footer className="space-y-1.5 border-t p-2">
						<Button className="w-full" onClick={() => restore(shown.n)}>
							<RotateCcwIcon /> Restore v{shown.n}
						</Button>
						<p className="text-center text-xs text-muted-foreground">What's on the canvas now is saved first.</p>
					</footer>
				)}
			</section>
		</>
	)
}
