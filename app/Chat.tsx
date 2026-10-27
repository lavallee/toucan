import * as React from 'react'
import {
	ArrowUpIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	CircleDotIcon,
	CircleIcon,
	CircleStopIcon,
	FilePenIcon,
	LoaderCircleIcon,
	MessageCircleDashedIcon,
	PlusIcon,
	RouteIcon,
	ShrinkIcon,
	SquareIcon,
	TerminalIcon,
	WrenchIcon,
} from 'lucide-react'

import { Markdown } from '@/components/markdown'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from '@/components/ui/code-block'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Message, MessageContent } from '@/components/ui/message'
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceDescription,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from '@/components/ui/trace'
import {
	CodexTranscript,
	type ChatMessage,
	type ChatPart,
	type EditFilesPart,
	type PlanPart,
	type RunCommandPart,
	type ServerEvent,
	type ToolPart,
	isToolPart,
	messageText,
} from '@/lib/codex-messages'
import { cn } from '@/lib/utils'
import { wsUrl } from './net'

type Send = (msg: Record<string, unknown>) => void

// Chat panel for the Codex agent: the shadcn AI Elements "Chat" pattern, fed by
// server/codex.mjs over /ws/chat through the adapter in lib/codex-messages.ts.
export function Chat() {
	const transcript = React.useRef(new CodexTranscript())
	const [view, setView] = React.useState(() => transcript.current.snapshot())
	const [online, setOnline] = React.useState(false)
	const [pending, setPending] = React.useState(false) // sent, turn not started yet
	const [draft, setDraft] = React.useState('')
	const ws = React.useRef<WebSocket | null>(null)
	const formRef = React.useRef<HTMLFormElement>(null)

	React.useEffect(() => {
		let closed = false
		let frame = 0
		const flush = () => {
			frame = 0
			setView(transcript.current.snapshot())
		}
		function connect() {
			const sock = new WebSocket(wsUrl('/ws/chat'))
			ws.current = sock
			sock.onopen = () => setOnline(true)
			sock.onclose = () => {
				setOnline(false)
				if (!closed) setTimeout(connect, 1500)
			}
			sock.onmessage = (ev) => {
				const e: ServerEvent = JSON.parse(ev.data)
				transcript.current.apply(e)
				if (e.type === 'turn' || e.type === 'error' || e.type === 'history') setPending(false)
				// Deltas arrive many times a second; render at most once per frame.
				frame ||= requestAnimationFrame(flush)
			}
		}
		connect()
		return () => {
			closed = true
			cancelAnimationFrame(frame)
			ws.current?.close()
		}
	}, [])

	const send: Send = (msg) => ws.current?.readyState === 1 && ws.current.send(JSON.stringify(msg))
	const busy = view.busy || pending
	const text = draft.trim()
	const canSend = online && text.length > 0 && !busy

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!canSend) return
		send({ type: 'send', text })
		setDraft('')
		setPending(true)
	}

	const { messages } = view
	return (
		<aside
			className="toucan-ui flex min-h-0 min-w-0 flex-col border-l bg-background text-sm text-foreground max-md:border-t max-md:border-l-0"
			// Keep typing, shortcuts and paste in the panel away from tldraw's document listeners.
			onKeyDown={(e) => e.stopPropagation()}
			onKeyUp={(e) => e.stopPropagation()}
			onPaste={(e) => e.stopPropagation()}
		>
			<header className="flex items-center gap-2 border-b px-4 py-2.5">
				<span className="font-medium">Codex</span>
				<span
					className={cn('size-2 rounded-full', online ? 'bg-emerald-500' : 'bg-destructive')}
					role="status"
					aria-label={online ? 'connected' : 'offline'}
					title={online ? 'connected' : 'offline'}
				/>
				<Button variant="ghost" size="sm" className="ml-auto" onClick={() => send({ type: 'new' })} disabled={!online}>
					<PlusIcon />
					New chat
				</Button>
			</header>

			<MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
				<div className="relative min-h-0 flex-1">
					{messages.length === 0 ? (
						<Empty className="h-full">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<MessageCircleDashedIcon />
								</EmptyMedia>
								<EmptyTitle>What should change on the canvas?</EmptyTitle>
								<EmptyDescription>
									“Group these into a frame”, “colour anything unowned red”, “add a button that re-runs the layout”.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<MessageScroller>
							<MessageScrollerViewport>
								<MessageScrollerContent aria-busy={busy} className="gap-5 px-4 py-4">
									{messages.map((message) =>
										message.role === 'user' ? (
											<MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor>
												<Message align="end">
													<MessageContent>
														<Bubble align="end" variant="muted">
															<BubbleContent className="whitespace-pre-wrap">{messageText(message)}</BubbleContent>
														</Bubble>
													</MessageContent>
												</Message>
											</MessageScrollerItem>
										) : (
											<MessageScrollerItem key={message.id} messageId={message.id}>
												<AssistantMessage
													message={message}
													streaming={busy && message === messages.at(-1)}
													send={send}
												/>
											</MessageScrollerItem>
										),
									)}
									{busy && messages.at(-1)?.role === 'user' && (
										<MessageScrollerItem messageId="pending">
											<Trace>
												<TraceLine status="running">
													<TraceIcon>
														<LoaderCircleIcon className="animate-spin" />
													</TraceIcon>
													<TraceTitle>Working</TraceTitle>
												</TraceLine>
											</Trace>
										</MessageScrollerItem>
									)}
								</MessageScrollerContent>
							</MessageScrollerViewport>
							<MessageScrollerButton />
						</MessageScroller>
					)}
				</div>
			</MessageScrollerProvider>

			<div className="p-3 pt-0">
				<form ref={formRef} onSubmit={onSubmit} className="w-full">
					<InputGroup>
						<InputGroupTextarea
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							placeholder={online ? 'Message Codex…' : 'Reconnecting…'}
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
							<span className="text-xs text-muted-foreground">Enter to send · Shift+Enter for a new line</span>
							{busy ? (
								<InputGroupButton
									type="button"
									size="icon-sm"
									variant="default"
									className="ml-auto rounded-full"
									aria-label="Stop"
									title="Stop"
									onClick={() => send({ type: 'interrupt' })}
								>
									<SquareIcon className="fill-current" />
								</InputGroupButton>
							) : (
								<InputGroupButton
									type="submit"
									size="icon-sm"
									variant="default"
									className="ml-auto rounded-full"
									disabled={!canSend}
									aria-label="Send"
									title="Send"
								>
									<ArrowUpIcon />
								</InputGroupButton>
							)}
						</InputGroupAddon>
					</InputGroup>
				</form>
			</div>
		</aside>
	)
}

// ---- assistant turn ------------------------------------------------------------

const isStep = (p: ChatPart) =>
	p.type === 'reasoning' || p.type === 'data-plan' || p.type === 'data-notice' || (isToolPart(p) && p.state !== 'approval-requested')

function AssistantMessage({ message, streaming, send }: { message: ChatMessage; streaming: boolean; send: Send }) {
	// Consecutive steps share one Trace; text, approvals and errors sit between Trace lists.
	const blocks: (ChatPart | ChatPart[])[] = []
	for (const part of message.parts) {
		if (part.type === 'reasoning' && !part.text && part.state === 'done') continue // nothing to show
		if (isStep(part)) {
			const last = blocks.at(-1)
			if (Array.isArray(last)) last.push(part)
			else blocks.push([part])
		} else blocks.push(part)
	}

	return (
		<Message>
			<MessageContent className="min-w-0 gap-3">
				{blocks.map((block, i) => {
					if (Array.isArray(block))
						return (
							<Trace key={i}>
								{block.map((part, j) => (
									<StepLine key={'id' in part ? part.id : 'toolCallId' in part ? part.toolCallId : j} part={part} streaming={streaming} />
								))}
							</Trace>
						)
					if (block.type === 'text')
						return block.text ? (
							<Markdown key={block.id} streaming={streaming && block.state === 'streaming'}>
								{block.text}
							</Markdown>
						) : null
					if (block.type === 'data-error')
						return (
							<Item key={block.id} variant="outline" size="sm" className="border-destructive/40 text-destructive">
								<ItemMedia variant="icon">
									<CircleAlertIcon />
								</ItemMedia>
								<ItemContent>
									<ItemDescription className="text-destructive">{block.data.message}</ItemDescription>
								</ItemContent>
							</Item>
						)
					if (isToolPart(block) && block.state === 'approval-requested') return <Confirmation key={block.toolCallId} part={block} send={send} />
					return null
				})}
			</MessageContent>
		</Message>
	)
}

function StepLine({ part, streaming }: { part: ChatPart; streaming: boolean }) {
	switch (part.type) {
		case 'reasoning':
			return <ReasoningLine text={part.text} running={streaming && part.state === 'streaming'} />
		case 'tool-runCommand':
			return <CommandLine part={part} streaming={streaming} />
		case 'tool-editFiles':
			return <EditLine part={part} streaming={streaming} />
		case 'tool-call': {
			const running = part.state === 'input-available' && streaming
			return (
				<TraceLine status={part.state === 'output-error' ? 'error' : running ? 'running' : undefined}>
					<TraceIcon>{part.input.runningTitle ? <ShrinkIcon /> : <WrenchIcon />}</TraceIcon>
					<TraceTitle>{running ? (part.input.runningTitle ?? part.input.title) : part.input.title}</TraceTitle>
				</TraceLine>
			)
		}
		case 'data-plan':
			return <PlanLine plan={part.data} streaming={streaming} />
		case 'data-notice':
			return (
				<TraceLine>
					<TraceIcon>
						<CircleStopIcon />
					</TraceIcon>
					<TraceTitle>{part.data.message}</TraceTitle>
				</TraceLine>
			)
	}
	return null
}

// Reasoning pattern: opens while the model thinks, closes when done, unless the person chose.
function ReasoningLine({ text, running }: { text: string; running: boolean }) {
	const [open, setOpen] = React.useState<boolean>()
	const line = (
		<TraceLine status={running ? 'running' : undefined}>
			<TraceIcon>{running ? <LoaderCircleIcon className="animate-spin" /> : <CircleCheckIcon />}</TraceIcon>
			<TraceTitle>{running ? 'Thinking' : 'Thought'}</TraceTitle>
		</TraceLine>
	)
	if (text.length === 0) return line
	return (
		<TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
			<TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
			<TraceCollapsibleContent>
				<Markdown className="text-muted-foreground">{text}</Markdown>
			</TraceCollapsibleContent>
		</TraceCollapsible>
	)
}

const seconds = (ms?: number | null) => (ms == null ? null : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

function denied(part: ToolPart) {
	return part.state === 'output-denied' || (part.state === 'approval-responded' && 'approval' in part && part.approval?.approved === false)
}

// Tool pattern for commandExecution: a plain line while it runs, a collapsible with output once done.
function CommandLine({ part, streaming }: { part: RunCommandPart; streaming: boolean }) {
	const command = part.input.command
	const icon = (
		<TraceIcon>
			<TerminalIcon />
		</TraceIcon>
	)
	if (denied(part))
		return (
			<TraceLine>
				{icon}
				<TraceTitle>Denied {command}</TraceTitle>
			</TraceLine>
		)

	const finished = part.state === 'output-available' || part.state === 'output-error'
	const failed = part.state === 'output-error'
	const running = !finished && streaming
	const stdout = (failed ? part.errorText : part.output?.stdout) ?? ''
	const line = (
		<TraceLine status={failed ? 'error' : running ? 'running' : !finished ? 'error' : undefined}>
			{icon}
			<TraceTitle title={command}>
				{failed ? 'Failed to run' : finished ? 'Ran' : running ? 'Running' : 'Failed to run'} {command}
			</TraceTitle>
			{finished && (
				<TraceDescription>
					{[failed && part.output?.exitCode != null ? `exit ${part.output.exitCode}` : null, seconds(part.output?.durationMs)]
						.filter(Boolean)
						.join(' · ')}
				</TraceDescription>
			)}
		</TraceLine>
	)
	if (!finished && !stdout) return line
	return (
		<TraceCollapsible>
			<TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
			<TraceCollapsibleContent>
				<CodeBlock size="sm" variant={failed ? 'destructive' : 'default'}>
					<CodeBlockContent wrap className="max-h-64">
						{`$ ${command}\n${stdout.trimEnd() || '(no output)'}`}
					</CodeBlockContent>
				</CodeBlock>
			</TraceCollapsibleContent>
		</TraceCollapsible>
	)
}

function diffStats(diff = '', kind?: string) {
	const lines = diff.split('\n').filter((l) => l.length)
	if (kind === 'add') return { added: lines.length, removed: 0 }
	if (kind === 'delete') return { added: 0, removed: lines.length }
	let added = 0
	let removed = 0
	for (const l of lines) {
		if (l.startsWith('+++') || l.startsWith('---')) continue
		if (l.startsWith('+')) added++
		else if (l.startsWith('-')) removed++
	}
	return { added, removed }
}

function DiffLines({ diff, kind }: { diff: string; kind?: string }) {
	return diff
		.replace(/\n$/, '')
		.split('\n')
		.filter((line) => !line.startsWith('+++') && !line.startsWith('---'))
		.map((line, index) => {
			if (kind === 'add' || kind === 'delete')
				return (
					<CodeBlockLine key={index} variant={kind === 'add' ? 'added' : 'removed'}>
						{line}
					</CodeBlockLine>
				)
			if (line.startsWith('@@'))
				return (
					<CodeBlockLine key={index} className="text-muted-foreground">
						{line}
					</CodeBlockLine>
				)
			return (
				<CodeBlockLine key={index} variant={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'default'}>
					{line.slice(1)}
				</CodeBlockLine>
			)
		})
}

const basename = (p: string) => p.split('/').at(-1) ?? p

// Tool pattern for fileChange: paths in the title, the diff of each file inside.
function EditLine({ part, streaming }: { part: EditFilesPart; streaming: boolean }) {
	const changes = part.input.changes
	const what = changes.length === 1 ? basename(changes[0].path) : `${changes.length} files`
	const totals = changes.map((c) => diffStats(c.diff, c.kind)).reduce((a, b) => ({ added: a.added + b.added, removed: a.removed + b.removed }), { added: 0, removed: 0 })
	const finished = part.state === 'output-available'
	const failed = part.state === 'output-error'
	const verb = denied(part) ? 'Denied edit to' : failed ? 'Failed to edit' : finished ? 'Edited' : streaming ? 'Editing' : 'Failed to edit'
	const line = (
		<TraceLine status={failed || (!finished && !streaming && !denied(part)) ? 'error' : !finished && !denied(part) ? 'running' : undefined}>
			<TraceIcon>
				<FilePenIcon />
			</TraceIcon>
			<TraceTitle title={changes.map((c) => c.path).join('\n')}>
				{verb} {what}
			</TraceTitle>
			{(totals.added > 0 || totals.removed > 0) && (
				<TraceDescription className="font-mono">
					+{totals.added} −{totals.removed}
				</TraceDescription>
			)}
		</TraceLine>
	)
	if (!changes.some((c) => c.diff)) return line
	return (
		<TraceCollapsible>
			<TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
			<TraceCollapsibleContent className="flex flex-col gap-2">
				{changes.map((c) => (
					<CodeBlock key={c.path} size="sm">
						<CodeBlockHeader>
							<CodeBlockTitle className="font-mono">{c.path}</CodeBlockTitle>
						</CodeBlockHeader>
						<CodeBlockContent className="max-h-64">{c.diff ? <DiffLines diff={c.diff} kind={c.kind} /> : null}</CodeBlockContent>
					</CodeBlock>
				))}
			</TraceCollapsibleContent>
		</TraceCollapsible>
	)
}

// Plan pattern, from turn/plan/updated.
function PlanLine({ plan, streaming }: { plan: PlanPart['data']; streaming: boolean }) {
	const done = plan.steps.filter((s) => s.status === 'done').length
	const running = streaming && done < plan.steps.length
	return (
		<TraceCollapsible defaultOpen>
			<TraceCollapsibleTrigger>
				<TraceLine status={running ? 'running' : undefined}>
					<TraceIcon>
						<RouteIcon />
					</TraceIcon>
					<TraceTitle>{plan.title}</TraceTitle>
					<TraceDescription>
						{done} of {plan.steps.length} done
					</TraceDescription>
				</TraceLine>
			</TraceCollapsibleTrigger>
			<TraceCollapsibleContent className="flex flex-col gap-3">
				{plan.explanation && <p>{plan.explanation}</p>}
				<Trace>
					{plan.steps.map((step, i) => (
						<TraceLine
							key={i}
							status={step.status === 'pending' ? 'pending' : streaming && step.status === 'running' ? 'running' : undefined}
						>
							<TraceIcon>
								{step.status === 'done' ? <CircleCheckIcon /> : step.status === 'running' ? <CircleDotIcon /> : <CircleIcon />}
							</TraceIcon>
							<TraceTitle>{step.title}</TraceTitle>
						</TraceLine>
					))}
				</Trace>
			</TraceCollapsibleContent>
		</TraceCollapsible>
	)
}

// Confirmation pattern: a pending approval is a question, so it sits outside Trace.
function Confirmation({ part, send }: { part: ToolPart; send: Send }) {
	const approval = 'approval' in part ? part.approval : undefined
	if (!approval) return null
	const answer = (decision: 'accept' | 'decline') => send({ type: 'approve', key: approval.id, decision })
	const command = part.type === 'tool-runCommand' ? part.input.command : ''
	const files = part.type === 'tool-editFiles' ? part.input.changes.map((c) => c.path) : []
	return (
		<Item variant="outline" size="sm" className="items-start">
			<ItemMedia variant="icon">{part.type === 'tool-editFiles' ? <FilePenIcon /> : <TerminalIcon />}</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle className="block w-full min-w-0 break-words">
					{part.type === 'tool-editFiles' ? (
						<>Edit {files.length ? files.map(basename).join(', ') : 'files'}?</>
					) : (
						<>
							Run <code className="font-mono text-[0.9em]">{command}</code>?
						</>
					)}
				</ItemTitle>
				<ItemDescription>{approval.reason || 'Codex is asking to go outside its sandbox.'}</ItemDescription>
			</ItemContent>
			<ItemActions>
				<Button size="sm" variant="outline" onClick={() => answer('decline')}>
					Deny
				</Button>
				<Button size="sm" onClick={() => answer('accept')}>
					Allow
				</Button>
			</ItemActions>
		</Item>
	)
}
