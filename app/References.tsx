import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftIcon, BookOpenIcon, ExternalLinkIcon, FileIcon, FileTextIcon, GlobeIcon, ImageIcon, Maximize2Icon, Minimize2Icon, SearchIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CodeBlock, CodeBlockContent, CodeBlockLine } from '@/components/ui/code-block'
import { Markdown } from '@/components/markdown'
import { defaultRehypePlugins } from 'streamdown'
import { useHighlightedCode } from '@/hooks/use-highlighted-code'
import { cn } from '@/lib/utils'
import { back, close, isWeb, listReferences, loadReference, nameOf, openReference, resolveLink, setWide, showList, useReferences, type Listing, type Loaded } from './references-store'

/**
 * Reference material beside the canvas: the canvas's own files, its project's, and pages on the web, read without leaving.
 * Everything comes through the server (server/references.mjs) as a blob, so the token never sits in a URL and a page's
 * scripts never run as toucan.
 */
export function ReferencesPanel() {
	const { stack, wide } = useReferences()
	const current = stack.at(-1)
	return (
		<section
			aria-label="References"
			onKeyDown={(e) => {
				e.stopPropagation()
				if (e.key === 'Escape') close()
			}}
			className={cn(
				'toucan-ui absolute inset-y-2 right-2 z-[460] flex max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl border bg-background text-sm shadow-lg',
				wide ? 'w-[min(52rem,calc(100%-1rem))]' : 'w-[28rem]',
			)}
		>
			<header className="flex items-center gap-1 border-b py-1.5 pr-1.5 pl-2">
				{current ? (
					<Button variant="ghost" size="icon-sm" aria-label="Back" title="Back" onClick={back}>
						<ArrowLeftIcon />
					</Button>
				) : (
					<BookOpenIcon className="mx-1 size-4 text-muted-foreground" />
				)}
				<h2 className="min-w-0 flex-1 truncate font-medium" title={current?.ref}>
					{current ? nameOf(current.ref) : 'References'}
				</h2>
				{current?.by && <span className="shrink-0 rounded bg-violet-100 px-1.5 text-[11px] text-violet-800 dark:bg-violet-950 dark:text-violet-200">from {current.by}</span>}
				<Button variant="ghost" size="icon-sm" aria-label={wide ? 'Narrower' : 'Wider'} title={wide ? 'Narrower' : 'Wider'} onClick={() => setWide(!wide)}>
					{wide ? <Minimize2Icon /> : <Maximize2Icon />}
				</Button>
				<Button variant="ghost" size="icon-sm" aria-label="Close references" title="Close (Esc)" onClick={close}>
					<XIcon />
				</Button>
			</header>
			{current ? <Viewer key={current.ref} refName={current.ref} /> : <List />}
		</section>
	)
}

const ICONS: Record<string, typeof FileIcon> = { markdown: FileTextIcon, text: FileTextIcon, table: FileTextIcon, image: ImageIcon, html: GlobeIcon }
const sizeOf = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`)

function List() {
	const [listing, setListing] = useState<Listing | null>(null)
	const [error, setError] = useState('')
	const [q, setQ] = useState('')
	useEffect(() => {
		listReferences().then(setListing, (e) => setError(String(e.message ?? e)))
	}, [])
	const onCanvas: { ref: string; label?: string; key: string; on: string }[] = useMemo(() => {
		const all = (window as any).toucan?.referencesOnCanvas?.() ?? []
		const seen = new Set<string>()
		return all.filter((r: { ref: string }) => !seen.has(r.ref) && seen.add(r.ref))
	}, [])
	const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase())
	const open = (e: React.FormEvent) => {
		e.preventDefault()
		const v = q.trim()
		if (isWeb(v) || /^(files|project(-\d+)?)\//.test(v)) openReference(v)
	}
	// Documents first; in a code repository the source files would bury them, so they wait behind a toggle.
	const groups =
		listing?.roots.map((r) => {
			const files = listing.files.filter((f) => f.root === r.id && match(f.path))
			const docs = files.filter((f) => f.kind !== 'text' || /\.(txt|log)$/i.test(f.path))
			return { ...r, docs, code: files.filter((f) => !docs.includes(f)) }
		}) ?? []
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<form onSubmit={open} className="flex items-center gap-1.5 border-b p-2">
				<SearchIcon className="size-4 shrink-0 text-muted-foreground" />
				<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a file, or paste a link and press Enter" aria-label="Find a file or open a link" className="h-7 text-xs" />
			</form>
			<div className="min-h-0 flex-1 overflow-y-auto p-1.5">
				{onCanvas.filter((r) => match(r.ref) || match(r.on)).length > 0 && (
					<Group label="Linked from the canvas">
						{onCanvas.filter((r) => match(r.ref) || match(r.on)).map((r) => (
							<Row key={r.ref} icon={isWeb(r.ref) ? GlobeIcon : FileTextIcon} title={r.label || nameOf(r.ref)} meta={r.on ? `on ${r.on}` : r.ref} onClick={() => openReference(r.ref)} />
						))}
					</Group>
				)}
				{error && <p className="p-2 text-xs text-destructive">{error}</p>}
				{groups.map((g) => (
					<Group key={g.id} label={g.label}>
						{g.docs.slice(0, 400).map((f) => <Row key={f.ref} icon={ICONS[f.kind] ?? FileIcon} title={f.path} meta={sizeOf(f.size)} onClick={() => openReference(f.ref)} />)}
						{!g.docs.length && !g.code.length && (
							<p className="px-2 py-1 text-xs text-muted-foreground">{g.id === 'files' && !q ? 'Nothing yet. Agents write research and notes for this canvas here.' : 'No match.'}</p>
						)}
						{g.code.length > 0 && (
							<details open={!!q && g.code.length < 60} className="mt-0.5">
								<summary className="cursor-pointer rounded-md px-2 py-1 text-xs text-muted-foreground outline-none select-none hover:bg-muted focus-visible:bg-muted">
									Code and other text ({g.code.length})
								</summary>
								<ul>
									{g.code.slice(0, 400).map((f) => <Row key={f.ref} icon={FileIcon} title={f.path} meta={sizeOf(f.size)} onClick={() => openReference(f.ref)} />)}
								</ul>
								{g.code.length > 400 && <p className="px-2 py-1 text-xs text-muted-foreground">{g.code.length - 400} more: narrow it down above.</p>}
							</details>
						)}
					</Group>
				))}
				{listing && listing.roots.length === 1 && (
					<p className="px-2 py-2 text-xs text-muted-foreground">
						To read a project's files here, run <code className="rounded bg-muted px-1">toucan init</code> in it.
					</p>
				)}
				{listing?.cut && <p className="px-2 py-1 text-xs text-muted-foreground">Only the first files are listed; search to find others.</p>}
			</div>
		</div>
	)
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="mb-2">
			<h3 className="px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</h3>
			<ul>{children}</ul>
		</div>
	)
}

function Row({ icon: Icon, title, meta, onClick }: { icon: typeof FileIcon; title: string; meta?: string; onClick: () => void }) {
	return (
		<li>
			<button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left outline-none hover:bg-muted focus-visible:bg-muted">
				<Icon className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate">{title}</span>
				{meta && <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{meta}</span>}
			</button>
		</li>
	)
}

function Viewer({ refName }: { refName: string }) {
	const [state, setState] = useState<{ loaded?: Loaded; text?: string; url?: string; error?: string }>({})
	useEffect(() => {
		const abort = new AbortController()
		let url = ''
		loadReference(refName, abort.signal).then(
			async (loaded) => {
				const textual = ['markdown', 'text', 'table', 'html'].includes(loaded.kind)
				url = URL.createObjectURL(loaded.blob)
				setState({ loaded, url, text: textual ? await loaded.blob.text() : undefined })
			},
			(e) => !abort.signal.aborted && setState({ error: String(e.message ?? e) }),
		)
		return () => {
			abort.abort()
			if (url) URL.revokeObjectURL(url)
		}
	}, [refName])
	const { loaded, text, url, error } = state
	const source = loaded?.url ?? refName
	// A blob runs in toucan's own origin, without the server's sandbox, so only what can't carry a script goes to a tab as itself.
	// Anything else (HTML, SVG, XML) goes as plain text.
	const tabUrl = useMemo(() => {
		if (!loaded || isWeb(source)) return ''
		const inert = ['pdf', 'video', 'audio'].includes(loaded.kind) || (loaded.kind === 'image' && !/svg|xml/i.test(loaded.type))
		return inert ? url : URL.createObjectURL(new Blob([text ?? ''], { type: 'text/plain;charset=utf-8' }))
	}, [loaded, url, text, source])
	useEffect(() => () => void (tabUrl && tabUrl !== url && URL.revokeObjectURL(tabUrl)), [tabUrl, url])
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center gap-1.5 border-b px-3 py-1 text-xs text-muted-foreground">
				<span className="min-w-0 flex-1 truncate" title={source}>
					{source}
				</span>
				{(isWeb(source) || tabUrl) && (
					<a href={isWeb(source) ? source : tabUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 hover:text-foreground">
						<ExternalLinkIcon className="size-3" /> {isWeb(source) ? 'Open the page' : 'Open in a tab'}
					</a>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				{error && <p className="p-3 text-sm text-destructive">{error}</p>}
				{!error && !loaded && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
				{loaded && <Body loaded={loaded} text={text} url={url!} base={refName} />}
			</div>
		</div>
	)
}

function Body({ loaded, text, url, base }: { loaded: Loaded; text?: string; url: string; base: string }) {
	const ext = base.split('?')[0].split('.').at(-1)?.toLowerCase() ?? ''
	switch (loaded.kind) {
		case 'markdown':
			return <MarkdownDoc text={text ?? ''} base={loaded.url && isWeb(loaded.url) ? loaded.url : base} />
		case 'image':
			return <img src={url} alt={nameOf(base)} className="mx-auto block max-w-full p-3" />
		case 'pdf':
			return <iframe title={nameOf(base)} src={url} className="block h-full min-h-[60vh] w-full border-0" />
		case 'video':
			return <video src={url} controls className="block w-full p-2" />
		case 'audio':
			return <audio src={url} controls className="block w-full p-3" />
		case 'html':
			return <Page html={text ?? ''} url={isWeb(loaded.url) ? loaded.url : ''} title={nameOf(base)} />
		case 'table':
			return <Table text={text ?? ''} tab={ext === 'tsv' || loaded.type.includes('tab-separated')} />
		case 'text':
			return <Code text={text ?? ''} ext={ext === 'json' || loaded.type.includes('json') ? 'json' : ext} />
		default:
			return (
				<p className="p-3 text-sm text-muted-foreground">
					This kind of file can't be shown here.{' '}
					<a href={url} download={nameOf(base)} className="underline">
						Download it
					</a>
					.
				</p>
			)
	}
}

// Streamdown's hardening blocks relative links and images, which are what documents in a project are made of. The
// sanitizer stays, so raw HTML can't carry scripts or javascript: links; links and images are drawn below, by us.
const DOC_PLUGINS = [defaultRehypePlugins.raw, defaultRehypePlugins.sanitize]
// What a link in a document may be: a page on the web, mail, an anchor, or a path. Anything else is shown as text.
const SAFE_HREF = /^(https?:|mailto:|#|[^:]*$)/i

/** Markdown, with its links opening here and its images loaded through the server like the document was. */
function MarkdownDoc({ text, base }: { text: string; base: string }) {
	const host = useRef<HTMLDivElement>(null)
	const components = useMemo(
		() => ({
			a: ({ href = '', children, node: _, ...props }: any) =>
				!SAFE_HREF.test(href.trim()) ? (
					<span>{children}</span>
				) : (
				<a
					{...props}
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline underline-offset-2"
					onClick={(e: React.MouseEvent) => {
						if (href.startsWith('#')) {
							e.preventDefault()
							let id = href.slice(1)
							try {
								id = decodeURIComponent(id)
							} catch {}
							host.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView()
							return
						}
						const to = resolveLink(base, href)
						if (!to || e.metaKey || e.ctrlKey || e.shiftKey) return // a new tab, as the person asked
						e.preventDefault()
						openReference(to)
					}}
				>
					{children}
				</a>
				),
			img: ({ src = '', alt = '' }: any) => <RefImage src={src} alt={alt} base={base} />,
		}),
		[base],
	)
	// GitHub's alerts (> [!TIP]) are its own syntax; elsewhere they'd show as a stray [!TIP], so they become a label.
	const source = useMemo(() => text.replace(/^(>\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/gim, (_, q, k) => `${q}**${k[0]}${k.slice(1).toLowerCase()}**`), [text])
	return (
		<div ref={host} className="toucan-doc p-4">
			<Markdown components={components} urlTransform={(u) => u} rehypePlugins={DOC_PLUGINS} className="text-[13.5px]">
				{source}
			</Markdown>
		</div>
	)
}

function RefImage({ src, alt, base }: { src: string; alt: string; base: string }) {
	const [url, setUrl] = useState('')
	useEffect(() => {
		if (src.startsWith('data:')) return setUrl(src)
		const to = resolveLink(base, src)
		if (!to) return
		let made = ''
		const abort = new AbortController()
		loadReference(to, abort.signal).then((l) => setUrl((made = URL.createObjectURL(l.blob))), () => {})
		return () => {
			abort.abort()
			if (made) URL.revokeObjectURL(made)
		}
	}, [src, base])
	return url ? <img src={url} alt={alt} className="max-w-full" /> : <span className="text-xs text-muted-foreground">[{alt || 'image'}]</span>
}

/** A web page or an HTML file, in a frame that runs none of its scripts. Its links open in a new tab. */
function Page({ html, url, title }: { html: string; url: string; title: string }) {
	const doc = useMemo(() => {
		const head = `<meta charset="utf-8"><meta name="referrer" content="no-referrer">${url ? `<base href="${url.replace(/"/g, '&quot;')}" target="_blank">` : '<base target="_blank">'}<style>body{font:15px/1.55 system-ui,sans-serif;max-width:46rem;margin:1rem auto;padding:0 1rem}img,video{max-width:100%;height:auto}</style>`
		return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html
	}, [html, url])
	return <iframe title={title} srcDoc={doc} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" className="block h-full min-h-[60vh] w-full border-0 bg-white" />
}

const LANG: Record<string, string> = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx', py: 'python', rb: 'ruby', rs: 'rust', sh: 'bash', yml: 'yaml', md: 'markdown', mmd: 'text' }
function Code({ text, ext }: { text: string; ext: string }) {
	const value = useMemo(() => {
		const capped = text.length > 400_000 ? text.slice(0, 400_000) + '\n…' : text
		if (ext !== 'json') return capped
		try {
			return JSON.stringify(JSON.parse(capped), null, 2)
		} catch {
			return capped
		}
	}, [text, ext])
	const lines = useHighlightedCode(value, LANG[ext] ?? (ext || 'text'))
	return (
		<CodeBlock size="sm" className="m-2">
			<CodeBlockContent>
				{lines.map((line, i) => (
					<CodeBlockLine key={i}>{line}</CodeBlockLine>
				))}
			</CodeBlockContent>
		</CodeBlock>
	)
}

/** A CSV or TSV as a table: the first 500 rows. */
function Table({ text, tab }: { text: string; tab: boolean }) {
	const rows = useMemo(() => parseDelimited(text, tab ? '\t' : ',').slice(0, 501), [text, tab])
	const [head, ...body] = rows
	return (
		<div className="p-2">
			<table className="w-full border-collapse text-xs">
				<thead>
					<tr>{head?.map((c, i) => <th key={i} className="sticky top-0 border-b bg-background px-2 py-1 text-left font-medium">{c}</th>)}</tr>
				</thead>
				<tbody>
					{body.map((r, i) => (
						<tr key={i} className="border-b last:border-0">
							{r.map((c, j) => <td key={j} className="px-2 py-1 align-top">{c}</td>)}
						</tr>
					))}
				</tbody>
			</table>
			{rows.length > 500 && <p className="p-2 text-xs text-muted-foreground">The first 500 rows.</p>}
		</div>
	)
}

export function parseDelimited(text: string, sep: string) {
	const rows: string[][] = []
	let row: string[] = [], cell = '', quoted = false
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (quoted) {
			if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++
			else if (ch === '"') quoted = false
			else cell += ch
		} else if (ch === '"' && !cell) quoted = true
		else if (ch === sep) row.push(cell), (cell = '')
		else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && text[i + 1] === '\n') i++
			row.push(cell), rows.push(row), (row = []), (cell = '')
			if (rows.length > 600) return rows
		} else cell += ch
	}
	if (cell || row.length) row.push(cell), rows.push(row)
	return rows
}

/** The app bar's button. */
export function ReferencesButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
	return (
		<Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={open} aria-label="References" title="References: files and pages to read beside the canvas" className={cn(open && 'bg-muted')}>
			<BookOpenIcon />
			<span className="max-lg:hidden">References</span>
		</Button>
	)
}

export { showList }
