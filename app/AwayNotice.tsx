import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api, canvasName } from './net'

type Entry = { t: string; source: string; what: string; created: string[]; changed: string[]; removed: string[]; error?: string }

const SEEN = `toucan.seen.${canvasName}`

/**
 * "N agent edits while you were away": edits an agent made in the server's headless page, with
 * nobody watching, since this browser last marked the canvas's trail seen (`toucan log` on the CLI).
 */
export function AwayNotice() {
	const [entries, setEntries] = useState<Entry[]>([])
	const [open, setOpen] = useState(false)
	useEffect(() => {
		const since = localStorage.getItem(SEEN) ?? ''
		api(`/api/canvases/${encodeURIComponent(canvasName)}/log?since=${encodeURIComponent(since)}`).then((r) => setEntries(r.entries), () => {})
	}, [])
	if (!entries.length) return null
	const seen = () => {
		localStorage.setItem(SEEN, entries[entries.length - 1].t)
		setEntries([])
	}
	const keys = (label: string, ks: string[]) => (ks.length ? `${label} ${ks.slice(0, 6).join(', ')}${ks.length > 6 ? ` +${ks.length - 6}` : ''}` : '')
	return (
		<span className="relative">
			<Button variant="secondary" size="xs" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Edits an agent made while no one had this canvas open">
				{entries.length} agent {entries.length === 1 ? 'edit' : 'edits'} while you were away
			</Button>
			{open && (
				<div className="absolute bottom-full left-0 mb-2 w-96 max-w-[80vw] rounded-lg border bg-background p-2 text-xs text-foreground shadow-md">
					<ol className="max-h-72 space-y-1.5 overflow-auto">
						{entries.map((e, i) => (
							<li key={i}>
								<span className="text-muted-foreground">{new Date(e.t).toLocaleString()}</span> <code className="font-mono break-all">{e.what}</code>
								<div className="text-muted-foreground">{[keys('+', e.created), keys('~', e.changed), keys('−', e.removed)].filter(Boolean).join(' · ')}{e.error && ` · failed: ${e.error}`}</div>
							</li>
						))}
					</ol>
					<div className="mt-2 flex justify-end">
						<Button variant="outline" size="xs" onClick={seen}>
							Mark seen
						</Button>
					</div>
				</div>
			)}
		</span>
	)
}
