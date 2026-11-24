import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { HistoryIcon, LayoutTemplateIcon, MessageSquareIcon } from 'lucide-react'
import { Button } from '@lyra-forge/leyline/ui/button'
import { AppBar, AppBarButton } from '@lyra-forge/leyline/app-bar'
import { cn } from '@/lib/utils'
import { Chat } from './Chat'
import { ChatDock, DockButtons, useChatLayout } from '@lyra-forge/leyline/dock'
import { History, type VersionPreview } from './History'
import { Routines } from './Routines'
import { Reflexes } from './Reflexes'
import { CommentButton, ThreadsButton, ThreadsPanel } from './Threads'
import { update as updateThreads, useThreads } from './threads-store'
import { AppearanceMenu } from './Appearance'
import { api, canvasName, headless } from './net'
import { chooseFormat, loadFormats, useFormat, useFormatList } from './formats'
import { Popover, PopoverContent, PopoverTrigger } from '@lyra-forge/leyline/ui/popover'
import { AwayNotice } from './AwayNotice'
import { AgentStatus } from './pulses'
import { ReferencesButton, ReferencesPanel } from './References'
import { AddMenu } from './AddMenu'
import { PlanMenu } from './PlanMenu'
import { PlanNotice } from './PlanNotice'
import { ExportMenu } from './ExportMenu'
import { ReviewButton } from './Review'
import { close as closeReferences, openReference, toggle as toggleReferences, useReferences } from './references-store'

document.title = `${canvasName} · toucan`

const BANK_PROMPT = 'Bank what you just did as a routine I can run on any canvas. '

/** The page around any engine's canvas: toucan's app bar, the canvas, its history, and the chat panel. */
export function CanvasFrame({ live, engine, preview, onComment, children }: { live: boolean; engine: string; preview: VersionPreview; onComment: () => void; children: ReactNode }) {
	const { panel: threadsOpen } = useThreads()
	const format = useFormat()
	const formats = useFormatList()
	const [chatOpen, setChatOpen] = useState(() => !headless && localStorage.getItem('toucan.chat') !== 'closed')
	const [historyOpen, setHistoryOpen] = useState(false)
	const { open: referencesOpen } = useReferences()
	// One panel on the right at a time: opening References (or an agent showing something) puts the others away, and they it.
	useEffect(() => {
		if (!referencesOpen) return
		setHistoryOpen(false)
		updateThreads({ panel: false })
	}, [referencesOpen])
	useEffect(() => {
		if (threadsOpen || historyOpen) closeReferences()
	}, [threadsOpen, historyOpen])
	// A link on the canvas (a pasted bookmark, an element's link) opens beside it rather than in a new tab. A modifier key
	// still opens a tab, as people expect.
	useEffect(() => {
		const el = stage.current
		if (!el) return
		const onClick = (e: MouseEvent) => {
			if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
			const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null
			if (!a || a.closest('.toucan-ui') || !/^https?:\/\//i.test(a.href) || a.origin === location.origin) return
			e.preventDefault()
			e.stopPropagation()
			openReference(a.href)
		}
		el.addEventListener('click', onClick, true)
		return () => el.removeEventListener('click', onClick, true)
	}, [])
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
			loadFormats(c.format).catch(() => {})
			if (!c.title) return
			setTitle(c.title)
			document.title = `${c.title} · toucan`
		}, () => {})
	}, [])
	return (
		<div className="flex h-full flex-col">
			<AppBar product="toucan" productHref="/" productTitle="All canvases" title={title} titleHint={canvasName} live={live} tag={engine !== 'tldraw' ? engine : null} status={!headless && <AwayNotice />}>
				<Popover>
					<PopoverTrigger asChild>
						<AppBarButton icon={LayoutTemplateIcon} label={format?.label ?? 'Format'} aria-label={`Format: ${format?.label ?? 'none'}`} title="Format: how this canvas behaves" />
					</PopoverTrigger>
					<PopoverContent className="w-72 p-1">
						<ul role="radiogroup" aria-label="Format">
							{[{ id: null as string | null, label: 'None', description: 'A free canvas' }, ...formats].map((f) => (
								<li key={f.id ?? 'none'}>
									<button type="button" role="radio" aria-checked={(format?.id ?? null) === f.id} onClick={() => chooseFormat(f.id)} className={cn('w-full rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted', (format?.id ?? null) === f.id && 'bg-muted')}>
										<span className="block text-sm font-medium">{f.label}</span>
										<span className="block text-xs text-muted-foreground">{f.description}</span>
									</button>
								</li>
							))}
						</ul>
						<p className="border-t px-2 pt-1.5 pb-1 text-xs text-muted-foreground">Choosing a format moves nothing. To give an existing diagram room, run Air out from Routines.</p>
					</PopoverContent>
				</Popover>
				<PlanMenu />
				<AddMenu />
				<ReferencesButton open={referencesOpen} onToggle={toggleReferences} />
				<CommentButton onComment={onComment} />
				<ThreadsButton />
				<AppBarButton icon={HistoryIcon} label="History" pressed={historyOpen} aria-expanded={historyOpen} onClick={() => (setHistoryOpen((o) => !o), updateThreads({ panel: false }))} />
				{!headless && <ReviewButton />}
				<ExportMenu />
				<Reflexes
					onAskAgent={(text) => {
						setChatOpen(true)
						setDraftRequest({ text })
					}}
				/>
				<Routines
					engine={engine}
					onAskAgent={(text) => {
						setChatOpen(true)
						setDraftRequest({ text: text ?? BANK_PROMPT })
					}}
				/>
				<AppearanceMenu />
				<AppBarButton icon={MessageSquareIcon} label="Chat" variant="outline" pressed={chatOpen} aria-expanded={chatOpen} aria-label={chatOpen ? 'Hide chat' : 'Show chat'} title={chatOpen ? 'Hide chat' : 'Show chat'} className={cn(chatOpen && 'bg-muted')} onClick={() => setChatOpen((o) => !o)} />
			</AppBar>
			<div ref={stage} className={cn('relative flex min-h-0 flex-1', chat.dock === 'left' ? 'flex-row-reverse' : chat.dock === 'bottom' ? 'flex-col' : 'flex-row')}>
				<div className="relative min-h-0 min-w-0 flex-1">
					{children}
					{!headless && <AgentStatus top={engine === 'excalidraw' ? 84 : 52} />}
					{!headless && <PlanNotice />}
					{historyOpen && !threadsOpen && <History Preview={preview} onClose={() => setHistoryOpen(false)} />}
					{threadsOpen && <ThreadsPanel />}
					{referencesOpen && !threadsOpen && !historyOpen && <ReferencesPanel />}
				</div>
				{chatOpen && (
					<ChatDock chat={chat} stage={stage}>
						{(startDrag) => <Chat engine={engine} toolbar={<DockButtons dock={chat.dock} onDock={(dock) => chat.set((l) => ({ ...l, dock }))} />} onHeaderPointerDown={startDrag} draftRequest={draftRequest} onDraftTaken={takeDraft} />}
					</ChatDock>
				)}
			</div>
		</div>
	)
}
