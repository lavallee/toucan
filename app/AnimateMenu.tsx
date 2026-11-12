import { useEffect, useState } from 'react'
import { DownloadIcon, FilmIcon, LoaderCircleIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { canvasName } from './net'

const SPEEDS = [
	{ id: 'slow', label: 'Slow', step: 1100 },
	{ id: 'normal', label: 'Normal', step: 700 },
	{ id: 'fast', label: 'Fast', step: 400 },
]

/**
 * An animated build of the canvas as a GIF (app/animate.js): boxes appear in the order the arrows go, each with its arrows.
 * Made in this tab, from what's on the canvas now; nothing changes. `toucan animate` makes the same from the CLI.
 */
export function AnimateMenu() {
	const [open, setOpen] = useState(false)
	const [speed, setSpeed] = useState('normal')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [made, setMade] = useState<{ url: string; frames: number } | null>(null)
	useEffect(() => () => made && URL.revokeObjectURL(made.url), [made])
	async function make() {
		setBusy(true)
		setError('')
		try {
			const step = SPEEDS.find((s) => s.id === speed)!.step
			const r = await (window as any).toucan?.animate?.({ step })
			if (!r) throw new Error('There is nothing on the canvas to animate.')
			const bytes = Uint8Array.from(atob(r.gif), (c) => c.charCodeAt(0))
			setMade({ url: URL.createObjectURL(new Blob([bytes], { type: 'image/gif' })), frames: r.frames })
		} catch (e: any) {
			setError(e.message ?? String(e))
		}
		setBusy(false)
	}
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" aria-label="Animate" title="Animate: a GIF of this diagram building up, box by box" className={cn(open && 'bg-muted')}>
					<FilmIcon />
					<span className="max-lg:hidden">Animate</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-80 p-0" align="end">
				<header className="border-b px-3 py-2">
					<h2 className="font-medium">Animated build</h2>
					<p className="text-xs text-muted-foreground">A GIF of this diagram building up, box by box in the order the arrows go. Nothing on the canvas changes.</p>
				</header>
				<div className="flex items-center gap-1 border-b p-2" role="radiogroup" aria-label="Animation speed">
					{SPEEDS.map((s) => (
						<button key={s.id} type="button" role="radio" aria-checked={speed === s.id} onClick={() => setSpeed(s.id)} className={cn('rounded-md px-2 py-1 text-xs outline-none hover:bg-muted focus-visible:bg-muted', speed === s.id && 'bg-muted font-medium')}>
							{s.label}
						</button>
					))}
					<span className="flex-1" />
					<Button size="sm" onClick={make} disabled={busy}>
						{busy ? <LoaderCircleIcon className="animate-spin" /> : <FilmIcon />}
						{made ? 'Make again' : 'Make GIF'}
					</Button>
				</div>
				{error && (
					<p role="alert" className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
						{error}
					</p>
				)}
				{made && (
					<div className="space-y-2 p-2">
						<img src={made.url} alt="The animated build" className="w-full rounded border" />
						<a href={made.url} download={`${canvasName}.gif`} className="flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-sm hover:bg-muted">
							<DownloadIcon className="size-4" />
							Download GIF <span className="text-xs text-muted-foreground">({made.frames} frames)</span>
						</a>
					</div>
				)}
			</PopoverContent>
		</Popover>
	)
}
