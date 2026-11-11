import { useEffect, useState, type FormEvent } from 'react'
import { ArchiveIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { api, token } from './net'
import { AppearanceMenu } from './Appearance'

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
	openThreads?: number
	open: number
	thumb: number | null
}

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
	const [templates, setTemplates] = useState<{ id: string; title: string; use: string; type?: string; group?: string; parts?: string[] }[]>([])
	const [groups, setGroups] = useState<{ id: string; label: string }[]>([])
	useEffect(() => {
		api('/api/templates').then((r) => (setTemplates(r.templates), setGroups(r.groups ?? [])), () => {})
	}, [])

	const load = () => api('/api/canvases').then((r) => setCanvases(r.canvases), (e) => setError(String(e.message ?? e)))
	useEffect(() => {
		load()
		const t = setInterval(load, 10000)
		return () => clearInterval(t)
	}, [])

	async function create(e: FormEvent) {
		e.preventDefault()
		const n = nameEdited ? name : slug(title) || (from.startsWith('template:') ? `${from.slice(9)}-${Date.now().toString(36).slice(-4)}` : '')
		if (!n) return
		try {
			await api('/api/canvases', { method: 'POST', body: JSON.stringify({ name: n, ...(title && { title }), engine, ...(from.startsWith('template:') ? { template: from.slice(9) } : from && { from }) }) })
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
				<header className="mb-6 flex items-center gap-2">
					<div className="min-w-0 flex-1">
						<h1 className="text-xl font-semibold tracking-tight">toucan</h1>
						<p className="text-sm text-muted-foreground">Canvases you and your agents share.</p>
					</div>
					<AppearanceMenu />
					<Popover>
						<PopoverTrigger asChild>
							<Button>
								<PlusIcon /> New canvas
							</Button>
						</PopoverTrigger>
						<PopoverContent>
							<form onSubmit={create} className="space-y-2">
								<label className="block space-y-1 text-xs font-medium">
									Title
									<Input placeholder="Launch plan" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
								</label>
								<label className="block space-y-1 text-xs font-medium">
									Name, for the URL and the CLI
									<Input className="font-mono" placeholder="launch-plan" value={nameEdited ? name : slug(title)} onChange={(e) => (setNameEdited(true), setName(slug(e.target.value)))} />
								</label>
								<label className="block space-y-1 text-xs font-medium">
									Engine
									<select className={cn(SELECT, 'w-full font-normal')} value={engine} onChange={(e) => setEngine(e.target.value)}>
										<option value="tldraw">tldraw</option>
										<option value="excalidraw">Excalidraw</option>
									</select>
								</label>
								<label className="block space-y-1 text-xs font-medium">
									Start from
									<select className={cn(SELECT, 'w-full font-normal')} value={from} onChange={(e) => setFrom(e.target.value)}>
										<option value="">Blank</option>
										{/* Starters are whole canvases on one subject; blocks are one diagram each, grouped by what they're for. */}
										{[{ id: 'starter', label: 'Starters', list: templates.filter((t) => t.type === 'starter') }, ...groups.map((g) => ({ id: g.id, label: g.label, list: templates.filter((t) => t.type !== 'starter' && t.group === g.id) }))]
											.filter((g) => g.list.length)
											.map((g) => (
												<optgroup key={g.id} label={g.label}>
													{g.list.map((t) => (
														<option key={t.id} value={`template:${t.id}`}>
															{t.title}
														</option>
													))}
												</optgroup>
											))}
										{!!canvases?.length && (
											<optgroup label="Copy of">
												{canvases.map((c) => (
													<option key={c.name} value={c.name}>
														{c.title}
													</option>
												))}
											</optgroup>
										)}
									</select>
								</label>
								{from.startsWith('template:') && (() => {
									const t = templates.find((x) => `template:${x.id}` === from)
									return (
										<p className="text-xs text-muted-foreground">
											{t?.use}
											{t?.parts && ` It has: ${t.parts.join(', ').toLowerCase()}.`}
										</p>
									)
								})()}
								<Button type="submit" className="w-full" disabled={!(nameEdited ? name : slug(title)) && !from.startsWith('template:')}>
									Create
								</Button>
							</form>
						</PopoverContent>
					</Popover>
				</header>

				{error && (
					<p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" onClick={() => setError('')}>
						{error}
					</p>
				)}

				{canvases === null ? (
					<p className="text-sm text-muted-foreground">Loading…</p>
				) : canvases.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No canvases yet. Make one above, or ask your agent to, from your project: <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">toucan init</code>
					</p>
				) : (
					<ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
						{[...canvases].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0)).map((c) => (
							<li key={c.name} className="group relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md">
								<a href={href(c.name)} className="flex flex-1 flex-col focus-visible:outline-none">
									<div className={cn('flex aspect-[16/10] items-center justify-center overflow-hidden border-b', c.thumb ? 'bg-white' : 'bg-muted')}>
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
										<p className="text-xs text-muted-foreground" title={c.name}>
											{c.shapes} shape{c.shapes === 1 ? '' : 's'}
											{(c.openThreads ?? 0) > 0 && ` · ${c.openThreads} open thread${c.openThreads === 1 ? '' : 's'}`}
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
