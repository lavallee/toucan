import { useEffect, useState } from 'react'
import { KanbanSquareIcon, LoaderCircleIcon, RefreshCwIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { api } from './net'
import { messageOf, planUrl, setPlan, usePlan, type PlanStatus, type PlanView } from './plan-store'

type Kinds = Record<string, { title: string; about: string }>

const DOT: Record<string, string> = { synced: 'bg-emerald-500', syncing: 'animate-pulse bg-amber-500', waiting: 'bg-muted-foreground/40', problem: 'bg-destructive' }
// Views that are laid out by a field's options, and so can be regrouped from here.
const GROUPED = ['board', 'gantt']

function ago(iso: string | null | undefined) {
	if (!iso) return 'not synced yet'
	const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
	if (min < 1) return 'synced just now'
	if (min < 60) return `synced ${min} min ago`
	if (min < 60 * 24) return `synced ${Math.round(min / 60)} h ago`
	return `synced ${new Date(iso).toLocaleDateString()}`
}

/**
 * A canvas bound to a plan draws views of a system of record: a board, a gantt, a table. This is where a person sees
 * which plan that is and whether the canvas is up to date with it, and adds, regroups or removes its views.
 */
export function PlanMenu() {
	const plan = usePlan()
	const [open, setOpen] = useState(false)
	const [kinds, setKinds] = useState<Kinds | null>(null)
	const [busy, setBusy] = useState('')
	const [error, setError] = useState('')
	const [confirming, setConfirming] = useState('')
	const [, tick] = useState(0)
	useEffect(() => {
		if (open && !kinds) api('/api/plan/catalog').then((r) => setKinds(r.kinds), (e) => setError(messageOf(e)))
	}, [open, kinds])
	// "2 min ago" keeps counting while the menu is open.
	useEffect(() => {
		if (!open) return
		const timer = setInterval(() => tick((n) => n + 1), 30000)
		return () => clearInterval(timer)
	}, [open])
	// A second click removes; left alone, the button goes back to what it was.
	useEffect(() => {
		if (!confirming) return
		const timer = setTimeout(() => setConfirming(''), 3000)
		return () => clearTimeout(timer)
	}, [confirming])

	if (!plan.bound || !plan.source) return null
	const { source, state = 'waiting' } = plan
	const views = plan.views ?? [], fields = plan.fields ?? [], problems = plan.problems ?? []
	const optionFields = fields.filter((f) => f.type === 'option')
	const canAdd: Record<string, string> = {
		board: optionFields.length ? '' : 'This plan has no field with options to make columns of.',
		timeline: fields.some((f) => f.type === 'date') ? '' : 'This plan has no date field.',
	}

	/** One call at a time; each answers with the plan's new status, alone or beside what it made. */
	async function run(what: string, path: string, init: RequestInit) {
		setBusy(what)
		setError('')
		try {
			const r = await api(planUrl(path), init)
			const next: PlanStatus = r.plan ?? r
			if (typeof next?.bound === 'boolean') setPlan(next)
		} catch (e) {
			setError(messageOf(e))
		}
		setBusy('')
	}
	const titleOf = (v: PlanView) => v.title || kinds?.[v.kind]?.title || v.kind
	// What a view groups by when it doesn't say: the server's own defaults (lib/plan.mjs).
	const groupOf = (v: PlanView) => v.groupBy ?? (v.kind === 'gantt' ? 'none' : ((optionFields.find((f) => f.id === 'stage') ?? optionFields[0])?.id ?? ''))
	function remove(v: PlanView) {
		if (confirming !== v.id) return setConfirming(v.id)
		setConfirming('')
		run(`remove:${v.id}`, `/views/${encodeURIComponent(v.id)}`, { method: 'DELETE' })
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" aria-label={`Plan: ${source.title}, ${state}`} title={`Plan: ${source.title} (${state})`}>
					<KanbanSquareIcon />
					<span className="max-w-40 truncate max-lg:hidden">{source.title}</span>
					<span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[state])} />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-80 p-0" align="end">
				<header className="border-b px-3 py-2">
					<div className="flex items-center gap-2">
						<h2 className="min-w-0 flex-1 truncate font-medium">{source.title}</h2>
						{source.readonly && <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">read-only</span>}
					</div>
					<p className="truncate font-mono text-[11px] text-muted-foreground" title={`${source.name} · ${source.ref}`}>
						{source.name} · {source.ref}
					</p>
					<div className="mt-1.5 flex items-center gap-2">
						{plan.error ? (
							<p className="min-w-0 flex-1 text-xs break-words text-destructive">{plan.error}</p>
						) : (
							<p className="min-w-0 flex-1 text-xs text-muted-foreground">
								{plan.items ?? 0} {plan.items === 1 ? 'item' : 'items'} · {state === 'syncing' ? 'syncing' : ago(plan.syncedAt)}
							</p>
						)}
						<Button variant="outline" size="xs" disabled={busy === 'sync'} onClick={() => run('sync', '/sync', { method: 'POST' })}>
							{busy === 'sync' ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />} Sync now
						</Button>
					</div>
				</header>
				{error && (
					<p role="alert" className="border-b bg-destructive/10 px-3 py-1.5 text-xs break-words text-destructive">
						{error}
					</p>
				)}
				<div className="max-h-[min(28rem,60vh)] overflow-y-auto">
					<h3 className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Views</h3>
					{!views.length && <p className="px-3 pb-2 text-xs text-muted-foreground">No views yet. Add one below.</p>}
					<ul className="divide-y">
						{views.map((v) => (
							<li key={v.id} className="flex items-center gap-2 px-3 py-1.5">
								<span className="min-w-0 flex-1 truncate text-sm" title={v.id}>
									{titleOf(v)}
								</span>
								{GROUPED.includes(v.kind) && optionFields.length > 0 && (
									<select
										aria-label={`Group ${titleOf(v)} by`}
										title="Group by"
										value={groupOf(v)}
										disabled={!!busy}
										onChange={(e) => run(`group:${v.id}`, `/views/${encodeURIComponent(v.id)}`, { method: 'PATCH', body: JSON.stringify({ groupBy: e.target.value }) })}
										className="h-6 max-w-28 shrink-0 rounded-md border bg-background px-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
									>
										{v.kind === 'gantt' && <option value="none">None</option>}
										{optionFields.map((f) => (
											<option key={f.id} value={f.id}>
												{f.label}
											</option>
										))}
									</select>
								)}
								{confirming === v.id ? (
									<Button variant="destructive" size="xs" className="shrink-0" onClick={() => remove(v)}>
										Remove?
									</Button>
								) : (
									<Button variant="ghost" size="icon-xs" className="shrink-0" aria-label={`Remove ${titleOf(v)}`} title="Remove this view and its shapes" disabled={!!busy} onClick={() => remove(v)}>
										{busy === `remove:${v.id}` ? <LoaderCircleIcon className="animate-spin" /> : <XIcon />}
									</Button>
								)}
							</li>
						))}
					</ul>
					<h3 className="border-t px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Add a view</h3>
					<div className="flex flex-wrap gap-1 px-3 pb-2.5">
						{kinds === null && !error && <span className="text-xs text-muted-foreground">Loading…</span>}
						{Object.entries(kinds ?? {}).map(([kind, k]) => (
							<Button key={kind} variant="outline" size="xs" title={canAdd[kind] || k.about} disabled={!!busy || !!canAdd[kind]} onClick={() => run(`add:${kind}`, '/views', { method: 'POST', body: JSON.stringify({ kind }) })}>
								{busy === `add:${kind}` && <LoaderCircleIcon className="animate-spin" />}
								{k.title}
							</Button>
						))}
					</div>
					{problems.length > 0 && (
						<>
							<div className="flex items-center border-t px-3 pt-2 pb-1">
								<h3 className="flex-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Problems</h3>
								<Button variant="ghost" size="xs" disabled={!!busy} onClick={() => run('dismiss', '/problems', { method: 'DELETE' })}>
									Dismiss all
								</Button>
							</div>
							<ul className="space-y-1 px-3 pb-2.5 text-xs">
								{[...problems].reverse().map((p) => (
									<li key={p.id} className="break-words">
										{p.text} <span className="text-muted-foreground">{new Date(p.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
									</li>
								))}
							</ul>
						</>
					)}
				</div>
			</PopoverContent>
		</Popover>
	)
}
