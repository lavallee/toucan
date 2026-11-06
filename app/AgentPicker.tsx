import { useEffect, useState } from 'react'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { api, canvasName } from './net'

export type Agent = { ref: string; name: string; color?: string } | { error: string } | null
// tldraw's palette, so an agent's colour matches what it draws.
const DOT: Record<string, string> = { black: '#1d1d1d', grey: '#9fa8b2', violet: '#ae3ec9', 'light-violet': '#e085f4', blue: '#4465e9', 'light-blue': '#4ba1f1', yellow: '#f1ac4b', orange: '#e16919', green: '#099268', 'light-green': '#4cb05e', red: '#e03131', 'light-red': '#f87777' }
type Listed = { ref: string; source: string; name: string; description: string }

/**
 * Who the chat panel talks to: toucan's own agent, or a named one (an agent profile, server/profiles.mjs) the person
 * chose for this canvas. Choosing one starts a new conversation with it, for everyone on the canvas.
 */
export function AgentPicker({ agent, disabled }: { agent: Agent; disabled?: boolean }) {
	const [open, setOpen] = useState(false)
	const [list, setList] = useState<{ profiles: Listed[]; errors: { source: string; error: string }[] } | null>(null)
	const [error, setError] = useState('')
	const [q, setQ] = useState('')
	useEffect(() => {
		if (open) api('/api/profiles').then(setList, (e) => setError(String(e.message ?? e)))
	}, [open])
	const current = agent && 'ref' in agent ? agent.ref : ''
	const choose = async (ref: string) => {
		setError('')
		try {
			await api(`/api/canvases/${encodeURIComponent(canvasName)}/meta`, { method: 'PATCH', body: JSON.stringify({ profile: ref }) })
			setOpen(false)
		} catch (e) {
			setError(String((e as Error).message ?? e).replace(/^\d+ /, '').replace(/^\{"error":"|"\}$/g, ''))
		}
	}
	const label = agent && 'name' in agent ? agent.name : agent && 'error' in agent ? 'Agent unavailable' : 'Codex'
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" disabled={disabled} className="-ml-2 gap-1 px-2 font-medium" title={agent && 'error' in agent ? agent.error : 'Who you are working with on this canvas'} aria-label={`Working with ${label}`}>
					{agent && 'color' in agent && agent.color && <span aria-hidden className="size-2 rounded-full" style={{ background: DOT[agent.color] ?? DOT.grey }} />}
					<span className={cn(agent && 'error' in agent && 'text-destructive')}>{label}</span>
					<ChevronDownIcon className="size-3.5 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 p-1">
				<p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">Work on this canvas with:</p>
				{/* A registry can hold dozens: they scroll, and a few letters find one. */}
				{(list?.profiles.length ?? 0) > 6 && (
					<input
						value={q}
						onChange={(e) => setQ(e.target.value)}
						onKeyDown={(e) => e.stopPropagation()}
						placeholder="Find an agent"
						aria-label="Find an agent"
						autoFocus
						className="mx-1 mb-1 h-7 w-[calc(100%-0.5rem)] rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				)}
				<ul role="radiogroup" aria-label="Agent" className="max-h-[min(24rem,60vh)] overflow-y-auto">
					{!q && <Choice checked={!current} title="Codex" description="toucan's own agent, for drawing and tidying" onClick={() => choose('')} />}
					{list?.profiles
						.filter((p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q.toLowerCase()))
						.map((p) => <Choice key={p.ref} checked={current === p.ref} title={p.name} description={p.description} source={p.source} onClick={() => choose(p.ref)} />)}
				</ul>
				{list && !list.profiles.length && (
					<p className="px-2 py-1.5 text-xs text-muted-foreground">
						No agent profiles yet. Add one as <code className="rounded bg-muted px-1">_profiles/NAME.json</code> in the data folder, or install a{' '}
						<code className="rounded bg-muted px-1">toucan-profiles-…</code> source.
					</p>
				)}
				{list?.errors.map((e) => (
					<p key={e.source} className="px-2 py-1 text-xs text-destructive">
						{e.error}
					</p>
				))}
				{error && <p className="px-2 py-1 text-xs text-destructive">{error}</p>}
				<p className="border-t px-2 pt-1.5 pb-1 text-xs text-muted-foreground">Switching starts a new conversation for everyone on this canvas. Each agent's earlier one is kept.</p>
			</PopoverContent>
		</Popover>
	)
}

function Choice({ checked, title, description, source, onClick }: { checked: boolean; title: string; description: string; source?: string; onClick: () => void }) {
	return (
		<li>
			<button type="button" role="radio" aria-checked={checked} onClick={onClick} className={cn('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted', checked && 'bg-muted')}>
				<CheckIcon className={cn('mt-0.5 size-3.5 shrink-0', !checked && 'invisible')} />
				<span className="min-w-0 flex-1">
					<span className="block text-sm font-medium">
						{title}
						{source && source !== 'local' && <span className="ml-1.5 text-xs font-normal text-muted-foreground">from {source}</span>}
					</span>
					{description && <span className="block text-xs text-muted-foreground">{description}</span>}
				</span>
			</button>
		</li>
	)
}
