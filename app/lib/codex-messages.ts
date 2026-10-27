// Maps the chat relay's events (server/codex.mjs) onto AI-SDK-shaped UIMessage parts, so the
// shadcn AI Elements patterns can render them without the AI SDK runtime.
//
//   user                         -> user message, text part
//   item agentMessage + delta    -> text part (state streaming|done)
//   item plan                    -> text part (Codex plan-mode proposal, markdown)
//   item reasoning + reasoning   -> reasoning part (summary deltas, joined per summaryIndex)
//   item commandExecution+output -> tool-runCommand part (input-available -> output-*)
//   item fileChange              -> tool-editFiles part (changes with unified diffs)
//   item mcpToolCall/dynamic/web -> tool-call part (generic line)
//   item contextCompaction       -> tool-call part ("Compacting the conversation")
//   approval / approved          -> approval-requested / approval-responded on the tool part
//   plan (turn/plan/updated)     -> data-plan part, replaced in place per turn
//   turn failed / error          -> data-error part; turn interrupted -> data-notice part

export type ServerEvent = { type: string; [k: string]: any }

export type ToolState =
	| 'input-available'
	| 'approval-requested'
	| 'approval-responded'
	| 'output-available'
	| 'output-error'
	| 'output-denied'

export type Approval = { id: string; kind: 'commandExecution' | 'fileChange' | string; reason?: string; approved?: boolean }

export type FileChange = { path: string; kind?: 'add' | 'delete' | 'update'; diff?: string }

export type TextPart = { type: 'text'; id: string; text: string; state: 'streaming' | 'done' }
export type ReasoningPart = { type: 'reasoning'; id: string; text: string; state: 'streaming' | 'done' }
export type RunCommandPart = {
	type: 'tool-runCommand'
	toolCallId: string
	state: ToolState
	input: { command: string; cwd?: string }
	output?: { stdout: string; exitCode?: number | null; durationMs?: number | null }
	errorText?: string
	approval?: Approval
}
export type EditFilesPart = {
	type: 'tool-editFiles'
	toolCallId: string
	state: ToolState
	input: { changes: FileChange[] }
	errorText?: string
	approval?: Approval
}
export type ToolCallPart = { type: 'tool-call'; toolCallId: string; state: ToolState; input: { title: string; runningTitle?: string } }
export type PlanStep = { title: string; status: 'done' | 'running' | 'pending' }
export type PlanPart = { type: 'data-plan'; id: string; data: { title: string; explanation?: string | null; steps: PlanStep[] } }
export type ErrorPart = { type: 'data-error'; id: string; data: { message: string } }
export type NoticePart = { type: 'data-notice'; id: string; data: { message: string } }

export type ToolPart = RunCommandPart | EditFilesPart | ToolCallPart
export type ChatPart = TextPart | ReasoningPart | ToolPart | PlanPart | ErrorPart | NoticePart
export type ChatMessage = { id: string; role: 'user' | 'assistant'; parts: ChatPart[] }

export const isToolPart = (p: ChatPart): p is ToolPart => p.type.startsWith('tool-')

const OUTPUT_CAP = 6000

// `/bin/bash -lc 'node bin/toucan.mjs …'` -> `node bin/toucan.mjs …`
export function displayCommand(command: unknown): string {
	const s = Array.isArray(command) ? command.join(' ') : String(command ?? '')
	const m = /^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(s.trim())
	return m ? m[2] : s
}

// Mutable builder; `snapshot()` hands React fresh objects for every render.
export class CodexTranscript {
	messages: ChatMessage[] = []
	busy = false
	private seq = 0
	private parts = new Map<string, ChatPart>() // item id / approval key / plan id -> part
	private summaries = new Map<string, string[]>() // reasoning item id -> summary sections

	reset() {
		this.messages = []
		this.busy = false
		this.seq = 0
		this.parts.clear()
		this.summaries.clear()
	}

	private assistant(): ChatMessage {
		const last = this.messages.at(-1)
		if (last?.role === 'assistant') return last
		const m: ChatMessage = { id: `m${++this.seq}`, role: 'assistant', parts: [] }
		this.messages.push(m)
		return m
	}

	private add<T extends ChatPart>(key: string, part: T): T {
		this.assistant().parts.push(part)
		this.parts.set(key, part)
		return part
	}

	apply(e: ServerEvent) {
		switch (e.type) {
			case 'history':
				this.reset()
				for (const x of e.events ?? []) this.apply(x)
				return
			case 'user':
				this.messages.push({ id: `m${++this.seq}`, role: 'user', parts: [{ type: 'text', id: `t${this.seq}`, text: e.text, state: 'done' }] })
				return
			case 'turn':
				this.busy = e.status === 'inProgress'
				if (e.status === 'failed') this.add(`err${++this.seq}`, { type: 'data-error', id: `err${this.seq}`, data: { message: `Turn failed${e.error ? `: ${e.error}` : ''}` } })
				if (e.status === 'interrupted') this.add(`n${++this.seq}`, { type: 'data-notice', id: `n${this.seq}`, data: { message: 'Stopped' } })
				if (!this.busy) this.settle()
				return
			case 'error':
				this.add(`err${++this.seq}`, { type: 'data-error', id: `err${this.seq}`, data: { message: e.message } })
				return
			case 'delta':
				this.text(e.itemId).text += e.text
				return
			case 'reasoning': {
				const p = this.reasoning(e.itemId)
				const s = this.summaries.get(e.itemId) ?? []
				s[e.index ?? 0] = (s[e.index ?? 0] ?? '') + e.text
				this.summaries.set(e.itemId, s)
				p.text = s.filter(Boolean).join('\n\n')
				return
			}
			case 'output': {
				const p = this.parts.get(e.itemId)
				if (p?.type !== 'tool-runCommand') return
				p.output ??= { stdout: '' }
				p.output.stdout = (p.output.stdout + e.text).slice(-OUTPUT_CAP)
				return
			}
			case 'plan': {
				const key = `plan-${e.turnId}`
				const data = {
					title: 'Plan',
					explanation: e.explanation,
					steps: (e.steps ?? []).map((s: any) => ({
						title: s.step,
						status: s.status === 'completed' ? 'done' : s.status === 'inProgress' ? 'running' : 'pending',
					})) as PlanStep[],
				}
				const existing = this.parts.get(key)
				if (existing?.type === 'data-plan') existing.data = data
				else this.add(key, { type: 'data-plan', id: key, data })
				return
			}
			case 'approval':
				return this.approval(e)
			case 'approved': {
				const p = this.parts.get(e.key)
				if (p && 'approval' in p && p.approval) {
					p.approval.approved = e.decision === 'accept'
					if (p.state === 'approval-requested') p.state = 'approval-responded'
				}
				return
			}
			case 'item':
				return this.item(e.item, e.phase === 'completed')
		}
	}

	private text(id: string): TextPart {
		const p = this.parts.get(id)
		return p?.type === 'text' ? p : this.add(id, { type: 'text', id, text: '', state: 'streaming' })
	}

	private reasoning(id: string): ReasoningPart {
		const p = this.parts.get(id)
		return p?.type === 'reasoning' ? p : this.add(id, { type: 'reasoning', id, text: '', state: 'streaming' })
	}

	private item(it: any, completed: boolean) {
		if (!it?.id) return
		const done = (status?: string) => status !== 'inProgress'
		switch (it.type) {
			case 'agentMessage':
			case 'plan': {
				const p = this.text(it.id)
				if (it.text) p.text = it.text
				if (completed) p.state = 'done'
				return
			}
			case 'reasoning': {
				const p = this.reasoning(it.id)
				const summary = (it.summary ?? []).filter(Boolean)
				if (summary.length) p.text = summary.join('\n\n')
				if (completed) p.state = 'done'
				return
			}
			case 'commandExecution': {
				let p = this.parts.get(it.id) as RunCommandPart | undefined
				if (p?.type !== 'tool-runCommand') p = this.add(it.id, { type: 'tool-runCommand', toolCallId: it.id, state: 'input-available', input: { command: '' } })
				p.input = { command: displayCommand(it.command) || p.input.command, cwd: it.cwd }
				const stdout = it.output ?? p.output?.stdout ?? ''
				p.output = { stdout, exitCode: it.exitCode, durationMs: it.durationMs }
				if (it.status === 'declined') p.state = 'output-denied'
				else if (it.status === 'failed' || (it.exitCode != null && it.exitCode !== 0)) {
					p.state = 'output-error'
					p.errorText = stdout || `exit code ${it.exitCode ?? '?'}`
				} else if (done(it.status)) p.state = 'output-available'
				else if (p.state !== 'approval-requested' && p.state !== 'approval-responded') p.state = 'input-available'
				return
			}
			case 'fileChange': {
				let p = this.parts.get(it.id) as EditFilesPart | undefined
				if (p?.type !== 'tool-editFiles') p = this.add(it.id, { type: 'tool-editFiles', toolCallId: it.id, state: 'input-available', input: { changes: [] } })
				const changes: FileChange[] = it.changes ?? (it.paths ?? []).map((path: string) => ({ path }))
				if (changes.length) p.input = { changes }
				if (it.status === 'declined') p.state = 'output-denied'
				else if (it.status === 'failed') {
					p.state = 'output-error'
					p.errorText = 'The patch did not apply.'
				} else if (it.status === 'completed') p.state = 'output-available'
				return
			}
			case 'contextCompaction': {
				let p = this.parts.get(it.id) as ToolCallPart | undefined
				if (p?.type !== 'tool-call')
					p = this.add(it.id, { type: 'tool-call', toolCallId: it.id, state: 'input-available', input: { title: 'Compacted the conversation', runningTitle: 'Compacting the conversation' } })
				if (completed) p.state = 'output-available'
				return
			}
			case 'mcpToolCall':
			case 'dynamicToolCall':
			case 'webSearch': {
				let p = this.parts.get(it.id) as ToolCallPart | undefined
				const title =
					it.type === 'webSearch' ? `Searched the web${it.query ? ` for ${it.query}` : ''}` : `Called ${[it.server, it.tool].filter(Boolean).join('.')}`
				if (p?.type !== 'tool-call') p = this.add(it.id, { type: 'tool-call', toolCallId: it.id, state: 'input-available', input: { title } })
				p.input = { title }
				if (it.status === 'failed') p.state = 'output-error'
				else if (it.type === 'webSearch' || done(it.status)) p.state = 'output-available'
				return
			}
		}
	}

	private approval(e: ServerEvent) {
		const approval: Approval = { id: e.key, kind: e.kind, reason: e.reason }
		let p = e.itemId ? this.parts.get(e.itemId) : undefined
		if (!p || !(p.type === 'tool-runCommand' || p.type === 'tool-editFiles')) {
			p =
				e.kind === 'fileChange'
					? this.add(e.itemId ?? e.key, { type: 'tool-editFiles', toolCallId: e.itemId ?? e.key, state: 'approval-requested', input: { changes: [] } })
					: this.add(e.itemId ?? e.key, { type: 'tool-runCommand', toolCallId: e.itemId ?? e.key, state: 'approval-requested', input: { command: displayCommand(e.command), cwd: e.cwd } })
		}
		if (p.type === 'tool-runCommand' && e.command) p.input = { command: displayCommand(e.command), cwd: e.cwd }
		p.approval = approval
		if (p.state !== 'output-available' && p.state !== 'output-error' && p.state !== 'output-denied') p.state = 'approval-requested'
		this.parts.set(e.key, p)
	}

	// When a turn ends, nothing is streaming any more; unanswered approvals were dropped by the server.
	private settle() {
		for (const m of this.messages)
			for (const p of m.parts) {
				if ((p.type === 'text' || p.type === 'reasoning') && p.state === 'streaming') p.state = 'done'
			}
	}

	snapshot(): { messages: ChatMessage[]; busy: boolean } {
		return {
			busy: this.busy,
			messages: this.messages.map((m) => ({
				...m,
				parts: m.parts.map((p) => {
					const c: any = { ...p }
					if ('input' in p) c.input = { ...p.input }
					if ('output' in p && p.output) c.output = { ...p.output }
					if ('approval' in p && p.approval) c.approval = { ...p.approval }
					if ('data' in p) c.data = { ...p.data }
					return c as ChatPart
				}),
			})),
		}
	}
}

export const messageText = (m: ChatMessage) =>
	m.parts
		.filter((p): p is TextPart => p.type === 'text')
		.map((p) => p.text)
		.join('\n\n')
