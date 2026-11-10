import * as React from 'react'
import { ArrowUpIcon, SquareIcon, LoaderCircleIcon, PlusIcon, MessageCircleDashedIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from './ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from './ui/input-group'
import { Bubble, BubbleContent } from './ui/bubble'
import { Message, MessageContent } from './ui/message'
import { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from './ui/message-scroller'
import { Trace, TraceLine, TraceIcon, TraceTitle } from './ui/trace'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from './ui/empty'

export type ChatMode = 'fast' | 'thorough'
export function ChatHeader({ agent, online, toolbar, onNew, onPointerDown }: { agent: React.ReactNode; online: boolean; toolbar?: React.ReactNode; onNew?: () => void; onPointerDown?: React.PointerEventHandler<HTMLElement> }) {
 return <header className="flex items-center gap-2 border-b py-1.5 pr-1.5 pl-4 md:cursor-grab md:active:cursor-grabbing" onPointerDown={onPointerDown}>
  <span onPointerDown={e => e.stopPropagation()}>{agent}</span>
  <span className={cn('size-2 rounded-full', online ? 'bg-emerald-500' : 'bg-destructive')} role="status" aria-label={online ? 'connected' : 'offline'} title={online ? 'connected' : 'offline'} />
  <span className="flex-1" />{toolbar}
  {onNew && <Button variant="ghost" size="sm" onClick={onNew} disabled={!online}><PlusIcon />New chat</Button>}
 </header>
}
export function ChatComposer({ draft, onDraftChange, onSend, onStop, online, busy, mode = 'fast', onModeChange, placeholder = 'Message', matches = [], inputRef, disabled = false, allowSendWhileBusy = true }: {
 draft: string; onDraftChange: (draft: string) => void; onSend: (text: string, mode: ChatMode) => void; onStop?: () => void; online: boolean; busy: boolean; mode?: ChatMode; onModeChange?: (mode: ChatMode) => void; placeholder?: string; matches?: {name:string; title:string; description:string}[]; inputRef?: React.Ref<HTMLTextAreaElement>; disabled?: boolean; allowSendWhileBusy?: boolean;
}) {
 const formRef = React.useRef<HTMLFormElement>(null)
 const text = draft.trim()
 const canSend = online && !disabled && text.length > 0 && (!busy || allowSendWhileBusy)
 function onSubmit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (canSend) onSend(text, mode) }
 return (
			<div className="p-3 pt-0">
				<form ref={formRef} onSubmit={onSubmit} className="relative w-full">
					{matches.length > 0 && (
						<ul aria-label="Routines" className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-48 overflow-y-auto rounded-lg border bg-popover py-1 shadow-md">
							{matches.map((r) => (
								<li key={r.name}>
									<button
										type="button"
										className="block w-full px-3 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted"
										onClick={() => {
											onSend(`/${r.name}`, mode)
											onDraftChange('')
										}}
									>
										<span className="font-mono text-xs">/{r.name}</span> <span className="text-xs text-muted-foreground">{r.description || r.title}</span>
									</button>
								</li>
							))}
						</ul>
					)}
					<InputGroup>
						<InputGroupTextarea
							value={draft}
							onChange={(event) => onDraftChange(event.target.value)}
							ref={inputRef}
							placeholder={!online ? 'Reconnecting…' : busy ? 'Add to what it’s doing…' : placeholder}
							aria-label="Message"
							className="max-h-48 min-h-14 p-3"
							onKeyDown={(event) => {
								if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
									event.preventDefault()
									formRef.current?.requestSubmit()
								}
							}}
						/>
						<InputGroupAddon align="block-end">
							{onModeChange && <div role="radiogroup" aria-label="Agent speed" className="flex items-center rounded-md border p-px">
								{(
									[
										['fast', 'Fast', 'Quick edits: a lighter model that acts straight away'],
										['thorough', 'Thorough', 'Planning and hard layout: slower, thinks longer'],
									] as const
								).map(([value, label, title]) => (
									<button key={value} type="button" role="radio" aria-checked={mode === value} title={title} onClick={() => onModeChange?.(value)} className={cn('rounded-[5px] px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50', mode === value && 'bg-muted text-foreground')}>
										{label}
									</button>
								))}
							</div>}
							<span className="ml-auto" />
							{busy && onStop && (
								<InputGroupButton type="button" size="icon-sm" variant="outline" className="rounded-full" aria-label="Stop" title="Stop" onClick={() => onStop?.()}>
									<SquareIcon className="fill-current" />
								</InputGroupButton>
							)}
							{(!busy || text.length > 0 || !onStop) && (
								<InputGroupButton type="submit" size="icon-sm" variant="default" className="rounded-full" disabled={!canSend} aria-label={busy ? 'Add to this turn' : 'Send'} title={busy ? 'Add to this turn' : 'Send'}>
									<ArrowUpIcon />
								</InputGroupButton>
							)}
						</InputGroupAddon>
					</InputGroup>
				</form>
			</div>
 )
}
export type ConversationMessage = { id: string; role: 'user' | 'assistant'; text?: string; content?: React.ReactNode }
export function Conversation({ messages, busy, emptyTitle, emptyDescription }: { messages: ConversationMessage[]; busy: boolean; emptyTitle: string; emptyDescription: React.ReactNode }) {
 return <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor"><div className="relative min-h-0 flex-1">
 {messages.length === 0 ? <Empty className="h-full"><EmptyHeader><EmptyMedia variant="icon"><MessageCircleDashedIcon /></EmptyMedia><EmptyTitle>{emptyTitle}</EmptyTitle><EmptyDescription>{emptyDescription}</EmptyDescription></EmptyHeader></Empty> :
 <MessageScroller><MessageScrollerViewport><MessageScrollerContent aria-busy={busy} className="gap-5 px-4 py-4">
 {messages.map(m => <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === 'user'}>
 {m.role === 'user' ? <Message align="end"><MessageContent><Bubble align="end" variant="muted"><BubbleContent className="whitespace-pre-wrap">{m.text}</BubbleContent></Bubble></MessageContent></Message> : m.content || <Message><MessageContent className="whitespace-pre-wrap">{m.text}</MessageContent></Message>}
 </MessageScrollerItem>)}
 {busy && messages.at(-1)?.role === 'user' && <MessageScrollerItem messageId="pending"><Trace><TraceLine status="running"><TraceIcon><LoaderCircleIcon className="animate-spin" /></TraceIcon><TraceTitle>Working</TraceTitle></TraceLine></Trace></MessageScrollerItem>}
 </MessageScrollerContent></MessageScrollerViewport><MessageScrollerButton /></MessageScroller>}
 </div></MessageScrollerProvider>
}
