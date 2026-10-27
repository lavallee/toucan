import { useEffect, useState, type FormEvent } from 'react'
import { ArchiveIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { api, token } from './net'

type Canvas = {
	engine: string
	name: string
	title: string
	description: string
	created: string | null
	updated: number | null
	shapes: number
	pages: number
	scripts: string[]
	open: number
	thumb: number | null
}

document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches)
document.title = 'toucan'

const ago = (ms: number | null) => {
	if (!ms) return 'never edited'
	const s = (Date.now() - ms) / 1000
	for (const [n, unit] of [[86400, 'day'], [3600, 'hour'], [60, 'minute']] as const)
		if (s >= n) return `${Math.floor(s / n)} ${unit}${Math.floor(s / n) > 1 ? 's' : ''} ago`
	return 'just now'
}
const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
const SELECT = 'h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'
const href = (name: string) => `/?canvas=${encodeURIComponent(name)}`

export function Index() {
	const [canvases, setCanvases] = useState<Canvas[] | null>(null)
	const [error, setError] = useState('')
	const [title, setTitle] = useState('')
	const [name, setName] = useState('')
	const [nameEdited, setNameEdited] = useState(false)
	const [engine, setEngine] = useState('tldraw')
	const [from, setFrom] = useState('')

	const load = () => api('/api/canvases').then((r) => setCanvases(r.canvases), (e) => setError(String(e.message ?? e)))
	useEffect(() => {
		load()
		const t = setInterval(load, 10000)
		return () => clearInterval(t)
	}, [])

	async function create(e: FormEvent) {
		e.preventDefault()
		const n = nameEdited ? name : slug(title)
		if (!n) return
		try {
			await api('/api/canvases', { method: 'POST', body: JSON.stringify({ name: n, title: title || n, engine, ...(from && { from }) }) })
			location.href = href(n)
		} catch (err: any) {
			setError(err.message)
		}
	}

	async function archive(c: Canvas) {
		if (!confirm(`Archive "${c.title}"? Its files move to the archive on the server; nothing is deleted.`)) return
		try {
			await api(`/api/canvases/${c.name}/archive`, { method: 'POST' })
			load()
		} catch (err: any) {
			setError(err.message)
		}
	}

	return (
		<div className="toucan-ui min-h-full bg-background text-foreground">
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
				<header className="mb-6 flex flex-wrap items-end justify-between gap-4">
					<div>
						<h1 className="text-2xl font-semibold tracking-tight">toucan</h1>
						<p className="text-sm text-muted-foreground">Canvases on this server, in tldraw or Excalidraw. Each has its own chat thread and scripts; a copy converts between engines.</p>
					</div>
					<form onSubmit={create} className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
						<Input
							className="sm:w-56"
							placeholder="New canvas title"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							aria-label="Title"
						/>
						<Input
							className="font-mono sm:w-40"
							placeholder="name"
							value={nameEdited ? name : slug(title)}
							onChange={(e) => (setNameEdited(true), setName(slug(e.target.value)))}
							aria-label="Name (used in the URL and the CLI's --canvas)"
						/>
						<select className={SELECT} value={engine} onChange={(e) => setEngine(e.target.value)} aria-label="Engine">
							<option value="tldraw">tldraw</option>
							<option value="excalidraw">Excalidraw</option>
						</select>
						<select className={cn(SELECT, "max-w-52")} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Start from">
							<option value="">Blank</option>
							{canvases?.map((c) => (
								<option key={c.name} value={c.name}>
									Copy of {c.title}
								</option>
							))}
						</select>
						<Button type="submit" disabled={!(nameEdited ? name : slug(title))}>
							<PlusIcon /> New
						</Button>
					</form>
				</header>

				{error && (
					<p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" onClick={() => setError('')}>
						{error}
					</p>
				)}

				{canvases === null ? (
					<p className="text-sm text-muted-foreground">Loading…</p>
				) : canvases.length === 0 ? (
					<p className="text-sm text-muted-foreground">No canvases yet. Make one above.</p>
				) : (
					<ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
						{canvases.map((c) => (
							<li key={c.name} className="group relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md">
								<a href={href(c.name)} className="flex flex-1 flex-col focus-visible:outline-none">
									<div className="flex aspect-[16/10] items-center justify-center overflow-hidden border-b bg-muted">
										{c.thumb ? (
											<img
												src={`/api/canvases/${c.name}/thumb?v=${c.thumb}&token=${encodeURIComponent(token)}`}
												alt=""
												className="size-full object-contain"
												loading="lazy"
											/>
										) : (
											<span className="text-xs text-muted-foreground">{c.shapes ? 'Preview appears after the canvas is opened' : 'Empty'}</span>
										)}
									</div>
									<div className="space-y-1 p-3">
										<div className="flex items-center gap-2">
											<span className="truncate font-medium">{c.title}</span>
											{c.engine !== 'tldraw' && <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{c.engine}</span>}
											{c.open > 0 && <span className="size-2 shrink-0 rounded-full bg-emerald-500" title={`open in ${c.open} tab${c.open > 1 ? 's' : ''}`} />}
										</div>
										{c.description && <p className="line-clamp-2 text-sm text-muted-foreground">{c.description}</p>}
										<p className="font-mono text-xs text-muted-foreground">
											{c.name} · {c.shapes} shape{c.shapes === 1 ? '' : 's'}
											{c.scripts.length > 0 && ` · ${c.scripts.length} script${c.scripts.length > 1 ? 's' : ''}`} · {ago(c.updated)}
										</p>
									</div>
								</a>
								<Button
									variant="secondary"
									size="icon-xs"
									className={cn('absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100', c.open > 0 && 'hidden')}
									title="Archive"
									aria-label={`Archive ${c.title}`}
									onClick={() => archive(c)}
								>
									<ArchiveIcon />
								</Button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	)
}
