import { ChatHeader, ChatComposer, Conversation } from '../packages/agent-chat/src'
import * as React from 'react'
import {
	CircleAlertIcon,
	CircleCheckIcon,
	CircleDotIcon,
	CircleIcon,
	CircleStopIcon,
	FilePenIcon,
	LoaderCircleIcon,
	RouteIcon,
	ShrinkIcon,
	TerminalIcon,
	WrenchIcon,
} from 'lucide-react'

import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from '@/components/ui/code-block'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Message, MessageContent } from '@/components/ui/message'

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
import { api, wsUrl } from './net'
import { AgentPicker, type Agent } from './AgentPicker'

type Send = (msg: Record<string, unknown>) => void

// Chat panel for the Codex agent: the shadcn AI Elements "Chat" pattern, fed by
// server/codex.mjs over /ws/chat through the adapter in lib/codex-messages.ts.
export function Chat({ toolbar, onHeaderPointerDown, engine, draftRequest, onDraftTaken }: { engine: string; toolbar?: React.ReactNode; onHeaderPointerDown?: (e: React.PointerEvent) => void; draftRequest?: { text: string } | null; onDraftTaken?: () => void }) {
	const transcript = React.useRef(new CodexTranscript())
	const [view, setView] = React.useState(() => transcript.current.snapshot())
	const [online, setOnline] = React.useState(false)
	const [pending, setPending] = React.useState(false) // sent, turn not started yet
	const [draft, setDraft] = React.useState('')
	const [agent, setAgent] = React.useState<Agent>(null) // toucan's own agent, or the named one this canvas works with
	const ws = React.useRef<WebSocket | null>(null)
	const inputRef = React.useRef<HTMLTextAreaElement>(null)
	const [mode, setMode] = React.useState<'fast' | 'thorough'>(() => (localStorage.getItem('toucan.chatMode') === 'thorough' ? 'thorough' : 'fast'))
	const [routines, setRoutines] = React.useState<{ name: string; title: string; description: string; engines: string[] }[]>([])
	React.useEffect(() => {
		api('/api/routines').then((r) => setRoutines(r.routines), () => {})
	}, [])
	const chooseMode = (next: 'fast' | 'thorough') => {
		setMode(next)
		localStorage.setItem('toucan.chatMode', next)
	}

	// Something outside the panel starts a message for the person to finish (the Routines menu).
	React.useEffect(() => {
		if (!draftRequest) return
		setDraft(draftRequest.text)
		inputRef.current?.focus()
		onDraftTaken?.()
	}, [draftRequest, onDraftTaken])

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
				if ((e as any).type === 'agent') return setAgent((e as any).agent)
				transcript.current.apply(e)
				if (e.type === 'turn' || e.type === 'error' || e.type === 'history' || e.type === 'direct-done') setPending(false)
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
	// Typing "/" offers the banked routines, which run straight away with no agent.
	const slash = /^\/([\w-]*)$/.exec(draft)
	const matches = slash ? routines.filter((r) => r.engines.includes(engine) && (r.name.includes(slash[1].toLowerCase()) || r.title.toLowerCase().includes(slash[1].toLowerCase()))) : []

	const { messages } = view
	return (
		<aside
			className="toucan-ui flex min-h-0 min-w-0 flex-1 flex-col bg-background text-sm text-foreground"
			// Keep typing, shortcuts and paste in the panel away from tldraw's document listeners.
			onKeyDown={(e) => e.stopPropagation()}
			onKeyUp={(e) => e.stopPropagation()}
			onPaste={(e) => e.stopPropagation()}
		>
			<ChatHeader agent={<AgentPicker agent={agent} disabled={!online} />} online={online} toolbar={toolbar} onNew={() => send({ type: 'new' })} onPointerDown={onHeaderPointerDown} />

			<Conversation messages={messages.map(message => ({ id: message.id, role: message.role, text: messageText(message), content: message.role === 'user' ? undefined : <AssistantMessage message={message} streaming={busy && message === messages.at(-1)} send={send} /> }))} busy={busy} emptyTitle={agent && 'name' in agent ? `Working with ${agent.name}` : 'What should change on the canvas?'} emptyDescription={agent && 'name' in agent ? `${agent.name} has their own knowledge loaded, and can draw on the canvas like any agent.` : '“Group these into a frame”, “colour anything unowned red”, “add a button that re-runs the layout”.'} />

			<ChatComposer draft={draft} onDraftChange={setDraft} inputRef={inputRef} online={online} busy={busy} mode={mode} onModeChange={chooseMode} matches={matches} placeholder={agent && 'name' in agent ? `Ask ${agent.name}, or / for a routine` : 'Tell it what to put on the canvas, or / for a routine'} onSend={(text, mode) => { send({ type: 'send', text, mode }); setDraft(''); setPending(true) }} onStop={() => send({ type: 'interrupt' })} />

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
