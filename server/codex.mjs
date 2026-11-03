// Chat panel backend: one `codex app-server` child (stdio JSON-RPC), one thread per canvas.
// Codex runs on the machine's ChatGPT sign-in (`codex login`); no API key is involved.
// Codex edits the canvas the same way a terminal agent does — by running bin/toucan.mjs —
// so there is one path for both. Approval requests are forwarded to the browser.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import readline from 'node:readline'

// Who answers, per message. Fast suits most canvas work; Thorough is for planning and hard layout. Both use
// Codex's current default model unless set here, so they don't go stale as models change. Measured on real
// requests, its low effort put correct edits on the canvas about 3x sooner; a lighter model was only a little
// faster than that and drew worse.
const MODES = {
	fast: { model: process.env.TOUCAN_CHAT_FAST_MODEL, effort: process.env.TOUCAN_CHAT_FAST_EFFORT ?? 'low' },
	thorough: { model: process.env.TOUCAN_CHAT_THOROUGH_MODEL, effort: process.env.TOUCAN_CHAT_THOROUGH_EFFORT ?? 'medium' },
}

const instructions = (canvas, engine = 'tldraw', notes = null, data = '') => `You are the agent in toucan's chat panel. The user is looking at the ${engine} canvas "${canvas}" in their browser and can also edit it by hand. They are watching the canvas and waiting, so speed is the point.
Change the canvas with \`node bin/toucan.mjs --canvas ${canvas} <cmd>\`. AGENTS.md is already in your context: don't read it again.
Each message comes with a <canvas_brief> of what is on the canvas and selected. Don't re-read what it already tells you. If they say "this" or "these" and the brief shows nothing selected, run \`selection\`; if it's still unclear, ask them rather than guess.
Get something on the canvas first, then improve it. For a clear request, your first or second tool call should be the visible edit: pipe a small Mermaid flowchart to \`import - --format mermaid --label "what this is"\`, or run \`exec -e '...' --label "what this is"\`. Otherwise pick sensible defaults rather than asking. Don't research, read source files or write helper files unless the request can't be done without them. When you do write a file, research or a helper script, put it only in \`${data}/${canvas}.files/\`, and name the file in your reply. Keep the user's hand edits, and make small, reversible changes.
\`toucan.node\` changes only what you pass and places a new box somewhere free; \`import\` also lays new boxes out beside what they connect to, so prefer it for anything connected. \`import\` only adds and updates: when a request replaces something ("between", "instead of", "move"), also remove what it replaces, with \`toucan.remove('edge:a->b')\` for an arrow. Draw a flow in one direction, without arrows looping back to the start.
Once your edit is on the canvas, take one \`screenshot\` and fix anything overlapping, cut off or mislabelled, unless you only changed text or colour. Then reply in a line or two with what you changed.
Before redoing a chore, check \`routine list\` and \`routine run NAME\`. When the user asks to bank what you did, write a routine that works from the canvas alone, try it with \`exec\`, and \`routine save NAME FILE --title T --description D --engines E\`. For lasting new behaviour on one canvas, use \`script put\`.
Sticky notes on tldraw are addressed to you: when asked to handle them, run \`notes\`, act on each using where it sits, then \`notes resolve KEY --reply "…"\`; never delete one.
When the user gives broad feedback or asks what you'd change, answer on the canvas as a proposal (\`import - --format mermaid --propose\`, or \`proposed: true\` in the helpers) and leave accepting it to them.
For a new diagram of a common kind, start from a template rather than placing boxes by hand: \`toucan templates\` lists them (flowchart, swimlane, org chart, sequence, roadmap and more), and the layouts behind them are described in AGENTS.md. After a layout change, \`routine run check-diagram\` tells you what's wrong and where in a moment; prefer it to a screenshot, and \`routine run clean-up\` or \`lay-out-again\` to nudging boxes by hand.
Name a point with \`versions save LABEL\` before a sweeping change. Only \`versions restore\` when asked.
People also leave comment threads on shapes and regions; the brief lists the open ones. When a message is about one ("#3"), do the work and answer there with \`threads reply 3 "…"\`, as well as briefly here. \`threads show 3\` has its history. Leave closing it to them unless they ask.
A message may arrive while you are working: it adjusts what you're doing, so take it into account and carry on.${engine === 'tldraw' ? '' : `
This canvas runs ${engine}: in exec code \`editor\` is the ${engine} API and \`tl\` its module. Prefer \`import\` for structure.`}${notes ? `
This deployment adds its own agent notes in ${notes}: read them once at the start of this conversation, and follow them.` : ''}`

// An agent working on one comment thread. Its last message in a turn becomes its reply there.
const threadInstructions = (canvas, id, engine = 'tldraw', data = '') => `You are an agent working on comment thread #${id}, which someone attached to part of the ${engine} canvas "${canvas}". Others may be working on the canvas and in other threads at the same time, so keep to what this thread is about.
Change the canvas with \`node bin/toucan.mjs --canvas ${canvas} <cmd>\`, giving each change a \`--label "#${id}: what this is"\`. AGENTS.md is already in your context: don't read it again. \`toucan.node\` changes only what you pass; \`import - --format mermaid\` lays out new connected boxes and only adds, so also remove what a request replaces. Trust the <canvas_brief> rather than re-reading the canvas, and get the visible edit done first.
Your final message is posted as your reply in the thread, so write it for the people reading there: a line or two on what you did or found, and a clear question if you need a decision. If the request is for research or an opinion rather than an edit, answer in that reply. A message may arrive while you work: take it into account and carry on.
Put any file you write, research or a helper script, only in \`${data}/${canvas}.files/\`, and name it in your reply.
Leave closing the thread to people, unless they ask you to close it (\`threads close ${id}\`).`

export class CodexChat {
	constructor({ root, port, engineOf = () => 'tldraw', data = join(root, 'canvases'), brief = async () => null, direct = async () => null, onThread = () => {} }) {
		this.onThread = onThread // (canvas, id, event): what's happening in a comment thread's own conversation
		this.engineOf = engineOf
		this.brief = brief // (canvas) => the canvas brief for a message
		this.direct = direct // (canvas, text) => a reply, if this message needed no agent
		this.sending = new Map() // canvas -> the message being handed over, so they go in order
		// Deployment-specific instructions for the chat agent (extensions, house canvases): <data>/AGENTS.md.
		this.notes = join(data, 'AGENTS.md')
		this.data = data
		this.root = root
		this.port = port
		this.proc = null
		this.seq = 0
		this.calls = new Map()
		this.threads = new Map() // canvas -> threadId
		this.sockets = new Map() // canvas -> Set<ws>
		this.history = new Map() // canvas -> recent events for late joiners
		this.approvals = new Map() // approval key -> {rpcId, canvas}
		this.turns = new Map() // canvas -> active turnId
		this.state = join(root, '.toucan', 'threads.json')
		if (existsSync(this.state)) this.saved = JSON.parse(readFileSync(this.state, 'utf8'))
		else this.saved = {}
	}

	attach(ws, canvas) {
		if (!canvas) return ws.close()
		if (!this.sockets.has(canvas)) this.sockets.set(canvas, new Set())
		this.sockets.get(canvas).add(ws)
		ws.send(JSON.stringify({ type: 'history', events: this.history.get(canvas) ?? [] }))
		ws.on('close', () => this.sockets.get(canvas).delete(ws))
		// Warm up now, so the first message doesn't wait for Codex to start.
		this.start().catch(() => {})
		ws.on('message', async (raw) => {
			const msg = JSON.parse(raw)
			try {
				if (msg.type === 'send') await this.enqueue(canvas, msg.text, msg.mode)
				else if (msg.type === 'new') await this.reset(canvas)
				else if (msg.type === 'interrupt') await this.interrupt(canvas)
				else if (msg.type === 'approve') this.answer(msg.key, msg.decision)
			} catch (e) {
				this.emit(canvas, { type: 'error', message: String(e.message ?? e) })
			}
		})
	}

	emit(canvas, event, keep = true) {
		// A key like "name#3" is comment thread 3's conversation; a canvas name can't contain a #.
		const [name, thread] = canvas.split('#')
		if (thread) return this.onThread(name, Number(thread), event)
		if (keep) {
			const h = this.history.get(canvas) ?? []
			h.push(event)
			this.history.set(canvas, h.slice(-400))
		}
		for (const ws of this.sockets.get(canvas) ?? []) ws.send(JSON.stringify(event))
	}

	// ---- JSON-RPC over stdio -------------------------------------------------
	start() {
		if (this.proc) return this.ready
		this.proc = spawn('codex', ['app-server'], { cwd: this.root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } })
		this.proc.stderr.on('data', (d) => process.stderr.write(`[codex] ${d}`))
		// No codex here: the canvas still works, and the panel says why the chat doesn't.
		this.proc.on('error', (e) => {
			console.error(`[codex] couldn't start: ${e.message}`)
			this.proc = null
			for (const [, c] of this.calls) c.reject(new Error('Codex is not available: install the Codex CLI to use the chat.'))
			this.calls.clear()
		})
		this.proc.on('exit', (code) => {
			console.error(`[codex] app-server exited (${code})`)
			this.proc = null
			this.threads.clear()
			// Nothing will say these turns ended, so say it here.
			for (const key of [...this.turns.keys()]) {
				this.turns.delete(key)
				this.emit(key, { type: 'turn', status: 'failed', error: 'Codex stopped unexpectedly.' })
			}
			for (const [, c] of this.calls) c.reject(new Error('codex app-server exited'))
			this.calls.clear()
		})
		readline.createInterface({ input: this.proc.stdout }).on('line', (line) => this.onLine(line))
		this.ready = (async () => {
			await this.call('initialize', { clientInfo: { name: 'toucan', title: 'toucan', version: '0.6.0' }, capabilities: null })
			this.notify('initialized', {})
			// Without it, turns use the machine's own Codex config, which may name a different model.
			const models = await this.call('model/list', {}).catch(() => null)
			this.defaultModel = models?.data?.find((m) => m.isDefault)?.id
		})()
		return this.ready
	}

	call(method, params) {
		const id = ++this.seq
		return new Promise((resolve, reject) => {
			this.calls.set(id, { resolve, reject })
			this.proc.stdin.write(JSON.stringify({ method, id, params }) + '\n')
		})
	}
	notify(method, params) {
		this.proc.stdin.write(JSON.stringify({ method, params }) + '\n')
	}
	reply(id, result) {
		this.proc?.stdin.write(JSON.stringify({ id, result }) + '\n')
	}

	onLine(line) {
		let msg
		try {
			msg = JSON.parse(line)
		} catch {
			return
		}
		if (msg.id !== undefined && !msg.method) {
			const c = this.calls.get(msg.id)
			this.calls.delete(msg.id)
			if (c) msg.error ? c.reject(new Error(msg.error.message)) : c.resolve(msg.result)
			return
		}
		const p = msg.params ?? {}
		const canvas = this.canvasFor(p.threadId ?? p.turn?.threadId)
		if (msg.id !== undefined) return this.onServerRequest(msg, canvas)
		if (!canvas) return
		switch (msg.method) {
			// Streaming deltas go to open tabs only; the completed item carries the final text.
			case 'item/agentMessage/delta':
				return this.emit(canvas, { type: 'delta', itemId: p.itemId, text: p.delta }, false)
			case 'item/reasoning/summaryTextDelta':
				return this.emit(canvas, { type: 'reasoning', itemId: p.itemId, index: p.summaryIndex, text: p.delta }, false)
			case 'item/commandExecution/outputDelta':
				return this.emit(canvas, { type: 'output', itemId: p.itemId, text: p.delta }, false)
			case 'item/fileChange/patchUpdated':
				return this.emit(canvas, { type: 'item', phase: 'updated', item: slim({ type: 'fileChange', id: p.itemId, status: 'inProgress', changes: p.changes }) }, false)
			case 'turn/plan/updated': {
				// Only the latest plan of a turn is worth replaying to late joiners.
				const h = this.history.get(canvas)
				if (h) this.history.set(canvas, h.filter((e) => !(e.type === 'plan' && e.turnId === p.turnId)))
				return this.emit(canvas, { type: 'plan', turnId: p.turnId, explanation: p.explanation, steps: p.plan })
			}
			case 'item/started':
			case 'item/completed':
				return this.emit(canvas, { type: 'item', phase: msg.method.split('/')[1], item: slim(p.item) })
			case 'turn/started':
				this.turns.set(canvas, p.turn?.id)
				return this.emit(canvas, { type: 'turn', status: 'inProgress', turnId: p.turn?.id })
			case 'turn/completed':
				this.turns.delete(canvas)
				return this.emit(canvas, { type: 'turn', status: p.turn?.status, error: p.turn?.error?.message })
			case 'error':
				if (p.willRetry) return // Codex is retrying: not a failure yet
				return this.emit(canvas, { type: 'error', message: p.error?.message ?? JSON.stringify(p) })
		}
	}

	onServerRequest(msg, canvas) {
		const approvals = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval']
		if (!canvas || !approvals.includes(msg.method)) {
			// Anything we don't render is declined rather than left hanging.
			return this.reply(msg.id, { decision: 'decline' })
		}
		const key = `a${msg.id}`
		this.approvals.set(key, { rpcId: msg.id, canvas })
		const p = msg.params
		this.emit(canvas, { type: 'approval', key, kind: msg.method.split('/')[1], itemId: p.itemId, command: p.command, cwd: p.cwd, reason: p.reason })
	}

	answer(key, decision) {
		const a = this.approvals.get(key)
		if (!a) return
		this.approvals.delete(key)
		this.reply(a.rpcId, { decision: decision === 'accept' ? 'accept' : 'decline' })
		this.emit(a.canvas, { type: 'approved', key, decision })
	}

	canvasFor(threadId) {
		for (const [c, t] of this.threads) if (t === threadId) return c
		return null
	}

	// ---- threads ---------------------------------------------------------------
	async thread(canvas) {
		await this.start()
		if (this.threads.has(canvas)) return this.threads.get(canvas)
		const [name, comment] = canvas.split('#')
		const developerInstructions = comment ? threadInstructions(name, comment, this.engineOf(name), this.data) : instructions(name, this.engineOf(name), existsSync(this.notes) ? this.notes : null, this.data)
		const opts = { cwd: this.root, approvalPolicy: 'on-request', developerInstructions, serviceName: 'toucan' }
		let res
		if (this.saved[canvas]) {
			try {
				res = await this.call('thread/resume', { threadId: this.saved[canvas], ...opts })
			} catch {
				res = null
			}
		}
		res ??= await this.call('thread/start', { ...opts, sandbox: 'workspace-write' })
		const id = res.thread.id
		this.threads.set(canvas, id)
		this.saved[canvas] = id
		mkdirSync(join(this.root, '.toucan'), { recursive: true })
		writeFileSync(this.state, JSON.stringify(this.saved, null, 2))
		return id
	}

	/** Messages for a canvas are handed over one at a time, so a quick follow-up finds the turn it should join. */
	/** Hands a comment thread's latest to its own conversation, or to the turn already running there. */
	askThread(canvas, id, prompt, mode) {
		return this.queue(`${canvas}#${id}`, prompt, mode)
	}

	stopThread(canvas, id) {
		return this.interrupt(`${canvas}#${id}`)
	}

	/** An archived canvas's thread conversations shouldn't be picked up by a later canvas of that name. */
	forgetThreads(canvas) {
		for (const key of Object.keys(this.saved)) if (key.startsWith(`${canvas}#`)) delete this.saved[key]
		for (const key of [...this.turns.keys()]) if (key.startsWith(`${canvas}#`)) this.interrupt(key).catch(() => {}) // don't let it write on after the move
		for (const key of this.threads.keys()) if (key.startsWith(`${canvas}#`)) setTimeout(() => this.threads.delete(key), 1000)
	}

	queue(key, text, mode) {
		const next = (this.sending.get(key) ?? Promise.resolve()).catch(() => {}).then(() => this.send(key, text, mode))
		this.sending.set(key, next)
		return next
	}

	async enqueue(canvas, text, mode) {
		this.emit(canvas, { type: 'user', text })
		// A direct run can take a while; it doesn't hold up messages for the agent behind it.
		const reply = await this.direct(canvas, text)
		if (reply) {
			this.emit(canvas, { type: 'item', phase: 'completed', item: { id: `direct-${++this.seq}`, type: 'agentMessage', text: reply } })
			return this.emit(canvas, { type: 'direct-done' }, false)
		}
		return this.queue(canvas, text, mode)
	}

	async send(canvas, text, mode) {
		// Agents may write to their canvas's folder and no other part of the data directory: not AGENTS.md, routines or other canvases.
		const folder = join(this.data, `${canvas.split('#')[0]}.files`)
		mkdirSync(folder, { recursive: true })
		const threadId = await this.thread(canvas)
		const message = { type: 'text', text, text_elements: [] }
		// Mid-turn, a message adjusts the work in progress rather than waiting for it to finish.
		const running = this.turns.get(canvas)
		if (running) {
			try {
				return await this.call('turn/steer', { threadId, expectedTurnId: running, input: [message] })
			} catch {
				// That turn just ended: this message starts the next one.
			}
		}
		const brief = await this.brief(canvas.split('#')[0]).catch(() => null)
		const { model = this.defaultModel, effort } = MODES[mode] ?? MODES.fast
		const started = await this.call('turn/start', {
			threadId,
			input: [...(brief ? [{ type: 'text', text: brief, text_elements: [] }] : []), message],
			...(model && { model }),
			...(effort && { effort }),
			cwd: this.root,
			summary: 'auto', // reasoning summaries feed the chat panel's "Thinking" line
			// The CLI talks to this server over loopback, so the sandbox needs network.
			sandboxPolicy: { type: 'workspaceWrite', writableRoots: [this.root, folder], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
		})
		if (started?.turn?.id && started.turn.status === 'inProgress') this.turns.set(canvas, started.turn.id)
	}

	async interrupt(canvas) {
		const threadId = this.threads.get(canvas), turnId = this.turns.get(canvas)
		if (threadId && turnId) await this.call('turn/interrupt', { threadId, turnId }).catch(() => {})
		else this.emit(canvas, { type: 'direct-done' }, false) // nothing to stop: don't leave the panel waiting
	}

	async reset(canvas) {
		this.threads.delete(canvas)
		delete this.saved[canvas]
		this.history.set(canvas, [])
		this.emit(canvas, { type: 'history', events: [] }, false)
	}
}

// Keep item payloads small for the browser; command output can be large.
function slim(item) {
	if (!item) return item
	const out = { id: item.id, type: item.type }
	if (item.type === 'agentMessage') out.text = item.text
	if (item.type === 'userMessage') return null
	if (item.type === 'commandExecution') Object.assign(out, { command: item.command, status: item.status, exitCode: item.exitCode, durationMs: item.durationMs, output: item.aggregatedOutput?.slice(-3000) })
	if (item.type === 'fileChange') {
		out.status = item.status
		out.paths = item.changes?.map((c) => c.path)
		out.changes = item.changes?.map((c) => ({ path: c.path, kind: c.kind?.type, diff: c.diff?.length > 6000 ? c.diff.slice(0, 6000) + '\n…' : c.diff }))
	}
	if (item.type === 'reasoning') out.summary = item.summary
	if (item.type === 'plan') out.text = item.text
	if (item.type === 'mcpToolCall') Object.assign(out, { server: item.server, tool: item.tool, status: item.status })
	if (item.type === 'dynamicToolCall') Object.assign(out, { tool: item.tool, status: item.status })
	if (item.type === 'webSearch') Object.assign(out, { query: item.query })
	return out
}
