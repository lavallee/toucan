import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * "Dashed = proposed": when an agent has proposed shapes, a small bar above the canvas lets the person
 * accept them (drawn solid) or reject them (removed): the selected ones if any are selected, else all.
 * Engine-neutral: it reads and acts through the engine's `toucan` helpers; `subscribe` reports changes.
 */
export function ProposalBar({ toucan, subscribe }: { toucan: any; subscribe: (onChange: () => void) => () => void }) {
	const [state, setState] = useState<{ all: string[]; selected: string[] }>({ all: [], selected: [] })
	useEffect(() => {
		if (!toucan) return
		let frame = 0
		const read = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => {
				const all = toucan.proposals().map((p: any) => p.key)
				const selected = toucan.selectedProposals()
				setState((s) => (s.all.join() === all.join() && s.selected.join() === selected.join() ? s : { all, selected }))
			})
		}
		read()
		const stop = subscribe(read)
		return () => (cancelAnimationFrame(frame), stop())
	}, [toucan, subscribe])

	if (!state.all.length) return null
	const some = state.selected.length > 0
	const keys = some ? state.selected : []
	const n = some ? state.selected.length : state.all.length
	return (
		<div className="toucan-ui absolute top-2 left-1/2 z-[400] flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-background py-1 pr-1 pl-3 text-xs shadow-sm" role="toolbar" aria-label="Proposals">
			<span className="text-muted-foreground">
				{some ? `${n} selected proposal${n === 1 ? '' : 's'}` : `${n} proposal${n === 1 ? '' : 's'} (dashed)`}
			</span>
			<Button size="xs" onClick={() => toucan.accept(...keys)}>
				{some ? 'Accept' : 'Accept all'}
			</Button>
			<Button variant="outline" size="xs" onClick={() => toucan.reject(...keys)}>
				{some ? 'Reject' : 'Reject all'}
			</Button>
		</div>
	)
}
