import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { HistoryIcon, MessageSquareIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Chat } from './Chat'
import { ChatDock, DockButtons, useChatLayout } from './ChatDock'
import { History, type VersionPreview } from './History'
import { Routines } from './Routines'
import { AppearanceMenu } from './Appearance'
import { api, canvasName, headless } from './net'
import { AwayNotice } from './AwayNotice'

document.title = `${canvasName} · toucan`

const BANK_PROMPT = 'Bank what you just did as a routine I can run on any canvas. '

/** The page around any engine's canvas: toucan's app bar, the canvas, its history, and the chat panel. */
export function CanvasFrame({ live, engine, preview, children }: { live: boolean; engine: string; preview: VersionPreview; children: ReactNode }) {
	const [chatOpen, setChatOpen] = useState(() => !headless && localStorage.getItem('toucan.chat') !== 'closed')
	const [historyOpen, setHistoryOpen] = useState(false)
	const [title, setTitle] = useState(canvasName)
	const [draftRequest, setDraftRequest] = useState<{ text: string } | null>(null)
	const takeDraft = useCallback(() => setDraftRequest(null), [])
	const stage = useRef<HTMLDivElement>(null)
	const chat = useChatLayout()
	useEffect(() => {
		try {
			localStorage.setItem('toucan.chat', chatOpen ? 'open' : 'closed')
		} catch {}
	}, [chatOpen])
	useEffect(() => {
		api(`/api/canvases/${encodeURIComponent(canvasName)}/info`).then((c) => {
			if (!c.title) return
			setTitle(c.title)
			document.title = `${c.title} · toucan`
		}, () => {})
	}, [])
	return (
		<div className="flex h-full flex-col">
			<header className="toucan-ui z-[700] flex h-11 shrink-0 items-center gap-1.5 border-b bg-background px-3 text-sm">
				<a href="/" className="font-semibold tracking-tight outline-none hover:opacity-70 focus-visible:underline" title="All canvases">
					toucan
				</a>
				<span aria-hidden className="text-muted-foreground/60">
					/
				</span>
				<span className="min-w-0 truncate font-medium" title={canvasName}>
					{title}
				</span>
				<span className={cn('size-2 shrink-0 rounded-full', live ? 'bg-emerald-500' : 'bg-destructive')} role="status" aria-label={live ? 'synced' : 'offline'} title={live ? 'synced' : 'offline'} />
				{engine !== 'tldraw' && <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground max-sm:hidden">{engine}</span>}
				{!headless && <AwayNotice />}
				<span className="flex-1" />
				<Button variant="ghost" size="sm" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen} aria-label="History" title="History" className={cn(historyOpen && 'bg-muted')}>
					<HistoryIcon />
					<span className="max-lg:hidden">History</span>
				</Button>
				<Routines
					engine={engine}
					onAskAgent={() => {
						setChatOpen(true)
						setDraftRequest({ text: BANK_PROMPT })
					}}
				/>
				<AppearanceMenu />
				<Button variant="outline" size="sm" onClick={() => setChatOpen((o) => !o)} aria-expanded={chatOpen} aria-label={chatOpen ? 'Hide chat' : 'Show chat'} title={chatOpen ? 'Hide chat' : 'Show chat'} className={cn('ml-1', chatOpen && 'bg-muted')}>
					<MessageSquareIcon />
					<span className="max-lg:hidden">Chat</span>
				</Button>
			</header>
			<div ref={stage} className={cn('relative flex min-h-0 flex-1', chat.dock === 'left' ? 'flex-row-reverse' : chat.dock === 'bottom' ? 'flex-col' : 'flex-row')}>
				<div className="relative min-h-0 min-w-0 flex-1">
					{children}
					{historyOpen && <History Preview={preview} onClose={() => setHistoryOpen(false)} />}
				</div>
				{chatOpen && (
					<ChatDock chat={chat} stage={stage}>
						{(startDrag) => <Chat toolbar={<DockButtons dock={chat.dock} onDock={(dock) => chat.set((l) => ({ ...l, dock }))} />} onHeaderPointerDown={startDrag} draftRequest={draftRequest} onDraftTaken={takeDraft} />}
					</ChatDock>
				)}
			</div>
		</div>
	)
}
