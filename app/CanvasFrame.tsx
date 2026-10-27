import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Chat } from './Chat'
import { canvasName } from './net'

document.title = `${canvasName} · toucan`

/** The page around any engine's canvas: the canvas, toucan's badge (index link, sync dot, chat toggle) and the chat panel. */
export function CanvasFrame({ live, engine, badgeClassName, children }: { live: boolean; engine: string; badgeClassName?: string; children: ReactNode }) {
	const [chatOpen, setChatOpen] = useState(() => localStorage.getItem('toucan.chat') !== 'closed')
	useEffect(() => {
		try {
			localStorage.setItem('toucan.chat', chatOpen ? 'open' : 'closed')
		} catch {}
	}, [chatOpen])
	return (
		<div
			className={cn(
				'grid h-full',
				chatOpen && 'max-md:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[minmax(0,1fr)_45%] md:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]',
			)}
		>
			<div className="relative min-h-0 min-w-0">
				{children}
				<div
					className={cn(
						'toucan-ui absolute z-[400] flex items-center gap-2 rounded-lg border bg-background py-1 pr-1 pl-2.5 text-xs text-muted-foreground shadow-sm',
						badgeClassName ?? 'bottom-14 left-2',
					)}
				>
					<a href="/" className="hover:text-foreground" title="All canvases">
						Canvases
					</a>
					<span aria-hidden>/</span>
					<span className={cn('size-2 rounded-full', live ? 'bg-emerald-500' : 'bg-destructive')} title={live ? 'synced' : 'offline'} />
					{canvasName}
					{engine !== 'tldraw' && <span className="rounded bg-muted px-1 font-mono text-[10px]">{engine}</span>}
					<Button variant="outline" size="xs" onClick={() => setChatOpen((o) => !o)} aria-expanded={chatOpen}>
						{chatOpen ? 'Hide chat' : 'Chat'}
					</Button>
				</div>
			</div>
			{chatOpen && <Chat />}
		</div>
	)
}
