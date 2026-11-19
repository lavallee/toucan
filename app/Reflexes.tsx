import { useEffect, useState } from 'react'
import { Trash2Icon, ZapIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { api, canvasName } from './net'
import { myName } from './threads-store'
import { useReflexes, type ReflexNode } from './reflexes-store'

type Suggestion = { starter?: string; node?: string; about?: string; why: string }

const base = `/api/canvases/${encodeURIComponent(canvasName)}/reflexes`
/** What a failed call said, without the status code and JSON around it. */
const messageOf = (e: any) => {
	const text = String(e?.message ?? e).replace(/^\d{3} /, '')
	try {
		return JSON.parse(text).error ?? text
	} catch {
		return text
	}
}
const does = (n: ReflexNode) => (!n.do ? 'Groups the reflexes under it' : n.do.routine ? `Runs ${n.do.routine}` : n.do.tell ? 'Asks the agent' : 'Runs its own code')
const counts = (n: ReflexNode) =>
	[n.stats.done && `settled ${n.stats.done}`, n.stats.failed && `didn't settle ${n.stats.failed}`, n.stats.undone && `undone ${n.stats.undone}`, n.stats.would && `would have acted ${n.stats.would}`, n.stats.told && `asked ${n.stats.told}`].filter(Boolean).join(' · ')
const WHY: Record<string, string> = { told: 'asks', failed: "acted, and it's still there", undone: 'was undone twice, and paused', fault: 'has a condition that keeps failing', error: 'failed when it ran' }

/**
 * Reflexes: what this canvas does by itself when something happens to it (server/reflexes.mjs). People switch them on and
 * off here; what an agent writes arrives watching, and acts once someone switches it on.
 */
export function Reflexes({ onAskAgent }: { onAskAgent: (text: string) => void }) {
	const { nodes, asks, wake, resting, starters } = useReflexes()
	const [open, setOpen] = useState(false)
	const [error, setError] = useState('')
	const [suggestions, setSuggestions] = useState<Suggestion[]>([])
	useEffect(() => {
		if (open) api(`${base}/suggest`).then((r) => setSuggestions(r.suggestions), () => {})
	}, [open])

	const call = (path: string, init: RequestInit) => api(`${base}${path}`, init).then(() => setError(''), (e) => setError(messageOf(e)))
	const setStatus = (n: ReflexNode, status: string) => call(`/${n.name}`, { method: 'PATCH', body: JSON.stringify({ status }) })
	const addStarter = (name: string) => call('', { method: 'POST', body: JSON.stringify({ starter: name, status: 'on', agent: myName() || 'someone' }) })
	const remove = (n: ReflexNode) => confirm(`Remove "${n.about}"${nodes.some((x) => x.under === n.name) ? ' and the reflexes under it' : ''}?`) && call(`/${n.name}`, { method: 'DELETE' })

	const rows: { n: ReflexNode; depth: number }[] = []
	const walk = (under: string | null, depth: number) => nodes.filter((n) => (n.under ?? null) === under).forEach((n) => (rows.push({ n, depth }), walk(n.name, depth + 1)))
	walk(null, 0)
	// A node that only groups others does nothing by itself: it comes with the first one under it.
	const toAdd = starters.filter((s) => !s.added && s.does !== 'groups the ones under it')

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" aria-label={`Reflexes${asks.length ? `, ${asks.length} asking` : ''}`} title="Reflexes: what this canvas does by itself" className="relative">
					<ZapIcon />
					<span className="max-lg:hidden">Reflexes</span>
					{asks.length > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">{asks.length}</span>}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-96 p-0">
				<header className="border-b px-3 py-2">
					<h2 className="font-medium">Reflexes</h2>
					<p className="text-xs text-muted-foreground">What this canvas fixes by itself, the moment it happens, without the agent. Each fix is one undo step; undo one twice and it pauses. What none of them can fix, they ask about.</p>
				</header>
				{error && (
					<p role="alert" className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive" onClick={() => setError('')}>
						{error}
					</p>
				)}
				{resting && <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">Resting for a minute: they acted too often in a short time.</p>}
				<div className="max-h-[min(30rem,62vh)] overflow-y-auto">
					{asks.length > 0 && (
						<section>
							<h3 className="sticky top-0 z-10 border-b bg-background px-3 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Asking</h3>
							<ul className="divide-y">
								{asks.map((a) => (
									<li key={a.id} className="px-3 py-2">
										<p className="text-sm">
											<span className="font-medium">{nodes.find((n) => n.name === a.node)?.about ?? a.node}</span> {WHY[a.why] ?? a.why}
										</p>
										{(a.text || a.on?.length) && <p className="text-xs text-muted-foreground">{[a.text, a.on?.length && `on ${a.on.slice(0, 6).join(', ')}`].filter(Boolean).join(' · ')}</p>}
										<div className="mt-1 flex gap-1.5">
											{a.woke ? (
												<span className="text-xs text-muted-foreground">The agent has it, in a comment thread.</span>
											) : (
												<Button size="sm" variant="outline" onClick={() => (setOpen(false), onAskAgent(a.prompt))}>
													Ask the agent
												</Button>
											)}
											<Button size="sm" variant="ghost" onClick={() => call(`/asks/${a.id}/dismiss`, { method: 'POST' })}>
												Dismiss
											</Button>
										</div>
									</li>
								))}
							</ul>
						</section>
					)}
					<section>
						{(asks.length > 0 || rows.length > 0) && <h3 className="sticky top-0 z-10 border-b bg-background px-3 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">On this canvas</h3>}
						{rows.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">None yet. Switch on a starter below, or ask the agent to teach the canvas something it keeps doing.</p>}
						<ul className="divide-y">
							{rows.map(({ n, depth }) => (
								<li key={n.name} className="py-2 pr-3" style={{ paddingLeft: `${0.75 + depth * 1}rem` }}>
									<div className="flex items-start gap-2">
										<div className="min-w-0 flex-1">
											<p className={cn('font-medium', n.status === 'off' && 'text-muted-foreground')}>{n.about}</p>
											<p className="text-xs text-muted-foreground">
												{does(n)}
												{n.by && ` · added by ${n.by}`}
											</p>
										</div>
										{n.do && (
											<div role="radiogroup" aria-label={`${n.about}: on, watching or off`} className="flex shrink-0 overflow-hidden rounded-md border text-xs">
												{(['on', 'watching', 'off'] as const).map((s) => (
													<button
														key={s}
														type="button"
														role="radio"
														aria-checked={n.status === s}
														title={{ on: 'Acts by itself', watching: 'Counts what it would do, and does nothing', off: 'Not judged' }[s]}
														onClick={() => n.status !== s && setStatus(n, s)}
														className={cn('px-1.5 py-0.5 outline-none focus-visible:bg-muted', n.status === s ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
													>
														{s === 'on' ? 'On' : s === 'watching' ? 'Watch' : 'Off'}
													</button>
												))}
											</div>
										)}
										<button type="button" className="rounded p-0.5 text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50" aria-label={`Remove ${n.about}`} title="Remove" onClick={() => remove(n)}>
											<Trash2Icon className="size-3.5" />
										</button>
									</div>
									{n.status === 'paused' && <p className="mt-1 text-xs text-destructive">Paused itself. Switch it on again to let it act.</p>}
									{counts(n) && <p className="mt-0.5 text-xs text-muted-foreground">{counts(n)}</p>}
									{n.last && <p className={cn('mt-0.5 text-xs', n.last.ok ? 'text-muted-foreground' : 'text-destructive')}>Last: {n.last.ok ? n.last.summary ?? 'acted' : n.last.error}</p>}
									{n.tried && <p className="mt-0.5 text-xs text-muted-foreground">Tried on a copy: {n.tried.verdict}</p>}
									{n.status === 'watching' && !n.stats.would && <p className="mt-0.5 text-xs text-muted-foreground">Watching: it will count what it would have done.</p>}
								</li>
							))}
						</ul>
					</section>
					{(toAdd.length > 0 || suggestions.length > 0) && (
						<section>
							<h3 className="sticky top-0 z-10 border-b bg-background px-3 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Starters</h3>
							<ul className="divide-y">
								{toAdd.map((s) => {
									const hint = suggestions.find((x) => x.starter === s.name)
									return (
										<li key={s.name} className="flex items-start gap-2 px-3 py-2">
											<div className="min-w-0 flex-1">
												<p className="text-sm font-medium">{s.about}</p>
												<p className="text-xs text-muted-foreground">{hint ? `${s.does}. Worth it: ${hint.why}.` : s.does}</p>
											</div>
											<Button size="sm" variant="outline" onClick={() => addStarter(s.name)}>
												Switch on
											</Button>
										</li>
									)
								})}
								{suggestions.filter((s) => s.node).map((s) => (
									<li key={s.node} className="px-3 py-2 text-xs text-muted-foreground">
										{nodes.find((n) => n.name === s.node)?.about ?? s.node} {s.why}.{' '}
										<button type="button" className="underline" onClick={() => (setOpen(false), onAskAgent(`The reflex "${s.node}" keeps asking about the same kind of thing. Look at its asks (\`toucan reflexes asks --all\`), and teach the canvas a reflex that answers it, under ${s.node}; leave it watching and tell me.`))}>
											Ask the agent to teach it
										</button>
									</li>
								))}
							</ul>
						</section>
					)}
				</div>
				<footer className="border-t px-3 py-2">
					<label className="flex items-start gap-2 text-xs">
						<input type="checkbox" className="mt-0.5" checked={wake} onChange={(e) => call('/wake', { method: 'POST', body: JSON.stringify({ on: e.target.checked }) })} />
						<span>
							Let the agent take asks by itself, in a comment thread on what each is about (at most one every ten minutes). Otherwise they wait here, and the chat agent sees them.
						</span>
					</label>
				</footer>
			</PopoverContent>
		</Popover>
	)
}
