import { useEffect, useState } from 'react'
import { LoaderCircleIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { api, canvasName } from './net'

type Template = { id: string; type: 'block' | 'starter'; title: string; use: string; group?: string; parts?: string[] }
type Group = { id: string; label: string; about: string }

/**
 * What a canvas has: add a block (one diagram) or a starter (several on one subject) beside what's already here. Each
 * arrives as an example to edit, laid out by toucan, as one undo step, on either engine.
 */
export function AddMenu() {
	const [open, setOpen] = useState(false)
	const [templates, setTemplates] = useState<Template[] | null>(null)
	const [groups, setGroups] = useState<Group[]>([])
	const [q, setQ] = useState('')
	const [adding, setAdding] = useState('')
	const [error, setError] = useState('')
	useEffect(() => {
		if (open && !templates) api('/api/templates').then((r) => (setTemplates(r.templates), setGroups(r.groups)), (e) => setError(String(e.message ?? e)))
	}, [open, templates])
	async function add(t: Template) {
		setAdding(t.id)
		setError('')
		try {
			const r = await api(`/api/canvases/${encodeURIComponent(canvasName)}/add`, { method: 'POST', body: JSON.stringify({ template: t.id }) })
			if (!r.ok) throw new Error(r.error)
			setOpen(false)
		} catch (e: any) {
			setError(e.message)
		}
		setAdding('')
	}
	const matches = (t: Template) => !q || `${t.title} ${t.use} ${t.parts?.join(' ') ?? ''}`.toLowerCase().includes(q.toLowerCase())
	const sections = [
		{ id: 'starter', label: 'Starters', about: 'Several diagrams on one subject', list: (templates ?? []).filter((t) => t.type === 'starter' && matches(t)) },
		...groups.map((g) => ({ ...g, list: (templates ?? []).filter((t) => t.type === 'block' && t.group === g.id && matches(t)) })),
	].filter((s) => s.list.length)
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" aria-label="Add a diagram" title="Add a diagram: a block or a starter, beside what's here">
					<PlusIcon />
					<span className="max-lg:hidden">Add</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-96 p-0" align="end">
				<header className="border-b px-3 py-2">
					<h2 className="font-medium">Add a diagram</h2>
					<p className="text-xs text-muted-foreground">An example to edit, laid out beside what's here. One undo takes it away.</p>
				</header>
				<div className="border-b p-2">
					<Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Find a diagram" aria-label="Find a diagram" className="h-7 text-xs" autoFocus />
				</div>
				{error && (
					<p role="alert" className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
						{error}
					</p>
				)}
				<ul className="max-h-[min(28rem,60vh)] overflow-y-auto">
					{templates === null && !error && <li className="px-3 py-2 text-xs text-muted-foreground">Loading…</li>}
					{templates && !sections.length && <li className="px-3 py-2 text-xs text-muted-foreground">No diagram matches.</li>}
					{sections.map((s) => (
						<li key={s.id}>
							<h3 className="sticky top-0 z-10 border-b bg-background px-3 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase" title={s.about}>
								{s.label}
							</h3>
							<ul className="divide-y">
								{s.list.map((t) => (
									<li key={t.id}>
										<button type="button" disabled={!!adding} onClick={() => add(t)} className={cn('flex w-full items-start gap-2 px-3 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted disabled:opacity-60')}>
											<span className="min-w-0 flex-1">
												<span className="block text-sm font-medium">{t.title}</span>
												<span className="block text-xs text-muted-foreground">
													{t.use}
													{t.parts && ` Has: ${t.parts.join(', ').toLowerCase()}.`}
												</span>
											</span>
											{adding === t.id && <LoaderCircleIcon className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />}
										</button>
									</li>
								))}
							</ul>
						</li>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	)
}
