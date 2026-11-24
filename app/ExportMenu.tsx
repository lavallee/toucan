import { useEffect, useState } from 'react'
import { CheckIcon, CopyIcon, DownloadIcon, FilmIcon, ImageUpIcon, LoaderCircleIcon, ShareIcon } from 'lucide-react'
import { Button } from '@lyra-forge/leyline/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@lyra-forge/leyline/ui/popover'
import { cn } from '@/lib/utils'
import { AppBarButton } from '@lyra-forge/leyline/app-bar'
import { api, canvasName, token } from './net'

const SPEEDS = [
	{ id: 'slow', label: 'Slow', step: 1100 },
	{ id: 'normal', label: 'Normal', step: 700 },
	{ id: 'fast', label: 'Fast', step: 400 },
]
// The diagram as a file other tools read. Each is the server's copy of the graph in that form (lib/tg.mjs FORMATS).
const FILES = [
	{ format: 'mermaid', ext: 'mmd', label: 'Mermaid', about: 'A flowchart, for a README or a doc' },
	{ format: 'jsoncanvas', ext: 'canvas', label: 'JSON Canvas', about: 'Opens in Obsidian' },
	{ format: 'excalidraw', ext: 'excalidraw', label: 'Excalidraw', about: 'Opens in Excalidraw' },
	{ format: 'dot', ext: 'dot', label: 'DOT', about: 'For Graphviz' },
	{ format: 'tg', ext: 'tg.json', label: 'Toucan graph', about: 'Every key, box and arrow, to import again' },
]

const graphAs = async (format: string) => {
	const res = await fetch(`/api/canvases/${encodeURIComponent(canvasName)}/graph?format=${format}`, { headers: { authorization: `Bearer ${token}` } })
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
	return res.text()
}
function save(name: string, data: BlobPart, type: string) {
	const url = URL.createObjectURL(new Blob([data], { type }))
	const a = Object.assign(document.createElement('a'), { href: url, download: name })
	document.body.append(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

// A rendition: a named picture of part of the canvas that documents include by name (server/renditions.mjs).
type Rendition = { name: string; state: 'current' | 'behind' | 'unpublished'; why?: string; format: string; picture: string | null; catalogue: string }
const RENDITION = /^[a-z0-9][a-z0-9._-]{0,63}$/
const renditionsAt = (name = '') => `/api/canvases/${encodeURIComponent(canvasName)}/renditions${name ? `/${encodeURIComponent(name)}` : ''}`

/**
 * Everything a canvas can leave as: a picture (SVG or PNG), an animated build (a GIF, app/animate.js), a file another tool reads, or
 * what it says in words. Pictures are made in this tab from what's on the canvas now; nothing on it changes. `toucan export OUT`
 * writes the same from the CLI.
 */
export function ExportMenu() {
	const [open, setOpen] = useState(false)
	const [speed, setSpeed] = useState('normal')
	const [busy, setBusy] = useState('')
	const [error, setError] = useState('')
	const [copied, setCopied] = useState(false)
	const [made, setMade] = useState<{ url: string; frames: number } | null>(null)
	useEffect(() => () => made && URL.revokeObjectURL(made.url), [made])
	const [renditions, setRenditions] = useState<Rendition[]>([])
	const [newName, setNewName] = useState('')
	const [published, setPublished] = useState('')
	const loadRenditions = () => api(renditionsAt()).then((r) => setRenditions(r.renditions)).catch(() => setRenditions([]))
	useEffect(() => {
		if (open) loadRenditions()
	}, [open])
	// One thing at a time, and whatever goes wrong is said in the menu.
	const run = (what: string, work: () => Promise<void>) => async () => {
		setBusy(what)
		setError('')
		try {
			await work()
		} catch (e: any) {
			setError(e.message ?? String(e))
		}
		setBusy('')
	}
	const toucan = () => (window as any).toucan
	const empty = () => new Error('There is nothing on the canvas to export.')
	const svg = run('svg', async () => {
		// The picture carries its title and what it says in words, for a screen reader and for search.
		const title = document.title.replace(/ · toucan$/, '')
		const r = await toucan()?.svg?.({ title, desc: await graphAs('text') })
		if (!r) throw empty()
		save(`${canvasName}.svg`, r.svg, 'image/svg+xml')
	})
	const png = run('png', async () => {
		const b64 = await toucan()?.screenshot?.({ max: 3000 })
		if (!b64) throw empty()
		save(`${canvasName}.png`, bytesOf(b64), 'image/png')
	})
	const gif = run('gif', async () => {
		const r = await toucan()?.animate?.({ step: SPEEDS.find((s) => s.id === speed)!.step })
		if (!r) throw empty()
		setMade({ url: URL.createObjectURL(new Blob([bytesOf(r.gif)], { type: 'image/gif' })), frames: r.frames })
	})
	const file = (f: (typeof FILES)[number]) => run(f.format, async () => save(`${canvasName}.${f.ext}`, await graphAs(f.format), 'text/plain'))
	const words = run('text', async () => {
		await navigator.clipboard.writeText(await graphAs('text'))
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	})
	// Publishing draws on the server's side, in this tab, and lists the picture in the include catalogue. A new name shows what is
	// selected, or the whole canvas; an existing one keeps what it shows. Only ever when asked.
	const publish = (name: string) =>
		run(`rendition:${name}`, async () => {
			if (!RENDITION.test(name)) throw new Error('A rendition name is lower case letters, digits and . _ -, starting with a letter or digit.')
			if (!renditions.some((r) => r.name === name)) {
				const keys: string[] = (toucan()?.selection?.().here ?? []).map((s: { key: string }) => s.key)
				await api(renditionsAt(name), { method: 'PUT', body: JSON.stringify({ select: keys.length ? { keys } : { all: true }, format: 'svg' }) })
			}
			const r = await api(`${renditionsAt(name)}/publish`, { method: 'POST', body: JSON.stringify({ agent: 'toucan' }) })
			if (r.catalogue?.error) throw new Error(`Published, but the include catalogue wasn't changed: ${r.catalogue.error}`)
			setNewName('')
			setPublished(`${r.unchanged ? 'Unchanged' : 'Published'}: ${r.catalogue?.name ?? name}`)
			await loadRenditions()
		})
	const spin = (what: string, icon: React.ReactNode) => (busy === what ? <LoaderCircleIcon className="animate-spin" /> : icon)
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<AppBarButton icon={ShareIcon} label="Export" pressed={open} title="Export: a picture, an animated build, or a file another tool reads" />
			</PopoverTrigger>
			<PopoverContent className="max-h-[80vh] w-80 overflow-y-auto p-0" align="end">
				<header className="border-b px-3 py-2">
					<h2 className="font-medium">Export</h2>
					<p className="text-xs text-muted-foreground">Take this canvas somewhere else. Nothing on it changes.</p>
				</header>
				{error && (
					<p role="alert" className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
						{error}
					</p>
				)}
				<section className="border-b p-2" aria-label="Picture">
					<h3 className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">Picture</h3>
					<div className="flex gap-2">
						<Button variant="outline" size="sm" className="flex-1" onClick={svg} disabled={!!busy} title="Sharp at any size, with what the diagram says in words inside it. For a document, a slide or a pull request.">
							{spin('svg', <DownloadIcon />)} SVG
						</Button>
						<Button variant="outline" size="sm" className="flex-1" onClick={png} disabled={!!busy} title="An image, for anywhere an SVG won't go">
							{spin('png', <DownloadIcon />)} PNG
						</Button>
					</div>
				</section>
				<section className="border-b p-2" aria-label="Rendition">
					<h3 className="px-1 pb-0.5 text-xs font-medium text-muted-foreground">Rendition</h3>
					<p className="px-1 pb-1.5 text-xs text-muted-foreground">A named picture of the selection (or the whole canvas) that documents include by name, and that says when the canvas has moved on.</p>
					{renditions.length > 0 && (
						<ul className="pb-1.5">
							{renditions.map((r) => (
								<li key={r.name} className="flex items-center gap-2 px-1 py-0.5 text-sm">
									<span className="flex-1 truncate" title={r.picture ?? 'not drawn yet'}>
										{r.name} <span className={cn('text-xs', r.state === 'current' ? 'text-muted-foreground' : 'text-amber-600')} title={r.why}>{r.state}</span>
									</span>
									<Button size="sm" variant="ghost" onClick={publish(r.name)} disabled={!!busy} aria-label={`Publish ${r.name}`}>
										{spin(`rendition:${r.name}`, <ImageUpIcon />)} Publish
									</Button>
								</li>
							))}
						</ul>
					)}
					<form
						className="flex gap-2"
						onSubmit={(e) => {
							e.preventDefault()
							publish(newName.trim())()
						}}
					>
						<input value={newName} onChange={(e) => setNewName(e.target.value.toLowerCase())} placeholder="name, e.g. how-it-works" aria-label="Rendition name" className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-sm" />
						<Button type="submit" size="sm" variant="outline" disabled={!!busy || !newName.trim()}>
							{spin(`rendition:${newName.trim()}`, <ImageUpIcon />)} Publish as a rendition
						</Button>
					</form>
					{published && <p className="px-1 pt-1.5 text-xs text-muted-foreground" role="status">{published}</p>}
				</section>
				<section className="border-b p-2" aria-label="Animated build">
					<h3 className="px-1 pb-0.5 text-xs font-medium text-muted-foreground">Animated build</h3>
					<p className="px-1 pb-1.5 text-xs text-muted-foreground">A GIF of this diagram building up, box by box in the order the arrows go.</p>
					<div className="flex items-center gap-1" role="radiogroup" aria-label="Animation speed">
						{SPEEDS.map((s) => (
							<button key={s.id} type="button" role="radio" aria-checked={speed === s.id} onClick={() => setSpeed(s.id)} className={cn('rounded-md px-2 py-1 text-xs outline-none hover:bg-muted focus-visible:bg-muted', speed === s.id && 'bg-muted font-medium')}>
								{s.label}
							</button>
						))}
						<span className="flex-1" />
						<Button size="sm" variant="outline" onClick={gif} disabled={!!busy}>
							{spin('gif', <FilmIcon />)}
							{made ? 'Make again' : 'Make GIF'}
						</Button>
					</div>
					{made && (
						<div className="space-y-2 pt-2">
							<img src={made.url} alt="The animated build" className="w-full rounded border" />
							<a href={made.url} download={`${canvasName}.gif`} className="flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-sm hover:bg-muted">
								<DownloadIcon className="size-4" />
								Download GIF <span className="text-xs text-muted-foreground">({made.frames} frames)</span>
							</a>
						</div>
					)}
				</section>
				<section className="border-b p-1" aria-label="File for another tool">
					<h3 className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">File for another tool</h3>
					<ul>
						{FILES.map((f) => (
							<li key={f.format}>
								<button type="button" onClick={file(f)} disabled={!!busy} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted disabled:opacity-50">
									{busy === f.format ? <LoaderCircleIcon className="size-4 shrink-0 animate-spin" /> : <DownloadIcon className="size-4 shrink-0 text-muted-foreground" />}
									<span className="flex-1">
										{f.label} <span className="text-xs text-muted-foreground">.{f.ext}</span>
										<span className="block text-xs text-muted-foreground">{f.about}</span>
									</span>
								</button>
							</li>
						))}
					</ul>
				</section>
				<section className="p-2" aria-label="In words">
					<Button variant="ghost" size="sm" className="w-full justify-start" onClick={words} disabled={!!busy} title="Its frames, boxes, states and arrows as plain text: alt text for the picture, or to paste into a message">
						{copied ? <CheckIcon /> : spin('text', <CopyIcon />)}
						{copied ? 'Copied' : 'Copy what it says, in words'}
					</Button>
				</section>
			</PopoverContent>
		</Popover>
	)
}
