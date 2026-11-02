import { useEffect, useState, type FormEvent } from 'react'
import { ChevronRightIcon, LoaderCircleIcon, PlayIcon, Trash2Icon, WandSparklesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { api, canvasName } from './net'

type Routine = { name: string; title: string; description: string; engines: string[]; source: 'shipped' | 'banked'; code: string }
type Outcome = { name: string; ok: boolean; text: string }

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
/** What a run returned, for a person: its `summary` if it has one. */
const describe = (result: any) => (typeof result === 'string' ? result : result?.summary ?? 'Done')

/** The bank of routines: chores saved once, run on this canvas with one click. One run is one undo step. */
export function Routines({ engine, onAskAgent }: { engine: string; onAskAgent: () => void }) {
	const [open, setOpen] = useState(false)
	const [routines, setRoutines] = useState<Routine[] | null>(null)
	const [running, setRunning] = useState('')
	const [outcome, setOutcome] = useState<Outcome | null>(null)
	const [codeOf, setCodeOf] = useState('')
	const [banking, setBanking] = useState(false)
	const [draft, setDraft] = useState({ title: '', description: '', code: '' })
	const [error, setError] = useState('')

	const load = () => api('/api/routines?code').then((r) => setRoutines(r.routines), (e) => setError(String(e.message ?? e)))
	useEffect(() => {
		if (open) load()
	}, [open])

	async function run(r: Routine) {
		setRunning(r.name)
		setOutcome(null)
		try {
			const res = await api(`/api/canvases/${encodeURIComponent(canvasName)}/routines/${r.name}/run`, { method: 'POST', body: '{}' })
			setOutcome({ name: r.name, ok: res.ok, text: res.ok ? describe(res.result) : res.error })
		} catch (e: any) {
			setOutcome({ name: r.name, ok: false, text: e.message })
		}
		setRunning('')
	}
	async function bank(e: FormEvent) {
		e.preventDefault()
		const name = slug(draft.title)
		if (!name || !draft.code.trim()) return
		try {
			await api(`/api/routines/${name}`, { method: 'PUT', body: JSON.stringify({ ...draft, engines: [engine] }) })
			setDraft({ title: '', description: '', code: '' })
			setBanking(false)
			load()
		} catch (err: any) {
			setError(err.message)
		}
	}
	async function remove(r: Routine) {
		if (!confirm(`Remove "${r.title}" from the bank? Every canvas loses it.`)) return
		try {
			await api(`/api/routines/${r.name}`, { method: 'DELETE' })
			load()
		} catch (err: any) {
			setError(err.message)
		}
	}

	const usable = routines?.filter((r) => r.engines.includes(engine))
	const elsewhere = (routines?.length ?? 0) - (usable?.length ?? 0)
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" aria-label="Routines" title="Routines">
					<WandSparklesIcon />
					<span className="max-lg:hidden">Routines</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-96 p-0">
				<header className="border-b px-3 py-2">
					<h2 className="font-medium">Routines</h2>
					<p className="text-xs text-muted-foreground">Chores banked once, for every canvas. A run is one undo step.</p>
				</header>
				{error && (
					<p role="alert" className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive" onClick={() => setError('')}>
						{error}
					</p>
				)}
				<ul className="max-h-80 divide-y overflow-y-auto">
					{routines === null && <li className="px-3 py-2 text-xs text-muted-foreground">Loading…</li>}
					{usable?.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">Nothing banked for {engine} yet.</li>}
					{usable?.map((r) => (
						<li key={r.name} className="px-3 py-2">
							<div className="flex items-start gap-2">
								<div className="min-w-0 flex-1">
									<p className="font-medium">{r.title}</p>
									{r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
								</div>
								<Button size="sm" variant="outline" disabled={!!running} onClick={() => run(r)} aria-label={`Run ${r.title}`}>
									{running === r.name ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />} Run
								</Button>
							</div>
							{outcome?.name === r.name && (
								<p role="status" className={cn('mt-1 text-xs', outcome.ok ? 'text-muted-foreground' : 'text-destructive')}>
									{outcome.text}
								</p>
							)}
							<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
								<button type="button" className="flex items-center gap-0.5 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50" aria-expanded={codeOf === r.name} onClick={() => setCodeOf((c) => (c === r.name ? '' : r.name))}>
									<ChevronRightIcon className={cn('size-3 transition-transform', codeOf === r.name && 'rotate-90')} /> Code
								</button>
								<span>{r.source === 'shipped' ? 'ships with toucan' : 'banked here'}</span>
								{r.source === 'banked' && (
									<button type="button" className="ml-auto rounded p-0.5 outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50" aria-label={`Remove ${r.title}`} title="Remove from the bank" onClick={() => remove(r)}>
										<Trash2Icon className="size-3.5" />
									</button>
								)}
							</div>
							{codeOf === r.name && <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-snug">{r.code}</pre>}
						</li>
					))}
				</ul>
				{elsewhere > 0 && <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">{elsewhere} more for other engines.</p>}
				<footer className="border-t p-2">
					{banking ? (
						<form onSubmit={bank} className="space-y-1.5">
							<Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Name, like Colour the blocked boxes red" aria-label="Routine name" className="h-7 text-xs" autoFocus />
							<Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What it does" aria-label="What it does" className="h-7 text-xs" />
							<Textarea value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder={'// editor, tl, toucan and args are in scope\nreturn { summary: "Done" }'} aria-label="Routine code" className="h-28 font-mono text-[11px]" />
							<div className="flex justify-end gap-1.5">
								<Button type="button" variant="ghost" size="sm" onClick={() => setBanking(false)}>
									Cancel
								</Button>
								<Button type="submit" size="sm" disabled={!slug(draft.title) || !draft.code.trim()}>
									Bank it
								</Button>
							</div>
						</form>
					) : (
						<div className="flex gap-1.5">
							<Button
								size="sm"
								className="flex-1"
								onClick={() => {
									setOpen(false)
									onAskAgent()
								}}
							>
								Ask the agent to bank one
							</Button>
							<Button variant="outline" size="sm" onClick={() => setBanking(true)}>
								Paste code
							</Button>
						</div>
					)}
				</footer>
			</PopoverContent>
		</Popover>
	)
}
