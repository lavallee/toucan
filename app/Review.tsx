import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ImagesIcon } from 'lucide-react'
import { Button } from '@lyra-forge/leyline/ui/button'
import { Textarea } from '@lyra-forge/leyline/ui/textarea'
import { AppBarButton } from '@lyra-forge/leyline/app-bar'
import { api, canvasName, token } from './net'

type Point = { x: number; y: number }
type Revision = {
	id: string; artifact: string; producer: string; number: number; title: string; caption: string | null
	at: string; previous: string | null
}
type Note = {
	id: string; revision: string; at: string; pin: Point; author: string; text: string; closedAt: string | null
	reply: { text: string; producer: string; replacement: string | null } | null
}
type Review = { revisions: Revision[]; notes: Note[] }
const protocol = 'toucan.review/1'
const path = `/api/canvases/${encodeURIComponent(canvasName)}/review`
const date = (at: string) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function useScreenshot(id?: string) {
	const [image, setImage] = useState<{ id: string; url?: string; error?: string } | null>(null)
	useEffect(() => {
		if (!id) return
		const controller = new AbortController()
		let url: string | undefined
		fetch(`${path}/${id}/image`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal })
			.then((res) => {
				if (!res.ok) throw new Error(`Screenshot unavailable (${res.status})`)
				return res.blob()
			})
			.then((blob) => {
				if (controller.signal.aborted) return
				url = URL.createObjectURL(blob)
				setImage({ id, url })
			})
			.catch((err) => {
				if (!controller.signal.aborted) setImage({ id, error: err.message })
			})
		return () => {
			controller.abort()
			if (url) URL.revokeObjectURL(url)
		}
	}, [id])
	return image?.id === id ? image : null
}

export function ReviewButton() {
	const dialog = useRef<HTMLDialogElement>(null)
	const [open, setOpen] = useState(false)
	return <>
		<AppBarButton icon={ImagesIcon} label="Review" title="Review screenshots" onClick={() => { dialog.current?.showModal(); setOpen(true) }} />
		<dialog ref={dialog} onClose={() => setOpen(false)} aria-labelledby="review-title" className="toucan-ui fixed inset-0 m-auto max-h-[90dvh] w-[min(96vw,76rem)] max-w-none overflow-auto rounded-lg border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50">
			<div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background px-4 py-3">
				<h2 id="review-title" className="font-semibold">Screenshot review</h2>
				<Button variant="ghost" size="sm" onClick={() => dialog.current?.close()}>Close</Button>
			</div>
			{open && <ReviewContent />}
		</dialog>
	</>
}

function ReviewContent() {
	const [review, setReview] = useState<Review | null>(null)
	const [loadError, setLoadError] = useState('')
	const [selected, setSelected] = useState('')
	const [compare, setCompare] = useState(false)
	const [compareBase, setCompareBase] = useState<string | null>(null)
	const [active, setActive] = useState('')
	const [pin, setPin] = useState<Point | null>(null)
	const [draft, setDraft] = useState('')
	const [writeError, setWriteError] = useState('')
	const [busy, setBusy] = useState(false)
	const writes = useRef(0)
	const retry = useRef<{ payload: string; mutation: string } | null>(null)

	useEffect(() => {
		let stopped = false
		let timer: ReturnType<typeof setTimeout>
		const refresh = async () => {
			try {
				const seen = writes.current
				const snapshot = await api(path)
				if (!stopped && seen === writes.current) { setReview(snapshot); setLoadError('') }
			} catch (err) {
				if (!stopped) setLoadError((err as Error).message)
			}
			if (!stopped) timer = setTimeout(refresh, 4000)
		}
		void refresh()
		return () => { stopped = true; clearTimeout(timer) }
	}, [])

	const all = review?.revisions ?? []
	const current = all.find((rev) => rev.id === selected) ?? all.at(-1)
	const previous = compare ? all.find((rev) => rev.id === (compareBase ?? current?.previous)) : undefined
	const latestByArtifact = new Map(all.map((rev) => [rev.artifact, rev]))
	const notes = review?.notes.filter((note) => note.revision === current?.id) ?? []
	const screenshot = useScreenshot(current?.id)
	const before = useScreenshot(previous?.id)

	function select(id: string) {
		setSelected(id)
		setCompareBase(null)
		setActive('')
		setPin(null)
		setDraft('')
		setWriteError('')
	}

	function pick(event: MouseEvent<HTMLButtonElement>) {
		const bounds = event.currentTarget.getBoundingClientRect()
		setPin(event.detail ? { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height } : { x: 0.5, y: 0.5 })
		setActive('')
		setSelected(current?.id ?? '')
	}

	async function mutate(input: object) {
		if (busy) return
		setWriteError('')
		setBusy(true)
		const payload = JSON.stringify(input)
		if (retry.current?.payload !== payload) retry.current = { payload, mutation: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('') }
		try {
			const { note } = await api(path, { method: 'POST', body: JSON.stringify({ protocol, mutation: retry.current.mutation, ...input }) })
			writes.current++
			setReview((old) => old && { ...old, notes: [...old.notes.filter((n) => n.id !== note.id), note].sort((a, b) => a.at.localeCompare(b.at)) })
			if ('op' in input && input.op === 'pin') {
				setActive(note.id)
				setPin(null)
				setDraft('')
			}
			retry.current = null
		} catch (err) { setWriteError((err as Error).message) }
		finally { setBusy(false) }
	}

	const marker = 'absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white bg-blue-700 text-xs font-semibold text-white shadow'
	return <div className="space-y-4 p-4">
		{loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
		{!review && !loadError && <p role="status">Loading review…</p>}
		{review && !current && <p className="text-sm text-muted-foreground">No screenshots yet. Publish one with <code>toucan review post</code>.</p>}
		{current && <>
			<div className="flex flex-wrap items-end gap-3">
				<label className="grid min-w-0 gap-1 text-xs font-medium">Artifact
					<select className="max-w-full rounded border bg-background p-1.5 text-sm" value={current.artifact} disabled={busy} onChange={(event) => {
						const revision = latestByArtifact.get(event.target.value)
						if (revision) select(revision.id)
					}}>
						{[...latestByArtifact.values()].map((rev) => <option key={rev.artifact} value={rev.artifact}>{rev.title} · {rev.artifact}</option>)}
					</select>
				</label>
				<label className="grid gap-1 text-xs font-medium">Revision
					<select className="rounded border bg-background p-1.5 text-sm" value={current.id} disabled={busy} onChange={(event) => select(event.target.value)}>
						{all.filter((rev) => rev.artifact === current.artifact).reverse().map((rev) => <option key={rev.id} value={rev.id}>v{rev.number} · {date(rev.at)}</option>)}
					</select>
				</label>
				<Button size="sm" variant="outline" disabled={!current.previous} aria-pressed={!!previous} onClick={() => { setCompareBase(null); setCompare(!compare) }}>{compareBase ? 'Hide comparison' : 'Compare with previous'}</Button>
			</div>
			{current.caption && <p className="whitespace-pre-wrap break-words text-sm">{current.caption}</p>}
			<div className={previous ? 'grid gap-3 md:grid-cols-2' : 'grid gap-3'}>
				{previous && <figure className="min-w-0">
					<figcaption className="pb-1 text-xs font-medium">Before · v{previous.number}</figcaption>
					{before?.url ? <img src={before.url} alt={previous.title} className="w-full rounded border" /> : <p role="status">{before?.error ?? 'Loading previous screenshot…'}</p>}
				</figure>}
				<figure className="min-w-0">
					<figcaption className="pb-1 text-xs font-medium">{previous ? `After · v${current.number}` : 'Select a point on the screenshot to leave feedback.'}</figcaption>
					{screenshot?.url ? <div className="relative">
						<button type="button" disabled={busy} className="block w-full cursor-crosshair rounded outline outline-1 outline-border" aria-label="Place feedback pin on screenshot" onClick={pick}>
							<img src={screenshot.url} alt={current.title} className="w-full" />
						</button>
						{notes.map((note, i) => <button type="button" key={note.id} aria-label={`Show note ${i + 1}`} aria-pressed={active === note.id} className={`${marker} ${note.closedAt ? 'opacity-60' : ''} aria-pressed:ring-2 aria-pressed:ring-blue-500`} style={{ left: `${note.pin.x * 100}%`, top: `${note.pin.y * 100}%` }} onClick={() => {
							setActive(note.id)
							document.getElementById(`review-note-${note.id}`)?.scrollIntoView({ block: 'nearest' })
						}}>{i + 1}</button>)}
						{pin && <span aria-hidden className={`${marker} pointer-events-none`} style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}>+</span>}
					</div> : <p role="status">{screenshot?.error ?? 'Loading screenshot…'}</p>}
				</figure>
			</div>
			{pin && <form className="space-y-2" onSubmit={(event) => {
				event.preventDefault()
				void mutate({ op: 'pin', revision: current.id, pin, author: 'Reviewer', text: draft })
			}}>
				<label className="block text-sm font-medium" htmlFor="review-draft">Feedback</label>
				<Textarea id="review-draft" required maxLength={4000} value={draft} onChange={(event) => setDraft(event.target.value)} />
				<Button type="submit" size="sm" disabled={busy || !draft.trim()}>Post feedback</Button>
				<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setPin(null); setDraft('') }}>Cancel</Button>
			</form>}
			{writeError && <p role="alert" className="text-sm text-destructive">{writeError}</p>}
			{notes.length > 0 && <ol aria-label="Feedback" className="space-y-2">
				{notes.map((note, i) => <li key={note.id} id={`review-note-${note.id}`} className={`space-y-2 rounded border p-3 text-sm ${active === note.id ? 'border-blue-500' : ''}`}>
					<p className="text-xs text-muted-foreground">{i + 1} · {note.author} · {date(note.at)} · {note.closedAt ? 'Closed' : note.reply ? 'Answered' : 'Awaiting reply'}</p>
					<p className="whitespace-pre-wrap break-words">{note.text}</p>
					{note.reply && <div className="space-y-1 border-l-2 pl-3">
						<p className="text-xs text-muted-foreground">Reply · {note.reply.producer}</p>
						<p className="whitespace-pre-wrap break-words">{note.reply.text}</p>
						{note.reply.replacement && <Button variant="outline" size="sm" onClick={() => { select(note.reply!.replacement!); setCompareBase(note.revision); setCompare(true) }}>View revised screenshot</Button>}
					</div>}
					{!note.closedAt && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate({ op: 'close', note: note.id })}>Close note</Button>}
				</li>)}
			</ol>}
		</>}
	</div>
}
