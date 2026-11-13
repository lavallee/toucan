import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from './net'
import { messageOf, planUrl, setPlan, usePlan } from './plan-store'

const SHOWN = 3

/**
 * When a canvas shows a plan, an edit made here can be refused upstream, or lose to a change made there. The canvas then
 * goes back to what the source says, and this says why, above the canvas, until the person dismisses it. On either engine.
 */
export function PlanNotice() {
	const plan = usePlan()
	const problems = plan.bound ? (plan.problems ?? []) : []
	if (!problems.length) return null
	const newest = problems.slice(-SHOWN).reverse()
	const dismiss = (id: string) => api(planUrl(`/problems?ids=${encodeURIComponent(id)}`), { method: 'DELETE' }).then(setPlan, (e) => console.warn('toucan: could not dismiss', messageOf(e)))
	return (
		<div className="toucan-ui absolute top-12 left-1/2 z-[400] flex w-max max-w-[min(36rem,calc(100%-1rem))] -translate-x-1/2 flex-col gap-1 !bg-transparent text-xs">
			{newest.map((p) => (
				<div key={p.id} role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-100 py-1 pr-1 pl-3 text-amber-950 shadow-sm dark:bg-amber-950 dark:text-amber-100">
					<span className="min-w-0 flex-1 py-0.5 break-words">{p.text}</span>
					<Button variant="ghost" size="icon-xs" aria-label="Dismiss" title="Dismiss" onClick={() => dismiss(p.id)}>
						<XIcon />
					</Button>
				</div>
			))}
			{problems.length > SHOWN && <p className="self-center rounded-md border bg-background px-2 py-0.5 text-muted-foreground">+{problems.length - SHOWN} more, in the plan menu</p>}
		</div>
	)
}
